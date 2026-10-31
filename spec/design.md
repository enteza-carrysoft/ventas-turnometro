# Diseño técnico — TurnoSala Prospector (ADR-004, sistema web completo)

## 1. Vista general

```text
                         ┌──────────────────────── TurnoSala Prospector (este repo, Docker) ─────────────────────────┐
 Fuentes permitidas ───► │ worker (pg-boss)                                                                           │
 (datos abiertos, OSM,   │  ├─ discovery   → candidatos            ┌─ packages/core (puro) ───────────────────────┐   │
  mapas, web_search,     │  ├─ enrich      → evidencias + señales  │ normalización · dedupe · puntuación           │   │
  webs corporativas)     │  ├─ verify/dedupe/score → fichas        │ complianceGate.evaluate · motor de huecos     │   │
                         │  ├─ planner     → siguiente mejor acción└──────────────────────────────────────────────┘   │
                         │  ├─ content     → cartas, guiones, landings, anuncios (verificador de afirmaciones)        │
                         │  ├─ contact     → ContactService.execute()  ── único punto de salida ──┐                   │
                         │  ├─ calendar    → lee ICS de ocupado · recordatorios · resumen diario  │                   │
                         │  ├─ trials      → sync_outbox → API de plataforma TurnoSala (PRP-017)  │                   │
                         │  └─ reports / retention                                                │                   │
                         │ web (Next.js 16):                                                      │                   │
                         │   panel: fichas · revisión · campañas · CRM (tablero, tareas, línea de tiempo) · agenda    │
                         │   público: /demo/<sector> · /demo/reservar · /c/<token> · /baja · /cita/<token> · ICS      │
                         │ voice (Fastify + WebSocket): Twilio ConversationRelay ⇄ Claude (huecos y reserva directos) │
                         │ PostgreSQL 16 (+ pgvector, btree_gist)                                 │                   │
                         └────────────────────────────────────────────────────────────────────────┼───────────────────┘
                                   ▲ ICS de ocupado (solo lectura)                                 ▼
                         Google Calendar / Outlook de los comerciales          Twilio · Resend · cartas · Anthropic · TurnoSala
```

Principio: **un solo sistema investiga, decide, contacta y gestiona la venta.** Ningún componente salvo
`packages/contact` puede contactar a nadie; el CRM y la agenda usan la misma puerta de cumplimiento.

## 2. Pila

| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript estricto, Node 22 LTS, ESM | Mismo lenguaje que TurnoSala; un solo equipo |
| Monorepo | npm workspaces | El desarrollador usa npm en Windows; sin herramientas extra |
| Web | Next.js 16 (App Router) + Tailwind + shadcn/ui | Igual que turnometro: componentes y criterio conocidos |
| BD | PostgreSQL 16 + `pgvector` (+ `pg_trgm`, `unaccent`, `btree_gist`) | Dedupe difusa, búsqueda semántica (S), anti-doble-reserva por restricción de exclusión, todo en una BD |
| Calendario | `ics` (generar invitaciones y feeds), `node-ical` (leer suscripciones), `@dnd-kit` (tablero) | Sin dependencias de Google/Microsoft en el MVP |
| ORM / migraciones | Drizzle ORM + drizzle-kit (SQL revisable) | Tipos desde el esquema; migraciones legibles |
| Colas | `pg-boss` | Trabajos en Postgres: sin Redis, reintentos, cron, singleton |
| Auth | Better Auth (email + contraseña, 2FA TOTP para `admin`) | Autoalojado, roles propios |
| LLM | API de Claude, SDK `@anthropic-ai/sdk` | Herramientas web de servidor, salidas estructuradas, batch, caché |
| Rastreo | `undici` + `robots-parser` + `cheerio` (HTML→texto) | Control de robots y ritmo; sin navegador headless en el MVP |
| Teléfonos | `libphonenumber-js` | E.164 |
| Voz | Twilio Programmable Voice + ConversationRelay (STT/TTS es-ES) | La pasarela solo intercambia texto con el LLM |
| Email | Resend (subdominio dedicado, p. ej. `hola.turnosala.com`) + entrada por webhook | Ya verificado en turnometro; DMARC propio |
| Cartas | PDF con `@react-pdf/renderer`; envío por proveedor con API (D-07) o impresión propia | Carril legal para el primer contacto |
| QR | `qrcode` | Igual que turnometro |
| Validación | Zod 4 | Todas las fronteras |
| Tests | Vitest (unit/integración con Postgres efímero en Docker), Playwright (e2e) | |
| Logs | `pino` JSON | Sin secretos ni datos personales en claro |
| Despliegue | Docker Compose: `web`, `worker`, `voice`, `postgres`, `caddy` (TLS) | Ver §10 |

