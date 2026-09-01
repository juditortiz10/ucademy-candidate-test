import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { PdfService } from './pdf.service';
import { KnowledgeChunk, KnowledgeChunkSchema } from './schemas/knowledge-chunk.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KnowledgeChunk.name, schema: KnowledgeChunkSchema },
    ]),
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, PdfService],
  exports: [KnowledgeService, PdfService],
})
export class KnowledgeModule {}
