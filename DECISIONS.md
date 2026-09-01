# Decisiones Técnicas

## Información del Candidato

- **Nombre:** Judit Ortiz
- **Fecha:** 1 de septiembre de 2026
- **Tiempo dedicado:** ~7 horas

---

## Resumen de lo entregado

| Prioridad | Requisito | Estado |
|---|---|---|
| Must Have | Integración OpenAI (chat básico) | ✅ |
| Must Have | Sistema RAG completo (indexar PDFs, buscar, usar contexto) | ✅ |
| Must Have | Endpoints `/stats` y `/preferences` | ✅ |
| Must Have | Tests de los métodos implementados | ✅ 155 tests, 0 `it.todo` |
| Should Have | Streaming de respuestas | ✅ SSE |
| Should Have | Historial de chat con paginación | ✅ |
| Should Have | Loading / error en frontend | ✅ skeleton + retry |
| Nice to Have | Gráfico de actividad | ✅ recharts, datos reales |
| Nice to Have | Hover en CourseCard | ✅ |
| Nice to Have | Markdown en mensajes | ✅ |
| — | Bug intencional | ✅ encontrado y corregido |

**Verificación:** `npm run lint` (exit 0) · `npm run test:api` (111/111) · `npm run test:web` (44/44) · ambos builds OK.

---

## Decisiones de Arquitectura

### 1. Modelo de OpenAI: `gpt-5-mini` y sus restricciones

**Contexto:** El README sugiere `gpt-5-mini` o `gpt-4`. Antes de escribir código consulté
`GET /v1/models` con la API key proporcionada: solo hay acceso a **4 modelos**
(`gpt-5-mini`, `text-embedding-3-small`, `text-embedding-3-large`). `gpt-4` no está disponible,
así que la elección estaba tomada.

**Lo relevante es que `gpt-5-mini` es un modelo de razonamiento** y rechaza los parámetros
habituales de Chat Completions. Verificado con `curl` contra la API real:

| Parámetro | Resultado |
|---|---|
| `max_tokens` | `400 unsupported_parameter` → hay que usar `max_completion_tokens` |
| `temperature: 0.7` | `400 unsupported_value` → solo admite el valor por defecto (1) |
| `reasoning_effort` | ✅ soportado (`low` reduce el razonamiento de 256 → 128 tokens) |

**Decisión:** usar `max_completion_tokens: 2000` y `reasoning_effort: 'low'`, y **omitir
`temperature`** por completo.

**Consecuencia crítica y no evidente:** los `reasoning_tokens` se descuentan del presupuesto
**antes** de emitir texto visible. Un "di hola" consumió 271 tokens de los que **256 fueron
razonamiento**. Con un presupuesto bajo (p.ej. 300) la API devuelve **`content: null` con
HTTP 200**, sin error. Por eso `AiService` trata explícitamente la respuesta vacía y devuelve un
mensaje de fallback en lugar de persistir una cadena vacía en la base de datos.

---

### 2. Embeddings: `text-embedding-3-small` y llamadas por lotes

**Contexto:** hay que generar embeddings de ~52 chunks al indexar los 5 PDFs.

**Opciones consideradas:**
1. `text-embedding-3-large` (3072 dims): más preciso, 6,5× más caro.
2. `text-embedding-3-small` (1536 dims): suficiente para 5 PDFs de contenido docente.

**Decisión:** `text-embedding-3-small`, configurable vía `OPENAI_EMBEDDING_MODEL`.

Además, la API acepta **un array de inputs por request**, así que `createEmbeddings()` agrupa en
lotes de 64: indexar 52 chunks cuesta **1 request en lugar de 52**. Los resultados se reordenan
por `data[].index` porque la API no garantiza el orden de respuesta.

**Consecuencia:** si algún día se reindexa con `3-large`, los chunks antiguos (1536 dims) y los
nuevos (3072) convivirían. `searchSimilar()` descarta los de dimensión distinta a la de la query
en lugar de dejar que `cosineSimilarity()` lance y tumbe la búsqueda entera.

---

### 3. Búsqueda semántica en memoria y umbral de similitud

**Contexto:** el README especifica búsqueda en memoria, no MongoDB Atlas Vector Search.

**Decisión:** `searchSimilar()` genera el embedding de la query, carga los chunks candidatos con
un `find()` normal, calcula similitud coseno en Node y devuelve el top-K ordenado.