## 3. Estructura del repositorio

```text
apps/
  web/                    # Next.js: (panel)/ fichas, revision, campanas, crm, agenda, ajustes
                          #          (public)/ demo/[sector], demo/reservar, c/[token], baja/[token], cita/[token]
                          #          api/ · api/webhooks/* · api/ics/[token]
  worker/                 # registro de colas pg-boss y handlers (uno por archivo)
  voice/                  # Fastify: /twilio/voice (TwiML), /twilio/relay (WS), /twilio/status
packages/
  core/                   # PURO, sin E/S: normalize/, dedupe/, scoring/, compliance/, claims/, slots/
  db/                     # esquema Drizzle, migraciones, repositorios, triggers de solo inserción
  ai/                     # cliente Claude, rutas de modelo, prompts versionados, esquemas Zod de salida
  connectors/             # sources/* (adaptadores), turnosala/, twilio/, resend/, letters/, robinson/, ical/
  contact/                # ContactService: check → ejecutar → registrar (único usuario de connectors de salida)
  content/                # generadores (carta, guion, landing, anuncio) + verificador de afirmaciones
  crm/                    # servicios de oportunidades, tareas, línea de tiempo y reservas (usan contact y core/slots)
spec/                     # este paquete SDD
deploy/                   # docker-compose.yml, Caddyfile, .env.example, scripts de copia
tests/                    # e2e Playwright, escenarios de voz YAML, test de arquitectura
```

## 4. Pipeline de agentes (cómo se hace la «prospección con IA»)

El trabajo se divide en **etapas deterministas** y **llamadas al LLM acotadas**. El LLM nunca decide permisos ni
calcula puntuaciones: extrae, resume y redacta. Cada etapa es una cola idempotente con estado por registro.

| # | Etapa (cola) | Entrada → salida | LLM | Detalle |
|---|---|---|---|---|
| 1 | `market.analyze` | producto + competidores → segmentos ICP | Sí (agente con `web_search`/`web_fetch`) | REQ-MKT-02; el resultado queda en `draft` |
| 2 | `market.size` | segmento + territorio → universo estimado | Opcional | INE DIRCE/registros; REQ-MKT-03 |
| 3 | `discovery.task` | (fuente × municipio) → candidatos | Solo en la fuente `web_search` | Adaptadores de §5 |
| 4 | `enrich.site` | candidato → páginas (≤ 6) | No | Rastreador propio, robots, 1 req/s/dominio, caché 30 días |
| 5 | `enrich.extract` | páginas → campos + señales + evidencias | Sí (salida estructurada) | REQ-ENR-01/02; verificación literal del fragmento |
| 6 | `verify` | campos → normalizados + comprobados | No | E.164, MX, HTTP, INE, `legal_form` |
| 7 | `dedupe` | ficha → fusionada / nueva / bloqueada | No | trigram + claves exactas + `turnosala_customers` + exclusiones |
| 8 | `score` | señales → puntuación | No | Función pura versionada |
| 9 | `review` | — | — | Humano en el panel (REQ-REV) |
| 10 | `plan.next_action` | ficha aprobada + campaña → acción por canal | No | Evalúa la puerta por canal; REQ-OUT-02 |
| 11 | `content.generate` | acción → carta/guion/landing | Sí | Verificador de afirmaciones contra `product_facts` |
| 12 | `contact.execute` | lote aprobado → envío | No | `ContactService`; re-evalúa la puerta < 60 s |
| 13 | `inbound.classify` | respuesta de email → intención | Sí (Haiku) | REQ-EML-02 |
| 14 | `crm.handoff` | hito comercial → oportunidad + tarea | No | REQ-CRM-01; §8 |
| 15 | `calendar.*` | ICS de ocupado, recordatorios de demo, resumen diario de tareas | No | REQ-AGE-03, DEM-02, CRM-03 |
| 16 | `trials.sync` | outbox → API de plataforma de TurnoSala | No | REQ-TRI-01/02 |
| 17 | `report.weekly` | métricas → informe | Sí | REQ-OBS-02 |

