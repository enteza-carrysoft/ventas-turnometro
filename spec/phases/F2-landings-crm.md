# F2 — Landings, consentimientos y CRM

**Estado:** **APROBADA por el promotor el 01/11/2026 con los valores por defecto** (ver «Lo que necesito del promotor»). En curso.
**Depende de:** F0 completada, F1 en lo que ya existe (fichas, revisión, trabajos). **No depende** de las claves de IA ni de las anotaciones de F1.10: todo F2 se
puede construir y probar en sandbox sin gasto en LLM.
**Puerta de salida: G2** — textos legales de landings y consentimientos aprobados por el asesor (D-04) y recorrido completo hecho por el promotor.

## Objetivo

Que una persona interesada pueda **pedir una demo desde una página pública** dejando consentimientos granulares y verificables, que eso cree (o enlace) la ficha, el
contacto y una **oportunidad** en un CRM propio, y que el comercial la gestione (tablero, tareas, notas, línea de tiempo). Y que **cualquier oposición** corte todos los
canales en la misma transacción. Al terminar, el circuito «interesado → oportunidad → seguimiento» funciona de punta a punta, todavía sin agenda (F3) ni envíos (F4).

## Requisitos (copiados de `spec/requirements.md`)

**REQ-CNS-01 (M)** — publicar landings por sector (`/demo/<sector>`) y **personalizadas por ficha** (`/c/<token>`) con formulario de solicitud de demo y casillas
**separadas y desmarcadas**: (a) emails comerciales, (b) llamada de una persona, (c) llamada de un asistente de IA, (d) SMS/WhatsApp para confirmar la demo.
- CA1: cada casilla marcada crea un `consent` con canal, finalidad, texto exacto y versión, fecha, IP, user-agent, URL, teléfono/email al que aplica, campaña y ficha.
- CA2: el formulario crea o enlaza la ficha y marca la señal `inbound_interest` (+5 puntos).
- CA3: Turnstile, CSRF, límite por IP; validación de email y teléfono.
- CA4: la landing personalizada solo muestra datos públicos de la empresa y no indexa (`noindex`).

**REQ-CNS-02 (M)** — rechazar un consentimiento sin texto, versión, origen y marca temporal (validación en BD y en aplicación).

**REQ-CNS-03 (M)** — ante una oposición (enlace de baja, respuesta de email, llamada, comercial, botón «No contactar» o motivo de pérdida del CRM, carta devuelta con «no
contactar»), en una transacción: insertar `suppressions` (teléfono, email y, si se opone la empresa, dominio/ficha), registrar retirada en `consents`, cancelar acciones,
tareas de contacto y demos pendientes, cerrar como perdida su oportunidad abierta y anotarlo en la línea de tiempo.
- CA1: tras la oposición, `check()` devuelve `BLOCK` para esa empresa/contacto en todos los canales.
- CA2: página pública `/baja/<token>` sin login, con token firmado, y teléfono/email de baja en cada carta.

**REQ-CRM-01 (M)** — al alcanzar un hito comercial (solicitud de demo, `REVIEW` humano aprobado para llamar, respuesta interesada, llamada entrante cualificada), crear una
**oportunidad** (o reutilizar la abierta) con etapa, comercial asignado, segmento, puntuación, origen (campaña/canal/UTM) e importe estimado (plan propuesto × 12 meses, de `product_facts`).
- CA1: máximo una oportunidad abierta por ficha (índice único parcial); repetir el hito no duplica.
- CA2: etapas configurables con orden y probabilidad; por defecto Nuevo → Interesado → Demo reservada → Demo realizada → Prueba activa → Ganado / Perdido.

**REQ-CRM-02 (M)** — pipeline como **tablero por etapas** (arrastrar) y como **lista** filtrable (comercial, etapa, segmento, provincia, campaña, fecha de siguiente tarea),
con totales por etapa y vista «mis oportunidades».
- CA1: cambiar de etapa queda en la línea de tiempo con autor y fecha. CA2: usable en móvil (lista y ficha); el tablero puede ser solo de escritorio.

**REQ-CRM-03 (M)** — **Tareas** (`call`, `email`, `visit`, `follow_up`, `other`) con fecha, responsable y nota, ligadas a ficha u oportunidad; las de contacto pasan por la puerta al ejecutarse.
- CA1: resumen diario por email a cada comercial con sus tareas vencidas y del día. CA2: vista «Hoy» con tareas, demos del día y llamadas pendientes de devolver.

