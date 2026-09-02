import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';

/**
 * Vocabulario del embedding simulado.
 *
 * El mock convierte cada texto en un vector de frecuencias sobre estas
 * palabras. Así la similitud coseno se comporta como en producción (los textos
 * que hablan de lo mismo puntúan alto) pero de forma determinista, sin llamar a
 * OpenAI ni gastar dinero.
 */
const VOCAB = [
  'indice',
  'mongodb',
  'consulta',
  'coleccion',
  'escaneo',
  'react',
  'hook',
  'estado',
  'componente',
  'render',
];

function fakeEmbedding(text: string): number[] {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const vector = VOCAB.map((word) => normalized.split(word).length - 1);
  // Componente constante: evita el vector cero, que daría similitud 0 siempre.
  vector.push(0.1);
  return vector;
}

const embeddingsCreate = jest.fn(({ input }: { input: string[] }) => ({
  data: input.map((text, index) => ({ index, embedding: fakeEmbedding(text) })),
}));

interface ChatParams {
  messages: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

const chatCreate = jest.fn((_params: ChatParams) => ({
  choices: [{ message: { content: 'Respuesta simulada del asistente.' }, finish_reason: 'stop' }],
  usage: { total_tokens: 42 },
  model: 'gpt-5-mini-test',
}));

// Se sustituye el cliente de OpenAI: los e2e verifican NUESTRO cableado
// (rutas, validación, persistencia, recuperación), no la API de un tercero.
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    embeddings = { create: embeddingsCreate };
    chat = { completions: { create: chatCreate } };
  },
}));

// Arrancar Mongo en memoria y la app entera excede el timeout por defecto.
jest.setTimeout(60000);

const STUDENT_ID = '507f1f77bcf86cd799439011';

/** Contenido de dos "cursos" con vocabulario claramente distinto */
const MONGO_CONTENT = [
  'Los indice de mongodb evitan el escaneo completo de una coleccion.',
  'Una consulta sin indice obliga a mongodb a recorrer la coleccion entera.',
  'Crear un indice acelera cada consulta sobre esa coleccion de mongodb.',
].join(' ');

const REACT_CONTENT = [
  'Un hook de react gestiona el estado de un componente.',
  'Cada cambio de estado provoca un nuevo render del componente de react.',
  'El hook useState devuelve el estado y su actualizador en react.',
].join(' ');

