# Requisitos — TurnoSala Prospector

Formato EARS en español: **CUANDO** <evento> **[SI** <condición>**]** **EL SISTEMA DEBERÁ** <respuesta>. Cada requisito
tiene ID estable, prioridad (**M** = imprescindible en su fase · **S** = deseable) y criterios de aceptación (**CA**)
verificables. Tareas, tests y commits citan estos IDs. Las reglas `CG-xx` están en `compliance.md`.

## Actores

| Actor | Rol en la app | Qué hace |
|---|---|---|
| Promotor | `admin` | Aprueba fases, gastos, lotes, ajustes jurídicos y paso a producción |
| Marketing | `marketing` | Define segmentos y campañas, lanza investigaciones, revisa fichas, aprueba contenido |
| Comercial | `sales` | Llama/visita con copiloto, trabaja sus oportunidades y tareas en el CRM, publica su disponibilidad y hace demos |
| Auditor | `auditor` | Solo lectura de consentimientos, decisiones, contactos y costes |
| Voz | `voice` (técnico) | Servicio de voz; solo usa la API interna de voz |
| Prospecto | — | Empresa investigada; puede convertirse en contacto con consentimiento |

---

## 1. Producto y mercado (MKT)

**REQ-MKT-01 (M)** — EL SISTEMA DEBERÁ mantener `product_facts` versionados (planes, precios sin IVA, módulos por plan,
prueba gratuita, promociones con fecha de caducidad, límites, URLs) con estado `draft | approved | retired`.
- CA1: solo una versión `approved` vigente por producto; aprobarla exige rol `admin` y queda en `audit_log`.
- CA2: todo contenido generado guarda el `product_facts_version` usado.
- CA3: una promoción caducada no puede aparecer en contenido nuevo (validación del verificador de afirmaciones).

**REQ-MKT-02 (M)** — CUANDO marketing pide un análisis de mercado para un producto, EL SISTEMA DEBERÁ leer la web del
producto y los `product_facts`, analizar competidores configurados y proponer **segmentos ICP** (vertical, señales de
encaje, cargo decisor, mensaje, demo más persuasiva, encaje estimado 0–100 con justificación y fuentes).
- CA1: cada segmento cita URLs consultadas; el encaje es `inferred` con razonamiento.
- CA2: los segmentos quedan en `draft` hasta que marketing los aprueba o edita.

**REQ-MKT-03 (M)** — CUANDO marketing crea un **dimensionamiento** para un segmento y un territorio (municipio,
provincia, comunidad o país), EL SISTEMA DEBERÁ estimar el universo de empresas con fuentes estadísticas (INE DIRCE,
registros sectoriales) y mostrar el desglose por municipio, separando lo contado de lo estimado.

**REQ-MKT-04 (S)** — Búsqueda en lenguaje natural sobre las fichas («ópticas con gabinete de audiología en Sevilla
con más de 2 sedes») convertida en filtros estructurados, y búsqueda de «parecidas a» una ficha (similitud vectorial).

## 2. Descubrimiento (RES)

**REQ-RES-01 (M)** — CUANDO marketing lanza un `research_job` (segmento, territorio, tamaño de lote, presupuesto),
EL SISTEMA DEBERÁ ejecutarlo en segundo plano por tareas `(fuente × municipio)` y crear **candidatos** de empresa.
- CA1: solo se consultan fuentes de `allowed_sources` activas; cualquier otra petición se rechaza y se registra.
- CA2: un trabajo nunca supera su lote máximo (por defecto 200) ni el presupuesto diario de búsqueda/LLM.
- CA3: el trabajo es reanudable tras un corte (estado por tarea) y se puede pausar/cancelar desde el panel.
- CA4: se muestran avance, coste acumulado y errores por fuente en tiempo casi real (refresco ≤ 10 s).

**REQ-RES-02 (M)** — EL SISTEMA DEBERÁ ordenar las fuentes de más a menos fiables: registros oficiales y datos abiertos
→ OpenStreetMap → APIs de mapas con licencia que lo permita → búsqueda web (herramienta de búsqueda web del proveedor de LLM: `web_search` de Claude directo o la de OpenRouter) →
web corporativa. Cada adaptador declara licencia, límites de uso y qué campos puede **almacenar**.
- CA1: de Google Places solo se almacena `place_id` (y lo que sus condiciones vigentes permitan); el resto se obtiene
  de la web de la empresa.