**REQ-CRM-04 (M)** — **Línea de tiempo** por ficha/oportunidad en orden cronológico (notas, cambios de etapa, contactos, consentimientos, decisiones de la puerta relevantes, demos y
pruebas) con enlace a cada registro. Las notas no admiten datos de salud (aviso en el editor).

**REQ-CRM-05 (M)** — **Perder** una oportunidad exige motivo de una lista configurable; el motivo «Oposición / no contactar» y el botón **«No contactar»** aplican REQ-CNS-03 en la misma transacción.

**REQ-CRM-06 (M)** — **Ganar** ocurre cuando TurnoSala informa del primer pago (REQ-TRI-02, F3/F7) o lo marca un `admin`; la ficha queda como cliente (`turnosala_customers`) y se excluye de la prospección.
*(En F2 solo la marca manual del `admin`.)*

**REQ-RET-01 (M)** — proceso diario de retención: fichas no convertidas 12 meses tras su última evidencia, transcripciones 12 meses, oportunidades perdidas 24 meses, decisiones y
consentimientos 5 años (configurable, D-09). Las exclusiones (`suppressions`) se conservan.

**P5 / F2.7** — 2FA TOTP para `admin` antes de exponer el panel.

*Fuera de F2:* REQ-CRM-07 (importación CSV, «Should», F7), REQ-TRI-02 (pago, F3/F7), REQ-AGE-* y REQ-DEM-* (F3), envíos (F4/F6).

## Contexto real (comprobado el 01/11/2026)

- **Ya existe (F0/F1):** tablas `consents` (con `CHECK` de texto, versión y origen no vacíos → REQ-CNS-02 en BD), `suppressions`, `compliance_decisions`, `demos` (sin FK a oportunidades),
  `campaigns`; `insertConsent()` con validación Zod; la puerta (`evaluate`/`check`, CG-10…CG-99, T-01…T-22); `applyOpposition()` en su **versión mínima de F0**; `ingestCandidate()` (deduplica
  por dominio/teléfono/nombre y respeta exclusiones); el modelo de puntuación con la señal `inbound_interest` (5 pts); roles `admin|marketing|sales|auditor|voice`; panel con Better Auth.
- **Falta:** las tablas del CRM (`deal_stages`, `lost_reasons`, `deals`, `tasks`, `notes`, vista `timeline_events`) **solo están en `spec/data-model.sql`, no en migraciones**; no hay ninguna
  ruta pública; `applyOpposition()` **no cierra oportunidades ni cancela tareas** (lo prometía F0 para F2); no hay tokens públicos, ni textos de consentimiento versionados, ni límite de peticiones en formularios.
- **Better Auth 1.7.14** (instalada) incluye el plugin `two-factor`; su API exacta se lee de la documentación vigente al implementar F2.7 (CLAUDE.md: no se programa de memoria).
- **Reglas de la puerta que F2 respeta sin tocar:** CG-10 (entrante de IA permitido), CG-40 (confirmación de demo solicitada: solo F3) y T-22 (confirmación a un contacto creado por formulario → ALLOW CG-40).
- **Hosting (D-01/D-06):** panel y páginas públicas en el mismo origen `go.turnosala.com` (VPS en la UE). En local, `localhost:3000`.

## Diseño

### Datos (migración 0012)
`deal_stages` y `lost_reasons` (sembradas), `deals` (índice único parcial «una abierta por ficha»), `tasks`, `notes`, vista `timeline_events`, FK `demos.deal_id → deals`,
`public_tokens`, `consent_texts`, `public_form_hits`, `staff_outbox`, y ajustes `retention_*` en `settings`. Todo con `CHECK`/FK; los cambios de etapa y de propietario se auditan.

- **`public_tokens(kind, token_hash, prospect_id, campaign_id, expires_at, revoked_at)`** — `kind ∈ {landing, unsubscribe}`. El token son **128 bits aleatorios**; en BD solo su **SHA-256**
  (una fuga de la BD no da enlaces utilizables) y se puede revocar. *Diferencia con `design.md`:* el documento dice «firmado»; se prefiere aleatorio + hash porque es revocable y no lleva datos.
