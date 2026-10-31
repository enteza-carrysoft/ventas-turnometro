# Decisiones

## ADR-005 (vigente, 31/10/2026): proveedores de LLM intercambiables (Anthropic directo y OpenRouter)

**Contexto.** La spec fijaba la API de Claude con el SDK de Anthropic como único acceso a modelos. El promotor quiere
poder usar también la API de OpenRouter.

**Decisión.** Todo acceso a modelos pasa por una **pasarela única** (`packages/ai`) con dos proveedores admitidos:
`anthropic` (API directa, SDK oficial) y `openrouter` (API compatible con OpenAI: Chat Completions y Responses, base
`https://openrouter.ai/api/v1`; en la UE `https://eu.openrouter.ai`). Cada **ruta** (`market.analyze`, `enrich.extract`,
`voice.dialog`…) elige proveedor y modelo **por configuración** (`settings.llm_routes`), no por código. Por defecto
todas las rutas usan `anthropic`; OpenRouter es opt-in por ruta y exige que un `admin` lo habilite en
`settings.llm_enabled_providers` (auditado). Ver `design.md` §4.1 y REQ-LLM-01…05.

**Por qué.** Poder comparar y cambiar de modelo sin reescribir; abaratar rutas de poca exigencia; tener un segundo
proveedor si uno falla; acceder a modelos que Anthropic no ofrece. El LLM sigue sin decidir permisos ni puntuaciones.

**Hechos comprobados en la documentación de OpenRouter (31/10/2026)** — detalle en `spec/research/proveedores.md`:
- Los identificadores **no coinciden**: Opus 5.5 es `anthropic/claude-opus-5.5[1m]` (con punto y sufijo `[1m]`); en su
  lista **no aparecen** Haiku 5.5 ni Sonnet 5.5. Cada ruta guarda un id por proveedor.
- Un parámetro que el modelo no soporta **se ignora en silencio** salvo que se envíe `provider.require_parameters: true`.
- La salida estructurada se comprueba **por endpoint**; el modo estricto lo cumple cada proveedor a su manera.
- Sin Batch API en lo leído; filtros de dominio de la búsqueda web **no uniformes** entre motores; caché de prompt
  de Anthropic admitida con `cache_control` y enrutado «pegajoso».
- Privacidad: no entrena con las entradas ni las guarda por defecto (sí metadatos); controles por petición
  `provider.data_collection: "deny"` y `provider.zdr: true`; endpoint de la UE (`eu.openrouter.ai`) para prompts y respuestas;
  **contrato de encargo (DPA con cláusulas tipo) en su plan Business**; su política no define roles ni publica lista de
  subencargados; cuenta y facturación pueden tratarse en EE. UU.
- Precio: sin sobreprecio de inferencia; comisión al comprar créditos (porcentaje **no confirmado**); BYOK con 5 % por
  encima de 25.000 USD/mes.

**Costes aceptados.** Una capa de abstracción propia que declare las **capacidades** de cada proveedor y se niegue a
degradar en silencio (REQ-LLM-02); un segundo conjunto de pruebas de contrato; los trabajos por lotes (Batch API, −50 %)
solo con `anthropic`.

**Alternativas descartadas.** (a) Usar el SDK de OpenAI como interfaz común: acopla el diseño al formato OpenAI y pierde
funciones propias de Anthropic (Batch, `fallbacks` del servidor, `web_search_20260209`). (b) Un único proveedor: es lo que
había y lo que se quiere flexibilizar.