- CA2: los datos de OpenStreetMap llevan atribución ODbL en la ficha.

**REQ-RES-03 (M)** — CUANDO una fuente no responde, bloquea, devuelve 429 o prohíbe el rastreo, EL SISTEMA DEBERÁ
registrar el motivo, aplicar espera exponencial (máx. 3 intentos) y seguir con las demás tareas.

**REQ-RES-04 (S)** — Vigilancia de señales: nuevas aperturas (registros sanitarios, BORME), licitaciones públicas de
sistemas de turnos/cita previa (Plataforma de Contratación del Sector Público), ofertas de empleo de recepcionista
publicadas por la empresa. Cada señal crea o refuerza una ficha con su evidencia.

## 3. Enriquecimiento y evidencias (ENR)

**REQ-ENR-01 (M)** — CUANDO se crea un candidato con web, EL SISTEMA DEBERÁ visitar un máximo de 6 páginas de su web
(inicio, contacto, servicios, sedes, equipo-sin-nombres, cita previa) con el rastreador propio (robots.txt, 1 petición/s
por dominio, `User-Agent` identificable) y extraer con el LLM, mediante **salida estructurada**, los campos de empresa.
- CA1: cada campo extraído crea una `evidence` con URL, fecha, fragmento literal (≤ 300 caracteres) y `provenance`.
- CA2: si el fragmento literal no aparece en el HTML descargado, el campo se descarta (anti-alucinación).
- CA3: no se guardan nombres de personas, salvo la razón social del negocio aunque coincida con un nombre.
- CA4: el contenido web se pasa al modelo como dato delimitado, con instrucción de ignorar órdenes que contenga.

**REQ-ENR-02 (M)** — EL SISTEMA DEBERÁ extraer **señales de encaje** del segmento (p. ej. «varias consultas», «cita
previa online», «sala de espera», «varios mostradores», «gabinete», «recepción de vehículos»), cada una con evidencia.

**REQ-ENR-03 (M)** — EL SISTEMA DEBERÁ clasificar cada canal de contacto encontrado: `switchboard_phone`,
`mobile_phone`, `generic_email`, `personal_email` (se descarta), `postal_address`, `web_form`, `booking_url`.

## 4. Verificación y deduplicación (VER)

**REQ-VER-01 (M)** — EL SISTEMA DEBERÁ normalizar: teléfono a E.164 (libphonenumber), dominio (sin `www`, en
minúsculas, dominio registrable), nombre (sin forma jurídica ni tildes), dirección y código INE de municipio.
- CA1: un teléfono no normalizable se marca `not_callable`.
- CA2: se comprueba que la web responde (HTTP 2xx/3xx) y que el email genérico tiene MX; los fallos se anotan.

**REQ-VER-02 (M)** — ANTES de crear una ficha, EL SISTEMA DEBERÁ buscar duplicados por dominio, teléfono E.164 y
nombre normalizado + municipio en fichas (incluidas archivadas), en `suppressions` y en la lista de clientes actuales
de TurnoSala (`turnosala_customers`, D-13).
- CA1: si hay coincidencia, se fusiona la evidencia en la ficha existente; no se crea otra.
- CA2: si es cliente de TurnoSala o tiene oposición (incluida una oportunidad perdida con «No contactar»), la ficha
  queda `blocked` con motivo.

**REQ-VER-03 (M)** — EL SISTEMA DEBERÁ determinar `legal_form` (`company` | `sole_trader` | `public_body` | `unknown`)
con evidencia; `unknown` se trata como `sole_trader` a efectos de cumplimiento.

## 5. Puntuación (SCO)

**REQ-SCO-01 (M)** — EL SISTEMA DEBERÁ puntuar cada ficha de 0 a 100 con una **función pura** de `packages/core` sobre
las señales extraídas, con pesos por segmento (por defecto: 25 atención simultánea, 20 flujo, 15 dolor público,
15 implantación sencilla, 10 cobertura, 10 decisor identificable por cargo, 5 interés entrante).
- CA1: guarda versión del modelo de puntuación, desglose por criterio y razonamiento de ≤ 2 líneas con URLs.
- CA2: `hot` ≥ 75 · `warm` 50–74 · `nurture` < 50.
- CA3: el LLM solo extrae señales; el número lo calcula el código (reproducible y testeable).

