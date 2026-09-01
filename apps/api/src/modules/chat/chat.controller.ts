import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { GetHistoryDto } from './dto/get-history.dto';

interface SseEvent {
  data: string;
}

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Enviar mensaje al chat con IA (respuesta completa).
   */
  @Post('message')
  @ApiOperation({ summary: 'Enviar mensaje al chat con IA' })
  @ApiResponse({ status: 201, description: 'Mensaje enviado y respuesta generada' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  async sendMessage(@Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(dto);
  }

  /**
   * Enviar mensaje y recibir la respuesta token a token vía SSE.
   *
   * Es GET porque `EventSource` del navegador solo admite GET; los parámetros
   * viajan en la query string.
   */
  @Sse('message/stream')
  @ApiOperation({ summary: 'Enviar mensaje y recibir respuesta en streaming (SSE)' })
  @ApiQuery({ name: 'studentId', required: true })
  @ApiQuery({ name: 'message', required: true })
  @ApiQuery({ name: 'conversationId', required: false })
  streamMessage(@Query() dto: SendMessageDto): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      let cancelled = false;

      (async () => {
        try {
          for await (const event of this.chatService.streamResponse(dto)) {
            if (cancelled) return;
            subscriber.next({ data: JSON.stringify(event) });
          }
          subscriber.complete();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Error generando la respuesta';
          subscriber.next({ data: JSON.stringify({ type: 'error', message }) });
          subscriber.complete();
        }
      })();

      // El cliente cerró la conexión: se deja de emitir.
      return () => {
        cancelled = true;
      };
    });
  }

  /**
   * ✅ IMPLEMENTADO - Iniciar nueva conversación
   */
  @Post('conversation/new')
  @ApiOperation({ summary: 'Iniciar una nueva conversación' })
  @ApiResponse({ status: 201, description: 'Conversación creada' })
  async startNewConversation(
    @Body('studentId') studentId: string,
    @Body('initialContext') initialContext?: string
  ) {
    return this.chatService.startNewConversation(studentId, initialContext);
  }

  /**
   * Lista de conversaciones del estudiante.
   */
  @Get('conversations/:studentId')
  @ApiOperation({ summary: 'Listar conversaciones del estudiante' })
  @ApiParam({ name: 'studentId', description: 'ID del estudiante' })
  async listConversations(@Param('studentId') studentId: string) {
    return this.chatService.listConversations(studentId);
  }

  /**
   * Historial de chat paginado.
   */
  @Get('history/:studentId')
  @ApiOperation({ summary: 'Obtener historial de chat del estudiante' })
  @ApiParam({ name: 'studentId', description: 'ID del estudiante' })
  @ApiQuery({ name: 'conversationId', required: false, description: 'ID de conversación específica' })
  @ApiQuery({ name: 'page', required: false, description: 'Número de página' })
  @ApiQuery({ name: 'limit', required: false, description: 'Mensajes por página' })
  @ApiResponse({ status: 200, description: 'Historial de mensajes' })
  async getHistory(@Param('studentId') studentId: string, @Query() query: GetHistoryDto) {
    return this.chatService.getHistory(studentId, query);
  }

  /**
   * Elimina el historial (mensajes + conversación).
   */
  @Delete('history/:studentId/:conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar historial de una conversación' })
  @ApiParam({ name: 'studentId', description: 'ID del estudiante' })
  @ApiParam({ name: 'conversationId', description: 'ID de la conversación' })
  @ApiResponse({ status: 204, description: 'Historial eliminado' })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  async deleteHistory(
    @Param('studentId') studentId: string,
    @Param('conversationId') conversationId: string
  ) {
    await this.chatService.deleteHistory(studentId, conversationId);
  }
}
