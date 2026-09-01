import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
// pdf-parse es CommonJS y su index ejecuta código de debug al importarlo:
// se requiere el módulo interno directamente.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export interface ExtractedPdf {
  text: string;
  pages: number;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /** Carpeta con los PDFs de contenido de los cursos */
  private readonly coursesDir = path.resolve(process.cwd(), 'data', 'courses');

  /**
   * Extrae el texto de un PDF de data/courses.
   * El nombre se resuelve contra esa carpeta y se verifica que no escape de ella.
   */
  async extractText(fileName: string): Promise<ExtractedPdf> {
    const filePath = path.resolve(this.coursesDir, fileName);

    if (!filePath.startsWith(this.coursesDir + path.sep)) {
      throw new NotFoundException(`PDF no encontrado: ${fileName}`);
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      throw new NotFoundException(`PDF no encontrado: ${fileName}`);
    }

    const parsed = await pdfParse(buffer);
    const text = this.normalize(parsed.text);

    this.logger.log(`Extraídos ${text.length} caracteres de ${fileName} (${parsed.numpages} páginas)`);

    return { text, pages: parsed.numpages };
  }

  /** Lista los PDFs disponibles en data/courses */
  async listPdfs(): Promise<string[]> {
    const files = await fs.readdir(this.coursesDir);
    return files.filter((file) => file.toLowerCase().endsWith('.pdf')).sort();
  }

  /**
   * Los PDFs traen saltos de línea de maquetación que rompen las frases.
   * Se colapsan para que el troceado por frases funcione correctamente.
   */
  private normalize(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/-\n(\w)/g, '$1') // palabras partidas con guion al final de línea
      .replace(/\n{2,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
}