### 4.1 Rutas de modelo (configurables por variable de entorno)

Verificar con la skill `claude-api` al implementar: los modelos, herramientas y precios cambian.

| Ruta | Modelo por defecto | Esfuerzo | Notas |
|---|---|---|---|
| `market.analyze`, `report.weekly` | `claude-opus-5-5` | `high` | Agente con `web_search_20260209` y `web_fetch_20260209`; streaming |
| `enrich.extract`, `content.generate` | `claude-opus-5-5` | `medium` | Salida estructurada (`client.messages.parse` + Zod); **Batch API** (−50 %) para lotes no urgentes |
| `discovery` (fuente web) | `claude-opus-5-5` | `low` | `web_search` con `user_location` España y `blocked_domains` de fuentes vetadas |
| `inbound.classify`, extracción masiva barata | `claude-haiku-5-5` | `low` | Clasificación corta |
| `voice.dialog` | `claude-haiku-5-5` | `low` | Latencia; streaming; herramientas estrictas (`strict: true`) |

Precios de referencia (caché de la skill, 06/10/2026, por millón de tokens): Opus 5.5 4 $ entrada / 20 $ salida;
Haiku 5.5 0,10 $ / 0,50 $. Las búsquedas web se facturan aparte: consultar precio vigente. Reglas de uso:

- Prompts de sistema y `product_facts` estables al principio con `cache_control` (caché de prefijo); nada variable antes.
- Comprobar `stop_reason` (`refusal`, `max_tokens`) antes de leer el contenido; activar `fallbacks: "default"` en Opus.
- Sin `temperature`/`top_p` (rechazados por la API actual) ni `budget_tokens`; pensamiento adaptativo.
- Cada llamada registra tokens y coste estimado en `usage_costs` (REQ-OBS-01) y respeta el presupuesto antes de lanzarse.
- Contenido web en bloques delimitados (`<documento fuente="…">`) con instrucción de tratarlo como dato.

### 4.2 Extracción con evidencia (anti-alucinación)

Esquema de salida (resumen): `{ fields: [{ key, value, provenance, source_url, quote }], signals: [{ key, quote,
source_url }], contact_points: [{ type, value, source_url, quote }], legal_form: {...} }`. El código comprueba que cada
`quote` aparece (normalizando espacios) en el texto descargado de `source_url`; si no, descarta el elemento y
lo cuenta como `hallucination_rejected` (métrica de calidad por versión de prompt).

## 5. Fuentes (adaptadores `packages/connectors/sources`)

Cada adaptador implementa `{ id, license, storable_fields, rate_limit, search(task) }`. Estado inicial: **todas
desactivadas** hasta que F0 compruebe licencia y acceso (tarea F0.4).

| Fuente | Uso | Licencia / restricción a verificar |
|---|---|---|
| REGCESS (Ministerio de Sanidad) y registros autonómicos de centros sanitarios (Junta de Andalucía) | Clínicas, dentales, ópticas, fisioterapia, laboratorios autorizados | Reutilización de información pública (Ley 37/2007); comprobar formato de descarga vigente |
| OpenStreetMap (Overpass) | Ópticas, talleres, veterinarios, academias, gestorías por municipio | ODbL: atribución; uso interno de la base derivada |
| Directorios de datos abiertos (datos.gob.es, Junta/IECA, ayuntamientos) | Establecimientos por actividad y municipio | Licencia de cada conjunto |
| INE (DIRCE, nomenclátor) | Dimensionamiento y códigos de municipio | Uso estadístico |
| Google Places API (New) | Descubrimiento complementario | Solo `place_id` almacenable; resto se consulta y no se guarda |
| `web_search` de Claude | Descubrimiento y evidencias complementarias | Resultados con URL; la ficha se basa en la web de la empresa |
| Web corporativa | Fuente principal de la ficha | robots.txt y condiciones de uso |
| Plataforma de Contratación del Sector Público | Señales de licitaciones (ayuntamientos) | Datos abiertos |
| **Vetadas** | LinkedIn, directorios que prohíben la extracción, buscadores de personas | — |

## 6. Puerta de cumplimiento y ContactService

```ts
// packages/contact
async function execute(action: PlannedAction): Promise<ExecutionResult> {
  // 1. re-evaluar SIEMPRE: check() < 60 s; REVIEW exige review_approval del lote
  // 2. reservar presupuesto (transacción) y registrar contact_attempt 'sending'
  // 3. llamar al conector (twilio | resend | letters) con clave de idempotencia = action.id
  // 4. registrar resultado + coste; si el proveedor falla → 'failed' con reintento acotado
}
```