- **`consent_texts(version, channel, text, status draft|approved, approved_by, approved_at)`** — el texto exacto que ve la persona vive versionado en BD. El formulario guarda **copia literal** en `consents.text_snapshot`.
  En **producción** el formulario se niega a mostrarse si la versión vigente no está `approved` (G2); en sandbox se muestra con un aviso «texto sin aprobar por el asesor».
- **`public_form_hits(ip_hmac, at)`** — límite por IP (5 envíos/hora por defecto) sin guardar la IP en claro (HMAC con secreto de la app); retención corta. La IP en claro solo va a `consents.ip` (CA1).
- **`staff_outbox`** — resumen diario y avisos al personal. Un puerto `StaffMailer`; en F2 la implementación es una **bandeja en BD visible para `admin`** (sin proveedor). El adaptador real (Resend) llega con F3.4/F6 cuando haya dominio y clave.

### Páginas y rutas
- Públicas (sin sesión, CSP estricta, sin cookies propias, `noindex` en las personalizadas): `/demo/<sector>`, `/c/<token>`, `/baja/<token>`, `POST /api/public/demo-request`, `POST /api/public/baja`.
- Panel: `/oportunidades` (tablero y lista, filtros, «mis oportunidades»), `/oportunidades/<id>`, `/hoy`, `/fichas/<id>` gana notas, tareas y línea de tiempo, `/ajustes/consentimientos` (versionar y aprobar textos, solo `admin`), `/ajustes/seguridad` (2FA).
- **Landing de sector:** el texto sale de `product_facts` aprobados y del segmento (nada que no esté respaldado); el sector es el `slug` de un segmento **aprobado**.
- **Landing personalizada:** muestra solo nombre y localidad públicos de la empresa (CA4); el token enlaza ficha y campaña; el formulario precarga lo que ya consta.

### Flujo del formulario (`submitDemoRequest`, función de BD en una transacción)
1. Validar (Zod): nombre, email o teléfono (al menos uno, normalizados con los mismos módulos de `core`), empresa opcional, casillas (a)–(d) explícitas, Turnstile, límite por IP, origen exacto.
2. Resolver la ficha: por token; si no, por dominio del email (no genérico), teléfono o nombre (`ingestCandidate`, fuente `inbound_form`); si no existe, se crea en estado `candidate`. Una exclusión previa **no se pisa**: la solicitud se registra pero la ficha sigue bloqueada y no se crea oportunidad (se avisa al comercial para revisión humana).
3. Crear un `consent` **por cada casilla marcada** (canal, finalidad, texto exacto y versión, IP, user-agent, URL, contacto al que aplica, campaña, ficha). Sin casillas, la solicitud es válida (pidió una demo) pero no habilita ningún canal comercial.
4. Evidencia `signal:inbound_interest` (observada, URL de la landing) y **recalcular la puntuación**.
5. Crear/reutilizar la oportunidad en «Interesado» (importe = plan propuesto × 12 de `product_facts`), asignar comercial (reparto por turnos entre `sales` activos o sin asignar) y crear la tarea «Atender demo solicitada».
6. Nada se envía. El resultado de la página es una confirmación genérica (no revela si la ficha existía, ni si estaba excluida).

### Oposición transversal
`applyOpposition()` se amplía y se parte en una función que **acepta un cliente de transacción**, para componerse con el cierre de oportunidades: cierra la oportunidad abierta como perdida (motivo «Oposición /
no contactar»), cancela tareas de contacto abiertas, demos pendientes e intentos planificados, anota la línea de tiempo y deja el rastro en `audit_log`. La baja pública usa el token `unsubscribe`
(un solo uso lógico, idempotente) y puede oponerse en nombre de la empresa (dominio y ficha) o solo de un contacto.

### CRM
Etapas por defecto (id · nombre · probabilidad): `new` Nuevo 5 · `interested` Interesado 15 · `demo_booked` Demo reservada 30 · `demo_held` Demo realizada 50 · `trial` Prueba activa 70 · `won` Ganado 100 · `lost` Perdido 0.
Motivos de pérdida: `opposition` (aplica oposición), `no_interest`, `no_budget`, `competitor`, `not_target`, `no_response`, `other`. Permisos (servidor, defensa en profundidad en BD): `sales` ve todo y edita solo lo suyo o lo sin asignar;
`admin` todo; `marketing` y `auditor` lectura; nadie salta una etapa hacia atrás sin dejar rastro. El tablero usa arrastrar nativo (HTML5) **más botones por teclado** (accesible y probable con Playwright); en móvil, lista.
Las tareas de contacto (`call`, `email`) **no habilitan nada por sí solas**: al ejecutarse pasan por `ContactService` (F4). Las notas avisan de no incluir datos de salud.