**Lo que no cambia.** El LLM extrae y redacta, no decide; las entradas y salidas del modelo son datos no fiables
(Zod); el presupuesto diario (D-03) y el registro de coste por proveedor.

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
| D-02 | Precios vigentes (sin IVA, Básico/Profesional/Business). Tres fuentes en `../turnometro` (comprobado 31/10/2026): `docs/TurnoSalaVentas.md` (web del 26/10) **24/58/124**; `docs/RETOMAR.md` (27/10, Stripe) **29/69/149** con anual 290/690/1490; `docs/turnosala-web/index.html` actual: **24/69/149** (anual con IVA incluido: Básico 290,40 = 240 sin IVA, Profesional 834,90 = 690 sin IVA). ¿Cuáles valen? ¿Se ofrece `TURNOSALA50` (−50 % los 3 primeros meses, hasta 31/12/2026) y es compatible con los 30 días de prueba? | F0 (product_facts) | Usar lo que publique la web. **Verificado el 31/10/2026: la web publica 29,04 / 83,49 / 180,29 € con IVA = 24 / 69 / 149 € sin IVA** (anual 240 / 690 / 1.490 sin IVA); el «29» de `RETOMAR.md` era el precio con IVA del Básico y 58/124 son anteriores. Sin promoción hasta confirmarla (`TURNOSALA50` no está publicada). `product_facts` v1 ya está sembrado en borrador con estos valores |
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
| D-14 | **Prefijo 400 en llamadas comerciales.** La Resolución de 14/04/2026 (BOE núm. 93, 16/04/2026; en vigor desde el 17/04 y obligatoria desde ~17/10/2026) reserva el rango `+34 400` para las llamadas comerciales **salientes**: no recibe llamadas ni sirve para atención al cliente, y solo llama a números geográficos, móviles o nómadas. Twilio avisa de que desde el 17/10/2026 no se pueden usar otros números para llamadas comerciales salientes en España y de que el rango 400 exige KYC nacional. Consecuencias: (1) la voz necesita **dos números**: uno 400 para las salientes (llamada humana y de IA consentida) y uno geográfico con «CIF» para las entrantes de cartas y anuncios; (2) nadie puede devolver la llamada al 400; (3) consulta al asesor: ¿quedan dentro del ámbito de la Ley 10/2025 las llamadas B2B y las de IA con consentimiento? ¿qué excepción prevé su disposición transitoria? | F4 (llamada humana) y F5 (voz IA saliente) | Una sola decisión de arquitectura: el conector de voz **se niega a originar** una llamada comercial saliente si el número de origen no es del rango 400 (comprobación en `connectors` y test de contrato). Pedir el número 400 a Twilio al abrir F5; entretanto, el piloto de F4 no hace llamadas salientes. |
| D-15 | Proveedor de LLM por ruta (ADR-005): ¿qué rutas pasan a OpenRouter y con qué modelo? | F1 (antes del piloto G1) | Todas en `anthropic`. Probar OpenRouter solo en `market.analyze` y `enrich.extract`, en sandbox, y promover una ruta solo si supera el conjunto dorado (REQ-LLM-05) |
| D-16 | Condiciones para usar OpenRouter con datos reales: contrato de encargo (plan Business, DPA con cláusulas tipo), región (`eu.openrouter.ai`), y si se exige `zdr: true` en todas las rutas | F1 (antes de habilitarlo en `production`) | No habilitarlo en `production` sin DPA firmado; usar el endpoint de la UE; `data_collection: "deny"` siempre y `zdr: true` donde el modelo lo permita. Pregunta al asesor: ¿alcanza con el DPA de OpenRouter o hace falta contrato con el proveedor del modelo final? |
| D-17 | **Duración de la prueba gratuita.** La web publica «Prueba 14 días gratis» (verificado 31/10/2026, literal); la app (`TRIAL_DAYS = 30` en el checkout de Stripe), `TurnoSalaVentas.md`, `docs/01-campana-marketing.md`, PRP-017 y los REQ-TRI de esta spec dicen 30. La constitución (P2.7) solo deja prometer lo que está en `product_facts` aprobado: hoy eso es **14 días**. Hay que decidir: (a) la oferta pública pasa a 30 días y se corrige la web; (b) se mantienen 14 en la web y la prueba comercial tras demo (PRP-017) es de 30, que **no se puede anunciar** en cartas ni anuncios; o (c) todo a 14 | F2 (landings) y F4 (cartas). No bloquea F1 | (b): lo publicado es 14; los 30 días solo se ofrecen en la demo, y las cartas no los prometen hasta que el promotor los publique en la web |

## Registro de respuestas

| # | Respuesta | Fecha | Quién |
|---|---|---|---|
| ADR-003 | Arquitectura híbrida: motor propio + Odoo como CRM | 31/10/2026 | Promotor |
| Alcance | Solo TurnoSala, extensible (producto como configuración) | 31/10/2026 | Promotor |
| ADR-004 | Sin Odoo 19: sistema web completo con CRM y agenda propios (sustituye a ADR-003) | 31/10/2026 | Promotor |
| ADR-005 | Proveedores de LLM intercambiables: Anthropic directo y OpenRouter (constitución 1.2) | 31/10/2026 | Promotor |
