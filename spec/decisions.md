# Decisiones

## ADR-004 (vigente, 31/10/2026): sistema web completo, sin Odoo

**Contexto.** ADR-003 dejaba en Odoo 19 Enterprise el CRM, las actividades y las demos (Citas). El promotor no dispone
de Odoo 19 para este proyecto.

**Decisión.** El motor incluye un **CRM ligero** (oportunidades por etapas, tareas, notas y línea de tiempo por empresa)
y una **agenda de demos propia** (disponibilidad por comercial, huecos, reserva pública, confirmaciones, .ics). Una sola
aplicación web y una sola base de datos de negocio. Sigue siendo solo para TurnoSala, con el producto como configuración.

**Por qué.**
- Sin Odoo no hay CRM ni Citas; el alcance que hace falta (un producto, un equipo pequeño) es acotado.
- Desaparece la sincronización (outbox, webhooks, reconciliación, módulo puente) y su riesgo de divergencia.
- **Cumplimiento más simple:** la oposición tiene un único punto de entrada y se aplica en la misma transacción.
- El agente de voz reserva directamente en la agenda, sin depender de la API de Citas ni de un plan B.

**Costes aceptados.** Construir y mantener el CRM y la agenda (≈ 1–2 sprints más que ADR-003, estimado); sincronización
con Google/Outlook más limitada al principio (invitaciones .ics y suscripción de solo lectura a calendarios ocupados;
la bidireccional, más adelante); sin app móvil nativa (web adaptable al móvil).

**Alternativa descartada.** Herramientas libres autoalojadas (Cal.com para la agenda, Twenty o EspoCRM para el CRM):
reintroducen la sincronización que se quiere evitar y no compensan para un solo producto y un equipo pequeño.

## ADR-003 (sustituido por ADR-004): motor de prospección propio + Odoo como CRM

Motor propio para investigación, fichas, cumplimiento y contacto; Odoo 19 para el pipeline, las actividades y Citas.
Se mantiene de ADR-003: el motor en TypeScript, la puerta de cumplimiento, la voz y la constitución heredada de
ADR-002 (`turnometro/docs/growth-agent/`), que queda sustituido (marcarlo en ese repositorio es decisión del promotor).

---

## Decisiones abiertas del promotor

Cada decisión indica la fase que bloquea. El agente no avanza esa fase sin respuesta escrita en el registro.

| # | Decisión | Bloquea | Propuesta por defecto |
|---|---|---|---|
| D-01 | (bloquea **G0**, no el código de F0) Dónde se aloja producción. En el CPD ya hay proxy y otros proyectos: ahí no se despliega `caddy` propio. Necesita HTTPS público (landings, reserva de demos, baja, webhooks, WebSocket de voz) y ser un lugar donde TurnoSala pueda tratar datos comerciales propios con su contrato de encargado. El servidor del CPD (10.158.0.3) vale para staging si el promotor confirma que puede alojar datos de TurnoSala; si no, VPS en la UE | F0 | Staging en el CPD; producción en VPS UE |
| D-02 | Precios vigentes (sin IVA, Básico/Profesional/Business). Tres fuentes en `../turnometro` (comprobado 31/10/2026): `docs/TurnoSalaVentas.md` (web del 26/10) **24/58/124**; `docs/RETOMAR.md` (27/10, Stripe) **29/69/149** con anual 290/690/1490; `docs/turnosala-web/index.html` actual: **24/69/149** (anual con IVA incluido: Básico 290,40 = 240 sin IVA, Profesional 834,90 = 690 sin IVA). ¿Cuáles valen? ¿Se ofrece `TURNOSALA50` (−50 % los 3 primeros meses, hasta 31/12/2026) y es compatible con los 30 días de prueba? | F0 (product_facts) | Usar lo que publique la web el día de aprobación; sin promoción hasta confirmarla |
| D-03 | Presupuesto diario por proveedor y mensual total | F0 | LLM 15 €/día · voz 10 €/día · búsqueda web 5 €/día · email 5 €/día · cartas por lote aprobado · **tope mensual total 600 €** (los dos últimos, nuevos: P6 exige presupuesto por proveedor) |
| D-04 | Asesor jurídico/DPD: textos de consentimiento, LIA, cartas de prospección, llamadas humanas B2B | G2/G4 | — (imprescindible) |
| D-05 | Agenda: calendario de los comerciales (Google Workspace, Microsoft 365 u otro) y herramienta de videollamada de las demos (Meet, Teams, Jitsi) | F3 | Suscripción ICS de solo lectura para ocupado + enlace de videollamada fijo por comercial; sincronización bidireccional por API en F7 |
| D-06 | Subdominios: landings, reserva y panel; voz | F2 | `go.turnosala.com` y `voz.turnosala.com` |
| D-07 | Cartas: proveedor con API o impresión propia en el piloto | F4 | Impresión propia en Sevilla (≤ 200 cartas); proveedor con API desde Andalucía |
| D-08 | Servicio de consulta de Lista Robinson | F4 | Contratar el servicio oficial para empresas; mientras tanto, no enviar a `sole_trader`/`unknown` |
| D-09 | Retención: fichas no convertidas / transcripciones / decisiones y consentimientos / oportunidades perdidas | F2 | 12 meses / 12 meses / 5 años / 24 meses |
| D-10 | Entrantes de voz 24/7 o solo en horario | F5 | Solo en horario; fuera, mensaje y tarea |
| D-11 | Verticales del piloto en Sevilla | F1 | Policlínicas y clínicas dentales multiconsulta, ópticas con gabinete, fisioterapia; talleres y concesionarios en una segunda tanda |
| D-12 | Sector público (ayuntamientos): ¿se trabaja en este motor o por canal institucional aparte? | F4 | Canal aparte: licitaciones + Diputación/partners; el motor solo vigila señales |
| D-13 | Lista de clientes actuales de TurnoSala para no prospectarlos (REQ-VER-02 CA2): endpoint de la API de plataforma o exportación CSV periódica | F1 | Endpoint `GET /api/platform/v1/orgs` (solo nombre, dominio, teléfono) añadido al PRP-017; mientras tanto, CSV manual |

## Registro de respuestas

| # | Respuesta | Fecha | Quién |
|---|---|---|---|
| ADR-003 | Arquitectura híbrida: motor propio + Odoo como CRM | 31/10/2026 | Promotor |
| Alcance | Solo TurnoSala, extensible (producto como configuración) | 31/10/2026 | Promotor |
| ADR-004 | Sin Odoo 19: sistema web completo con CRM y agenda propios (sustituye a ADR-003) | 31/10/2026 | Promotor |
