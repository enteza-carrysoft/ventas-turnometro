# Plan por fases y tareas

Cada fase sigue el ciclo SDD: **especificar** (`spec/phases/F<n>-*.md` con los REQ que cubre y sus CA copiados) →
**diseñar** (cambios sobre `design.md`/`data-model.sql`) → **tareas** (esta tabla, detallada en la fase) →
**implementar** tarea a tarea → **verificar** contra los CA → **puerta humana (G)**. Una fase no empieza sin superar la
anterior. La especificación de la fase la redacta el agente y la aprueba el promotor **antes** de escribir código.

**Definición de terminado (todas las tareas):** CA del requisito cubiertos por tests · `npm run typecheck`, `npm run
lint`, `npm test` en verde · T-ARQ en verde · sin secretos en el diff · migración revisable · `spec/` actualizado si
algo cambió · nota en «Aprendizajes» de la fase si hubo una decisión fuera de la spec.

---

## F0 — Cimientos y comprobaciones (1 sprint) → `phases/F0-cimientos.md`

| Tarea | Detalle | Cumple |
|---|---|---|
| F0.1 | Monorepo (npm workspaces), TS estricto, ESLint, Vitest, CI (GitHub Actions) con Postgres de servicio | P7, P8 |
| F0.2 | `deploy/docker-compose.yml` (postgres, web, worker, voice, caddy) y `.env.example` sin valores | D-01 |
| F0.3 | `packages/db`: esquema base (usuarios/roles, settings, test_contacts, products, product_facts, segments, territories, consents, suppressions, compliance_decisions, audit_log) + triggers de solo inserción | REQ-MKT-01, P4 |
| F0.4 | Comprobación de fuentes: licencia, formato y acceso de cada fuente de `design.md` §5 → `spec/research/fuentes.md`; `allowed_sources` sembrado con todas **inactivas** | REQ-RES-02 |
| F0.5 | `packages/core/compliance`: `evaluate()` puro con la tabla completa + `check()` que persiste; tests T-01…T-22 (los de voz con dobles) | REQ-CMP-01 |
| F0.6 | `packages/contact` esqueleto + T-ARQ (sin conectores reales todavía) | REQ-CMP-01 CA3 |
| F0.7 | Auth (Better Auth), roles en servidor, panel vacío con `kill_switch` y modo visibles | REQ-PAN-01, P5 |
| F0.8 | Agenda y clientes: calendarios de los comerciales (Google/Outlook: ¿publican ICS de ocupado?), videollamada (D-05) y fuente de clientes actuales de TurnoSala (D-13) → `spec/research/agenda-y-clientes.md` | REQ-AGE-03, REQ-VER-02, D-05, D-13 |
| F0.9 | Notas de proveedores (con fecha): Twilio ConversationRelay es-ES y latencia desde el servidor; proveedor de cartas; servicio Lista Robinson; Resend subdominio; Claude (modelos, web search, precios) con la skill `claude-api`; OpenRouter (ids de modelo, parámetros, privacidad, comisiones) con su documentación oficial → `spec/research/proveedores.md` | D-06, D-07, D-08, D-14, D-15, D-16 |
| F0.10 | `product_facts` v1 de TurnoSala desde turnosala.com y la app, con las discrepancias de precio señaladas (D-02) | REQ-MKT-01 |

**Puerta G0:** puerta de cumplimiento con T-01…T-22 y T-ARQ en verde · notas de F0.4, F0.8 y F0.9 revisadas ·
D-01, D-02 y D-03 resueltas.

## F1 — Investigación y fichas (MVP de datos)

