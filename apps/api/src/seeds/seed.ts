import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

// Schemas simplificados para el seed
const StudentSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    avatar: String,
    preferences: {
      theme: { type: String, enum: ['light', 'dark'], default: 'light' },
      language: { type: String, default: 'es' },
      notifications: { type: Boolean, default: true },
    },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const CourseSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    thumbnail: String,
    totalLessons: Number,
    category: String,
    tags: [String],
    durationMinutes: Number,
  },
  { timestamps: true }
);

const ProgressSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    completedLessons: { type: Number, default: 0 },
    progressPercentage: { type: Number, default: 0 },
    lastAccessedAt: Date,
    timeSpentMinutes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ConversationSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    title: { type: String, default: 'Nueva conversación' },
    isActive: { type: Boolean, default: true },
    lastMessageAt: Date,
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const ChatMessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
    role: { type: String, enum: ['user', 'assistant', 'system'] },
    content: String,
    metadata: {
      tokensUsed: Number,
      model: String,
      responseTime: Number,
    },
  },
  { timestamps: true }
);

// El seed borra los cursos, así que debe borrar también el conocimiento
// indexado que apunta a ellos: si no, quedan chunks huérfanos que siguen
// apareciendo duplicados en las búsquedas del RAG.
const KnowledgeChunkSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
    content: String,
    embedding: [Number],
    sourceFile: String,
    chunkIndex: Number,
    metadata: Object,
  },
  { timestamps: true }
);

const Student = mongoose.model('Student', StudentSchema);
const Course = mongoose.model('Course', CourseSchema);
const Progress = mongoose.model('Progress', ProgressSchema);
const Conversation = mongoose.model('Conversation', ConversationSchema);
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
const KnowledgeChunk = mongoose.model('KnowledgeChunk', KnowledgeChunkSchema);