La regla de 60 s y la re-evaluación garantizan que una oposición recibida entre la planificación y el envío gana.

## 7. Agente de voz (`apps/voice`)

```text
Llamada entrante ─► Twilio ─► POST /twilio/voice (firma) ─► TwiML <ConversationRelay url="wss://voz…/twilio/relay"
                                                               language="es-ES" welcomeGreeting="Hola, soy el asistente
                                                               de inteligencia artificial de TurnoSala…">
Saliente: worker → check(ai_call,outbound)=ALLOW → Twilio calls.create(url=/twilio/voice?attempt=<id>, machineDetection)
WS /twilio/relay: mensajes 'prompt' (texto del usuario) ─► diálogo (Haiku 5.5 en streaming) ─► 'text' tokens ─► TTS
```

- Herramientas del diálogo (estrictas, validadas con Zod): `get_demo_slots(n=2)`, `book_demo(slot_id)`,
  `register_opt_out()`, `transfer_to_human(reason)`, `end_call(outcome, summary)`.
- Antes de cada turno: `turnAllowed(callId)` (kill switch, duración, oposición) — CV-06.
- Detector de rechazo por reglas (expresiones en español) **antes** del LLM; si salta, CV-02 sin consultar al modelo.
- Presupuesto de latencia objetivo por turno: < 1,2 s hasta el primer token de voz (medir en F0 desde el servidor).
- Sin grabación; se guarda la transcripción textual de ConversationRelay (retención D-09).
- `get_demo_slots` y `book_demo` usan directamente `packages/core/slots` y el servicio de reservas de `packages/crm`
  (misma transacción y misma restricción anti-doble-reserva que la página pública).

## 8. CRM y agenda de demos

### 8.1 Modelo

```text
prospect (empresa) 1──* deal (oportunidad, máx. 1 abierta) ──* task
     │                         │                              
     └──* note / contact_attempt / call / consent / demo ──► timeline (vista SQL ordenada por fecha)
sales user 1──* availability_rule · availability_exception · external_calendar (ICS) · busy_block · demo
```

- **Ficha ≠ oportunidad.** La ficha es la empresa investigada (vive siempre); la oportunidad nace en un hito comercial
  (REQ-CRM-01) y termina ganada o perdida. Lo anterior al hito (investigada, aprobada, carta enviada) se ve en la
  ficha y en el embudo, no en el tablero de ventas.
- **Etapas** en `deal_stages` (orden, probabilidad, `is_won`/`is_lost`), sembradas: Nuevo → Interesado → Demo
  reservada → Demo realizada → Prueba activa → Ganado / Perdido. Transiciones automáticas: reservar demo → «Demo
  reservada»; resultado `held` → «Demo realizada»; prueba creada → «Prueba activa»; primer pago → «Ganado».
- **Línea de tiempo**: vista `timeline_events` (UNION de notas, cambios de etapa en `audit_log`, `contact_attempts`,
  `calls`, `consents`, `demos`, tareas completadas), paginada por fecha. Sin tabla propia: no hay que sincronizar nada.
- **«No contactar»** y el motivo de pérdida «Oposición / no contactar» llaman a `applyOpposition()` (la misma función
  de F0), que además cierra la oportunidad, cancela tareas y demos pendientes y avisa al comercial.

### 8.2 Motor de huecos (`packages/core/slots`, puro)

```ts
function freeSlots(input: {
  rules: AvailabilityRule[];        // semanales, en hora local del comercial (Europe/Madrid)
  exceptions: AvailabilityException[]; holidays: LocalDate[];
  booked: Interval[]; busy: Interval[];   // demos propias + ocupado de calendarios externos
  durationMin: number; bufferMin: number; minNoticeMin: number; horizonDays: number;
  now: Date;                        // inyectado: sin reloj dentro
}): Interval[];                     // UTC, ordenados
```

Reparto entre comerciales: entre los que tienen el hueco libre, el de menos demos en la semana (empate: orden fijo).
La lógica del motor de huecos de turnometro (PRP-007) sirve de referencia, pero aquí se escribe en TypeScript puro.

### 8.3 Reserva sin doble reserva

