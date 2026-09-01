/**
 * Indexa el contenido de los PDFs de data/courses en la base de conocimiento.
 *
 * Empareja cada PDF con su curso por título y llama al endpoint
 * POST /api/knowledge/index/pdf de la API (que debe estar arrancada).
 *
 *   npm run index:courses
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:3333/api';

/** Cada PDF de data/courses con el título exacto del curso que le corresponde */
const PDF_TO_COURSE: Record<string, string> = {
  'javascript-fundamentals.pdf': 'Introducción a JavaScript',
  'react-hooks.pdf': 'React desde Cero',
  'nodejs-express.pdf': 'Node.js y Express',
  'mongodb-fundamentals.pdf': 'MongoDB Esencial',
  'typescript-profesional.pdf': 'TypeScript Profesional',
};

const CourseSchema = new mongoose.Schema({ title: String }, { strict: false });
const Course = mongoose.model('Course', CourseSchema);

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/candidate-test';

  console.log('[DB] Conectando a MongoDB...');
  await mongoose.connect(mongoUri);

  const courses = await Course.find().lean<Array<{ _id: mongoose.Types.ObjectId; title: string }>>();
  const courseByTitle = new Map(courses.map((course) => [course.title, course._id.toString()]));

  if (courses.length === 0) {
    throw new Error('No hay cursos en la base de datos. Ejecuta `npm run seed` primero.');
  }

  let totalChunks = 0;

  for (const [fileName, courseTitle] of Object.entries(PDF_TO_COURSE)) {
    const courseId = courseByTitle.get(courseTitle);

    if (!courseId) {
      console.warn(`[SKIP] Curso no encontrado para ${fileName}: "${courseTitle}"`);
      continue;
    }

    process.stdout.write(`[INDEX] ${fileName} -> ${courseTitle} ... `);

    const response = await fetch(`${API_URL}/knowledge/index/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, fileName }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.log('ERROR');
      throw new Error(`Fallo indexando ${fileName}: ${response.status} ${error}`);
    }

    const result = (await response.json()) as { chunksCreated: number; pages: number };
    totalChunks += result.chunksCreated;
    console.log(`${result.chunksCreated} chunks (${result.pages} págs)`);
  }

  const stats = (await (await fetch(`${API_URL}/knowledge/stats`)).json()) as {
    totalChunks: number;
    coursesCovered: number;
  };

  console.log('');
  console.log(`[OK] Indexación completada: ${totalChunks} chunks nuevos`);
  console.log(`[INFO] Base de conocimiento: ${stats.totalChunks} chunks / ${stats.coursesCovered} cursos`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('[ERROR]', error.message);
  process.exit(1);
});