| Tarea | Detalle | Cumple |
|---|---|---|
| F1.1 | `packages/ai`: **pasarela de LLM** con adaptadores `anthropic` (skill `claude-api`) y `openrouter` (documentación oficial), `llm_routes` y `llm_enabled_providers` sembrados, capacidades declaradas por proveedor y negativa a degradar en silencio, registro de coste con modelo servido, presupuesto previo, caché de prompts, normalización de rechazo/truncado, test **T-ARQ-LLM** y pruebas de contrato con dobles | REQ-LLM-01…04, REQ-OBS-01 |
| F1.2 | Análisis de mercado y segmentos ICP (agente con herramientas web) + vista de aprobación | REQ-MKT-02 |
| F1.3 | Dimensionamiento por territorio (INE + registros) | REQ-MKT-03 |
| F1.4 | `research_jobs`/`research_tasks` en pg-boss, reanudables, con panel de avance | REQ-RES-01/03 |
| F1.5 | Adaptadores de las fuentes aprobadas en G0 (mínimo: un registro oficial, OSM, `web_search`, web corporativa) | REQ-RES-02 |
| F1.6 | Rastreador propio + extracción estructurada con verificación literal + señales + canales | REQ-ENR-01/02/03 |
| F1.7 | Normalización, verificación y deduplicación (contra fichas, exclusiones y `turnosala_customers`) | REQ-VER-01/02/03 |
| F1.8 | Puntuación pura versionada | REQ-SCO-01 |
| F1.9 | Ficha y cola de revisión con atajos y muestreo; exportación CSV | REQ-REV-01/02/03 |
| F1.10 | Conjunto dorado de 50 webs anotadas y `npm run eval:extract` (con `--route` y `--provider` para comparar proveedores) | design §11, REQ-LLM-05 |

**Criterio:** lote piloto de **200 empresas de la provincia de Sevilla** (2–3 verticales A) investigado, deduplicado
y revisado en staging; cada ficha con evidencias; **cero contactos**. Precisión de campos ≥ 90 % en el conjunto dorado;
coste por ficha medido. **Puerta G1:** el promotor revisa 20 fichas al azar.

## F2 — Landings, consentimientos y CRM

| Tarea | Detalle | Cumple |
|---|---|---|
| F2.1 | Landings `/demo/<sector>` y `/c/<token>` con formulario de consentimientos granulares, Turnstile, `noindex` en las personalizadas | REQ-CNS-01/02 |
| F2.2 | Oposición transversal (`applyOpposition()` completa: cierra oportunidad, cancela tareas y demos) + `/baja/<token>` | REQ-CNS-03, REQ-CRM-05 |
| F2.3 | Oportunidades: etapas y motivos sembrados, creación por hito, una abierta por ficha, permisos por rol | REQ-CRM-01, REQ-CRM-06 |
| F2.4 | Tablero por etapas (arrastrar) y lista con filtros; vista «mis oportunidades» | REQ-CRM-02 |
| F2.5 | Tareas, vista «Hoy» y resumen diario por email al comercial | REQ-CRM-03 |
| F2.6 | Línea de tiempo (vista `timeline_events`) y notas en la ficha y la oportunidad | REQ-CRM-04 |
| F2.7 | 2FA TOTP para `admin` antes de exponer el panel; retención diaria | P5, REQ-RET-01 |

**Criterio:** en staging, una landing con consentimientos crea ficha, contacto y oportunidad «Interesado»; el comercial
la mueve por el tablero, crea tareas y notas; «No contactar» bloquea todos los canales en la misma transacción (T-14).
**Puerta G2:** textos legales de landings y consentimientos aprobados por el asesor (D-04) · el promotor hace el recorrido.

## F3 — Agenda de demos y prueba de 30 días

| Tarea | Detalle | Cumple |
|---|---|---|
| F3.1 | Disponibilidad por comercial (franjas, excepciones, ajustes, enlace de videollamada) | REQ-AGE-01 |
| F3.2 | Motor de huecos puro (`packages/core/slots`) con tests de cambio de hora y rendimiento; reparto entre comerciales | REQ-AGE-02 |
| F3.3 | Reserva con restricción de exclusión, test de concurrencia, página pública `/demo/reservar` y reserva desde `/c/<token>` | REQ-DEM-01 |
| F3.4 | Confirmación y recordatorio vía `ContactService` (CG-40) con `.ics`; `/cita/<token>` para cancelar o cambiar | REQ-DEM-02, REQ-EML-01 (transaccional) |
| F3.5 | Feed ICS por comercial y suscripción ICS de ocupado (cola `calendar.sync`) | REQ-AGE-03 |
| F3.6 | Resultado de la demo y «Crear prueba» → API de plataforma de TurnoSala por `sync_outbox` (requiere PRP-017 implementado en turnometro); refresco de `turnosala_customers` | REQ-DEM-03, REQ-TRI-01, D-13 |

**Criterio:** en staging, landing → reserva de demo (sin doble reserva bajo concurrencia) → confirmación con `.ics` →
recordatorio → demo realizada → «Crear prueba» → organización de prueba en el staging de TurnoSala → oportunidad en
«Prueba activa» con tarea a 7 días. **Puerta G3:** el promotor reserva, cambia y cancela una demo desde el móvil y crea
una prueba.