### Seguridad
CSRF por origen exacto + `Content-Type` JSON en toda mutación; Turnstile en el formulario (se verifica en servidor contra el endpoint de Cloudflare; **a confirmar con su documentación vigente al implementar**; en sandbox, claves de prueba
publicadas por Cloudflare); honeypot y tiempo mínimo de envío como defensa adicional; CSP estricta en páginas públicas (solo el script de Turnstile de terceros); cabeceras `X-Robots-Tag: noindex` en `/c/*` y `/baja/*`;
respuestas idénticas con y sin ficha existente (sin enumeración); tokens comparados en tiempo constante; **ninguna** ruta pública lee la sesión ni toca el panel. Panel y páginas públicas comparten origen: por eso nada del usuario se
renderiza como HTML (React escapa; sin `dangerouslySetInnerHTML`).

## Tareas (test primero; cada una cierra con typecheck, lint, tests y mutaciones de su lógica crítica)

| Tarea | Detalle | Verificación concreta |
|---|---|---|
| F2.0 | Migración 0012 y sembrado; módulos `db` (`deals`, `tasks`, `notes`, `tokens`, `consent-texts`) | Esquema completo; índice único «una abierta por ficha»; FK `demos.deal_id`; `CHECK` de etapas cerradas; permisos del rol `app` (sin `update/delete` donde no toca) |
| F2.1 | Textos de consentimiento versionados + `submitDemoRequest` + páginas y rutas públicas (`/demo/<sector>`, `/c/<token>`) | Cada casilla ⇒ un `consent` con todos los campos (CA1); ficha creada/enlazada y `inbound_interest` +5 (CA2); Turnstile/CSRF/límite/validación (CA3); `noindex` y solo datos públicos (CA4); sin texto/versión ⇒ rechazo en app y en BD (CNS-02); exclusión previa ⇒ no se crea oportunidad; producción sin texto aprobado ⇒ el formulario no se muestra; respuestas indistinguibles con/sin ficha; e2e del recorrido |
| F2.2 | `applyOpposition` completa + `/baja/<token>` | T-14: en una transacción, `BLOCK` en todos los canales, tareas y demos canceladas, oportunidad cerrada como perdida, línea de tiempo anotada; atomicidad (si falla una parte no queda nada a medias); token inválido/caducado/ya usado sin filtrar información; idempotente |
| F2.3 | Oportunidades: etapas, motivos, creación por hito, una abierta por ficha, permisos por rol, «ganar» manual de `admin` | CRM-01 CA1/CA2; repetir el hito no duplica (con concurrencia); importe = plan × 12; `sales` solo edita lo suyo; ganar ⇒ `turnosala_customers` y ficha excluida de la prospección; perder exige motivo |
| F2.4 | Tablero (arrastrar + teclado) y lista con filtros; «mis oportunidades»; contadores en el panel | CRM-02 CA1/CA2; cambio de etapa auditado con autor y fecha; filtros; totales por etapa; usable a 400 px (lista) |
| F2.5 | Tareas, vista «Hoy» y resumen diario a la bandeja del personal | CRM-03; una tarea «Llamar» no ejecuta nada; resumen solo con tareas vencidas y del día de cada comercial, a su hora (Europe/Madrid, cambio de hora); sin duplicados si se reintenta |
| F2.6 | Línea de tiempo (vista) y notas en ficha y oportunidad | CRM-04: orden cronológico, enlace a cada registro, avisos de salud, `auditor` solo lectura |
| F2.7 | 2FA TOTP para `admin` + retención diaria | 2FA: alta, acceso con código, códigos de recuperación, **obligatorio para `admin` en producción** (opcional en sandbox); retención: fichas 12 m / oportunidades perdidas 24 m con valores de `settings`, `suppressions` intactas, ejecución repetible; purga de las tablas de solo inserción **no se implementa ahora** (no hay nada de más de 5 años hasta 2031; se documenta como decisión) |

## Plan de pruebas

