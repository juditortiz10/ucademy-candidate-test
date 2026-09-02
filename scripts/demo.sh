#!/usr/bin/env bash
#
# Demostración de las funcionalidades implementadas.
#
#   bash scripts/demo.sh            índice
#   bash scripts/demo.sh check      comprueba que el entorno está listo
#   bash scripts/demo.sh rag        el sistema RAG de principio a fin
#   bash scripts/demo.sh chat       chat con contexto, y sin él
#   bash scripts/demo.sh stream     streaming SSE token a token
#   bash scripts/demo.sh student    /stats y /preferences
#   bash scripts/demo.sh history    historial paginado y borrado seguro
#   bash scripts/demo.sh all        todo seguido (~3 min)
#
# Requiere la API arrancada (npm run start:api) y los PDFs indexados
# (npm run index:courses).

set -uo pipefail

API="${API_URL:-http://localhost:3333/api}"
SID="${STUDENT_ID:-507f1f77bcf86cd799439011}"

B=$'\033[1m'; D=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; N=$'\033[0m'

titulo()  { printf '\n%s══ %s ══%s\n' "$B" "$1" "$N"; }
paso()    { printf '\n%s▸ %s%s\n' "$C" "$1" "$N"; }
nota()    { printf '  %s%s%s\n' "$D" "$1" "$N"; }
comando() { printf '  %s$ %s%s\n' "$Y" "$1" "$N"; }
ok()      { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
aviso()   { printf '  %s!%s %s\n' "$R" "$N" "$1"; }

comprobar_entorno() {
  if ! curl -s -o /dev/null --max-time 3 "$API/knowledge/stats"; then
    aviso "La API no responde en $API"
    nota  "Arráncala con: npm run start:api"
    return 1
  fi

  local total
  total=$(curl -s "$API/knowledge/stats" | sed -n 's/.*"totalChunks":\([0-9]*\).*/\1/p')

  if [ "${total:-0}" -eq 0 ]; then
    aviso "No hay contenido indexado"
    nota  "Indexa los PDFs con: npm run index:courses"
    return 1
  fi

  return 0
}

demo_check() {
  titulo "COMPROBACIÓN DEL ENTORNO"
  comprobar_entorno || return 1
  ok "API operativa en $API"
  ok "Base de conocimiento: $(curl -s "$API/knowledge/stats")"
  ok "Estudiante de prueba: $SID"
  nota "Frontend en http://localhost:5173 (npm run start:web)"
}

demo_rag() {
  titulo "SISTEMA RAG"
  comprobar_entorno || return 1

  paso "1 · Contenido indexado"
  comando "curl $API/knowledge/stats"
  printf '  %s\n' "$(curl -s "$API/knowledge/stats")"
  nota "52 chunks extraídos de los 5 PDFs de data/courses"

  paso "2 · Búsqueda semántica: encuentra SIN usar las palabras del texto"
  local consulta="como evito que mi consulta recorra toda la coleccion"
  nota "Consulta: \"$consulta\""
  comando "curl -G $API/knowledge/search --data-urlencode 'q=...'"
  curl -s -G "$API/knowledge/search" \
       --data-urlencode "q=$consulta" \
       --data-urlencode 'limit=3' \
    | python3 -c "
import json,sys
for r in json.load(sys.stdin)['results']:
    print(f\"     {r['score']:.4f}  {r['content'][:76].replace(chr(10),' ')}...\")"

  paso "3 · Y una búsqueda por palabras no encuentra nada"
  nota "Ninguna de esas palabras aparece en los PDFs:"
  for palabra in "recorra" "evito que mi consulta"; do
    local n
    n=$(curl -s -G "$API/knowledge/search" --data-urlencode "q=$palabra" --data-urlencode 'limit=1' >/dev/null 2>&1; \
        mongosh candidate-test --quiet --eval "db.knowledgechunks.countDocuments({content:{\$regex:'$palabra',\$options:'i'}})" 2>/dev/null || echo "?")
    printf '     grep "%s" → %s resultados\n' "$palabra" "$n"
  done
  nota "Eso es buscar por significado, no por coincidencia de texto."
}

demo_chat() {
  titulo "CHAT CON RAG"
  comprobar_entorno || return 1

  paso "1 · Pregunta CUBIERTA por el material del curso"
  local pregunta="Segun el material de mi curso, que es el aggregation pipeline de MongoDB?"
  nota "\"$pregunta\""
  curl -s -X POST "$API/chat/message" -H 'Content-Type: application/json' \
       -d "$(python3 -c "import json,sys; print(json.dumps({'studentId': sys.argv[1], 'message': sys.argv[2]}))" "$SID" "$pregunta")" \
    | python3 -c "
import json,sys,textwrap
d=json.load(sys.stdin); m=d['assistantMessage']
print(textwrap.fill(m['content'][:400], 84, initial_indent='     ', subsequent_indent='     '))
print()
print(f\"     modelo: {m['metadata']['model']}   tokens: {m['metadata']['tokensUsed']}   ms: {m['metadata']['responseTime']}\")
print(f\"     fuentes usadas: {[round(s['score'],3) for s in d['sources']]}\")"
  nota "La respuesta declara en qué fragmentos se apoyó, con su puntuación."

  paso "2 · Pregunta FUERA del material"
  local otra="Cual es la altura del Everest?"
  nota "\"$otra\""
  curl -s -X POST "$API/chat/message" -H 'Content-Type: application/json' \
       -d "$(python3 -c "import json,sys; print(json.dumps({'studentId': sys.argv[1], 'message': sys.argv[2]}))" "$SID" "$otra")" \
    | python3 -c "
import json,sys,textwrap
d=json.load(sys.stdin)
print(textwrap.fill(d['assistantMessage']['content'][:220], 84, initial_indent='     ', subsequent_indent='     '))
print()
print(f\"     fuentes usadas: {d['sources']}\")"
  nota "Sin fuentes: el umbral de similitud descarta el ruido en lugar de"
  nota "colar fragmentos irrelevantes en el prompt."
}

demo_stream() {
  titulo "STREAMING SSE"
  comprobar_entorno || return 1

  paso "Respuesta token a token"
  comando "curl -N -G $API/chat/message/stream --data-urlencode 'message=...'"
  curl -s -N -G "$API/chat/message/stream" \
       --data-urlencode "studentId=$SID" \
       --data-urlencode "message=En una frase: que es un closure en JavaScript?" \
       --max-time 90 \
    | grep -E '"start"|"token"|"done"' | head -12 | sed 's/^/     /'
  nota "Un evento 'start' con el id de conversación, luego los tokens sueltos,"
  nota "y un 'done' con el mensaje completo ya persistido."
}

demo_student() {
  titulo "ENDPOINTS DE ESTUDIANTE"
  comprobar_entorno || return 1

  paso "1 · GET /students/:id/stats"
  curl -s "$API/students/$SID/stats" | python3 -c "
import json,sys
d=json.load(sys.stdin); t=d['totals']; s=d['streak']
print(f\"     tiempo de estudio: {t['totalTimeSpentFormatted']}\")
print(f\"     cursos: {t['completedCourses']} completados / {t['inProgressCourses']} en progreso / {t['notStartedCourses']} sin empezar\")
print(f\"     racha: {s['currentStreakDays']} días (récord {s['longestStreakDays']})\")
print('     tiempo por categoría (agregación \$lookup en MongoDB):')
for c in d['timeByCategory']:
    print(f\"       {c['category']:16} {c['timeSpentFormatted']:>8}  {c['percentage']:3}%  {'#'*int(c['percentage']/4)}\")
print('     actividad de los últimos 7 días:')
print('       ' + '  '.join(f\"{x['label']}:{x['minutes']}m\" for x in d['activityByDay']))"

  paso "2 · PATCH /preferences — merge parcial"
  curl -s -X PATCH "$API/students/$SID/preferences" -H 'Content-Type: application/json' \
       -d '{"theme":"light","language":"es","notifications":true}' > /dev/null
  printf '     estado inicial: %s\n' "$(curl -s "$API/students/$SID/dashboard" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['student']['preferences'],ensure_ascii=False))")"
  comando "curl -X PATCH .../preferences -d '{\"theme\":\"dark\"}'   ← solo el tema"
  curl -s -X PATCH "$API/students/$SID/preferences" -H 'Content-Type: application/json' -d '{"theme":"dark"}' > /dev/null
  printf '     resultado:      %s\n' "$(curl -s "$API/students/$SID/dashboard" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['student']['preferences'],ensure_ascii=False))")"
  nota "language y notifications intactos: es un merge, no un reemplazo."

  paso "3 · Validación"
  printf '     theme inválido        → HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/students/$SID/preferences" -H 'Content-Type: application/json' -d '{"theme":"neon"}')"
  printf '     estudiante inexistente → HTTP %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/students/507f1f77bcf86cd799439099/preferences" -H 'Content-Type: application/json' -d '{"theme":"dark"}')"
}

demo_history() {
  titulo "HISTORIAL Y BORRADO"
  comprobar_entorno || return 1

  paso "1 · Paginación en orden cronológico"
  local conv
  conv=$(curl -s "$API/chat/conversations/$SID" | python3 -c "
import json,sys
cs=[c for c in json.load(sys.stdin) if c['messageCount']>=4]
print(cs[0]['_id'] if cs else '')")

  if [ -z "$conv" ]; then
    nota "No hay ninguna conversación con 4+ mensajes; se muestra la más reciente."
    conv=$(curl -s "$API/chat/conversations/$SID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['_id'] if d else '')")
  fi

  for pagina in 1 2; do
    printf '     ── página %s ──\n' "$pagina"
    curl -s "$API/chat/history/$SID?conversationId=$conv&limit=2&page=$pagina" | python3 -c "
import json,sys
d=json.load(sys.stdin); p=d['pagination']
print(f\"        total={p['total']}  páginas={p['totalPages']}  hasMore={p['hasMore']}\")
for m in d['messages']:
    print(f\"        [{m['role']:9}] {m['content'][:56].replace(chr(10),' ')}\")
if not d['messages']: print('        (vacío)')"
  done

  paso "2 · Borrado, y que no se pueden tocar conversaciones ajenas"
  local nueva
  nueva=$(curl -s -X POST "$API/chat/conversation/new" -H 'Content-Type: application/json' \
          -d "$(python3 -c "import json,sys; print(json.dumps({'studentId': sys.argv[1]}))" "$SID")" \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['_id'])")

  printf '     borrar la propia           → HTTP %s  (204 esperado)\n' "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/chat/history/$SID/$nueva")"
  printf '     borrarla de nuevo          → HTTP %s  (404 esperado)\n' "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/chat/history/$SID/$nueva")"
  printf '     borrar la de otro alumno   → HTTP %s  (404 esperado)\n' "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/chat/history/507f1f77bcf86cd799439099/$conv")"
  nota "Las conversaciones se resuelven por { _id, studentId }: conocer el id"
  nota "de otro estudiante no da acceso a su conversación."
}

indice() {
  printf '\n%sDEMO · Dashboard de Estudiante con Chat IA%s\n' "$B" "$N"
  printf '%s\n' "$(printf '─%.0s' $(seq 1 58))"
  printf '  %-10s %s\n' "check"   "comprueba que el entorno está listo"
  printf '  %-10s %s\n' "rag"     "sistema RAG: indexado y búsqueda semántica"
  printf '  %-10s %s\n' "chat"    "chat con contexto del curso, y sin él"
  printf '  %-10s %s\n' "stream"  "streaming SSE token a token"
  printf '  %-10s %s\n' "student" "estadísticas y preferencias"
  printf '  %-10s %s\n' "history" "historial paginado y borrado seguro"
  printf '  %-10s %s\n' "all"     "todo seguido (~3 min)"
  printf '\n  %sUso:%s bash scripts/demo.sh rag\n' "$C" "$N"
  printf '  %sFrontend:%s http://localhost:5173\n\n' "$C" "$N"
}

case "${1:-}" in
  check)   demo_check ;;
  rag)     demo_rag ;;
  chat)    demo_chat ;;
  stream)  demo_stream ;;
  student) demo_student ;;
  history) demo_history ;;
  all)     demo_check && demo_rag && demo_chat && demo_stream && demo_student && demo_history ;;
  *)       indice ;;
esac