**REQ-SCO-02 (S)** — Recalibración: con resultados reales (demo, prueba, pago) el sistema propone nuevos pesos con su
justificación; marketing los aprueba como nueva versión.

## 6. Fichas y revisión humana (REV)

**REQ-REV-01 (M)** — EL SISTEMA DEBERÁ mostrar cada ficha con: datos de empresa, mapa, señales, puntuación y desglose,
evidencias enlazadas, canales permitidos (resultado de la puerta por canal), historial y siguiente mejor acción.

**REQ-REV-02 (M)** — EL SISTEMA DEBERÁ ofrecer una **cola de revisión** por lotes con atajos de teclado: aprobar,
corregir campo, descartar con motivo, bloquear. Solo las fichas `approved` pasan a campañas y al CRM.
- CA1: aprobar no envía nada; solo habilita la ficha para planificar acciones.
- CA2: el revisor ve resaltados los campos `inferred`.
- CA3: muestreo de calidad: el sistema propone revisar al menos el 10 % de cada lote al azar aunque se apruebe en bloque.

**REQ-REV-03 (M)** — Exportación CSV de fichas aprobadas (sin datos personales) para uso interno.

## 7. Consentimientos y oposición (CNS)

**REQ-CNS-01 (M)** — EL SISTEMA DEBERÁ publicar landings por sector (`/demo/<sector>`) y **personalizadas por ficha**
(`/c/<token>`, enlazadas desde cartas y QR) con formulario de solicitud de demo y casillas **separadas y desmarcadas**:
(a) emails comerciales, (b) llamada de una persona, (c) llamada de un asistente de IA, (d) SMS/WhatsApp para confirmar
la demo.
- CA1: cada casilla marcada crea un `consent` con canal, finalidad, texto exacto y versión, fecha, IP, user-agent,
  URL, teléfono/email al que aplica, campaña y ficha.
- CA2: el formulario crea o enlaza la ficha y marca la señal `inbound_interest` (+5 puntos).
- CA3: Turnstile, CSRF, límite por IP; validación de email y teléfono.
- CA4: la landing personalizada solo muestra datos públicos de la empresa y no indexa (`noindex`).

**REQ-CNS-02 (M)** — EL SISTEMA DEBERÁ rechazar un consentimiento sin texto, versión, origen y marca temporal
(validación en BD y en aplicación).

**REQ-CNS-03 (M)** — CUANDO alguien se opone (enlace de baja, respuesta de email, llamada, comercial, botón «No
contactar» o motivo de pérdida del CRM, carta devuelta con «no contactar»), EL SISTEMA DEBERÁ en una transacción:
insertar `suppressions` (teléfono, email y, si se opone la empresa, dominio/ficha), registrar retirada en `consents`,
cancelar acciones, tareas de contacto y demos pendientes, cerrar como perdida su oportunidad abierta y anotarlo en la
línea de tiempo.
- CA1: tras la oposición, `check()` devuelve `BLOCK` para esa empresa/contacto en todos los canales.
- CA2: página pública `/baja/<token>` sin login, con token firmado, y teléfono/email de baja en cada carta.

**REQ-CNS-04 (S)** — Caducidad: `ai_call` a los 12 meses o al cerrar su campaña; `email` mientras no se retire.

## 8. Puerta de cumplimiento (CMP)

**REQ-CMP-01 (M)** — EL SISTEMA DEBERÁ exponer `complianceGate.check(input)` (función pura sobre un contexto cargado
de BD) que implemente **exactamente** la tabla de `compliance.md` y guarde cada resultado en `compliance_decisions`.
- CA1: cada regla CG tiene al menos un test positivo y uno negativo.
- CA2: ninguna acción de contacto se ejecuta sin una decisión `ALLOW` (o `REVIEW` aprobada) del mismo contacto y canal
  con menos de 60 s de antigüedad.
