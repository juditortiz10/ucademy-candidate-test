import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeChunk } from './schemas/knowledge-chunk.schema';

const COURSE_ID = '507f1f77bcf86cd799439012';
const OTHER_COURSE_ID = '507f1f77bcf86cd799439013';

/** Embedding de juguete: 3 dimensiones bastan para verificar el ranking */
const embeddingOf = (vector: number[]) => vector;

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  const mockKnowledgeChunkModel = {
    create: jest.fn(),
    insertMany: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    distinct: jest.fn(),
    deleteMany: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  /** Cliente de OpenAI simulado, inyectado en la instancia ya construida */
  const mockEmbeddingsCreate = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        {
          provide: getModelToken(KnowledgeChunk.name),
          useValue: mockKnowledgeChunkModel,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);

    // El constructor no crea cliente sin API key; se inyecta el doble aquí.
    (service as any).openai = { embeddings: { create: mockEmbeddingsCreate } };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [1, 2, 3];
      expect(service.cosineSimilarity(vec, vec)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vecA = [1, 0];
      const vecB = [0, 1];
      expect(service.cosineSimilarity(vecA, vecB)).toBeCloseTo(0);
    });

    it('should throw error for vectors of different length', () => {
      const vecA = [1, 2, 3];
      const vecB = [1, 2];
      expect(() => service.cosineSimilarity(vecA, vecB)).toThrow();
    });

    it('should return -1 for opposite vectors', () => {
      expect(service.cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
    });

    it('should return 0 when one vector is all zeros', () => {
      expect(service.cosineSimilarity([0, 0], [1, 2])).toBe(0);
    });
  });

  describe('splitIntoChunks', () => {
    it('should split text into chunks', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const chunks = service.splitIntoChunks(text, 30);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should not split short text', () => {
      const text = 'Short text.';
      const chunks = service.splitIntoChunks(text, 1000);
      expect(chunks.length).toBe(1);
    });

    it('should preserve all content across chunks', () => {
      const text = 'Uno. Dos. Tres. Cuatro. Cinco.';
      const chunks = service.splitIntoChunks(text, 12);

      expect(chunks.join(' ')).toBe(text);
    });
  });

  describe('createEmbedding', () => {
    it('should create embeddings using OpenAI API', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      });

      const result = await service.createEmbedding('¿Qué es un índice?');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['¿Qué es un índice?'],
      });
    });

    it('should send all texts in a single batched request', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [0, 1] },
        ],
      });

      await service.createEmbeddings(['primero', 'segundo']);

      expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
      expect(mockEmbeddingsCreate.mock.calls[0][0].input).toEqual(['primero', 'segundo']);
    });

    it('should reorder embeddings by index when API returns them out of order', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      });

      const result = await service.createEmbeddings(['primero', 'segundo']);

      expect(result).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });

    it('should throw BadRequest when there is no usable text', async () => {
      await expect(service.createEmbeddings(['   ', ''])).rejects.toThrow(BadRequestException);
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });

    it('should surface OpenAI failures as ServiceUnavailable', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('rate limit'));

      await expect(service.createEmbedding('hola')).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw when OpenAI is not configured', async () => {
      (service as any).openai = undefined;

      await expect(service.createEmbedding('hola')).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('indexCourseContent', () => {
    it('should index course content into chunks', async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [
          { index: 0, embedding: [1, 0] },
          { index: 1, embedding: [0, 1] },
        ],
      });
      mockKnowledgeChunkModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
      mockKnowledgeChunkModel.insertMany.mockResolvedValue([]);

      // Dos frases largas: superan el chunk de 1000 caracteres del servicio
      // y por tanto deben acabar en dos chunks distintos.
      const first = `Primera frase sobre índices ${'muy detallada '.repeat(50)}.`;
      const second = `Segunda frase sobre agregaciones ${'con ejemplos '.repeat(50)}.`;
      const result = await service.indexCourseContent(COURSE_ID, `${first} ${second}`, 'mongodb.pdf');

      expect(result).toEqual({ chunksCreated: 2 });

      const inserted = mockKnowledgeChunkModel.insertMany.mock.calls[0][0];
      expect(inserted).toHaveLength(2);
      expect(inserted[0]).toMatchObject({
        content: first,
        embedding: [1, 0],
        sourceFile: 'mongodb.pdf',
        chunkIndex: 0,
      });
      expect(inserted[1]).toMatchObject({ content: second, embedding: [0, 1], chunkIndex: 1 });
      expect(inserted[0].courseId.toString()).toBe(COURSE_ID);
    });

    it('should remove previous chunks of the same file before reindexing', async () => {
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [1, 0] }] });
      mockKnowledgeChunkModel.deleteMany.mockResolvedValue({ deletedCount: 3 });
      mockKnowledgeChunkModel.insertMany.mockResolvedValue([]);

      await service.indexCourseContent(COURSE_ID, 'Una sola frase.', 'mongodb.pdf');

      expect(mockKnowledgeChunkModel.deleteMany).toHaveBeenCalledWith({
        courseId: new Types.ObjectId(COURSE_ID),
        sourceFile: 'mongodb.pdf',
      });
    });

    it('should reject an invalid courseId', async () => {
      await expect(service.indexCourseContent('no-es-un-id', 'texto', 'f.pdf')).rejects.toThrow(
        BadRequestException
      );
      expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
    });

    it('should reject empty content', async () => {
      await expect(service.indexCourseContent(COURSE_ID, '   ', 'f.pdf')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should not delete previous chunks when embedding fails', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('API caída'));

      await expect(
        service.indexCourseContent(COURSE_ID, 'Una frase.', 'mongodb.pdf')
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockKnowledgeChunkModel.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('searchSimilar', () => {
    const chunks = [
      {
        content: 'Chunk casi idéntico a la consulta',
        courseId: new Types.ObjectId(COURSE_ID),
        embedding: embeddingOf([1, 0, 0]),
        metadata: { section: 'Índices' },
      },
      {
        content: 'Chunk parcialmente relacionado',
        courseId: new Types.ObjectId(COURSE_ID),
        embedding: embeddingOf([0.8, 0.6, 0]),
        metadata: {},
      },
      {
        content: 'Chunk sin relación',
        courseId: new Types.ObjectId(OTHER_COURSE_ID),
        embedding: embeddingOf([0, 0, 1]),
        metadata: {},
      },
    ];

    beforeEach(() => {
      // La consulta apunta en la dirección [1,0,0]
      mockEmbeddingsCreate.mockResolvedValue({ data: [{ index: 0, embedding: [1, 0, 0] }] });
      mockKnowledgeChunkModel.find.mockReturnValue({ lean: () => Promise.resolve(chunks) });
    });

    it('should search for similar content', async () => {
      const results = await service.searchSimilar('índices');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toBe('Chunk casi idéntico a la consulta');
      expect(results[0].score).toBeCloseTo(1);
    });

    it('should return results sorted by similarity score', async () => {
      const results = await service.searchSimilar('índices', { minScore: 0 });

      const scores = results.map((result) => result.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('should filter search results by courseId', async () => {
      await service.searchSimilar('índices', { courseId: COURSE_ID });

      expect(mockKnowledgeChunkModel.find).toHaveBeenCalledWith({
        courseId: new Types.ObjectId(COURSE_ID),
      });
    });

    it('should query every course when no courseId is given', async () => {
      await service.searchSimilar('índices');

      expect(mockKnowledgeChunkModel.find).toHaveBeenCalledWith({});
    });

    it('should discard results below minScore', async () => {
      const results = await service.searchSimilar('índices', { minScore: 0.9 });

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Chunk casi idéntico a la consulta');
    });

    it('should respect the limit', async () => {
      const results = await service.searchSimilar('índices', { limit: 1, minScore: 0 });

      expect(results).toHaveLength(1);
    });

    it('should skip chunks whose embedding has a different dimension', async () => {
      mockKnowledgeChunkModel.find.mockReturnValue({
        lean: () =>
          Promise.resolve([
            ...chunks,
            // Chunk indexado con otro modelo (p.ej. 3-large): dimensión distinta
            { content: 'Dimensión incompatible', courseId: new Types.ObjectId(COURSE_ID), embedding: [1, 0] },
          ]),
      });

      const results = await service.searchSimilar('índices', { minScore: 0 });

      expect(results.map((r) => r.content)).not.toContain('Dimensión incompatible');
    });

    it('should return an empty array when nothing is indexed', async () => {
      mockKnowledgeChunkModel.find.mockReturnValue({ lean: () => Promise.resolve([]) });

      await expect(service.searchSimilar('índices')).resolves.toEqual([]);
    });

    it('should reject an empty query', async () => {
      await expect(service.searchSimilar('   ')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStats', () => {
    it('should report chunk and course totals', async () => {
      mockKnowledgeChunkModel.countDocuments.mockResolvedValue(52);
      mockKnowledgeChunkModel.distinct.mockResolvedValue(['a', 'b', 'c']);

      await expect(service.getStats()).resolves.toEqual({ totalChunks: 52, coursesCovered: 3 });
    });
  });

  describe('deleteCourseChunks', () => {
    it('should delete every chunk of the course', async () => {
      mockKnowledgeChunkModel.deleteMany.mockResolvedValue({ deletedCount: 11 });

      const result = await service.deleteCourseChunks(COURSE_ID);

      expect(result).toEqual({ deletedCount: 11 });
      expect(mockKnowledgeChunkModel.deleteMany).toHaveBeenCalledWith({
        courseId: new Types.ObjectId(COURSE_ID),
      });
    });

    it('should reject an invalid courseId', async () => {
      await expect(service.deleteCourseChunks('nope')).rejects.toThrow(BadRequestException);
    });
  });
});