describe('Flujo RAG completo (e2e)', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let connection: Connection;

  let mongoCourseId: string;
  let reactCourseId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    // AppModule lee estas variables al construirse.
    process.env.MONGODB_URI = mongod.getUri();
    process.env.OPENAI_API_KEY = 'sk-test-e2e';

    // Se importa después de fijar el entorno.
    const { AppModule } = await import('../app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Misma configuración que main.ts, para que el e2e pruebe lo que se despliega.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    );
    await app.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    await Promise.all(
      ['students', 'courses', 'progresses', 'conversations', 'chatmessages', 'knowledgechunks'].map(
        (name) => connection.collection(name).deleteMany({})
      )
    );

    await connection.collection('students').insertOne({
      _id: new Types.ObjectId(STUDENT_ID),
      name: 'María García',
      email: 'maria@test.com',
      preferences: { theme: 'light', language: 'es', notifications: true },
      createdAt: new Date(),
    });

    const courses = await connection.collection('courses').insertMany([
      { title: 'MongoDB Esencial', description: 'NoSQL', totalLessons: 10, category: 'Base de Datos', tags: [], durationMinutes: 150 },
      { title: 'React desde Cero', description: 'Frontend', totalLessons: 20, category: 'Frontend', tags: [], durationMinutes: 360 },
    ]);

    mongoCourseId = courses.insertedIds[0].toString();
    reactCourseId = courses.insertedIds[1].toString();

    await connection.collection('progresses').insertOne({
      studentId: new Types.ObjectId(STUDENT_ID),
      courseId: courses.insertedIds[0],
      completedLessons: 5,
      progressPercentage: 50,
      lastAccessedAt: new Date(),
      timeSpentMinutes: 90,
    });
  });

  /** Indexa los dos cursos de prueba */
  const indexarCursos = async () => {
    await request(app.getHttpServer())
      .post('/api/knowledge/index')
      .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/knowledge/index')
      .send({ courseId: reactCourseId, content: REACT_CONTENT, sourceFile: 'react.txt' })
      .expect(201);
  };

  describe('indexar → buscar → responder', () => {
    it('recorre el flujo completo y responde citando las fuentes', async () => {
      // 1 · Indexar
      const indexado = await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      expect(indexado.body.chunksCreated).toBeGreaterThan(0);

      // Los embeddings se han persistido de verdad
      const chunks = await connection.collection('knowledgechunks').find().toArray();
      expect(chunks).toHaveLength(indexado.body.chunksCreated);
      expect(chunks[0].embedding).toHaveLength(VOCAB.length + 1);

      // 2 · Buscar
      const busqueda = await request(app.getHttpServer())
        .get('/api/knowledge/search')
        .query({ q: 'como evito el escaneo de una coleccion', limit: 2 })
        .expect(200);

      expect(busqueda.body.count).toBeGreaterThan(0);
      expect(busqueda.body.results[0].content).toMatch(/indice|coleccion/);

      // 3 · Preguntar al chat, que debe usar ese contexto
      const respuesta = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'que es un indice en mongodb?' })
        .expect(201);

      expect(respuesta.body.assistantMessage.content).toBe('Respuesta simulada del asistente.');
      expect(respuesta.body.sources.length).toBeGreaterThan(0);

      // El contexto recuperado llegó al prompt enviado al modelo
      const systemPrompt = chatCreate.mock.calls[0][0].messages[0].content;
      expect(systemPrompt).toContain('Material del curso');
      expect(systemPrompt).toContain('indice');
      // Y el prompt está personalizado con los datos del estudiante
      expect(systemPrompt).toContain('María García');

      // 4 · Todo quedó persistido
      const historial = await request(app.getHttpServer())
        .get(`/api/chat/history/${STUDENT_ID}`)
        .expect(200);

      expect(historial.body.pagination.total).toBe(2);
      expect(historial.body.messages.map((m: { role: string }) => m.role)).toEqual([
        'user',
        'assistant',
      ]);
    });

    it('discrimina entre cursos: la pregunta de React no trae fragmentos de MongoDB', async () => {
      await indexarCursos();

      const busqueda = await request(app.getHttpServer())
        .get('/api/knowledge/search')
        .query({ q: 'el hook que gestiona el estado del componente', limit: 3 })
        .expect(200);

      expect(busqueda.body.results[0].courseId).toBe(reactCourseId);
      expect(busqueda.body.results[0].content).toMatch(/hook|estado|componente/);
    });

    it('responde sin contexto cuando nada supera el umbral', async () => {
      await indexarCursos();

      const respuesta = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'receta de tortilla de patatas' })
        .expect(201);

      expect(respuesta.body.sources).toEqual([]);
      // Sin fuentes, el prompt no debe incluir el bloque de material del curso.
      expect(chatCreate.mock.calls[0][0].messages[0].content).not.toContain('Material del curso');
    });

    it('sigue respondiendo aunque no haya nada indexado', async () => {
      const respuesta = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'hola' })
        .expect(201);

      expect(respuesta.body.assistantMessage.content).toBe('Respuesta simulada del asistente.');
      expect(respuesta.body.sources).toEqual([]);
    });
  });

  describe('indexación idempotente', () => {
    it('reindexar el mismo fichero reemplaza los chunks en lugar de duplicarlos', async () => {
      const primera = await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      const stats = await request(app.getHttpServer()).get('/api/knowledge/stats').expect(200);

      expect(stats.body.totalChunks).toBe(primera.body.chunksCreated);
    });

    /**
     * Documenta el alcance real de la idempotencia, que es (courseId, sourceFile).
     *
     * Este comportamiento es el que causó un bug en la práctica: al reejecutar
     * el seed, los cursos se recrean con ObjectIds nuevos, así que los chunks
     * anteriores dejaban de estar cubiertos y sobrevivían huérfanos. Por eso el
     * seed borra ahora también la colección de chunks.
     */
    it('la idempotencia NO cubre un courseId distinto: son cursos distintos', async () => {
      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      // Mismo fichero y mismo contenido, pero otro curso: se indexa aparte.
      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: reactCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      const stats = await request(app.getHttpServer()).get('/api/knowledge/stats').expect(200);

      expect(stats.body.coursesCovered).toBe(2);

      // Y la búsqueda global sí devuelve el mismo texto dos veces, uno por curso.
      const busqueda = await request(app.getHttpServer())
        .get('/api/knowledge/search')
        .query({ q: 'indice coleccion mongodb', limit: 10, minScore: 0 })
        .expect(200);

      const porCurso = new Set(busqueda.body.results.map((r: { courseId: string }) => r.courseId));
      expect(porCurso.size).toBe(2);
    });

    it('la búsqueda no devuelve fragmentos repetidos tras reindexar', async () => {
      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: mongoCourseId, content: MONGO_CONTENT, sourceFile: 'mongo.txt' })
        .expect(201);

      const busqueda = await request(app.getHttpServer())
        .get('/api/knowledge/search')
        .query({ q: 'indice coleccion mongodb', limit: 5, minScore: 0 })
        .expect(200);

      const textos = busqueda.body.results.map((r: { content: string }) => r.content);
      expect(new Set(textos).size).toBe(textos.length);
    });
  });

  describe('conversaciones', () => {
    it('mantiene el contexto entre mensajes de la misma conversación', async () => {
      const primero = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'primera pregunta' })
        .expect(201);

      const conversationId = primero.body.conversationId;

      await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'segunda pregunta', conversationId })
        .expect(201);

      // La segunda llamada al modelo debe incluir el intercambio anterior.
      const mensajes = chatCreate.mock.calls[1][0].messages;
      const contenidos = mensajes.map((m: { content: string }) => m.content);

      expect(contenidos).toContain('primera pregunta');
      expect(contenidos).toContain('Respuesta simulada del asistente.');
      expect(contenidos.at(-1)).toBe('segunda pregunta');
    });

    it('pagina el historial en orden cronológico', async () => {
      const primero = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'mensaje uno' })
        .expect(201);

      const conversationId = primero.body.conversationId;

      await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'mensaje dos', conversationId })
        .expect(201);

      const pagina1 = await request(app.getHttpServer())
        .get(`/api/chat/history/${STUDENT_ID}`)
        .query({ conversationId, limit: 2, page: 1 })
        .expect(200);

      expect(pagina1.body.pagination).toMatchObject({ total: 4, totalPages: 2, hasMore: true });
      expect(pagina1.body.messages[0].content).toBe('mensaje uno');

      const pagina2 = await request(app.getHttpServer())
        .get(`/api/chat/history/${STUDENT_ID}`)
        .query({ conversationId, limit: 2, page: 2 })
        .expect(200);

      expect(pagina2.body.pagination.hasMore).toBe(false);
      expect(pagina2.body.messages[0].content).toBe('mensaje dos');
    });

    it('no permite acceder ni borrar la conversación de otro estudiante', async () => {
      const primero = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'privado' })
        .expect(201);

      const conversationId = primero.body.conversationId;
      const otroEstudiante = '507f1f77bcf86cd799439099';

      await request(app.getHttpServer())
        .delete(`/api/chat/history/${otroEstudiante}/${conversationId}`)
        .expect(404);

      // Y la conversación sigue intacta
      const historial = await request(app.getHttpServer())
        .get(`/api/chat/history/${STUDENT_ID}`)
        .query({ conversationId })
        .expect(200);

      expect(historial.body.pagination.total).toBe(2);
    });

    it('borra la conversación propia y sus mensajes', async () => {
      const primero = await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: 'a borrar' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/chat/history/${STUDENT_ID}/${primero.body.conversationId}`)
        .expect(204);

      expect(await connection.collection('chatmessages').countDocuments()).toBe(0);
      expect(await connection.collection('conversations').countDocuments()).toBe(0);
    });
  });

  describe('endpoints de estudiante', () => {
    it('devuelve estadísticas agregadas', async () => {
      const stats = await request(app.getHttpServer())
        .get(`/api/students/${STUDENT_ID}/stats`)
        .expect(200);

      expect(stats.body.totals.totalCourses).toBe(1);
      expect(stats.body.totals.totalTimeSpentFormatted).toBe('1h 30m');
      expect(stats.body.streak.currentStreakDays).toBe(1);
      expect(stats.body.timeByCategory[0]).toMatchObject({
        category: 'Base de Datos',
        timeSpentMinutes: 90,
      });
      expect(stats.body.activityByDay).toHaveLength(7);
    });

    it('actualiza las preferencias sin perder las no enviadas', async () => {
      const actualizado = await request(app.getHttpServer())
        .patch(`/api/students/${STUDENT_ID}/preferences`)
        .send({ theme: 'dark' })
        .expect(200);

      expect(actualizado.body.preferences).toEqual({
        theme: 'dark',
        language: 'es',
        notifications: true,
      });
    });

    it('rechaza preferencias inválidas y estudiantes inexistentes', async () => {
      await request(app.getHttpServer())
        .patch(`/api/students/${STUDENT_ID}/preferences`)
        .send({ theme: 'neon' })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/api/students/507f1f77bcf86cd799439099/preferences')
        .send({ theme: 'dark' })
        .expect(404);
    });
  });

  describe('validación de entrada', () => {
    it('rechaza un courseId con formato inválido al indexar', async () => {
      await request(app.getHttpServer())
        .post('/api/knowledge/index')
        .send({ courseId: 'no-es-un-id', content: 'texto' })
        .expect(400);
    });

    it('rechaza un limit fuera de rango en la búsqueda', async () => {
      await request(app.getHttpServer())
        .get('/api/knowledge/search')
        .query({ q: 'algo', limit: 999 })
        .expect(400);
    });

    it('rechaza un mensaje vacío en el chat', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/message')
        .send({ studentId: STUDENT_ID, message: '' })
        .expect(400);
    });
  });
});
