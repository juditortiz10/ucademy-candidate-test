import { IsString, IsNotEmpty, IsMongoId, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IndexPdfDto {
  @ApiProperty({ description: 'ID del curso al que pertenece el PDF' })
  @IsMongoId()
  @IsNotEmpty()
  courseId: string;

  @ApiProperty({
    description: 'Nombre del PDF dentro de data/courses (sin rutas)',
    example: 'javascript-fundamentals.pdf',
  })
  @IsString()
  @IsNotEmpty()
  // Evita path traversal: solo nombre de fichero .pdf, sin separadores.
  @Matches(/^[\w.-]+\.pdf$/i, { message: 'fileName debe ser un nombre de fichero .pdf válido' })
  fileName: string;
}
