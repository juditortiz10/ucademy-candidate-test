import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { AiService } from './ai.service';

/** Respuesta mínima con la forma que devuelve chat.completions.create */
const completion = (content: string | null, overrides: Record<string, unknown> = {}) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { total_tokens: 123 },
  model: 'gpt-5-mini-2025-08-07',
  ...overrides,
});

/** Convierte un array en el async iterable que devuelve la API en modo stream */
async function* asStream(tokens: Array<string | null>) {
  for (const token of tokens) {
    yield { choices: [{ delta: { content: token } }] };
  }
}

describe('AiService', () => {
  let service: AiService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockCreate = jest.fn();

  beforeEach(async () => {
    // `jest.clearAllMocks()` limpia las llamadas pero NO las implementaciones:
    // sin este reset, la API key de los tests de `isConfigured` se filtraría al
    // constructor de los siguientes y crearía un cliente real de OpenAI.
    mockConfigService.get.mockReset();
    mockConfigService.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /** Inyecta el cliente de OpenAI simulado en el servicio ya construido */
  const withOpenAi = () => {
    (service as any).openai = { chat: { completions: { create: mockCreate } } };
  };

  describe('isConfigured', () => {
    it('should return false when API key is not set', () => {
      mockConfigService.get.mockReturnValue(undefined);
      expect(service.isConfigured()).toBe(false);
    });

    it('should return true when API key is set', () => {
      mockConfigService.get.mockReturnValue('sk-test-key');
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('generateResponse', () => {
    /**
     * ✅ TEST QUE PASA - Verifica respuesta placeholder
     */
    it('should return placeholder response when OpenAI not configured', async () => {
      const result = await service.generateResponse('Hello');

      expect(result).toHaveProperty('content');
      expect(result.content).toContain('PLACEHOLDER');
      expect(result.model).toBe('placeholder');
    });

    it('should call OpenAI API with correct parameters', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      await service.generateResponse('¿Qué es un closure?');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const payload = mockCreate.mock.calls[0][0];

      expect(payload.model).toBe('gpt-5-mini');
      expect(payload.max_completion_tokens).toBeGreaterThan(0);
      expect(payload.reasoning_effort).toBe('low');
      // gpt-5-mini rechaza ambos parámetros con HTTP 400.
      expect(payload).not.toHaveProperty('max_tokens');
      expect(payload).not.toHaveProperty('temperature');
    });

    it('should include system prompt in messages', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      await service.generateResponse('Hola');

      const { messages } = mockCreate.mock.calls[0][0];
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('asistente educativo');
      expect(messages.at(-1)).toEqual({ role: 'user', content: 'Hola' });
    });

    it('should use the custom system prompt when provided', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      await service.generateResponse('Hola', [], { systemPrompt: 'Prompt personalizado' });

      expect(mockCreate.mock.calls[0][0].messages[0]).toEqual({
        role: 'system',
        content: 'Prompt personalizado',
      });
    });

    it('should include conversation history', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      const history = [
        { role: 'user' as const, content: 'Pregunta previa' },
        { role: 'assistant' as const, content: 'Respuesta previa' },
      ];

      await service.generateResponse('Nueva pregunta', history);

      const { messages } = mockCreate.mock.calls[0][0];
      expect(messages).toEqual([
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'Pregunta previa' },
        { role: 'assistant', content: 'Respuesta previa' },
        { role: 'user', content: 'Nueva pregunta' },
      ]);
    });

    it('should cap the history sent to OpenAI', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      const history = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `mensaje ${i}`,
      }));

      await service.generateResponse('Actual', history);

      const { messages } = mockCreate.mock.calls[0][0];
      // system + 20 de historial + mensaje actual
      expect(messages).toHaveLength(22);
      expect(messages[1].content).toBe('mensaje 30');
    });

    it('should return token usage information', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      const result = await service.generateResponse('Hola');

      expect(result.tokensUsed).toBe(123);
      expect(result.model).toBe('gpt-5-mini-2025-08-07');
      expect(result.responseTime).toEqual(expect.any(Number));
    });

    it('should return a fallback message when the model returns empty content', async () => {
      withOpenAi();
      // gpt-5-mini agota el presupuesto razonando y devuelve content vacío con HTTP 200.
      mockCreate.mockResolvedValue(completion(null, { choices: [{ message: { content: null }, finish_reason: 'length' }] }));

      const result = await service.generateResponse('Hola');

      expect(result.content).toContain('no he podido generar');
      expect(result.content.trim().length).toBeGreaterThan(0);
    });

    it('should handle OpenAI API errors', async () => {
      withOpenAi();
      mockCreate.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));

      await expect(service.generateResponse('Hola')).rejects.toThrow(ServiceUnavailableException);
    });

    it('should not retry client errors', async () => {
      withOpenAi();
      mockCreate.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));

      await expect(service.generateResponse('Hola')).rejects.toThrow(ServiceUnavailableException);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should respect rate limits by retrying 429 responses', async () => {
      withOpenAi();
      mockCreate
        .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
        .mockResolvedValue(completion('Respuesta tras reintento'));

      const result = await service.generateResponse('Hola');

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.content).toBe('Respuesta tras reintento');
    });

    it('should give up after exhausting retries on server errors', async () => {
      withOpenAi();
      mockCreate.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }));

      await expect(service.generateResponse('Hola')).rejects.toThrow(ServiceUnavailableException);
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('generateResponseWithRAG', () => {
    it('should inject the retrieved context into the system prompt', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta con contexto'));

      const result = await service.generateResponseWithRAG('¿Qué son los índices?', [], [
        'Los índices evitan escaneos completos.',
        'Se crean con createIndex().',
      ]);

      const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(systemPrompt).toContain('Los índices evitan escaneos completos.');
      expect(systemPrompt).toContain('Se crean con createIndex().');
      expect(systemPrompt).toContain('Material del curso');
      expect(result.sources).toHaveLength(2);
    });

    it('should fall back to a plain response when there is no context', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta sin contexto'));

      const result = await service.generateResponseWithRAG('Hola', [], []);

      expect(mockCreate.mock.calls[0][0].messages[0].content).not.toContain('Material del curso');
      expect(result.sources).toBeUndefined();
    });

    it('should ignore blank context fragments', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(completion('Respuesta'));

      const result = await service.generateResponseWithRAG('Hola', [], ['   ', '']);

      expect(result.sources).toBeUndefined();
    });
  });

  describe('generateStreamResponse', () => {
    it('should yield tokens one by one', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(asStream(['Hola', ' ', 'María']));

      const tokens: string[] = [];
      for await (const token of service.generateStreamResponse('Hola')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['Hola', ' ', 'María']);
      expect(mockCreate.mock.calls[0][0].stream).toBe(true);
    });

    it('should complete stream successfully skipping empty deltas', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(asStream(['Hola', null, 'mundo']));

      const tokens: string[] = [];
      for await (const token of service.generateStreamResponse('Hola')) {
        tokens.push(token);
      }

      expect(tokens.join('')).toBe('Holamundo');
    });

    it('should handle stream interruption', async () => {
      withOpenAi();
      mockCreate.mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: 'parcial' } }] };
          throw new Error('conexión interrumpida');
        })()
      );

      const tokens: string[] = [];
      const consume = async () => {
        for await (const token of service.generateStreamResponse('Hola')) {
          tokens.push(token);
        }
      };

      await expect(consume()).rejects.toThrow('conexión interrumpida');
      expect(tokens).toEqual(['parcial']);
    });

    it('should stream the placeholder when OpenAI is not configured', async () => {
      const tokens: string[] = [];
      for await (const token of service.generateStreamResponse('Hola')) {
        tokens.push(token);
      }

      expect(tokens.join('')).toContain('PLACEHOLDER');
    });
  });

  describe('buildContextualSystemPrompt', () => {
    it('should include student name in prompt', () => {
      const prompt = service.buildContextualSystemPrompt({ name: 'María García' });

      expect(prompt).toContain('María García');
    });

    it('should include current course if provided', () => {
      const prompt = service.buildContextualSystemPrompt({
        name: 'María',
        currentCourse: 'React desde Cero',
      });

      expect(prompt).toContain('React desde Cero');
    });

    it('should include progress percentage', () => {
      const prompt = service.buildContextualSystemPrompt({ name: 'María', progress: 70 });

      expect(prompt).toContain('70%');
    });

    it('should adapt the tone to the progress level', () => {
      const starting = service.buildContextualSystemPrompt({ name: 'María', progress: 5 });
      const finishing = service.buildContextualSystemPrompt({ name: 'María', progress: 95 });

      expect(starting).toContain('fundamentos');
      expect(finishing).toContain('terminar');
    });

    it('should maintain base prompt content', () => {
      const prompt = service.buildContextualSystemPrompt({ name: 'María' });

      expect(prompt).toContain('asistente educativo');
      expect(prompt).toContain('No des respuestas a exámenes directamente');
    });

    it('should omit course and progress lines when not provided', () => {
      const prompt = service.buildContextualSystemPrompt({ name: 'María' });

      expect(prompt).not.toContain('Curso actual');
      expect(prompt).not.toContain('Progreso en el curso');
    });
  });
});
