import { IsOptional, IsMongoId, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetHistoryDto {
  @ApiPropertyOptional({ description: 'ID de conversación específica' })
  @IsOptional()
  @IsMongoId()
  conversationId?: string;

  @ApiPropertyOptional({ description: 'Número de página (1 = mensajes más antiguos)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Mensajes por página', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