`demos.during tstzrange` generado a partir de `starts_at`/`ends_at` + `EXCLUDE USING gist (host_user_id WITH =,
during WITH &&) WHERE (status IN ('booked','confirmed'))`. La reserva inserta en una transacción; si salta la
restricción (`23P01`), se devuelve «hueco ocupado» con los dos siguientes. Lo usan igual la página pública, el agente
de voz y el comercial.

### 8.4 Notificaciones y calendarios

- Confirmación y recordatorio por `ContactService` (canal `email_transactional`/`sms_transactional`, CG-40), con
  invitación `.ics` (`METHOD:REQUEST`, UID estable por demo para que cambios y cancelaciones actualicen el mismo evento).
- Enlace `/cita/<token>` para cancelar o cambiar, sin login (token de 128 bits, caduca al terminar la demo).
- Feed ICS privado por comercial (`/api/ics/<token>`), regenerable si se filtra.
- Suscripción ICS de solo lectura al calendario del comercial cada 10 min → `busy_blocks` (solo inicio y fin).
- Resumen diario por email a cada comercial (tareas vencidas y del día, demos de hoy) — canal interno, no pasa por
  la puerta porque el destinatario es un usuario del sistema.

### 8.5 Prueba en TurnoSala

«Crear prueba» encola en `sync_outbox` (`target='turnosala'`) la llamada a `POST /api/platform/v1/trials` (HMAC,
idempotencia por id de oportunidad, PRP-017). Al responder, guarda `trial_org_id`/`trial_ends_at`, mueve la
oportunidad y crea la tarea de los 7 días. La lista de clientes actuales (`turnosala_customers`, D-13) se refresca
cada noche desde la API de plataforma o por CSV.

## 9. Seguridad

- Roles y permisos comprobados en servidor (middleware + comprobación por acción). `auditor` sin mutaciones.
- Triggers `BEFORE UPDATE OR DELETE` que lanzan excepción en tablas de solo inserción (T-19).
- Webhooks: Twilio (`X-Twilio-Signature`), Resend (firma Svix). Llamadas a TurnoSala con HMAC SHA-256 + marca temporal.
- Tokens públicos (`/c/<token>`, `/baja/<token>`, `/cita/<token>`, feeds ICS): aleatorios de 128 bits, sin datos en claro.
- Permisos del CRM: `sales` ve todas las oportunidades pero solo edita las suyas (o las sin asignar); `admin` todo;
  `marketing` lectura del pipeline; `auditor` lectura de todo.
- CSP estricta en páginas públicas; sin cookies de terceros; analítica propia agregada y con consentimiento de cookies.
- Copia de seguridad diaria cifrada de Postgres con prueba de restauración mensual.

## 10. Despliegue

- `deploy/docker-compose.yml`: `postgres` (volumen), `web`, `worker`, `voice`, `caddy` (TLS automático).
- Necesita **HTTPS público** para landings, reserva de demos, baja, feeds ICS, webhooks (Twilio, Resend) y el
  WebSocket de voz: subdominios propuestos `go.turnosala.com` (público + panel), `voz.turnosala.com` (voz). El panel
  puede restringirse por IP o VPN; los comerciales lo usan también desde el móvil.
- Dónde se aloja producción es la decisión abierta **D-01** (ver `decisions.md`).
- Entornos: `staging` y `production` con BD y claves separadas; staging apunta al staging de TurnoSala.

## 11. Estrategia de pruebas

| Nivel | Qué | Herramienta |
|---|---|---|
| Unidad | `packages/core` completo (normalización, dedupe, puntuación, puerta T-01…T-22, motor de huecos con cambios de hora) | Vitest |
| Integración | Repositorios, triggers, restricción anti-doble-reserva con reservas concurrentes, colas, conectores con dobles (Twilio, Resend, TurnoSala simulados) | Vitest + Postgres en Docker |
| Contrato | Cliente de TurnoSala contra su staging; lectura de ICS de Google y Outlook reales | Vitest (etiqueta `contract`) |
| Arquitectura | T-ARQ (imports y llamadas permitidas) | Vitest + análisis de imports |
| Calidad de extracción | Conjunto dorado de 50 webs reales anotadas a mano: precisión de campos y tasa de rechazo literal | script `npm run eval:extract` |
| Voz | Escenarios YAML por texto (REQ-VOZ-05) | Vitest |
| E2E | Flujo de la fase en el panel y landings | Playwright |