Se añadió un **umbral por defecto `minScore = 0.3`**, medido empíricamente: los fragmentos
realmente relevantes puntúan entre 0,42 y 0,64, y por debajo de 0,3 solo aparece ruido que
distrae al modelo. Verificación práctica: la pregunta *"¿cuál es la capital de Mongolia?"*
devuelve **0 fuentes** (el umbral filtra todo), mientras que *"¿qué son los utility types
Partial y Omit?"* devuelve **4 fuentes con scores 0,52–0,64**.

**Consecuencia / límite conocido:** cargar todos los chunks en memoria es correcto a esta escala
(52 chunks) pero es O(n) por consulta. A partir de unos pocos miles de chunks habría que pasar a
MongoDB Atlas Vector Search o a un índice vectorial dedicado (pgvector, Qdrant).

Se añadió un índice `{ courseId: 1, sourceFile: 1 }` en `KnowledgeChunk`, que es el filtro que
usan tanto la búsqueda por curso como el reindexado.

---

### 4. Indexación idempotente por `(courseId, sourceFile)`

**Contexto:** reindexar un PDF ya indexado duplicaría sus chunks y sesgaría la búsqueda
(el mismo fragmento aparecería varias veces en el contexto).

**Decisión:** `indexCourseContent()` borra los chunks previos de ese `(courseId, sourceFile)`
antes de insertar los nuevos. **El borrado ocurre después de generar los embeddings**, de modo
que un fallo de la API de OpenAI deja intacta la base de conocimiento existente.

Los PDFs traen saltos de línea de maquetación que parten las frases a mitad. Como
`splitIntoChunks()` trocea por final de frase (`/(?<=[.!?])\s+/`), sin normalizar salían chunks
rotos: `PdfService.normalize()` recompone las palabras cortadas con guion y colapsa los saltos.

---

### 5. RAG en el chat: alcance de la búsqueda y degradación

**Decisión 5a — no filtrar por el curso activo.** El estudiante puede preguntar por cualquiera
de sus cursos, así que la búsqueda recorre toda la base de conocimiento. El curso actual se usa
solo para **personalizar el prompt**, no para restringir el contexto.

**Decisión 5b — el RAG degrada, no rompe.** Si la búsqueda falla (nada indexado, OpenAI caído),
se registra un warning y se responde **sin** contexto. Un fallo del sistema de recuperación no
debe dejar el chat inutilizable.

**Decisión 5c — rollback del mensaje del usuario.** Si la IA falla después de haber guardado el
mensaje del usuario, ese mensaje se elimina. Si se quedara huérfano, contaminaría el contexto de
la siguiente llamada (dos mensajes de usuario seguidos sin respuesta intermedia) y descuadraría
`messageCount`.

**Decisión 5d — comprobación de propiedad.** `findById(conversationId)` permitía leer o borrar
la conversación de otro estudiante conociendo su ID. Todas las rutas resuelven ahora la
conversación con `{ _id, studentId }`, de modo que un ID ajeno devuelve 404.

---

### 6. Streaming de respuestas: SSE vs WebSocket

**Contexto:** hay que mostrar la respuesta token a token.

**Opciones consideradas:**
1. **Server-Sent Events (SSE):** unidireccional servidor→cliente sobre HTTP normal.
2. **WebSocket:** bidireccional, requiere handshake de upgrade y gestión de conexión propia.

**Decisión: SSE.** El flujo aquí es estrictamente unidireccional: el cliente envía una pregunta y
recibe tokens. SSE va sobre HTTP normal (sin upgrade, sin CORS especial), `EventSource` reconecta
solo, NestJS lo soporta de forma nativa con `@Sse()` y se depura con un simple `curl -N`.
WebSocket sería sobreingeniería sin ninguna ventaja para este caso.

**Consecuencias:**
- El endpoint es `GET /api/chat/message/stream` porque `EventSource` **solo admite GET**; los
  parámetros viajan en la query string.
- El generador asíncrono se envuelve en un `Observable` con función de teardown, para dejar de
  emitir si el cliente cierra la conexión.
- En el cliente hay que cerrar el `EventSource` al recibir `done`: si no, su reconexión
  automática reenviaría el mensaje.
- El frontend permite alternar streaming ON/OFF desde la cabecera del chat, para poder comparar
  ambos modos en la demo.

---

### 7. Cache de conversaciones en memoria

**Contexto:** `ChatService` mantiene un `Map<conversationId, MessageHistory[]>`.

