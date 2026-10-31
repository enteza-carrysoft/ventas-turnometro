# F0 — Cimientos y comprobaciones

**Estado:** borrador revisado contra el estado real (pendiente de aprobación del promotor) · **Fecha:** 31/10/2026 · **Puerta:** G0 · **Duración:** 1 sprint

## Objetivo

Dejar el repositorio, la CI, la base de datos y la **puerta de cumplimiento completa y probada** antes de que exista
ningún canal de contacto o fuente activa, y dejar escrito lo comprobado en las fuentes de datos, los calendarios de
los comerciales y los proveedores. Al terminar no se investiga ni se contacta a nadie.

## Requisitos

- **REQ-MKT-01** — `product_facts` versionados con una sola versión `approved` vigente (CA1–CA3).
- **REQ-CMP-01** — `complianceGate.check()` implementa exactamente `compliance.md`; cada CG con test positivo y
  negativo (CA1); ejecución solo con decisión < 60 s (CA2); T-ARQ (CA3).
- **REQ-CNS-02** — consentimiento sin texto, versión, origen y marca temporal rechazado (BD + app).
- **REQ-PAN-01** (parcial) — panel con `kill_switch` y modo visibles; activable solo por `admin`.
- **P4** — tablas de solo inserción con triggers (T-19).

## Contexto real

| Dato | Estado |
|---|---|
| Repositorio `ventas-turnometro` | Sin código: solo `spec/`, `docs/`, `CLAUDE.md`, `README.md`, `PROMPT_INICIAL.md` y `analisis-con-otra-herramienta.pdf` (no citado en la spec; fuera de F0). **Git ya inicializado** en `main` con 1 commit (`e4d404c`) y remoto `origin` = `github.com/enteza-carrysoft/ventas-turnometro`; `CLAUDE.md` modificado y `.claude/` sin versionar; `.gitignore` ya existe (comprobado 31/10/2026) |
| Herramientas del PC (31/10/2026) | Node **22.14.0** (coincide con el diseño: `engines`/`.nvmrc` = 22), npm **10.9.2**, git instalado, Docker 29.8.2 **con el motor respondiendo** (`docker ps` OK, sin contenedores). Corrige la versión anterior de esta tabla (Node 24 / motor caído) |
| Antecedentes | Están en `C:\Users\usuario\Documents\Proyectos\turnometro` (hermano de este repo; el `../turnometro` del prompt es correcto, el hueco era mío). Leídos: `docs/TurnoSalaVentas.md`, `docs/RETOMAR.md` y `.claude/PRPs/PRP-017-api-plataforma-pruebas.md`. **PRP-017 sigue redactado para Odoo** (`external_id` = id de oportunidad de Odoo, `consent_ref` = `ts.consent` de Odoo, consumidor «botón de Odoo») y está pendiente de aprobación: hay que actualizarlo (consumidor = este sistema; `consent_ref` = id de `consents` de este sistema) y añadir `GET /api/platform/v1/orgs` para D-13. Es trabajo en el repo turnometro y de F3, no de F0. Precios: tres versiones distintas (ver D-02) |
| Odoo | **No se usa** (ADR-004, 31/10/2026): CRM y agenda son propios |
| Calendarios de los comerciales | Por comprobar en F0.8 (Google/Outlook, ICS de ocupado, videollamada) |
| PRP-017 (API de plataforma) en turnometro | Documento pendiente de aprobación; no bloquea F0 |
| Twilio | Cuenta existente de TurnoSala; subcuenta «Growth» por crear |
| Hosting | Decisión D-01 abierta |

## Diseño

Tablas de F0: las de `data-model.sql` bajo «Usuarios y ajustes», «Producto y mercado» (sin `territories` cargada) y
«Consentimiento, exclusión y decisiones», más `allowed_sources` (sembrada inactiva) y las que la puerta necesita para
decidir (el cargador de contexto las lee): `prospects` (CG-07, CG-08), `contact_points` (tipo de teléfono, CG-21;
dirección, CG-50), `robinson_checks` (CG-08), `campaigns` (mínima, FK de consentimientos y lotes), `usage_costs`
(CG-04, gasto del día), `demos` (CG-40/51), `send_batches`, `review_approvals` y `contact_attempts` (regla de 60 s y
REVIEW). Quedan para F1+: `evidences`, `research_*`, `campaign_members`, `content_items`, `calls`, `sync_outbox`, etc.
Ajustes sembrados: `kill_switch=false`, `app_mode='sandbox'`, flags jurídicos en `false`, franjas y cadencias de
`compliance.md`, presupuestos de D-03.

Decisiones de diseño de F0 (estaban sin fijar):
- Postgres de pruebas: servicio `postgres` de `docker compose` en el puerto 5433 (local) y servicio de GitHub Actions
  (CI), ambos con `pgvector/pgvector:pg16`; cada ejecución crea una BD temporal. Sin Testcontainers.
- Migraciones: drizzle-kit genera SQL; triggers, CHECK, índices parciales y `GRANT/REVOKE` van en migraciones SQL
  manuales revisadas. Dos roles de BD: `migrator` (propietario) y `app` (sin UPDATE/DELETE/TRUNCATE en las 4 tablas P4).
- UUID v7 generado en la aplicación. Oposición (REQ-CNS-03) mínima en F0 como función de `packages/db`
  (`applyOpposition()`, una transacción) para poder probar T-14 con un motivo de pérdida simulado; cerrar la
  oportunidad y cancelar tareas y demos se añade en F2 junto con el CRM; el endpoint y `/baja` son de F2.
