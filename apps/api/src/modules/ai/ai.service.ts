import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface MessageHistory {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
  responseTime?: number;
  /** Fuentes RAG usadas para construir la respuesta (si las hubo) */
  sources?: string[];
}

export interface GenerateOptions {
  /** Reemplaza el system prompt base (p.ej. el personalizado por estudiante) */
  systemPrompt?: string;
  /** Fragmentos de contenido de curso recuperados por el sistema RAG */
  context?: string[];
}

export interface StudentContext {
  name: string;
  currentCourse?: string;
  progress?: number;
}

/** Máximo de mensajes previos que se envían como contexto conversacional */
const MAX_HISTORY_MESSAGES = 20;
/**
 * gpt-5-mini es un modelo de razonamiento: los `reasoning_tokens` se descuentan
 * de este presupuesto ANTES de emitir texto visible. Un valor bajo (p.ej. 300)
 * devuelve `content` vacío sin error. Ver DECISIONS.md.
 */
const MAX_COMPLETION_TOKENS = 2000;
const MAX_RETRIES = 3;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai?: OpenAI;
  private readonly model: string;
  private readonly reasoningEffort: 'low' | 'medium' | 'high';

  /**
   * System prompt base para el asistente de estudiantes
   */
  private readonly baseSystemPrompt = `Eres un asistente educativo amigable y servicial para estudiantes de una plataforma de cursos online.

Tu objetivo es:
- Ayudar a los estudiantes con dudas sobre el contenido de sus cursos
- Motivar y dar apoyo emocional cuando sea necesario
- Sugerir recursos y técnicas de estudio
- Responder de forma clara, concisa y amigable

Reglas:
- No des respuestas a exámenes directamente, guía al estudiante para que llegue a la respuesta
- Si no sabes algo, admítelo y sugiere buscar ayuda adicional
- Mantén un tono positivo y motivador
- Usa ejemplos prácticos cuando sea posible`;

  constructor(private readonly configService: ConfigService) {
    this.model = this.configService.get<string>('OPENAI_CHAT_MODEL') || 'gpt-5-mini';
    this.reasoningEffort =
      (this.configService.get<'low' | 'medium' | 'high'>('OPENAI_REASONING_EFFORT')) || 'low';

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log(`OpenAI inicializado (modelo: ${this.model})`);
    } else {
      this.logger.warn('OPENAI_API_KEY no configurada: se usarán respuestas placeholder');
    }
  }

  /**
   * Genera respuesta del asistente llamando a OpenAI.
   * Si no hay API key configurada, degrada a una respuesta placeholder
   * en lugar de romper el flujo del chat.
   */
  async generateResponse(
    userMessage: string,
    history: MessageHistory[] = [],
    options: GenerateOptions = {}
  ): Promise<AiResponse> {
    this.logger.debug(`Generando respuesta para: "${userMessage.substring(0, 50)}..."`);

    if (!this.openai) {
      return this.generatePlaceholderResponse();
    }

    const startedAt = Date.now();
    const messages = this.buildMessages(userMessage, history, options);

    const completion = await this.callWithRetry(() =>
      this.openai!.chat.completions.create({
        model: this.model,
        messages,
        // gpt-5-mini NO admite `max_tokens` ni `temperature` != 1.
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: this.reasoningEffort,
      })
    );

    const content = completion.choices?.[0]?.message?.content?.trim();

    if (!content) {
      this.logger.warn(
        `Respuesta vacía de OpenAI (finish_reason: ${completion.choices?.[0]?.finish_reason}). ` +
          'Probablemente el presupuesto de tokens se agotó en razonamiento.'
      );
      return {
        content:
          'Lo siento, no he podido generar una respuesta esta vez. ¿Puedes reformular tu pregunta?',
        tokensUsed: completion.usage?.total_tokens ?? 0,
        model: completion.model ?? this.model,
        responseTime: Date.now() - startedAt,
      };
    }

    return {
      content,
      tokensUsed: completion.usage?.total_tokens ?? 0,
      model: completion.model ?? this.model,
      responseTime: Date.now() - startedAt,
    };
  }

  /**
   * Genera la respuesta usando contexto recuperado del sistema RAG.
   * El contexto se inyecta en el system prompt para que el modelo
   * responda basándose en el contenido real de los cursos.
   */
  async generateResponseWithRAG(
    userMessage: string,
    history: MessageHistory[] = [],
    relevantContext?: string[],
    options: GenerateOptions = {}
  ): Promise<AiResponse> {
    const context = relevantContext?.filter((c) => c?.trim()) ?? [];

    if (context.length === 0) {
      this.logger.debug('Sin contexto RAG relevante: usando generación estándar');
      return this.generateResponse(userMessage, history, options);
    }

    this.logger.debug(`Generando respuesta con ${context.length} fragmentos de contexto RAG`);

    const response = await this.generateResponse(userMessage, history, {
      ...options,
      context,
    });

    return { ...response, sources: context };
  }

  /**
   * Streaming de respuestas token a token (usado por el endpoint SSE).
   */
  async *generateStreamResponse(
    userMessage: string,
    history: MessageHistory[] = [],
    options: GenerateOptions = {}
  ): AsyncGenerator<string> {
    if (!this.openai) {
      const placeholder = this.generatePlaceholderResponse();
      for (const word of placeholder.content.split(' ')) {
        yield word + ' ';
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return;
    }

    const messages = this.buildMessages(userMessage, history, options);

    const stream = await this.callWithRetry(() =>
      this.openai!.chat.completions.create({
        model: this.model,
        messages,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        reasoning_effort: this.reasoningEffort,
        stream: true,
      })
    );

    for await (const chunk of stream) {
      const token = chunk.choices?.[0]?.delta?.content;
      if (token) {
        yield token;
      }
    }
  }

  /**
   * Personaliza el system prompt con el contexto del estudiante para que
   * el asistente pueda dirigirse a él por su nombre y adaptar el tono
   * a su progreso actual.
   */
  buildContextualSystemPrompt(studentContext: StudentContext): string {
    const lines = [this.baseSystemPrompt, '', 'Contexto del estudiante:', `- Nombre: ${studentContext.name}`];

    if (studentContext.currentCourse) {
      lines.push(`- Curso actual: ${studentContext.currentCourse}`);
    }

    if (typeof studentContext.progress === 'number') {
      lines.push(`- Progreso en el curso: ${studentContext.progress}%`);
      lines.push(this.buildEncouragementHint(studentContext.progress));
    }

    lines.push('', `Dirígete a ${studentContext.name} por su nombre y adapta los ejemplos a su curso actual.`);

    return lines.join('\n');
  }

  /**
   * Ajusta el tono del asistente según lo avanzado que vaya el estudiante.
   */
  private buildEncouragementHint(progress: number): string {
    if (progress >= 80) {
      return '- Está a punto de terminar: refuerza su constancia y propón repasos finales.';
    }
    if (progress >= 40) {
      return '- Va por la mitad: reconoce su avance y ayúdale a mantener el ritmo.';
    }
    if (progress > 0) {
      return '- Acaba de empezar: sé especialmente claro con los fundamentos.';
    }
    return '- Aún no ha empezado el curso: ayúdale a dar el primer paso.';
  }

  /**
   * Construye el array de mensajes que se envía a OpenAI:
   * system prompt (+ contexto RAG) + historial acotado + mensaje actual.
   */
  private buildMessages(
    userMessage: string,
    history: MessageHistory[],
    options: GenerateOptions
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    let systemPrompt = options.systemPrompt || this.baseSystemPrompt;

    if (options.context?.length) {
      systemPrompt += `\n\n${this.buildContextBlock(options.context)}`;
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // El historial puede traer mensajes 'system' propios (contexto inicial);
    // se conservan, pero se acota el total para no disparar el coste.
    for (const message of history.slice(-MAX_HISTORY_MESSAGES)) {
      messages.push({ role: message.role, content: message.content } as OpenAI.Chat.ChatCompletionMessageParam);
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  /**
   * Envuelve los fragmentos recuperados con instrucciones de uso, para que el
   * modelo priorice el material del curso y no invente cuando no lo cubre.
   */
  private buildContextBlock(context: string[]): string {
    const fragments = context
      .map((fragment, index) => `[Fragmento ${index + 1}]\n${fragment}`)
      .join('\n\n');

    return `Material del curso relevante para esta pregunta:

${fragments}

Instrucciones sobre el material:
- Basa tu respuesta principalmente en estos fragmentos, son el contenido real del curso del estudiante.
- Si los fragmentos no cubren la pregunta, dilo con claridad y responde con tu conocimiento general, avisando de que no procede del material del curso.
- No inventes referencias a lecciones o secciones que no aparezcan en los fragmentos.`;
  }

  /**
   * Reintento con backoff exponencial para errores transitorios
   * (429 rate limit y 5xx). Los errores de cliente (4xx) no se reintentan.
   */
  private async callWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error) || attempt === MAX_RETRIES - 1) {
          break;
        }

        const delayMs = 2 ** attempt * 500;
        this.logger.warn(
          `Error transitorio de OpenAI (intento ${attempt + 1}/${MAX_RETRIES}), reintentando en ${delayMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.error(`Error llamando a OpenAI: ${this.describeError(lastError)}`);
    throw new ServiceUnavailableException(
      'El asistente no está disponible en este momento. Inténtalo de nuevo en unos segundos.'
    );
  }

  private isRetryable(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 429 || (typeof status === 'number' && status >= 500);
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Genera una respuesta placeholder para desarrollo (sin API key).
   */
  private generatePlaceholderResponse(): AiResponse {
    const responses = [
      '¡Hola! Soy tu asistente de estudios. Veo que tienes una pregunta interesante. Para ayudarte mejor, ¿podrías darme más detalles sobre el tema específico del curso en el que necesitas ayuda?',
      'Entiendo tu duda. Este es un tema importante que muchos estudiantes encuentran desafiante. Te sugiero que revisemos los conceptos paso a paso. ¿Por dónde te gustaría empezar?',
      '¡Excelente pregunta! Esto demuestra que estás pensando críticamente sobre el material. Déjame darte una explicación que te ayude a entender mejor el concepto.',
      'Gracias por compartir tu pregunta. Para darte la mejor ayuda posible, necesito que OpenAI esté configurado. Por ahora, te recomiendo revisar el material del curso y volver con preguntas específicas.',
    ];

    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    return {
      content: `[RESPUESTA PLACEHOLDER - Implementar OpenAI]\n\n${randomResponse}`,
      tokensUsed: 0,
      model: 'placeholder',
    };
  }

  /**
   * Verifica si OpenAI está configurado
   */
  isConfigured(): boolean {
    return !!this.configService.get<string>('OPENAI_API_KEY');
  }
}