**Problema encontrado (además del bug intencional):** el cache **nunca se actualizaba al guardar
mensajes**. Tras el primer intercambio devolvía historial obsoleto de forma permanente, porque
`getConversationHistory()` daba prioridad al cache y nadie escribía en él después.

Peor aún, el orden original era: guardar el mensaje del usuario → leer el historial (que ya lo
incluía) → enviarlo a OpenAI **junto con** el mensaje actual, duplicándolo en el prompt.

**Decisión:**
- El historial se carga **antes** de guardar el mensaje nuevo: representa el contexto previo.
- `appendToCache()` sincroniza el cache tras cada intercambio, acotado a 20 mensajes.
- `getConversationHistory()` devuelve una **copia defensiva**, para que quien la consuma no pueda
  mutar el cache por referencia.

**Límite asumido:** el cache es por instancia. Con varias réplicas del backend cada una tendría el
suyo; la BD sigue siendo la fuente de verdad, así que el impacto es un fallo de cache, no
inconsistencia. Para producción: Redis.

---

### 8. Paginación del historial

**Decisión:** orden cronológico (`createdAt: 1`, desempatado por `_id`), con `page` 1 = mensajes
más antiguos, según pide el enunciado. Sin `conversationId` se devuelve la conversación más
reciente del estudiante, que es lo que necesita el chat al abrirse.

El desempate por `_id` importa: dos mensajes guardados en el mismo milisegundo tendrían el mismo
`createdAt` y podrían aparecer en distinto orden entre páginas.

`DELETE /history/:studentId/:conversationId` borra los mensajes **y** la conversación (el
enunciado lo dejaba opcional) y limpia el cache. Responde 204.

---

### 9. Estadísticas: qué se puede calcular con el modelo de datos actual

**Contexto:** el enunciado pide racha de días consecutivos y progreso semanal, pero `Progress`
guarda un único `lastAccessedAt` por curso, **no un log de sesiones de estudio**.

**Decisión:** derivar las métricas de esas marcas y documentar la aproximación:
- **Racha:** días únicos (normalizados a medianoche local) con algún acceso. Sigue viva si el
  último acceso fue hoy o ayer.
- **Actividad diaria (gráfico):** el tiempo de cada curso se imputa al día de su
  `lastAccessedAt`. Es una aproximación, no un histórico real.
- **Progreso semanal:** puntos de progreso acumulados divididos por las semanas desde el alta.

La **distribución por categoría** sí usa una agregación de MongoDB (`$lookup` + `$group`), como
sugiere el enunciado: el join y la suma ocurren en la base de datos, no en Node.

**Mejora futura:** una colección `StudySession { studentId, courseId, startedAt, minutes }`
permitiría rachas y gráficos reales sin aproximaciones.

---

### 10. Actualización parcial de preferencias

**Decisión:** merge con **notación por puntos**:

```ts
updates[`preferences.${key}`] = value;   // -> { $set: { 'preferences.theme': 'dark' } }
```

Un `$set: { preferences: dto }` habría **reemplazado el subdocumento entero**, borrando
`language` y `notifications` al cambiar solo el tema. Verificado: enviar `{"theme":"dark"}`
conserva `language: "es"` y `notifications: true`.

Un DTO vacío devuelve 400 en lugar de ejecutar un `$set: {}`, que MongoDB rechaza.

---

## Bug Encontrado

### Ubicación
- **Archivo:** `apps/api/src/modules/chat/chat.service.ts`
- **Línea(s):** 100–107 (versión original)
- **Método:** `startNewConversation()`

### Código original

```ts
if (previousConversations.length > 0) {
  const prevId = previousConversations[0]._id.toString();
  const cachedHistory = this.conversationCache.get(prevId);
  history = cachedHistory || [];   // (1) referencia, no copia
  history.length = 0;              // (2) vacía el array de la conversación ANTERIOR
} else {
  history = [];
}
// ...
this.conversationCache.set(conversationIdStr, history);  // (3) misma referencia, dos claves
```

### Descripción del Bug

Al iniciar una conversación nueva, se **destruye el historial cacheado de la conversación
anterior** y ambas conversaciones quedan **compartiendo el mismo array**.

### Causa Raíz

Es un problema clásico de **aliasing de referencias** en JavaScript:

1. `history = cachedHistory` **no copia** el array: `history` y el valor guardado en el `Map`
   apuntan al mismo objeto en memoria.