- CA3: test de arquitectura (T-ARQ): los SDK de Twilio, Resend, proveedor de cartas y envío SMTP solo se importan en
  `packages/connectors` y solo se invocan desde `packages/contact`.

## 9. Orquestación de campañas (OUT)

**REQ-OUT-01 (M)** — EL SISTEMA DEBERÁ permitir definir una **campaña** (producto, segmento, territorio, oleada,
presupuesto, fechas) con una **secuencia** de pasos por canal (p. ej. carta → espera 10 días → llamada humana si hay
`REVIEW` aprobado → visita) y condiciones de salida (respuesta, demo, oposición).

**REQ-OUT-02 (M)** — CUANDO una ficha aprobada entra en una campaña, EL SISTEMA DEBERÁ calcular por paso la
**siguiente mejor acción permitida**: evalúa la puerta para cada canal del paso y elige el primero `ALLOW`; si ninguno
lo es, marca `research_only` y la incluye en audiencias de publicidad agregadas (nunca listas de contactos).

**REQ-OUT-03 (M)** — Las acciones se agrupan en **lotes de envío** que una persona aprueba (con vista previa, coste
estimado y número de destinatarios). Un lote no aprobado nunca se ejecuta (P1.7).

**REQ-OUT-04 (M)** — Cadencias y franjas de `compliance.md` aplicadas por la puerta, no por la secuencia.

## 10. Cartas personalizadas (LET)

**REQ-LET-01 (M)** — EL SISTEMA DEBERÁ generar por ficha una carta B2B de una página dirigida **a la empresa** (sin
nombre de persona), con: gancho basado en evidencia observada, propuesta, oferta vigente de `product_facts`, QR y URL
corta a `/c/<token>`, teléfono del asistente, identidad del remitente, información de privacidad (art. 14 RGPD
abreviada + URL) y forma de baja.
- CA1: el verificador de afirmaciones rechaza cualquier cifra, precio o función no presente en `product_facts`.
- CA2: salida PDF A4 lista para imprimir y sobre DL/C5 con dirección normalizada; lote en un único PDF + CSV.
- CA3: en `sandbox` las cartas solo se generan; en `production` se envían por el proveedor configurado o se marcan
  como impresas a mano.

**REQ-LET-02 (S)** — Seguimiento: escaneos del QR por ficha (sin cookies de terceros), cartas devueltas y respuestas.

## 11. Email (EML)

**REQ-EML-01 (M)** — EL SISTEMA DEBERÁ enviar emails solo vía `ContactService` y solo para: (a) transaccionales de demo
solicitada (confirmación y 1 recordatorio) y (b) secuencias comerciales a contactos con consentimiento `email` vigente.
- CA1: cada email lleva identidad, finalidad, enlace de baja de un clic (`List-Unsubscribe` + `List-Unsubscribe-Post`)
  e información de privacidad.
- CA2: envío desde un subdominio dedicado con SPF, DKIM y DMARC; límite de envío diario configurable.

**REQ-EML-02 (M)** — CUANDO llega una respuesta, EL SISTEMA DEBERÁ clasificarla (`interested`, `question`,
`not_now`, `opt_out`, `out_of_office`, `bounce`, `other`) con el LLM; `opt_out` aplica REQ-CNS-03 automáticamente y
el resto crea una tarea humana. El sistema **no responde solo** a correos comerciales.

## 12. Voz con IA (VOZ)

**REQ-VOZ-01 (M)** — CUANDO entra una llamada al número del asistente (impreso en cartas y anuncios), EL SISTEMA
DEBERÁ atenderla con el agente de voz, identificarse como asistente de IA de TurnoSala y seguir el guion de
cualificación y reserva.

**REQ-VOZ-02 (M)** — Las llamadas salientes de IA las planifica el worker: selecciona contactos con consentimiento
`ai_call`, pide `check(channel='ai_call', direction='outbound')` y solo con `ALLOW` crea la llamada en Twilio.
Franja L–V 10:00–14:00 y 16:00–19:00 Europe/Madrid sin festivos, máx. 2 intentos por consentimiento, 1 al día.

