import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { KnowledgeChunk, KnowledgeChunkDocument } from './schemas/knowledge-chunk.schema';

export interface SearchResult {
  content: string;
  courseId: string;
  score: number;
  metadata?: {
    pageNumber?: number;
    section?: string;
  };
}

export interface SearchOptions {
  courseId?: string;
  limit?: number;
  minScore?: number;
}

/** Tamaño objetivo de cada chunk en caracteres (~250 tokens) */
const CHUNK_SIZE = 1000;
/** Nº de textos por request a la API de embeddings */
const EMBEDDING_BATCH_SIZE = 64;
const DEFAULT_SEARCH_LIMIT = 5;
/**
 * Umbral por defecto de similitud coseno. Con text-embedding-3-small los
 * fragmentos claramente relacionados puntúan >0.3; por debajo suele ser ruido
 * que solo distrae al modelo.
 */
const DEFAULT_MIN_SCORE = 0.3;

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private openai?: OpenAI;
  private readonly embeddingModel: string;

  constructor(
    @InjectModel(KnowledgeChunk.name) private knowledgeChunkModel: Model<KnowledgeChunkDocument>,
    private readonly configService: ConfigService
  ) {
    this.embeddingModel =
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';

    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.logger.warn('OPENAI_API_KEY no configurada: el sistema RAG no podrá indexar ni buscar');
    }
  }

  /**
   * Crea el embedding de un texto usando la API de OpenAI.
   */
  async createEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.createEmbeddings([text]);
    return embedding;
  }

  /**
   * Crea embeddings en lote. La API acepta un array de inputs, así que
   * indexar N chunks cuesta ceil(N/64) requests en lugar de N.
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.openai) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY no configurada: no se pueden generar embeddings'
      );
    }

    const cleaned = texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);

    if (cleaned.length === 0) {
      throw new BadRequestException('No hay texto válido para generar embeddings');
    }

    const embeddings: number[][] = [];

    for (let i = 0; i < cleaned.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = cleaned.slice(i, i + EMBEDDING_BATCH_SIZE);

      try {
        const response = await this.openai.embeddings.create({
          model: this.embeddingModel,
          input: batch,
        });

        // La API no garantiza el orden de `data`; se ordena por `index`.
        const ordered = [...response.data].sort((a, b) => a.index - b.index);
        embeddings.push(...ordered.map((item) => item.embedding));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error creando embeddings (lote ${i / EMBEDDING_BATCH_SIZE + 1}): ${message}`);
        throw new ServiceUnavailableException(`Error generando embeddings: ${message}`);
      }
    }

    return embeddings;
  }

  /**
   * Indexa el contenido de un curso: trocea el texto, genera los embeddings
   * y guarda los chunks en MongoDB.
   *
   * Es idempotente por (courseId, sourceFile): reindexar el mismo fichero
   * reemplaza sus chunks en lugar de duplicarlos.
   */
  async indexCourseContent(
    courseId: string,
    content: string,
    sourceFile: string
  ): Promise<{ chunksCreated: number }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new BadRequestException(`courseId inválido: ${courseId}`);
    }

    if (!content?.trim()) {
      throw new BadRequestException('El contenido a indexar está vacío');
    }

    const chunks = this.splitIntoChunks(content, CHUNK_SIZE);
    this.logger.log(`Indexando ${chunks.length} chunks del curso ${courseId} (${sourceFile})`);

    const embeddings = await this.createEmbeddings(chunks);

    // Reindexado idempotente: fuera los chunks previos de este mismo fichero.
    await this.knowledgeChunkModel.deleteMany({
      courseId: new Types.ObjectId(courseId),
      sourceFile,
    });

    const documents = chunks.map((chunk, index) => ({
      courseId: new Types.ObjectId(courseId),
      content: chunk,
      embedding: embeddings[index],
      sourceFile,
      chunkIndex: index,
      metadata: {
        // Estimación estándar para texto en español: ~4 caracteres por token.
        tokenCount: Math.ceil(chunk.length / 4),
      },
    }));

    await this.knowledgeChunkModel.insertMany(documents);

    this.logger.log(`Indexados ${documents.length} chunks del curso ${courseId}`);

    return { chunksCreated: documents.length };
  }

  /**
   * Búsqueda semántica en memoria (no usa MongoDB Atlas Vector Search).
   *
   * 1. Embedding de la pregunta
   * 2. Carga de chunks candidatos desde Mongo (filtrando por curso si procede)
   * 3. Similitud coseno contra cada chunk
   * 4. Orden descendente y top-K por encima del umbral
   */
  async searchSimilar(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { courseId, limit = DEFAULT_SEARCH_LIMIT, minScore = DEFAULT_MIN_SCORE } = options;

    if (!query?.trim()) {
      throw new BadRequestException('La consulta de búsqueda está vacía');
    }

    if (courseId && !Types.ObjectId.isValid(courseId)) {
      throw new BadRequestException(`courseId inválido: ${courseId}`);
    }

    const queryEmbedding = await this.createEmbedding(query);

    const filter = courseId ? { courseId: new Types.ObjectId(courseId) } : {};
    const chunks = await this.knowledgeChunkModel.find(filter).lean();

    if (chunks.length === 0) {
      this.logger.warn(
        `Sin chunks indexados${courseId ? ` para el curso ${courseId}` : ''}: la búsqueda no devuelve resultados`
      );
      return [];
    }

    const scored = chunks
      // Un chunk con embedding corrupto o de otro modelo tiene distinta
      // dimensión: se descarta en vez de romper toda la búsqueda.
      .filter((chunk) => chunk.embedding?.length === queryEmbedding.length)
      .map((chunk) => ({
        content: chunk.content,
        courseId: chunk.courseId.toString(),
        score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
        metadata: chunk.metadata,
      }));

    return scored
      .filter((result) => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Helper: Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Helper: Split text into chunks
   */
  splitIntoChunks(text: string, maxChunkSize = 1000): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Obtener estadisticas de la base de conocimiento
   */
  async getStats(): Promise<{
    totalChunks: number;
    coursesCovered: number;
  }> {
    const totalChunks = await this.knowledgeChunkModel.countDocuments();
    const coursesCovered = await this.knowledgeChunkModel.distinct('courseId');

    return {
      totalChunks,
      coursesCovered: coursesCovered.length,
    };
  }

  /**
   * Eliminar chunks de un curso
   */
  async deleteCourseChunks(courseId: string): Promise<{ deletedCount: number }> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new BadRequestException(`courseId inválido: ${courseId}`);
    }

    const result = await this.knowledgeChunkModel.deleteMany({
      courseId: new Types.ObjectId(courseId),
    });
    return { deletedCount: result.deletedCount };
  }
}
