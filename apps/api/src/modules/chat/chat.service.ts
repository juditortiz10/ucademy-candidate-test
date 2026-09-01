import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage, ChatMessageDocument } from './schemas/chat-message.schema';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { AiService } from '../ai/ai.service';
import { SendMessageDto } from './dto/send-message.dto';

interface MessageHistory {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  // Cache de historial de conversaciones en memoria para optimizar
  private conversationCache: Map<string, MessageHistory[]> = new Map();

  constructor(
    @InjectModel(ChatMessage.name) private chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    private readonly aiService: AiService
  ) {}

  /**
   * ✅ PARCIALMENTE IMPLEMENTADO - Enviar mensaje y obtener respuesta
   *
   * El candidato debe completar:
   * - Integración con OpenAI para obtener respuesta real
   * - Implementar streaming de la respuesta
   * - Manejo de errores de la API de OpenAI
   */
  async sendMessage(dto: SendMessageDto) {
    const { studentId, message, conversationId } = dto;

    // Obtener o crear conversación
    let conversation = conversationId
      ? await this.conversationModel.findById(conversationId)
      : await this.createConversation(studentId);

    if (!conversation) {
      conversation = await this.createConversation(studentId);
    }

    // Guardar mensaje del usuario
    const userMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      role: 'user',
      content: message,
    });

    // Obtener historial para contexto
    const history = await this.getConversationHistory(conversation._id.toString());

    // TODO: El candidato debe implementar la llamada real a OpenAI
    // Por ahora retornamos una respuesta placeholder
    const aiResponse = await this.aiService.generateResponse(message, history);

    // Guardar respuesta del asistente
    const assistantMessage = await this.chatMessageModel.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: aiResponse.content,
      metadata: {
        tokensUsed: aiResponse.tokensUsed,
        model: aiResponse.model,
      },
    });

    // Actualizar conversación
    await this.conversationModel.findByIdAndUpdate(conversation._id, {
      lastMessageAt: new Date(),
      $inc: { messageCount: 2 },
    });

    return {
      conversationId: conversation._id,
      userMessage,
      assistantMessage,
    };
  }

  /**
   * Inicia una nueva conversación para el estudiante
   */
  async startNewConversation(studentId: string, initialContext?: string) {
    const conversation = await this.createConversation(studentId);
    const conversationIdStr = conversation._id.toString();

    // Cada conversación arranca con su propio array de historial.
    //
    // La versión anterior recuperaba del cache el array de la conversación
    // previa y lo vaciaba con `history.length = 0`. Eso mutaba el array
    // original (borrando ese historial) y, al guardarlo después bajo la clave
    // nueva, dejaba dos entradas del Map apuntando al mismo array: los
    // mensajes de una conversación aparecían también en la otra.
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
   * 📝 TODO: Implementar obtención del historial de chat
   *
   * El candidato debe implementar:
   * - Paginación del historial (limit/offset)
   * - Ordenar mensajes por fecha (más antiguos primero)
   * - Incluir metadata de cada mensaje
   */
  async getHistory(studentId: string, conversationId?: string) {
    // TODO: Implementar
    throw new Error('Not implemented - El candidato debe implementar este método');
  }

  /**
   * 📝 TODO: Implementar eliminación del historial
   *
   * El candidato debe implementar:
   * - Eliminar todos los mensajes de una conversación
   * - Opcionalmente eliminar la conversación completa
   * - Limpiar el cache en memoria
   */
  async deleteHistory(studentId: string, conversationId: string) {
    // TODO: Implementar
    throw new Error('Not implemented - El candidato debe implementar este método');
  }

  /**
   * 📝 TODO: Implementar streaming de respuestas
   *
   * El candidato debe elegir e implementar SSE o WebSocket.
   */
  async streamResponse(dto: SendMessageDto) {
    // TODO: Implementar
    throw new Error('Not implemented');
  }

  /**
   * Helper para crear una nueva conversación
   */
  private async createConversation(studentId: string) {
    return this.conversationModel.create({
      studentId: new Types.ObjectId(studentId),
      title: 'Nueva conversación',
      isActive: true,
      lastMessageAt: new Date(),
    });
  }

  /**
   * Helper para obtener historial de conversación (para contexto de IA)
   */
  private async getConversationHistory(conversationId: string): Promise<MessageHistory[]> {
    // Primero verificar cache
    if (this.conversationCache.has(conversationId)) {
      return this.conversationCache.get(conversationId)!;
    }

    // Si no está en cache, obtener de la base de datos
    const messages = await this.chatMessageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .limit(20) // Últimos 20 mensajes para contexto
      .lean();

    const history: MessageHistory[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Guardar en cache
    this.conversationCache.set(conversationId, history);

    return history;
  }
}
