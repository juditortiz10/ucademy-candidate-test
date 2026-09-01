import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { StudentModule } from '../student/student.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
    AiModule,
    // RAG: da acceso a KnowledgeService para recuperar contexto de los cursos.
    KnowledgeModule,
    // Personalización: nombre y curso actual del estudiante en el system prompt.
    StudentModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
