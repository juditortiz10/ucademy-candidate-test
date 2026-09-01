import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import { PdfService } from './pdf.service';
import { IndexContentDto } from './dto/index-content.dto';
import { IndexPdfDto } from './dto/index-pdf.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';

@ApiTags('Knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly pdfService: PdfService
  ) {}

  /**
   * Indexa texto plano de un curso (trocea, embebe y guarda en MongoDB).
   */
  @Post('index')
  @ApiOperation({ summary: 'Indexar contenido de un curso' })
  @ApiResponse({ status: 201, description: 'Contenido indexado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  async indexContent(@Body() dto: IndexContentDto) {
    const result = await this.knowledgeService.indexCourseContent(
      dto.courseId,
      dto.content,
      dto.sourceFile || 'manual-input'
    );

    return {
      ...result,
      courseId: dto.courseId,
      sourceFile: dto.sourceFile || 'manual-input',
    };
  }

  /**
   * Atajo para la demo: extrae el texto de un PDF de data/courses y lo indexa.
   */
  @Post('index/pdf')
  @ApiOperation({ summary: 'Indexar un PDF de data/courses' })
  @ApiResponse({ status: 201, description: 'PDF indexado exitosamente' })
  @ApiResponse({ status: 404, description: 'PDF no encontrado' })
  async indexPdf(@Body() dto: IndexPdfDto) {
    const { text, pages } = await this.pdfService.extractText(dto.fileName);

    const result = await this.knowledgeService.indexCourseContent(
      dto.courseId,
      text,
      dto.fileName
    );

    return { ...result, courseId: dto.courseId, sourceFile: dto.fileName, pages };
  }

  /**
   * Búsqueda semántica sobre la base de conocimiento.
   */
  @Get('search')
  @ApiOperation({ summary: 'Buscar contenido similar' })
  @ApiResponse({ status: 200, description: 'Resultados de busqueda' })
  async search(@Query() query: SearchKnowledgeDto) {
    const results = await this.knowledgeService.searchSimilar(query.q, {
      courseId: query.courseId,
      limit: query.limit,
      minScore: query.minScore,
    });

    return { query: query.q, count: results.length, results };
  }

  /**
   * Obtener estadisticas de la base de conocimiento
   */
  @Get('stats')
  @ApiOperation({ summary: 'Estadisticas de la base de conocimiento' })
  async getStats() {
    return this.knowledgeService.getStats();
  }

  /**
   * Eliminar chunks de un curso
   */
  @Delete('course/:courseId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar conocimiento de un curso' })
  async deleteCourseKnowledge(@Param('courseId') courseId: string) {
    return this.knowledgeService.deleteCourseChunks(courseId);
  }
}