**REQ-VOZ-03 (M)** — En la llamada el agente DEBERÁ:
- CA1: decir en la primera frase que es una IA de TurnoSala y el motivo.
- CA2: ante rechazo («no me interesa», «no me llaméis», «baja», insulto, cuelgue) despedirse en una frase, colgar y
  registrar oposición.
- CA3: máximo 3 preguntas de cualificación (actividad, nº de puestos/consultas, interés).
- CA4: ofrecer **dos huecos reales** obtenidos en ese momento y reservar el elegido.
- CA5: hablar solo de `product_facts` vigentes; derivar a persona en RGPD, contratos, integraciones o precios especiales.
- CA6: duración máxima 6 min; buzón de voz detectado ⇒ colgar sin mensaje comercial.
- CA7: comprobar `kill_switch` en cada turno; si no puede consultar el motor, no sigue la conversación comercial.

**REQ-VOZ-04 (M)** — Al terminar, EL SISTEMA DEBERÁ guardar resultado (`demo_booked`, `callback`, `not_interested`,
`opt_out`, `no_answer`, `voicemail`, `transferred`, `error`), duración, coste, resumen y transcripción textual (sin
audio) en `calls`, mostrarlo en la línea de tiempo y, si el resultado es `callback` o `transferred`, crear una tarea
para el comercial asignado.

**REQ-VOZ-05 (M)** — Simulador por texto con escenarios YAML (rechazo, buzón, pregunta RGPD, intento de manipulación,
pregunta de precio, motor caído) ejecutable en CI.

## 13. Copiloto comercial humano (COP)

**REQ-COP-01 (M)** — Para cada ficha con `human_call` en `ALLOW` o `REVIEW` aprobado, EL SISTEMA DEBERÁ preparar un
guion adaptado (sector, evidencias, objeciones probables) y crear la tarea «Llamar» en el CRM.

**REQ-COP-02 (M)** — Planificador de **visitas presenciales**: agrupa fichas aprobadas por municipio y propone rutas
del día con argumentario y material imprimible (requiere solo que la ficha no esté en `suppressions`).

**REQ-COP-03 (S)** — Tras llamada o visita, el comercial dicta el resultado; el sistema propone resumen, siguiente
paso y etapa; el comercial confirma.

## 14. Agenda de demos (AGE / DEM)

**REQ-AGE-01 (M)** — EL SISTEMA DEBERÁ permitir a cada comercial definir su **disponibilidad para demos**: franjas
semanales recurrentes, excepciones (vacaciones, días sueltos), duración de la demo (15 min por defecto), margen entre
demos, antelación mínima (por defecto 4 h) y máxima (30 días) y enlace de videollamada (D-05).
- CA1: los festivos de `compliance.md` se excluyen automáticamente.
- CA2: un `admin` puede editar la disponibilidad de cualquier comercial; un `sales`, solo la suya.

**REQ-AGE-02 (M)** — EL SISTEMA DEBERÁ calcular los **huecos libres** con una función pura de `packages/core`
(disponibilidad − excepciones − festivos − demos reservadas − ocupado de calendarios externos), en `Europe/Madrid`, y
repartir las demos entre comerciales (por defecto, el que menos demos tiene esa semana).
- CA1: cambios de hora (marzo y octubre) cubiertos por tests.
- CA2: rendimiento: 30 días × 5 comerciales en < 200 ms.

**REQ-DEM-01 (M)** — CUANDO alguien reserva un hueco (página pública de reserva, landing, agente de voz o comercial),
EL SISTEMA DEBERÁ crear la demo en una transacción que **impide la doble reserva** (restricción de exclusión en BD
sobre comercial + intervalo) y, si el hueco ya no está libre, ofrecer los dos siguientes.
- CA1: dos reservas simultáneas del mismo hueco: una gana y la otra recibe alternativa (test de concurrencia).
- CA2: la demo crea o enlaza la ficha, el contacto con consentimiento y la oportunidad en la etapa «Demo reservada».
- CA3: la página pública de reserva (`/demo/reservar` y desde `/c/<token>`) pide nombre, email, teléfono opcional,
  centro y las casillas de consentimiento de REQ-CNS-01; Turnstile y límite por IP.