2. `history.length = 0` **muta ese array in situ** (a diferencia de `history = []`, que
   reasignaría la variable local). El historial de la conversación anterior se pierde.
3. `this.conversationCache.set(conversationIdStr, history)` guarda **esa misma referencia** bajo
   la clave nueva. A partir de ahí, el `Map` tiene dos claves apuntando al mismo array: cada
   mensaje que se añada a la conversación nueva aparece también en la anterior, y viceversa.

El comentario del código (*"reutilizar estructura"*) sugiere que la intención era una
optimización, pero reutilizar un array mutable compartido no ahorra nada apreciable y rompe el
aislamiento entre conversaciones.

### Solución Propuesta

```ts
// Cada conversación arranca con su propio array de historial. Reutilizar el
// array cacheado de una conversación anterior compartiría la referencia
// entre ambas entradas del Map.
const history: MessageHistory[] = [];

if (initialContext) {
  history.push({ role: 'system', content: initialContext });
}

this.conversationCache.set(conversationIdStr, history);
```

También se eliminó la consulta `previousConversations`, que solo servía para alimentar ese
aliasing y suponía una lectura extra a la base de datos por cada conversación nueva.

### Cómo lo descubrí

El README apuntaba a `startNewConversation`, así que fui directo al método. Al leerlo, la línea
`history.length = 0` sobre un valor recién sacado del `Map` saltó a la vista: vaciar un array que
acabas de leer de un cache solo tiene sentido si crees que estás trabajando sobre una copia.

Para confirmarlo escribí primero el test de regresión (`should not affect history of previous
conversations`): precarga el cache con dos mensajes de una conversación anterior, llama a
`startNewConversation()` y comprueba (a) que el historial anterior sigue teniendo longitud 2 y
(b) que `cache.get(nueva) !== cache.get(anterior)`. Con el código original fallaban ambas
aserciones; con la corrección pasan.

---

## Suposiciones Realizadas

1. **`gpt-5-mini` como único modelo de chat:** es el único disponible con la API key
   proporcionada (`GET /v1/models`). Configurable con `OPENAI_CHAT_MODEL`.
2. **El RAG busca en todos los cursos, no solo en el activo:** un estudiante puede preguntar por
   cualquier curso en el que esté matriculado.
3. **`minScore = 0.3`:** umbral empírico. Es un parámetro de la query, así que se puede ajustar
   sin tocar código.
4. **Sin autenticación:** el `studentId` viaja en la ruta, tal como venía el proyecto base. Aun
   así, todas las operaciones sobre conversaciones verifican la propiedad, para que el modelo de
   permisos no dependa de que el ID sea secreto.
5. **La racha se deriva de `lastAccessedAt`:** no existe log de sesiones (ver decisión 9).
6. **Página 1 del historial = mensajes más antiguos:** el enunciado pide orden cronológico.
7. **`DELETE` borra también la conversación:** el enunciado lo daba como opcional; borrar solo
   los mensajes dejaría conversaciones vacías en la lista.
8. **El indexado de PDFs se lanza a mano** (`npm run index:courses`), no al arrancar: es una
   operación con coste en la API de OpenAI y no debe repetirse en cada reinicio.

---

## Dificultades Encontradas

### 1. `gpt-5-mini` devuelve respuestas vacías sin dar error
- **Problema:** con `max_completion_tokens` ajustado, la API responde HTTP 200 con
  `content: null`. No hay error que capturar, así que el síntoma es un mensaje del asistente en
  blanco guardado en la base de datos.
- **Causa:** los `reasoning_tokens` consumen el presupuesto antes de generar texto visible.
- **Solución:** presupuesto holgado (2000), `reasoning_effort: 'low'` y comprobación explícita de
  `content` vacío con mensaje de fallback. Hay un test que cubre este caso concreto.
- **Tiempo:** ~40 min (incluye probar la API con `curl` antes de escribir código, que es
  precisamente lo que evitó el problema).

### 2. Contaminación entre tests por `jest.clearAllMocks()`
- **Problema:** tres tests de `AiService` fallaban con un error de red real.
- **Causa:** `clearAllMocks()` limpia las llamadas registradas pero **no las implementaciones**.
  La API key configurada en los tests de `isConfigured` sobrevivía al `beforeEach` siguiente, el
  constructor la leía y **creaba un cliente real de OpenAI** que intentaba salir a internet.