## F4 — Primer contacto legal: cartas, copiloto y campañas

| Tarea | Detalle | Cumple |
|---|---|---|
| F4.1 | Campañas, secuencias, miembros y siguiente mejor acción | REQ-OUT-01/02/04 |
| F4.2 | Lotes con vista previa, coste y aprobación; ejecución vía `ContactService` | REQ-OUT-03 |
| F4.3 | Generador de cartas + verificador de afirmaciones + PDF + QR + conector de cartas (D-07) | REQ-LET-01, REQ-MKT-01 CA3 |
| F4.4 | Consulta Lista Robinson (D-08) para `sole_trader`/`unknown` | CG-08 |
| F4.5 | Copiloto de llamadas humanas (guion + tarea «Llamar» en el CRM) y planificador de visitas por municipio | REQ-COP-01/02 |
| F4.6 | Estudio de contenido (anuncios, posts, landings por provincia) | REQ-CAM-01 |
| F4.7 | Seguimiento de QR y cartas devueltas; informe semanal | REQ-LET-02, REQ-OBS-02 |

**Criterio:** primer lote real de **50 cartas** en la provincia de Sevilla aprobado y enviado; escaneos, solicitudes
y demos medidos. **Puerta G4:** `postal_b2b_approved` (y, si procede, `b2b_human_calls_approved`) activados por el
promotor con el informe del asesor.

## F5 — Agente de voz con IA

| Tarea | Detalle | Cumple |
|---|---|---|
| F5.1 | `apps/voice`: TwiML, firma, WebSocket ConversationRelay, estado de llamada | REQ-VOZ-01 |
| F5.2 | Diálogo (Haiku 5.5) + herramientas estrictas + detector de rechazo por reglas + `turnAllowed` por turno | REQ-VOZ-03, CV-01…07 |
| F5.3 | `get_demo_slots`/`book_demo` sobre el motor de huecos y la reserva de F3 | REQ-DEM-01 |
| F5.4 | Planificador de salientes consentidas en el worker | REQ-VOZ-02 |
| F5.5 | Cierre de llamada, resumen, línea de tiempo y tarea al comercial si procede | REQ-VOZ-04 |
| F5.6 | Simulador por texto y escenarios YAML en CI | REQ-VOZ-05 |

Despliegue escalonado obligatorio: entrante sandbox → saliente sandbox a `test_contacts` → producción **solo entrante**
2 semanas (número impreso en cartas y anuncios) → saliente consentida ≤ 20 llamadas/día 2 semanas con revisión de
resúmenes. **Puerta G5:** escenarios en verde · `kill_switch` probado en una llamada en curso · autorización escrita
por escalón.

## F6 — Email consentido y respuestas

| Tarea | Detalle | Cumple |
|---|---|---|
| F6.1 | Secuencias de email para consentidos (`email`), `List-Unsubscribe`, subdominio con DMARC | REQ-EML-01 |
| F6.2 | Entrada de respuestas y clasificación; oposición automática; tareas humanas en el CRM | REQ-EML-02 |

## F7 — Optimización y expansión (Andalucía → España)

Recalibración de pesos (REQ-SCO-02) · señales (REQ-RES-04) · búsqueda en lenguaje natural y «parecidas» (REQ-MKT-04) ·
A/B (REQ-CAM-02) · caducidad de consentimientos (REQ-CNS-04) · activación y pago de pruebas (REQ-TRI-02) ·
sincronización bidireccional de calendarios (REQ-AGE-04) · importación CSV al CRM (REQ-CRM-07) · nuevas fuentes por
comunidad autónoma (registros sanitarios de cada comunidad).

---

## Plantilla de especificación de fase

```markdown
# F<n> — <nombre>
**Estado:** borrador | aprobada | en curso | completada · **Fecha:** · **Puerta:** G<n>
## Objetivo            (1 párrafo)
## Requisitos          (IDs REQ/CG con sus CA copiados literalmente)
## Contexto real       (lo comprobado en código y proveedores; con fecha)
## Diseño              (tablas, colas, endpoints, pantallas; diferencias con design.md)
## Tareas              (F<n>.x con verificación concreta de cada una)
## Plan de pruebas     (un test por CA, incluidos negativos)
## Riesgos             (y mitigación)
## Aprendizajes        (se rellena durante la ejecución)
```