**REQ-DEM-02 (M)** — EL SISTEMA DEBERÁ enviar la **confirmación** (con invitación `.ics` y enlace de videollamada) y
**un recordatorio** (24 h antes, o 2 h si se reservó con menos antelación) solo por los canales autorizados en la
solicitud (CG-40), y ofrecer **cancelar o cambiar** la demo con un enlace firmado sin login.
- CA1: cancelar libera el hueco al instante; cambiar mantiene la oportunidad y el historial.
- CA2: el comercial recibe aviso por email y la demo aparece en su feed ICS (REQ-AGE-03).

**REQ-AGE-03 (M)** — Calendarios externos: EL SISTEMA DEBERÁ (a) publicar por comercial un **feed ICS privado** (URL
con token) con sus demos y (b) leer una **suscripción ICS de solo lectura** de su calendario (Google/Outlook) cada 10 min
para descontar el tiempo ocupado.
- CA1: del calendario externo solo se guarda inicio y fin de los bloques ocupados, nunca títulos ni asistentes.
- CA2: si la suscripción falla, se avisa al comercial y se siguen ofreciendo huecos según su disponibilidad.

**REQ-AGE-04 (S)** — Sincronización bidireccional con Google Calendar o Microsoft Graph (crear el evento en su
calendario) y envío de la grabación o resumen de la demo (si se aprueba la grabación).

**REQ-DEM-03 (M)** — Tras la hora de la demo, EL SISTEMA DEBERÁ pedir al comercial el resultado (`held`, `no_show`,
`rescheduled`) y, si `held`, mover la oportunidad a «Demo realizada» y proponer «Crear prueba».

## 15. CRM

**REQ-CRM-01 (M)** — CUANDO una ficha alcanza un hito comercial (solicitud de demo, `REVIEW` humano aprobado para
llamar, respuesta interesada, llamada entrante cualificada), EL SISTEMA DEBERÁ crear una **oportunidad** (o reutilizar
la abierta de esa ficha) con etapa, comercial asignado, segmento, puntuación, origen (campaña/canal/UTM) e importe
estimado (plan propuesto × 12 meses, de `product_facts`).
- CA1: una ficha tiene como máximo una oportunidad abierta (índice único parcial); repetir el hito no duplica.
- CA2: etapas configurables con orden y probabilidad; por defecto: Nuevo → Interesado → Demo reservada → Demo
  realizada → Prueba activa → Ganado / Perdido.

**REQ-CRM-02 (M)** — EL SISTEMA DEBERÁ mostrar el pipeline como **tablero por etapas** (arrastrar para cambiar de etapa)
y como **lista** filtrable (comercial, etapa, segmento, provincia, campaña, fecha de siguiente tarea), con totales por
etapa y vista «mis oportunidades».
- CA1: cambiar de etapa queda en la línea de tiempo con autor y fecha.
- CA2: usable en móvil (lista y ficha); el tablero puede ser solo de escritorio.

**REQ-CRM-03 (M)** — **Tareas**: EL SISTEMA DEBERÁ permitir crear tareas (`call`, `email`, `visit`, `follow_up`,
`other`) con fecha, responsable y nota, vinculadas a ficha u oportunidad; las tareas de contacto pasan por la puerta al
ejecutarse (una tarea «Llamar» no habilita la llamada por sí sola).
- CA1: resumen diario por email a cada comercial con sus tareas vencidas y del día.
- CA2: vista «Hoy» con tareas, demos del día y llamadas pendientes de devolver.

**REQ-CRM-04 (M)** — **Línea de tiempo** por ficha/oportunidad: EL SISTEMA DEBERÁ mostrar en orden cronológico notas,
cambios de etapa, contactos ejecutados (cartas, llamadas, emails), consentimientos, decisiones de la puerta relevantes,
demos y pruebas, con enlace a cada registro. Las notas no admiten datos de salud (aviso en el editor).

**REQ-CRM-05 (M)** — **Perder una oportunidad** exige motivo de una lista configurable; el motivo «Oposición / no
contactar» y el botón **«No contactar»** aplican REQ-CNS-03 en la misma transacción.