- **Unitarias y de BD** (una por CA, con los casos negativos): consentimientos, oposición (T-14 y la atomicidad), unicidad de oportunidad bajo concurrencia, permisos por rol, tokens (hash, caducidad, revocación, tiempo constante), límites por IP, retención.
- **Arquitectura:** T-ARQ intacto (ninguna ruta de F2 contacta con nadie); la bandeja de personal no importa ningún SDK de email.
- **E2E (Playwright):** recorrido completo (landing → consentimientos → ficha → oportunidad «Interesado» → comercial la mueve, crea tarea y nota → «No contactar» ⇒ `check()` bloquea todo); baja pública; 2FA; rol `sales` no edita lo ajeno; móvil a 400 px.
- **Mutaciones** de lo crítico: casilla marcada por defecto, consentimiento sin texto, oposición que no cierra la oportunidad, doble oportunidad, token sin hash, producción sin texto aprobado, retención que borra exclusiones.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Los textos legales no están aprobados (D-04) | Texto versionado en BD; producción bloqueada hasta `approved`; en sandbox, aviso visible. El código no depende de la redacción |
| Turnstile mete un tercero (Cloudflare) en la página | CSP restringida a su script; documentarlo en la política de privacidad (asesor); alternativa sin tercero (honeypot + tiempo + límite) ya incluida como capa adicional |
| Páginas públicas y panel en el mismo origen amplían el daño de un XSS | CSP estricta, nada renderizado como HTML, rutas públicas sin sesión, auditoría de dependencias |
| Enumerar fichas por el formulario o la baja | Respuestas idénticas, límite por IP, tokens de 128 bits |
| Crear una oportunidad para alguien con exclusión previa | La exclusión manda: se registra la solicitud pero no se crea oportunidad ni se habilita canal; aviso humano |
| 2FA mal configurado deja fuera al único admin | Códigos de recuperación y comando de rescate documentado (`user:create`-style) antes de exigirlo |
| Reparto de comerciales con pocos `sales` | Si no hay `sales` activos, la oportunidad queda sin asignar y aparece en «Hoy» de `admin` |

## Lo que necesito del promotor para aprobar F2

1. **Textos legales:** ¿de acuerdo con empezar con textos **borrador marcados «sin aprobar»** (solo sandbox) y que producción **no abra los formularios** hasta que el asesor los apruebe (G2)?
2. **Resumen diario por email al personal:** ¿bandeja interna en BD ahora (sin proveedor) y Resend más adelante (F3.4/F6, cuando haya dominio y clave)? *(por defecto: sí)*
3. **2FA:** ¿obligatorio para `admin` solo en producción y opcional en sandbox? *(por defecto: sí)*
4. **Turnstile:** ¿se usa (necesita cuenta de Cloudflare gratuita; en sandbox, claves de prueba) o prefieres solo honeypot + tiempo + límite por IP? *(por defecto: Turnstile)*
5. **CRM por defecto:** etapas y probabilidades de arriba, motivos de pérdida de arriba, **plan propuesto por defecto = Profesional** (69 €/mes ⇒ importe estimado 828 €/año), reparto de oportunidades por turnos entre `sales`. *(por defecto: sí)*
6. **Fuera de F2** (confirmo que no se hace): importación CSV al CRM (F7), pago y activación de pruebas (F3/F7), agenda y reservas (F3), envíos (F4/F6).

## Aprendizajes

- **F2.0 completada (01/11/2026)** — migración 0012 (`deal_stages`, `lost_reasons`, `deals`, `tasks`, `notes`, FK `demos.deal_id`) y 13 tests de esquema (`crm-schema.test.ts`).
  **Decisiones mías (revisables):** (1) **una migración por tarea** en vez de una sola 0012: tokens, textos de consentimiento y límite de formularios llegan con F2.1; la bandeja de personal con F2.5; la
  vista de línea de tiempo con F2.6; los ajustes de retención con F2.7. Cada tarea cierra con su propio esquema probado. Del mismo modo, los módulos `db` de oportunidades, tareas y notas se escriben
  en F2.3, F2.5 y F2.6 (donde se usan), no por adelantado. (2) **Restricciones más estrictas que `data-model.sql`**: el cierre es coherente en los dos sentidos (`closed_at` ⇔ etapa ganada o perdida),
  «perdida» ⇔ lleva motivo, el importe no es negativo, y propietario y responsable son usuarios reales (FK a `user`). (3) `demos.deal_id` ya es FK real. **Mutaciones:** las 9 restricciones
  (índice de una oportunidad abierta, coherencia de cierre, motivo de pérdida, tarea hecha sin fecha, tarea sin ficha ni oportunidad, nota sin límite, importe negativo, FK de demos, FK de propietario)
  hacen fallar tests al quitarlas. La unicidad se prueba también con tres inserciones **simultáneas**.