async function seed() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/candidate-test';

  console.log('[DB] Conectando a MongoDB...');
  await mongoose.connect(mongoUri);

  console.log('[DB] Limpiando datos existentes...');
  await Promise.all([
    Student.deleteMany({}),
    Course.deleteMany({}),
    Progress.deleteMany({}),
    Conversation.deleteMany({}),
    ChatMessage.deleteMany({}),
    KnowledgeChunk.deleteMany({}),
  ]);

  console.log('[SEED] Creando estudiante de prueba...');
  const student = await Student.create({
    _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    name: 'María García',
    email: 'maria@test.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria',
    preferences: {
      theme: 'light',
      language: 'es',
      notifications: true,
    },
    lastActive: new Date(),
  });

  console.log('[SEED] Creando cursos de ejemplo...');
  const courses = await Course.create([
    {
      title: 'Introducción a JavaScript',
      description:
        'Aprende los fundamentos de JavaScript desde cero. Variables, funciones, objetos y más.',
      thumbnail: 'https://picsum.photos/seed/js/400/300',
      totalLessons: 12,
      category: 'Programación',
      tags: ['javascript', 'web', 'principiante'],
      durationMinutes: 180,
    },
    {
      title: 'React desde Cero',
      description:
        'Domina React.js: componentes, hooks, estado y el ecosistema moderno de React.',
      thumbnail: 'https://picsum.photos/seed/react/400/300',
      totalLessons: 20,
      category: 'Frontend',
      tags: ['react', 'javascript', 'frontend'],
      durationMinutes: 360,
    },
    {
      title: 'Node.js y Express',
      description:
        'Construye APIs REST profesionales con Node.js y Express. Incluye autenticación y bases de datos.',
      thumbnail: 'https://picsum.photos/seed/node/400/300',
      totalLessons: 15,
      category: 'Backend',
      tags: ['nodejs', 'express', 'api', 'backend'],
      durationMinutes: 270,
    },
    {
      title: 'MongoDB Esencial',
      description:
        'Aprende a diseñar y gestionar bases de datos NoSQL con MongoDB. Queries, índices y agregaciones.',
      thumbnail: 'https://picsum.photos/seed/mongo/400/300',
      totalLessons: 10,
      category: 'Base de Datos',
      tags: ['mongodb', 'nosql', 'database'],
      durationMinutes: 150,
    },
    {
      title: 'TypeScript Profesional',
      description:
        'Lleva tu JavaScript al siguiente nivel con TypeScript. Tipos, interfaces, generics y más.',
      thumbnail: 'https://picsum.photos/seed/ts/400/300',
      totalLessons: 14,
      category: 'Programación',
      tags: ['typescript', 'javascript', 'tipos'],
      durationMinutes: 210,
    },
  ]);

  console.log('[SEED] Creando progreso en cursos...');
  await Progress.create([
    {
      studentId: student._id,
      courseId: courses[0]._id, // JavaScript
      completedLessons: 12,
      progressPercentage: 100,
      lastAccessedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Hace 1 semana
      timeSpentMinutes: 195,
    },
    {
      studentId: student._id,
      courseId: courses[1]._id, // React
      completedLessons: 14,
      progressPercentage: 70,
      lastAccessedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Ayer
      timeSpentMinutes: 280,
    },
    {
      studentId: student._id,
      courseId: courses[2]._id, // Node.js
      completedLessons: 5,
      progressPercentage: 33,
      lastAccessedAt: new Date(), // Hoy
      timeSpentMinutes: 90,
    },
    {
      studentId: student._id,
      courseId: courses[3]._id, // MongoDB
      completedLessons: 0,
      progressPercentage: 0,
      lastAccessedAt: null,
      timeSpentMinutes: 0,
    },
    {
      studentId: student._id,
      courseId: courses[4]._id, // TypeScript
      completedLessons: 0,
      progressPercentage: 0,
      lastAccessedAt: null,
      timeSpentMinutes: 0,
    },
  ]);

  console.log('[SEED] Creando conversacion de ejemplo...');
  const conversation = await Conversation.create({
    studentId: student._id,
    title: 'Dudas sobre React Hooks',
    isActive: true,
    lastMessageAt: new Date(),
    messageCount: 4,
  });

  await ChatMessage.create([
    {
      conversationId: conversation._id,
      role: 'user',
      content: '¿Cuál es la diferencia entre useState y useReducer?',
    },
    {
      conversationId: conversation._id,
      role: 'assistant',
      content: `¡Buena pregunta! Ambos hooks sirven para manejar estado en React, pero tienen diferentes casos de uso:

**useState** es ideal para:
- Estado simple (strings, números, booleanos)
- Cuando las actualizaciones son independientes
- Componentes pequeños

**useReducer** es mejor cuando:
- El estado es complejo (objetos anidados)
- Las actualizaciones dependen del estado anterior
- Tienes múltiples sub-valores relacionados
- Quieres lógica de actualización predecible

¿Te gustaría que te muestre un ejemplo práctico?`,
      metadata: {
        tokensUsed: 150,
        model: 'gpt-3.5-turbo',
        responseTime: 1200,
      },
    },
    {
      conversationId: conversation._id,
      role: 'user',
      content: 'Sí, muéstrame un ejemplo con useReducer',
    },
    {
      conversationId: conversation._id,
      role: 'assistant',
      content: `Aquí tienes un ejemplo de un carrito de compras con useReducer:

\`\`\`javascript
const cartReducer = (state, action) => {
  switch (action.type) {
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] };
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.payload) };
    case 'CLEAR_CART':
      return { ...state, items: [] };
    default:
      return state;
  }
};

const [cart, dispatch] = useReducer(cartReducer, { items: [] });

// Uso:
dispatch({ type: 'ADD_ITEM', payload: { id: 1, name: 'Producto' } });
\`\`\`

Este patrón hace que la lógica sea más predecible y fácil de testear. ¿Tienes alguna duda?`,
      metadata: {
        tokensUsed: 200,
        model: 'gpt-3.5-turbo',
        responseTime: 1500,
      },
    },
  ]);

  console.log('');
  console.log('[OK] Seed completado exitosamente!');
  console.log('');
  console.log('[INFO] Datos creados:');
  console.log(`   - 1 estudiante (ID: ${student._id})`);
  console.log(`   - ${courses.length} cursos`);
  console.log(`   - 5 registros de progreso`);
  console.log(`   - 1 conversacion con 4 mensajes`);
  console.log('');
  console.log('[AVISO] La base de conocimiento se ha vaciado (los cursos son nuevos).');
  console.log('        Ejecuta `npm run index:courses` con la API arrancada para reindexar.');
  console.log('');
  console.log('[INFO] Credenciales de prueba:');
  console.log('   Email: maria@test.com');
  console.log(`   Student ID: ${student._id}`);
  console.log('');

  await mongoose.disconnect();
  console.log('[DB] Conexion cerrada');
}

seed().catch((error) => {
  console.error('[ERROR] Error en seed:', error);
  process.exit(1);
});