**REQ-CRM-06 (M)** — **Ganar una oportunidad** ocurre cuando TurnoSala informa del primer pago (REQ-TRI-02) o lo marca
un `admin`; la ficha queda como cliente (`turnosala_customers`) y se excluye de la prospección.

**REQ-CRM-07 (S)** — Importación CSV de oportunidades y contactos existentes (con origen y base de contacto declarados)
y exportación CSV.

## 16. Prueba de 30 días (TRI)

**REQ-TRI-01 (M)** — CUANDO la oportunidad está en «Demo realizada» y el comercial pulsa «Crear prueba», EL SISTEMA
DEBERÁ llamar a `POST /api/platform/v1/trials` de TurnoSala (PRP-017 de turnometro; su consumidor pasa a ser este
sistema en lugar de Odoo) con firma HMAC e idempotencia por `external_id` = id de la oportunidad, guardar
`trial_org_id` y `trial_ends_at`, mover la oportunidad a «Prueba activa» y crear una tarea de seguimiento a los 7 días.
- CA1: un error de TurnoSala no pierde la petición: queda en `sync_outbox` con reintentos y aviso al comercial.

**REQ-TRI-02 (S)** — Seguimiento de activación y pago (`GET /api/platform/v1/orgs/:id/activation`) para crear tareas
de ayuda durante la prueba y marcar la oportunidad como ganada al primer pago.

## 17. Estudio de contenido (CAM)

**REQ-CAM-01 (M)** — EL SISTEMA DEBERÁ generar borradores (anuncios Meta/Google/LinkedIn, posts, guiones de vídeo,
landings por sector y provincia, FAQs) a partir de segmento + `product_facts`, con verificador de afirmaciones y estado
`draft → approved → published` (publicar es manual en el MVP).

**REQ-CAM-02 (S)** — Variantes A/B con su hipótesis y lectura de resultados con tamaño de muestra suficiente.

## 18. Panel y supervisión (PAN / OBS)

**REQ-PAN-01 (M)** — Panel con: trabajos en curso, cola de revisión, lotes pendientes de aprobar, decisiones `REVIEW`,
llamadas (en curso y recientes), demos de hoy y de la semana, oportunidades por etapa, tareas vencidas, embudo por
campaña y oleada (de ficha investigada a cliente ganado), coste del día frente a presupuesto, errores y `kill_switch`
(activable en un clic por `admin`).

**REQ-OBS-01 (M)** — Registrar coste por proveedor, campaña y día; bloquear el canal al superar el presupuesto y avisar.

**REQ-OBS-02 (M)** — Informe semanal generado (y revisable) con: fichas verificadas, contactables por canal, acciones
ejecutadas, respuestas, demos, pruebas, pagos, oposiciones, coste por demo y por prueba, separando datos de hipótesis.

## 19. Retención (RET)

**REQ-RET-01 (M)** — Proceso diario de retención: fichas no convertidas 12 meses tras su última evidencia,
transcripciones 12 meses, oportunidades perdidas 24 meses, decisiones y consentimientos 5 años (valores configurables,
decisión abierta D-09). Las exclusiones (`suppressions`) se conservan mientras dure la actividad comercial, porque
borrarlas reactivaría el contacto.

## 20. Acceso a modelos de lenguaje (LLM)

Cubre ADR-005: dos proveedores admitidos, **Anthropic directo** y **OpenRouter**, intercambiables por ruta.

**REQ-LLM-01 (M)** — EL SISTEMA DEBERÁ hacer **todas** las llamadas a modelos de lenguaje a través de una pasarela única
en `packages/ai`, con una interfaz propia (completar, salida estructurada, búsqueda web, herramientas) que no depende del
formato de ningún proveedor.
- CA1: test de arquitectura **T-ARQ-LLM**: ningún archivo fuera de `packages/ai` importa un SDK de LLM
  (`@anthropic-ai/sdk`, `openai`…) ni contiene URLs de `api.anthropic.com` u `openrouter.ai`; con fixtures de violación
  que el escáner debe detectar (mismo método que T-ARQ).
- CA2: el resto del sistema solo conoce nombres de **ruta** (`enrich.extract`…), nunca modelos ni proveedores.

