import { IsString, IsNotEmpty, IsOptional, IsMongoId } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IndexContentDto {
  @ApiProperty({ description: 'ID del curso al que pertenece el contenido' })
  @IsMongoId()
  @IsNotEmpty()
  courseId: string;

  @ApiProperty({ description: 'Texto plano a indexar (p.ej. extraído de un PDF)' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: 'Fichero de origen, usado para reindexar sin duplicar' })
  @IsOptional()
  @IsString()
  sourceFile?: string;
}
