import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { AiService } from '../ai/ai.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { StudentService } from '../student/student.service';
import { ChatMessage } from './schemas/chat-message.schema';
import { Conversation } from './schemas/conversation.schema';

const STUDENT_ID = '507f1f77bcf86cd799439011';
const OTHER_STUDENT_ID = '507f1f77bcf86cd799439099';

/**
 * Simula una Query de Mongoose: encadena sort/skip/limit/lean y es awaitable,
 * de modo que sirve tanto para `await model.findOne(...)` como para
 * `await model.find(...).sort(...).limit(...).lean()`.
 */
function query<T>(value: T) {
  const chain: any = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => Promise.resolve(value),
    populate: () => chain,
    exec: () => Promise.resolve(value),
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return chain;
}

const makeConversation = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  studentId: new Types.ObjectId(STUDENT_ID),
  title: 'Nueva conversación',
  isActive: true,
  messageCount: 0,
  ...overrides,
});

describe('ChatService', () => {
  let service: ChatService;

  const mockChatMessageModel = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    deleteMany: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockConversationModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
  };

  const mockAiService = {
    generateResponse: jest.fn(),
    generateResponseWithRAG: jest.fn(),
    generateStreamResponse: jest.fn(),
    buildContextualSystemPrompt: jest.fn(),
  };

  const mockKnowledgeService = {
    searchSimilar: jest.fn(),
  };

  const mockStudentService = {
    getChatContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getModelToken(ChatMessage.name), useValue: mockChatMessageModel },
        { provide: getModelToken(Conversation.name), useValue: mockConversationModel },
        { provide: AiService, useValue: mockAiService },
        { provide: KnowledgeService, useValue: mockKnowledgeService },
        { provide: StudentService, useValue: mockStudentService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);

    // Camino feliz por defecto; cada test sobreescribe lo que necesita.
    mockKnowledgeService.searchSimilar.mockResolvedValue([]);
    mockStudentService.getChatContext.mockResolvedValue({ name: 'María García' });
    mockAiService.buildContextualSystemPrompt.mockReturnValue('prompt personalizado');
    mockAiService.generateResponseWithRAG.mockResolvedValue({
      content: 'Respuesta del asistente',
      tokensUsed: 120,
      model: 'gpt-5-mini',
      responseTime: 900,
    });
    mockChatMessageModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc })
    );
    mockChatMessageModel.find.mockReturnValue(query([]));
    mockChatMessageModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
    mockConversationModel.findByIdAndUpdate.mockResolvedValue({});
    mockConversationModel.updateMany.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should create user message and get AI response', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      const result = await service.sendMessage({ studentId: STUDENT_ID, message: '¿Qué es un closure?' });

      expect(mockChatMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'user', content: '¿Qué es un closure?' })
      );
      expect(mockChatMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: 'Respuesta del asistente' })
      );
      expect(result.assistantMessage.content).toBe('Respuesta del asistente');
      expect(result.conversationId).toBe(conversation._id);
    });

    it('should persist token usage metadata on the assistant message', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());

      await service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' });

      const assistantCall = mockChatMessageModel.create.mock.calls.find(
        ([doc]) => doc.role === 'assistant'
      );
      expect(assistantCall?.[0].metadata).toEqual({
        tokensUsed: 120,
        model: 'gpt-5-mini',
        responseTime: 900,
      });
    });

    it('should create new conversation if none exists', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());

      await service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' });

      expect(mockConversationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: new Types.ObjectId(STUDENT_ID) })
      );
    });

    it('should use existing conversation if provided', async () => {
      const conversation = makeConversation({ messageCount: 4 });
      mockConversationModel.findOne.mockReturnValue(query(conversation));

      const result = await service.sendMessage({
        studentId: STUDENT_ID,
        message: 'Hola',
        conversationId: conversation._id.toString(),
      });

      expect(mockConversationModel.create).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(conversation._id);
    });

    it('should only load a conversation that belongs to the student', async () => {
      const conversation = makeConversation();
      mockConversationModel.findOne.mockReturnValue(query(null));
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.sendMessage({
        studentId: OTHER_STUDENT_ID,
        message: 'Hola',
        conversationId: conversation._id.toString(),
      });

      // La búsqueda va filtrada por estudiante, no solo por _id.
      expect(mockConversationModel.findOne).toHaveBeenCalledWith({
        _id: conversation._id,
        studentId: new Types.ObjectId(OTHER_STUDENT_ID),
      });
      // Al no ser suya, no se reutiliza: se crea una nueva.
      expect(mockConversationModel.create).toHaveBeenCalled();
    });

    it('should pass the retrieved RAG context to the AI service', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockKnowledgeService.searchSimilar.mockResolvedValue([
        { content: 'Los índices evitan COLLSCAN', courseId: 'c1', score: 0.8 },
        { content: 'Se crean con createIndex()', courseId: 'c1', score: 0.6 },
      ]);

      const result = await service.sendMessage({ studentId: STUDENT_ID, message: '¿Índices?' });

      expect(mockAiService.generateResponseWithRAG).toHaveBeenCalledWith(
        '¿Índices?',
        expect.any(Array),
        ['Los índices evitan COLLSCAN', 'Se crean con createIndex()'],
        { systemPrompt: 'prompt personalizado' }
      );
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].score).toBe(0.8);
    });

    it('should answer without context when the RAG search fails', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockKnowledgeService.searchSimilar.mockRejectedValue(new Error('OpenAI caído'));

      const result = await service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' });

      expect(result.assistantMessage.content).toBe('Respuesta del asistente');
      expect(mockAiService.generateResponseWithRAG).toHaveBeenCalledWith(
        'Hola',
        expect.any(Array),
        [],
        expect.any(Object)
      );
    });

    it('should still answer when the student context cannot be built', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockStudentService.getChatContext.mockRejectedValue(new Error('sin conexión'));

      await expect(
        service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' })
      ).resolves.toBeDefined();
    });

    it('should handle AI service errors gracefully by rolling back the user message', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockAiService.generateResponseWithRAG.mockRejectedValue(new Error('OpenAI no disponible'));

      await expect(service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' })).rejects.toThrow(
        'OpenAI no disponible'
      );

      // El mensaje del usuario no debe quedar huérfano contaminando el contexto.
      expect(mockChatMessageModel.deleteOne).toHaveBeenCalled();
      expect(mockConversationModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('should title the conversation with the first message', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation({ messageCount: 0 }));

      await service.sendMessage({ studentId: STUDENT_ID, message: '¿Qué es un closure?' });

      expect(mockConversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: '¿Qué es un closure?', $inc: { messageCount: 2 } })
      );
    });

    it('should not rename a conversation that already has messages', async () => {
      const conversation = makeConversation({ messageCount: 4, title: 'Dudas sobre React' });
      mockConversationModel.findOne.mockReturnValue(query(conversation));

      await service.sendMessage({
        studentId: STUDENT_ID,
        message: 'Otra pregunta',
        conversationId: conversation._id.toString(),
      });

      const [, update] = mockConversationModel.findByIdAndUpdate.mock.calls[0];
      expect(update).not.toHaveProperty('title');
    });
  });

  describe('startNewConversation', () => {
    it('should create a new conversation', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      const result = await service.startNewConversation(STUDENT_ID);

      expect(result).toBe(conversation);
      expect(mockConversationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: new Types.ObjectId(STUDENT_ID), isActive: true })
      );
    });

    it('should mark previous conversations as inactive', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.startNewConversation(STUDENT_ID);

      expect(mockConversationModel.updateMany).toHaveBeenCalledWith(
        { studentId: new Types.ObjectId(STUDENT_ID), _id: { $ne: conversation._id } },
        { isActive: false }
      );
    });

    it('should initialize empty history for new conversation', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.startNewConversation(STUDENT_ID);

      const cache = (service as any).conversationCache as Map<string, unknown[]>;
      expect(cache.get(conversation._id.toString())).toEqual([]);
    });

    it('should seed the history with the initial context when provided', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.startNewConversation(STUDENT_ID, 'El estudiante repasa React');

      const cache = (service as any).conversationCache as Map<string, unknown[]>;
      expect(cache.get(conversation._id.toString())).toEqual([
        { role: 'system', content: 'El estudiante repasa React' },
      ]);
    });

    /**
     * Regresión del bug documentado en DECISIONS.md: la implementación original
     * reutilizaba por referencia el array cacheado de una conversación previa y
     * lo vaciaba con `history.length = 0`, borrando su historial y dejando
     * ambas claves del Map apuntando al mismo array.
     */
    it('should not affect history of previous conversations', async () => {
      const previous = makeConversation({ isActive: false });
      const previousId = previous._id.toString();

      const cache = (service as any).conversationCache as Map<string, unknown[]>;
      cache.set(previousId, [
        { role: 'user', content: 'Pregunta antigua' },
        { role: 'assistant', content: 'Respuesta antigua' },
      ]);

      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);
      mockConversationModel.find.mockReturnValue(query([previous]));

      await service.startNewConversation(STUDENT_ID, 'Contexto nuevo');

      // El historial anterior sigue intacto...
      expect(cache.get(previousId)).toHaveLength(2);
      // ...y las dos conversaciones no comparten el mismo array.
      expect(cache.get(conversation._id.toString())).not.toBe(cache.get(previousId));
    });
  });

  describe('getHistory', () => {
    const conversation = makeConversation({ messageCount: 4 });
    const messages = [
      { _id: new Types.ObjectId(), role: 'user', content: 'Primero' },
      { _id: new Types.ObjectId(), role: 'assistant', content: 'Segundo' },
    ];

    it('should return paginated chat history', async () => {
      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.countDocuments.mockResolvedValue(25);
      mockChatMessageModel.find.mockReturnValue(query(messages));

      const result = await service.getHistory(STUDENT_ID, { page: 2, limit: 10 });

      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasMore: true,
      });
      expect(result.messages).toEqual(messages);
    });

    it('should report no more pages on the last page', async () => {
      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.countDocuments.mockResolvedValue(25);
      mockChatMessageModel.find.mockReturnValue(query(messages));

      const result = await service.getHistory(STUDENT_ID, { page: 3, limit: 10 });

      expect(result.pagination.hasMore).toBe(false);
    });

    it('should filter by conversationId when provided', async () => {
      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.countDocuments.mockResolvedValue(2);
      mockChatMessageModel.find.mockReturnValue(query(messages));

      await service.getHistory(STUDENT_ID, { conversationId: conversation._id.toString() });

      expect(mockConversationModel.findOne).toHaveBeenCalledWith({
        _id: conversation._id,
        studentId: new Types.ObjectId(STUDENT_ID),
      });
      expect(mockChatMessageModel.find).toHaveBeenCalledWith({ conversationId: conversation._id });
    });

    it('should return messages in chronological order', async () => {
      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.countDocuments.mockResolvedValue(2);

      const chain = query(messages);
      const sortSpy = jest.spyOn(chain, 'sort');
      mockChatMessageModel.find.mockReturnValue(chain);

      await service.getHistory(STUDENT_ID);

      expect(sortSpy).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    });

    it('should return an empty history when the student has no conversations', async () => {
      mockConversationModel.findOne.mockReturnValue(query(null));

      const result = await service.getHistory(STUDENT_ID);

      expect(result).toEqual({
        conversation: null,
        messages: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false },
      });
      expect(mockChatMessageModel.find).not.toHaveBeenCalled();
    });
  });

  describe('deleteHistory', () => {
    it('should delete all messages from conversation', async () => {
      const conversation = makeConversation();
      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.deleteMany.mockResolvedValue({ deletedCount: 6 });
      mockConversationModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteHistory(STUDENT_ID, conversation._id.toString());

      expect(mockChatMessageModel.deleteMany).toHaveBeenCalledWith({
        conversationId: conversation._id,
      });
      expect(mockConversationModel.deleteOne).toHaveBeenCalledWith({ _id: conversation._id });
      expect(result).toEqual({ deletedCount: 6 });
    });

    it('should clear cache for deleted conversation', async () => {
      const conversation = makeConversation();
      const conversationId = conversation._id.toString();

      const cache = (service as any).conversationCache as Map<string, unknown[]>;
      cache.set(conversationId, [{ role: 'user', content: 'algo' }]);

      mockConversationModel.findOne.mockReturnValue(query(conversation));
      mockChatMessageModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
      mockConversationModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.deleteHistory(STUDENT_ID, conversationId);

      expect(cache.has(conversationId)).toBe(false);
    });

    it('should throw error if conversation not found', async () => {
      mockConversationModel.findOne.mockReturnValue(query(null));

      await expect(
        service.deleteHistory(STUDENT_ID, new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundException);

      expect(mockChatMessageModel.deleteMany).not.toHaveBeenCalled();
    });

    it('should not delete a conversation belonging to another student', async () => {
      mockConversationModel.findOne.mockReturnValue(query(null));
      const conversationId = new Types.ObjectId().toString();

      await expect(service.deleteHistory(OTHER_STUDENT_ID, conversationId)).rejects.toThrow(
        NotFoundException
      );
      expect(mockConversationModel.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe('streamResponse', () => {
    async function* fakeStream() {
      yield 'Hola';
      yield ' María';
    }

    const collect = async (generator: AsyncGenerator<any>) => {
      const events: Array<Record<string, any>> = [];
      for await (const event of generator) events.push(event);
      return events;
    };

    it('should stream AI response tokens', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockAiService.generateStreamResponse.mockReturnValue(fakeStream());

      const events = await collect(
        service.streamResponse({ studentId: STUDENT_ID, message: 'Hola' })
      );

      expect(events[0].type).toBe('start');
      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hola',
        ' María',
      ]);
    });

    it('should complete stream correctly and persist the full message', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockAiService.generateStreamResponse.mockReturnValue(fakeStream());

      const events = await collect(
        service.streamResponse({ studentId: STUDENT_ID, message: 'Hola' })
      );

      const done = events.at(-1)!;
      expect(done.type).toBe('done');
      expect(done.content).toBe('Hola María');
      expect(mockChatMessageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'assistant', content: 'Hola María' })
      );
    });

    it('should handle streaming errors by rolling back the user message', async () => {
      mockConversationModel.create.mockResolvedValue(makeConversation());
      mockAiService.generateStreamResponse.mockImplementation(async function* () {
        yield 'parcial';
        throw new Error('stream roto');
      });

      await expect(
        collect(service.streamResponse({ studentId: STUDENT_ID, message: 'Hola' }))
      ).rejects.toThrow('stream roto');

      expect(mockChatMessageModel.deleteOne).toHaveBeenCalled();
    });
  });

  describe('conversation cache', () => {
    it('should feed the previous exchange back into the next request', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.sendMessage({ studentId: STUDENT_ID, message: 'Primera pregunta' });

      mockConversationModel.findOne.mockReturnValue(
        query({ ...conversation, messageCount: 2 })
      );

      await service.sendMessage({
        studentId: STUDENT_ID,
        message: 'Segunda pregunta',
        conversationId: conversation._id.toString(),
      });

      const [, history] = mockAiService.generateResponseWithRAG.mock.calls[1];
      expect(history).toEqual([
        { role: 'user', content: 'Primera pregunta' },
        { role: 'assistant', content: 'Respuesta del asistente' },
      ]);
    });

    it('should not let callers mutate the cached history', async () => {
      const conversation = makeConversation();
      mockConversationModel.create.mockResolvedValue(conversation);

      await service.sendMessage({ studentId: STUDENT_ID, message: 'Hola' });

      const [, history] = mockAiService.generateResponseWithRAG.mock.calls[0];
      history.push({ role: 'user', content: 'inyectado' });

      const cache = (service as any).conversationCache as Map<string, unknown[]>;
      expect(cache.get(conversation._id.toString())).toHaveLength(2);
    });
  });
});
