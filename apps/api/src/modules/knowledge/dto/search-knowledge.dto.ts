import { IsString, IsNotEmpty, IsOptional, IsMongoId, IsInt, Min, Max, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchKnowledgeDto {
  @ApiProperty({ description: 'Consulta en lenguaje natural' })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiPropertyOptional({ description: 'Restringir la búsqueda a un curso' })
  @IsOptional()
  @IsMongoId()
  courseId?: string;

  @ApiPropertyOptional({ description: 'Nº máximo de resultados', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Umbral mínimo de similitud coseno', default: 0.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;
}
