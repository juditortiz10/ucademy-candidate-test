import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage, ChatMessageDocument } from './schemas/chat-message.schema';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { AiService, MessageHistory } from '../ai/ai.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { StudentService } from '../student/student.service';
import { SendMessageDto } from './dto/send-message.dto';
import { GetHistoryDto } from './dto/get-history.dto';

/** Nº de fragmentos RAG que se inyectan como contexto en cada respuesta */
const RAG_CONTEXT_CHUNKS = 4;
/** Nº de mensajes previos que se mantienen como contexto conversacional */
const HISTORY_CONTEXT_SIZE = 20;
/** Caracteres del primer mensaje que se usan para titular la conversación */
const TITLE_MAX_LENGTH = 60;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  // Cache de historial de conversaciones en memoria para optimizar
  private conversationCache: Map<string, MessageHistory[]> = new Map();

  constructor(
    @InjectModel(ChatMessage.name) private chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    private readonly aiService: AiService,
    private readonly knowledgeService: KnowledgeService,
    private readonly studentService: StudentService
  ) {}

  /**
   * Envía un mensaje y devuelve la respuesta del asistente.
   *
   * Flujo: resolver conversación → cargar historial previo → guardar mensaje
   * del usuario → recuperar contexto RAG → llamar a OpenAI con ese contexto →
   * persistir la respuesta y sincronizar cache y contadores.
   */
  async sendMessage(dto: SendMessageDto) {
    const { studentId, message, conversationId } = dto;

    const conversation = await this.resolveConversation(studentId, conversationId);
    const conversationIdStr = conversation._id.toString();

    // El historial se carga ANTES de guardar el mensaje nuevo: representa el
    // contexto previo, y el mensaje actual se envía aparte a OpenAI.
    const history = await this.getConversationHistory(conversationIdStr);

    const userMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      role: 'user',
      content: message,
    });

    try {
      const [context, systemPrompt] = await Promise.all([
        this.retrieveContext(message),
        this.buildStudentSystemPrompt(studentId),
      ]);

      const aiResponse = await this.aiService.generateResponseWithRAG(
        message,
        history,
        context.map((result) => result.content),
        { systemPrompt }
      );

      const assistantMessage = await this.chatMessageModel.create({
        conversationId: conversation._id,
        role: 'assistant',
        content: aiResponse.content,
        metadata: {
          tokensUsed: aiResponse.tokensUsed,
          model: aiResponse.model,
          responseTime: aiResponse.responseTime,
        },
      });

      this.appendToCache(conversationIdStr, [
        { role: 'user', content: message },
        { role: 'assistant', content: aiResponse.content },
      ]);

      await this.conversationModel.findByIdAndUpdate(conversation._id, {
        lastMessageAt: new Date(),
        $inc: { messageCount: 2 },
        ...(conversation.messageCount === 0 ? { title: this.buildTitle(message) } : {}),
      });

      return {
        conversationId: conversation._id,
        userMessage,
        assistantMessage,
        // Permite al frontend mostrar en qué material se basó la respuesta.
        sources: context.map((result) => ({
          courseId: result.courseId,
          score: Number(result.score.toFixed(4)),
          excerpt: result.content.slice(0, 200),
        })),
      };
    } catch (error) {
      // Si la IA falla, el mensaje del usuario quedaría huérfano y
      // contaminaría el contexto de la siguiente llamada: se revierte.
      await this.chatMessageModel.deleteOne({ _id: userMessage._id });
      throw error;
    }
  }

  /**
   * Streaming de la respuesta token a token (SSE).
   * Persiste el mensaje completo una vez cerrado el stream.
   */
  async *streamResponse(dto: SendMessageDto): AsyncGenerator<
    | { type: 'start'; conversationId: string }
    | { type: 'token'; content: string }
    | { type: 'done'; conversationId: string; messageId: string; content: string }
  > {
    const { studentId, message, conversationId } = dto;

    const conversation = await this.resolveConversation(studentId, conversationId);
    const conversationIdStr = conversation._id.toString();

    const history = await this.getConversationHistory(conversationIdStr);

    const userMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      role: 'user',
      content: message,
    });

    yield { type: 'start', conversationId: conversationIdStr };

    const startedAt = Date.now();
    let fullContent = '';

    try {
      const [context, systemPrompt] = await Promise.all([
        this.retrieveContext(message),
        this.buildStudentSystemPrompt(studentId),
      ]);

      const stream = this.aiService.generateStreamResponse(message, history, {
        systemPrompt,
        context: context.map((result) => result.content),
      });

      for await (const token of stream) {
        fullContent += token;
        yield { type: 'token', content: token };
      }
    } catch (error) {
      await this.chatMessageModel.deleteOne({ _id: userMessage._id });
      throw error;
    }

    const assistantMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: fullContent,
      metadata: { model: 'stream', responseTime: Date.now() - startedAt },
    });

    this.appendToCache(conversationIdStr, [
      { role: 'user', content: message },
      { role: 'assistant', content: fullContent },
    ]);

    await this.conversationModel.findByIdAndUpdate(conversation._id, {
      lastMessageAt: new Date(),
      $inc: { messageCount: 2 },
      ...(conversation.messageCount === 0 ? { title: this.buildTitle(message) } : {}),
    });

    yield {
      type: 'done',
      conversationId: conversationIdStr,
      messageId: assistantMessage._id.toString(),
      content: fullContent,
    };
  }

  /**
   * Inicia una nueva conversación para el estudiante
   */
  async startNewConversation(studentId: string, initialContext?: string) {
    const conversation = await this.createConversation(studentId);
    const conversationIdStr = conversation._id.toString();

    // Cada conversación arranca con su propio array de historial. Reutilizar el
    // array cacheado de una conversación anterior compartiría la referencia
    // entre ambas entradas del Map (ver DECISIONS.md - bug encontrado).
    const history: MessageHistory[] = [];

    if (initialContext) {
      history.push({
        role: 'system',
        content: initialContext,
      });
    }

    this.conversationCache.set(conversationIdStr, history);

    // Marcar conversaciones anteriores como inactivas
    await this.conversationModel.updateMany(
      { studentId: new Types.ObjectId(studentId), _id: { $ne: conversation._id } },
      { isActive: false }
    );

    this.logger.log(`Nueva conversación iniciada: ${conversationIdStr}`);

    return conversation;
  }

  /**
   * Historial de chat paginado, en orden cronológico (más antiguos primero).
   *
   * Sin `conversationId` se devuelve la conversación activa más reciente del
   * estudiante, que es lo que necesita el chat al abrirse.
   */
  async getHistory(studentId: string, options: GetHistoryDto = {}) {
    const { conversationId, page = 1, limit = 20 } = options;

    const conversation = conversationId
      ? await this.findOwnedConversation(studentId, conversationId)
      : await this.conversationModel
          .findOne({ studentId: new Types.ObjectId(studentId) })
          .sort({ lastMessageAt: -1, createdAt: -1 });

    if (!conversation) {
      return {
        conversation: null,
        messages: [],
        pagination: { page, limit, total: 0, totalPages: 0, hasMore: false },
      };
    }

    const filter = { conversationId: conversation._id };

    const [total, messages] = await Promise.all([
      this.chatMessageModel.countDocuments(filter),
      this.chatMessageModel
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return {
      conversation,
      messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * Elimina una conversación del estudiante: sus mensajes, la propia
   * conversación y su entrada en el cache en memoria.
   */
  async deleteHistory(studentId: string, conversationId: string) {
    const conversation = await this.findOwnedConversation(studentId, conversationId);

    if (!conversation) {
      throw new NotFoundException(
        `Conversación ${conversationId} no encontrada para el estudiante ${studentId}`
      );
    }

    const { deletedCount } = await this.chatMessageModel.deleteMany({
      conversationId: conversation._id,
    });

    await this.conversationModel.deleteOne({ _id: conversation._id });
    this.conversationCache.delete(conversationId);

    this.logger.log(`Conversación ${conversationId} eliminada (${deletedCount} mensajes)`);

    return { deletedCount };
  }

  /**
   * Lista las conversaciones del estudiante (para el selector del frontend).
   */
  async listConversations(studentId: string) {
    return this.conversationModel
      .find({ studentId: new Types.ObjectId(studentId) })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Recupera contexto del material de curso para la pregunta.
   *
   * La búsqueda no se restringe al curso activo: el estudiante puede preguntar
   * por cualquiera de sus cursos. Si el RAG falla (sin indexar, OpenAI caído)
   * se degrada a respuesta sin contexto en lugar de tumbar el chat.
   */
  private async retrieveContext(message: string) {
    try {
      const results = await this.knowledgeService.searchSimilar(message, {
        limit: RAG_CONTEXT_CHUNKS,
      });

      this.logger.debug(`RAG: ${results.length} fragmentos recuperados para la consulta`);
      return results;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Búsqueda RAG fallida, se responde sin contexto: ${reason}`);
      return [];
    }
  }

  /**
   * System prompt personalizado con el nombre y el curso actual del estudiante.
   */
  private async buildStudentSystemPrompt(studentId: string): Promise<string | undefined> {
    try {
      const context = await this.studentService.getChatContext(studentId);
      return context ? this.aiService.buildContextualSystemPrompt(context) : undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo personalizar el prompt: ${reason}`);
      return undefined;
    }
  }

  /**
   * Devuelve la conversación indicada (validando que sea del estudiante)
   * o crea una nueva.
   */
  private async resolveConversation(studentId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.findOwnedConversation(studentId, conversationId);
      if (existing) return existing;

      this.logger.warn(
        `Conversación ${conversationId} no encontrada para ${studentId}: se crea una nueva`
      );
    }

    return this.createConversation(studentId);
  }

  /**
   * Busca una conversación comprobando que pertenece al estudiante, para que
   * un ID ajeno no dé acceso a la conversación de otra persona.
   */
  private async findOwnedConversation(studentId: string, conversationId: string) {
    if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(studentId)) {
      return null;
    }

    return this.conversationModel.findOne({
      _id: new Types.ObjectId(conversationId),
      studentId: new Types.ObjectId(studentId),
    });
  }

  /**
   * Helper para crear una nueva conversación
   */
  private async createConversation(studentId: string) {
    const conversation = await this.conversationModel.create({
      studentId: new Types.ObjectId(studentId),
      title: 'Nueva conversación',
      isActive: true,
      lastMessageAt: new Date(),
    });

    this.conversationCache.set(conversation._id.toString(), []);

    return conversation;
  }

  /**
   * Titula la conversación con el primer mensaje del estudiante.
   */
  private buildTitle(message: string): string {
    const clean = message.replace(/\s+/g, ' ').trim();
    return clean.length > TITLE_MAX_LENGTH ? `${clean.slice(0, TITLE_MAX_LENGTH)}…` : clean;
  }

  /**
   * Helper para obtener historial de conversación (para contexto de IA)
   */
  private async getConversationHistory(conversationId: string): Promise<MessageHistory[]> {
    // Primero verificar cache
    const cached = this.conversationCache.get(conversationId);
    if (cached) {
      // Copia defensiva: quien consuma el historial no debe poder mutar el cache.
      return [...cached];
    }

    // Si no está en cache, obtener de la base de datos
    const messages = await this.chatMessageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .limit(HISTORY_CONTEXT_SIZE)
      .lean();

    const history: MessageHistory[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    this.conversationCache.set(conversationId, history);

    return [...history];
  }

  /**
   * Mantiene el cache sincronizado tras cada intercambio, acotado a los
   * últimos HISTORY_CONTEXT_SIZE mensajes.
   */
  private appendToCache(conversationId: string, messages: MessageHistory[]) {
    const history = this.conversationCache.get(conversationId) ?? [];
    const updated = [...history, ...messages].slice(-HISTORY_CONTEXT_SIZE);
    this.conversationCache.set(conversationId, updated);
  }
}