**REQ-LLM-02 (M)** — EL SISTEMA DEBERÁ resolver cada ruta a `(proveedor, modelo, parámetros)` desde `settings.llm_routes`
(por proveedor, un identificador de modelo distinto) y declarar las **capacidades** de cada proveedor (salida
estructurada, búsqueda web con filtro de dominios, caché de prompt, Batch, razonamiento, herramientas estrictas).
- CA1: si una ruta necesita una capacidad que su proveedor no ofrece, **la ruta se niega a ejecutarse** con un error
  explícito; no se degrada en silencio (p. ej. Batch con OpenRouter) salvo alternativa declarada en la propia ruta.
- CA2: con OpenRouter, toda petición que dependa de un parámetro (esquema JSON, herramientas) envía
  `provider.require_parameters: true` (porque por defecto los parámetros no soportados se ignoran).
- CA3: los dominios vetados (P2.6) se aplican **también en código** sobre las URL que devuelva la búsqueda, porque el
  filtro de dominios del proveedor no está garantizado.
- CA4: cambiar de proveedor o de modelo en una ruta no exige tocar código: solo `llm_routes`, con registro en `audit_log`.

**REQ-LLM-03 (M)** — EL SISTEMA DEBERÁ mantener los proveedores de LLM **cerrados por defecto** (constitución P5.6).
- CA1: una ruta solo usa un proveedor presente en `settings.llm_enabled_providers` (por defecto solo `anthropic`);
  habilitar OpenRouter lo hace un `admin` y queda en `audit_log`.
- CA2: con OpenRouter, toda petición lleva `provider.data_collection: "deny"`; las rutas marcadas `zdr` llevan además
  `provider.zdr: true`, y en `production` se usa el endpoint de la UE si la decisión D-16 lo fija.
- CA3: en `APP_MODE=production`, habilitar un proveedor exige que conste el contrato de encargo (ajuste
  `llm_dpa_confirmed.<proveedor>` puesto por un `admin`); sin él, el proveedor sigue deshabilitado.
- CA4: a un proveedor solo se le envían datos de empresa y texto de sus páginas públicas (P2.3); nunca consentimientos,
  teléfonos o emails de personas.

**REQ-LLM-04 (M)** — EL SISTEMA DEBERÁ registrar, por cada llamada, proveedor, ruta, modelo pedido, **modelo servido**,
tokens (con los cacheados), coste y si hubo fallback, y comprobar el presupuesto diario antes de lanzarla (REQ-OBS-01).
- CA1: el coste sale del proveedor cuando lo informa (`usage.cost` de OpenRouter, consultable luego por el id de la
  generación) y, si no, de la tabla de precios versionada; nunca queda sin registrar.
- CA2: los fallbacks permitidos son una **lista cerrada por ruta** (`allowed_models`); si el proveedor responde con un
  modelo fuera de la lista, la respuesta se descarta y se registra.
- CA3: `stop_reason`/`finish_reason` de rechazo, truncado (`max_tokens`/`length`) o error se normalizan y **nunca** se leen
  como contenido válido.

**REQ-LLM-05 (S)** — Antes de promover una ruta a otro proveedor o modelo en producción, EL SISTEMA DEBERÁ ejecutar el
conjunto dorado de la ruta (`npm run eval:extract -- --route <ruta> --provider <p>`) y mostrar la comparación.
- CA1: una ruta con extracción de campos solo se promueve si iguala el umbral de precisión de F1 (≥ 90 %) y la tasa de
  rechazo de fragmentos no literales (REQ-ENR-01 CA2) no empeora.
- CA2: el informe separa lo medido de lo supuesto y recoge coste por ficha en cada proveedor.

## Fuera de alcance

- Envío de email comercial en frío o llamadas automáticas sin consentimiento (bloqueados por diseño).
- Compra de bases de datos de contactos o enriquecimiento con datos personales de empleados.
- Automatización de LinkedIn o de formularios de contacto de terceros.
- ERP, facturación y email marketing masivo (la facturación de clientes es de TurnoSala/Stripe).
- Funciones de CRM más allá de la venta de TurnoSala: presupuestos, contratos, soporte postventa, previsión avanzada.
- Multi-tenant / reventa a terceros (decisión del 31/10/2026; el producto es configuración para no impedirlo después).
