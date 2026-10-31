# TurnoSala Prospector

Motor de prospección comercial con IA para vender **TurnoSala** (gestión de colas y llamada de turnos) empezando por
la provincia de Sevilla, después Andalucía y después España. Inspirado en Explee, pero adaptado al marco legal español:
investiga el mercado, genera **fichas de empresa con evidencias verificables**, las puntúa, pasa por revisión humana y
ejecuta solo los contactos permitidos (carta personalizada con QR, agente de voz entrante o con consentimiento,
llamada humana con copiloto, visita y email consentido). Incluye **CRM propio** (oportunidades, tareas, línea de
tiempo) y **agenda de demos** con reserva pública, hasta crear la prueba de 30 días en TurnoSala. Sin Odoo (ADR-004).

**Estado:** especificación v1.0 (31/10/2026) · nada implementado · siguiente paso: aprobar `spec/phases/F0-cimientos.md`.

## Documentos (orden de lectura)

| # | Documento | Para qué |
|---|---|---|
| 1 | [`docs/00-analisis-explee.md`](docs/00-analisis-explee.md) | Qué hace Explee, qué no se puede copiar en España y qué adaptamos |
| 2 | [`docs/01-campana-marketing.md`](docs/01-campana-marketing.md) | Campaña por oleadas, canales, calendario, presupuesto e indicadores |
| 3 | [`spec/constitution.md`](spec/constitution.md) | Reglas no negociables (prevalecen sobre todo) |
| 4 | [`spec/requirements.md`](spec/requirements.md) | Requisitos EARS con ID y criterios de aceptación |
| 5 | [`spec/compliance.md`](spec/compliance.md) | Puerta de cumplimiento como tabla ejecutable + casos de prueba |
| 6 | [`spec/design.md`](spec/design.md) | Arquitectura, pila, pipeline de agentes, voz, CRM y agenda, despliegue, pruebas |
| 7 | [`spec/data-model.sql`](spec/data-model.sql) | Modelo de datos de referencia |
| 8 | [`spec/tasks.md`](spec/tasks.md) | Fases F0–F7, tareas, definición de terminado y puertas |
| 9 | [`spec/decisions.md`](spec/decisions.md) | ADR-004 (vigente), ADR-003 y decisiones abiertas del promotor |
| 10 | [`spec/phases/`](spec/phases/) | Especificación de la fase en curso |

Antecedentes (repositorio `../turnometro`): `docs/TurnoSalaVentas.md` (estrategia, ICP, guiones, marco legal),
`docs/growth-agent/` (paquete anterior sobre Odoo, sustituido) y `.claude/PRPs/PRP-017-api-plataforma-pruebas.md`
(su consumidor pasa a ser este sistema en lugar de Odoo).

## Método SDD (desarrollo guiado por especificación)

```text
constitución ─► requisitos (EARS + CA) ─► diseño ─► tareas por fase ─► implementación ─► verificación ─► puerta humana
     ▲                                                                                                     │
     └──────────────────── los cambios se escriben primero en spec/ y después en el código ◄───────────────┘
```

- Nada se programa sin una especificación de fase aprobada (`spec/phases/F<n>-*.md`).
- Cada tarea cita los `REQ-…`/`CG-…` que cumple; cada CA tiene un test; los commits citan IDs.
- Si el código y la spec discrepan, se corrige la spec (con aprobación) o el código; nunca se deja la divergencia.
- La legalidad la decide la tabla de `compliance.md`; ante duda, la opción más restrictiva.

## Para el agente programador

Empieza por [`CLAUDE.md`](CLAUDE.md) y pega [`PROMPT_INICIAL.md`](PROMPT_INICIAL.md).