- **F2.1 (a, b, c) hecha (01/11/2026)** — base pública (0013), envío del formulario (0014), verificador de Turnstile y páginas `/demo/<sector>` y `/c/<token>`. Falta F2.1d (pantalla de textos legales y revisión de la CSP del widget real).
  **Decisiones mías (revisables):**
  1. **`inbound_form` queda inactiva** en `allowed_sources`: solo existe por la FK de `prospect_sources`; no es una fuente de investigación y el guardián de F0.4 exige que todas las sembradas lo estén.
  2. **Una casilla ⇒ varias filas de `consents`** (una por canal, finalidad y destino), porque la puerta compara con igualdad estricta. La casilla de SMS/WhatsApp solo habilita *confirmar* la demo, nunca prospectar.
  3. **Exclusión antes que consentimiento**: si la persona o la ficha están suprimidas o bloqueadas, no se crea nada (ni consentimiento) y se deja un aviso humano; la respuesta pública es **idéntica** a la de un envío normal, para no revelar quién está en la base.
  4. **Atribución del primer contacto**: una oportunidad abierta se reutiliza (no se duplica ni retrocede de etapa; solo «Nuevo» sube a «Interesado») y conserva campaña, canal y UTM originales.
  5. **El token del enlace personal no se guarda en claro en ningún sitio**: ni en `source_url` de consentimientos y solicitudes (lleva un marcador) ni en la auditoría. `Referrer-Policy: no-referrer`, `noindex` y `no-store` en `/c/*` y `/baja/*`.
  6. **Orden de las defensas** (importa): origen → límite por IP → landing → validación → tiempo mínimo firmado → captcha → textos → registro. El captcha va tras validar para no gastar el token (de un solo uso) en un error de formulario.
  7. **Secreto del formulario derivado** de `BETTER_AUTH_SECRET` (HMAC con etiqueta fija), no el mismo: firma la marca de tiempo y hace el HMAC de las IP. Sin variable nueva.
  8. **Captcha de pruebas solo en sandbox**: sin claves de Turnstile, sandbox usa un token fijo sin red ni widget (así el e2e es determinista); en producción faltar las claves es un error. Las claves oficiales de prueba de Cloudflare
     devuelven otro `hostname`, así que con ellas habría que desactivar la comprobación de hostname (no se hace).
  9. **CSP con nonce** solo en las páginas públicas (proxy de Next 16, guía consultada el 01/11/2026). `style-src-attr 'unsafe-inline'` permite los atributos `style` del diseño sin abrir hojas en línea. **Sin verificar**: los directivos exactos
     que necesita el widget real de Turnstile (la documentación de Cloudflare consultada no los lista); se comprueban en un navegador con la clave de pruebas en F2.1d, no en CI.
  10. Un `X-Forwarded-For` que no es una IP válida se trata como «desconocida» (antes llegaba a una columna `inet` y rompía el envío). **El proxy inverso debe sobrescribir esa cabecera** (anotado para el despliegue, D-01).
  **Fallos míos que dejo anotados (Auto-Blindaje):** (a) un commit salió con el lint en rojo porque encadené `npm run lint | tail` (el `tail` devuelve siempre éxito); desde ahora la puerta del commit es `npm run ci` con `if`. (b) Un test de concurrencia
  pasaba aunque quitara el bloqueo de la ficha, porque otro índice único serializaba por su cuenta: hay que forzar que los envíos simultáneos difieran en lo demás (URL distinta). (c) Mis tests compartían IP y chocaban con el límite por IP:
  el *default* de los tests de rutas con límites debe ser una IP distinta por prueba.
  **Mutaciones:** formulario/envío 16 + 3, verificador de captcha 8, rutas públicas 15 + 1, proxy y CSP 11: todas detectadas (una era equivalente y está documentada en el commit).