- **Solución:** `mockConfigService.get.mockReset()` explícito al principio de cada `beforeEach`.
- **Tiempo:** ~20 min.

### 3. Entorno: tres bloqueos previos al desarrollo
- **MongoDB no arrancaba** (`exit 62`): el `dbpath` de Homebrew tenía
  `featureCompatibilityVersion: 7.0` pero la versión instalada era 6.0. Resuelto arrancando
  `mongod --dbpath ./.mongodb-data` en un directorio propio del proyecto, sin destruir datos
  previos del sistema.
- **Los tests del frontend no ejecutaban:** `project.json` usa `@nx/vite:test` (vitest) pero los
  specs estaban escritos con la API de Jest (`jest.mock` / `jest.fn`), y `jest` no existe como
  global en vitest. Migrados a `vi`. Además, `Chat.spec.tsx` importaba
  `@testing-library/user-event`, ausente del `package.json`.
- **`npm run lint` no arrancaba:** faltaba `@nx/eslint-plugin` y los `.eslintrc.json` por
  proyecto (el config raíz ignora `**/*` y cada proyecto debe reactivarse con
  `"ignorePatterns": ["!**/*"]`). Añadidos, junto con los plugins de React que exige
  `plugin:@nx/react`.
- **Tiempo:** ~50 min.

### 4. jsdom no implementa `scrollIntoView` ni `ResizeObserver`
- **Problema:** cualquier render del chat reventaba en el `useEffect` de auto-scroll, y el
  `ResponsiveContainer` de recharts no podía medirse.
- **Solución:** stubs en `apps/web/src/test-setup.ts`. Es una carencia del entorno de test, no del
  código de producción.
- **Tiempo:** ~10 min.

---

## Mejoras Futuras

1. **Autenticación y autorización reales** (JWT + guards). Hoy el `studentId` viaja en la ruta;
   la comprobación de propiedad mitiga el riesgo pero no sustituye a la autenticación.
2. **Colección `StudySession`** para calcular rachas y actividad diaria de forma exacta, en lugar
   de derivarlas de `lastAccessedAt` (ver decisión 9).
3. **Índice vectorial de verdad** (MongoDB Atlas Vector Search o pgvector) cuando la base de
   conocimiento supere unos pocos miles de chunks; la búsqueda en memoria es O(n) por consulta.
4. **Cache distribuido (Redis)** para el historial de conversaciones, en vez del `Map` por
   instancia, de cara a escalar horizontalmente.
5. **Chunking con solape** (~15%) y re-ranking de resultados: mejoraría la recuperación cuando la
   respuesta cae justo en la frontera entre dos chunks.
6. **Citas en la respuesta:** el backend ya devuelve `sources` con score y extracto por mensaje;
   falta pintarlas en la UI como referencias desplegables.
7. **Tests e2e** (Supertest + `mongodb-memory-server`) que cubran el flujo completo
   indexar → preguntar → responder, complementando los tests unitarios actuales.
8. **Rate limiting** por estudiante en los endpoints de chat, para acotar el gasto en la API de
   OpenAI.

---

## Notas Adicionales

### Puesta en marcha

```bash
npm install
cp .env.example .env          # configurar MONGODB_URI y OPENAI_API_KEY
npm run seed                  # datos de prueba
npm run start:api             # http://localhost:3333/api (Swagger en /api/docs)
npm run index:courses         # indexa los 5 PDFs (requiere la API en marcha)
npm run start:web             # http://localhost:5173
```

`npm run index:courses` es un script añadido: extrae el texto de los PDFs de `data/courses`,
los empareja con su curso por título y los indexa vía API. Resultado: **52 chunks / 5 cursos**.

### Endpoints añadidos sobre el enunciado

| Endpoint | Motivo |
|---|---|
| `GET /api/chat/message/stream` | Streaming SSE (Should Have) |
| `GET /api/chat/conversations/:studentId` | Listar conversaciones del estudiante |
| `POST /api/knowledge/index/pdf` | Indexar un PDF de `data/courses` directamente, sin extraer el texto a mano (facilita la demo) |

### Variables de entorno añadidas

| Variable | Por defecto | Uso |
|---|---|---|
| `OPENAI_CHAT_MODEL` | `gpt-5-mini` | Modelo de chat |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Modelo de embeddings |
| `OPENAI_REASONING_EFFORT` | `low` | Esfuerzo de razonamiento |