- `demos` se crea en F0 sin FK a `deals` (solo para CG-40/51); la FK y el resto de la agenda llegan en F2–F3.
- Aprobación de `REVIEW` en F0: solo el modelo y la comprobación en `ContactService`; la pantalla de lotes es de F4.
- 2FA TOTP de `admin` (design §2): se difiere a F2, antes de exponer el panel a Internet. En F0–F1 el panel es interno.
- Lint: `max-lines` 400 y `max-lines-per-function` 50 (P8) como errores; `no-explicit-any`.

`packages/core/compliance/`:
- `rules.ts` — una función por regla `(input, ctx) => Verdict | null`, en el orden de la tabla.
- `evaluate.ts` — recorre reglas; primera no nula gana; `CG-99` por defecto.
- `context.ts` — tipo `ComplianceContext` (Zod) y cargador en `packages/db`.
- `holidays.ts` — festivos nacionales y de Andalucía 2026–2027 como datos, con fuente anotada (BOE/BOJA). Los locales
  de cada municipio no se cargan: se anota como limitación y el comercial los respeta. Si un año aún no está publicado,
  queda vacío y se avisa en el panel; no se inventan fechas.

## Tareas

| # | Tarea | Verificación |
|---|---|---|
| F0.1 | (git y `.gitignore` ya existen) commit inicial de `CLAUDE.md` y `.claude/` si el promotor lo aprueba, monorepo, TS estricto, ESLint, Vitest, workflow de CI | `npm run ci` local (typecheck + lint + test) en verde con un test trivial por paquete; el workflow se valida con `actionlint` y su primera ejecución real ocurre cuando el promotor haga `git push` |
| F0.2 | Docker Compose + `.env.example` (solo nombres). Sin `caddy` en local; en el CPD no se publica 80/443 propios (ver D-01) | `docker compose up` levanta postgres y web con página «OK» (requiere el motor de Docker en marcha) |
| F0.3 | Esquema y migraciones de F0 + triggers (incl. `TRUNCATE`) y roles `migrator`/`app` | T-13 (SQL directo y API), T-19 como `app`, como `migrator` y con `TRUNCATE` |
| F0.4 | `spec/research/fuentes.md`: por fuente, licencia, URL de condiciones, formato, campos almacenables, coste, fecha | Revisado por el promotor |
| F0.5 | Puerta de cumplimiento (+ `applyOpposition()` mínima) | T-01…T-22 incl. T-03b (voz con dobles) y un test positivo y uno negativo por cada CG |
| F0.6 | `ContactService` esqueleto + T-ARQ | T-ARQ (con fixtures de violación que debe detectar), T-20, T-21 |
| F0.7 | Auth + roles + panel mínimo con `kill_switch` | e2e: `marketing` no puede activar el kill switch; `admin` sí y queda en `audit_log` |
| F0.8 | `spec/research/agenda-y-clientes.md`: qué calendario usa cada comercial y si publica ICS de ocupado (Google: «dirección secreta en formato iCal»; Outlook: «publicar calendario»), herramienta de videollamada (D-05) y cómo obtener la lista de clientes actuales de TurnoSala (D-13) | Revisado por el promotor |
| F0.9 | `spec/research/proveedores.md` (Twilio, cartas, Robinson, Resend, Claude). Aquí se **verifica con la skill `claude-api`** lo que `design.md` §4.1 da por supuesto (IDs de modelo, `web_search_20260209`, `fallbacks`, parámetros rechazados, precios): hasta entonces no se programa contra ello | Revisado por el promotor |
| F0.10 | `product_facts` v1 en `draft` con discrepancias señaladas. Fuentes: turnosala.com (WebFetch) y, si el promotor los aporta, `TurnoSalaVentas.md`/`RETOMAR.md`; no se inventa nada que no aparezca | El promotor la aprueba (D-02) |

Orden: F0.1 → F0.2 → F0.3 → F0.5 → F0.6 → F0.7. En paralelo: F0.4, F0.8, F0.9, F0.10.

## Plan de pruebas

Tabla T-xx de `compliance.md` como tests de Vitest con nombre `T-01 …`; reloj y contexto inyectados (sin `Date.now()`
dentro de `evaluate`). Tests de integración de triggers contra Postgres efímero. e2e Playwright del kill switch.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Fuentes oficiales sin descarga o con licencia restrictiva | Se documenta y se sustituye por OSM + web corporativa; nada se activa sin G0 |
| El calendario de un comercial no publica ICS de ocupado | Se ofrecen huecos solo según su disponibilidad declarada; sincronización por API en F7 |
| Hosting sin HTTPS público | No bloquea F0–F1 (panel interno); bloquea F2. D-01 sí bloquea **G0** (no el código) |
| `caddy` choca con el proxy ya existente en el CPD | En el CPD la entrada va por el proxy actual; `caddy` solo para VPS (decisión en D-01) |
| Franja de email (sin fines de semana) también bloquea la confirmación transaccional de una demo pedida en sábado | No se cambia `compliance.md` (ampliaría lo permitido); si el promotor quiere exentarla, es decisión suya con el asesor |
| Discrepancia de precios | `product_facts` en `draft` hasta D-02 |

## Aprendizajes

(se rellena durante la ejecución)
