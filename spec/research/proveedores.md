# Proveedores externos — lo comprobado y lo pendiente (F0.9)

**Fecha de la comprobación:** 31/10/2026 · **Estado:** borrador para revisión del promotor · **Responde a:** F0.9,
ADR-005 (OpenRouter), D-06, D-07, D-08, D-14, D-15, D-16.

Leyenda: ✅ comprobado en la página oficial citada · ⚠️ solo en fuente secundaria o parcial · ❓ **no se pudo confirmar**.
No se ha creado ninguna cuenta, ni gastado dinero, ni enviado ninguna petición a un proveedor de pago.

**Lo más importante, en cinco líneas**
1. **Prefijo 400 (nuevo, bloqueante para F4/F5):** las llamadas comerciales salientes en España solo pueden salir de números
   `+34 400`, que **no admiten llamadas entrantes**. Hacen falta dos números. → D-14.
2. **OpenRouter es viable pero distinto:** otros ids de modelo, parámetros no soportados que se ignoran en silencio, sin Batch
   y sin Haiku/Sonnet 5.5 en su lista. La pasarela de ADR-005 lo absorbe. Contrato de encargo solo en su plan Business. → D-15, D-16.
3. **Festivos de Andalucía 2026 y 2027 verificados en el BOJA** y corregidos en el código (faltaban los traslados del 2-nov
   y 7-dic de 2026).
4. **Lista Robinson:** existe tarifa **gratuita** para microempresas y pymes hasta 30.000 registros/año; cada consulta vale
   un mes.
5. **Cartas:** no encontré ninguna API de «correo híbrido» en España; se mantiene la impresión propia del piloto (D-07).

---

## 1. Claude (Anthropic, API directa)

Fuentes: skill `claude-api` (caché del 06/10/2026) y `platform.claude.com/docs/en/about-claude/pricing` (31/10/2026).
Contraste de lo que `design.md` daba por supuesto:

| Supuesto del diseño | Resultado |
|---|---|
| IDs `claude-opus-5-5`, `claude-haiku-5-5` | ✅ correctos |
| `web_search_20260209` y `web_fetch_20260209` | ✅ para Opus 5.5 (filtrado dinámico). ⚠️ **No figuran para Haiku 5.5**: las rutas con búsqueda web se quedan en Opus |
| `fallbacks: "default"` en Opus | ⚠️ Correcto, **pero** exige la cabecera beta `server-side-fallback-2026-07-01`, solo vale en la API directa y **se rechaza en la Batch API**. Las rutas por lotes no tienen fallback de servidor |
| Sin `temperature`/`top_p`/`budget_tokens` | ✅ Opus 5.5 los rechaza con 400 |
| Pensamiento adaptativo | ⚠️ En Opus 5.5 **no se puede desactivar** (400 con `disabled`); el esfuerzo por defecto es **`medium`**, no `high`: fijarlo siempre por ruta |
| Herramientas estrictas (`strict: true`) | ✅; `tool_choice` forzado (`any`/`tool`) da 400 en Opus 5.5: usar `auto` + instrucción |
| Salida estructurada con `client.messages.parse` | ✅; ⚠️ **incompatible con las citas de la API** (400). No nos afecta: nuestras evidencias son `quote` + URL de nuestro rastreador |
| Haiku 5.5 a 0,10 $ / 0,50 $ | ⚠️ solo **hasta 100.000 tokens** de prompt; por encima 0,50 $ / 2,50 $ |
| «Las búsquedas web se facturan aparte» | ✅ **10 $ por 1.000 búsquedas** + tokens; `web_fetch` sin coste adicional; la ejecución de código del filtrado dinámico no se cobra |
| Precios Opus 5.5 | ✅ 4 $ entrada / 20 $ salida; lectura de caché 0,20 $; escritura 5 $ (5 min) u 8 $ (1 h); Batch −50 % |
| Prioridad (Priority Tier) | ⚠️ no disponible en Opus 5.5 |
| Agentes con historial largo (`market.analyze`) | ⚠️ «pensamiento preservado»: en cuentas creadas desde el 31/08/2026, **editar turnos anteriores da error 400**. Los bucles del agente deben ser solo-añadir |

Estimación de coste por ficha: **no se hace aquí**; se mide en F1.1/F1.10 con el conjunto dorado (REQ-LLM-05).

## 2. OpenRouter (ADR-005)

Fuente: `openrouter.ai/docs` (varias páginas), `openrouter.ai/api/v1/models`, `openrouter.ai/privacy`, FAQ. 31/10/2026.

**API.** ✅ Base `https://openrouter.ai/api/v1`; `POST /chat/completions` y `POST /responses`; clave como `Authorization: Bearer`;
cabeceras opcionales `HTTP-Referer` y `X-Title`. Esquema «muy parecido al de OpenAI». ✅ **No documenta un endpoint compatible con
la API de Mensajes de Anthropic**: se usa el formato OpenAI. Streaming SSE; el uso llega una vez en el último fragmento.

**Modelos.** ✅ Opus 5.5 es **`anthropic/claude-opus-5.5[1m]`** (punto en `5.5` y sufijo `[1m]`); también `claude-fable-5.1[1m]` y
`claude-fable-5[1m]`. ✅ **No aparecen Haiku 5.5 ni Sonnet 5.5** en su lista. ❓ La vista que leí no traía precios ni
`supported_parameters`: **hay que consultar `GET /api/v1/models` directamente** (F1.1) antes de fijar una ruta.

**Parámetros.** ✅ «Los parámetros que un modelo no soporta **se ignoran, no se rechazan**»; para evitarlo,
`provider.require_parameters: true`. ✅ Enrutado por petición en `provider`: `order`, `allow_fallbacks`, `only`, `ignore`,
`sort`, `max_price`, `data_collection` (`allow`|`deny`, por defecto `allow`), `zdr`. Fallback de modelos con `models: [...]`.

**Salida estructurada.** ✅ `response_format: {type: "json_schema", json_schema: {..., strict}}`; el soporte se decide **por
endpoint** (un mismo modelo puede tener proveedores con y sin soporte); en modo estricto «algunos garantizan el esquema y
otros lo tratan como una pista fuerte». → siempre Zod después.

**Búsqueda web.** ✅ Sufijo `:online`, plugin `web` o herramienta de servidor `openrouter:web_search`; motor nativo (Anthropic,
Google, OpenAI, Perplexity…) o Exa (0,007 $/petición con hasta 10 resultados) u otros; `include_domains`/`exclude_domains`
**según motor** (el nativo de Google no filtra dominios). Citas como `annotations` de tipo `url_citation`.

**Caché de prompt.** ✅ Para modelos Anthropic, `cache_control` (automático o por bloques, hasta 4); TTL 5 min o 1 h;
enrutado «pegajoso» al mismo proveedor mientras haya actividad (10 min); verificar con `prompt_tokens_details.cached_tokens`.

**Batch.** ❓ No aparece en lo leído: tratarlo como **no disponible**.

**Coste y límites.** ✅ El resultado trae `usage.cost` (créditos) y `cost_details`; se puede consultar después por el id de la
generación (`/api/v1/generation`). ✅ **Sin sobreprecio en la inferencia**; comisión al comprar créditos (❓ el porcentaje no se
mostró); BYOK gratis hasta 25.000 USD/mes y 5 % después. ❓ **Límites de peticiones de cuentas de pago: no documentados** en lo
leído (los modelos gratuitos: 50/día, o 1.000/día tras comprar ≥ 10 créditos).

**Privacidad y encargo** (clave para D-16):
- ✅ **No guarda prompts ni respuestas por defecto** (sí metadatos como tokens y latencia); el registro de contenido y el uso
  para mejorar el producto son opt-in. Revisa los envíos por posible material de abuso infantil aunque haya ZDR.
- ✅ «No usa tus entradas ni salidas para entrenar modelos.»
- ✅ **Región UE:** las peticiones a `eu.openrouter.ai` se descifran en la UE y solo se enrutan a endpoints de Europa
  (UE/EEE, Reino Unido, Suiza). Cuenta y facturación pueden tratarse en EE. UU.
- ✅ **El contrato de encargo (DPA, con cláusulas tipo) está en el plan Business** (alta sin contrato).
- ⚠️ Su política de privacidad **no define** si es responsable o encargado, **no publica lista de subencargados** y dice que
  «no controla cómo los modelos tratan las entradas»: los proveedores finales también cuentan. **Pregunta para el asesor (D-04/D-16).**
- Consecuencia de diseño: `data_collection: "deny"` siempre; `zdr: true` donde el modelo lo permita; endpoint UE en producción.

**GPT-6 Luna (comprobado el 02/11/2026 en `https://openrouter.ai/api/v1/models`).** ✅ id `openai/gpt-6-luna` (también `:batch` a mitad de precio y `~openai/gpt-luna-latest`, que no se usa porque cambia solo); contexto 1.050.000; **0,10 $ entrada / 0,50 $ salida por Mtok**, lectura de caché 0,01 $, escritura 0,125 $; por encima de 272.000 tokens de entrada, 0,20 $ / 0,75 $. Búsqueda web **0,01 $ por búsqueda** (más que los 0,005–0,007 € anotados para Opus). Parámetros: `response_format`, `structured_outputs`, `tools`, `tool_choice`, `reasoning`, `reasoning_effort`, `max_tokens`; **no** `temperature` (no la enviamos). ❓ Pendiente con la clave: que el **modelo servido** coincida exactamente con el id (si trae sufijo de fecha, la pasarela lo rechaza con `model_not_allowed` y hay que añadirlo a `allowedModels`) y que la búsqueda devuelva citas `url_citation`: lo comprueba `npm run llm:check` y `npm run llm:check -- --search`.
  **Resultado con la clave real (02/11/2026):** ✅ modelo servido `openai/gpt-6-luna` exacto; salida estructurada correcta. ⚠️ Búsqueda con el motor **nativo** (por defecto): 3 búsquedas con `max_uses: 1`, **0 citas** (el mensaje no trae `annotations`) y 0,03 $. La documentación (`/docs/guides/features/server-tools/web-search`) confirma que con `native` `max_uses` solo se reenvía a Anthropic y solo documenta `url_citation` para Exa. ✅ Con `engine: "exa"`: 1 búsqueda, 5 citas, 0,0075 $. Motores: `auto`, `native`, `exa`, `firecrawl` (rechazado con ZDR), `parallel`, `perplexity`; **en `eu.openrouter.ai` no hay ningún motor** (afecta a D-16 en producción). Ajuste por ruta `searchEngine` (migración 0016: `discovery` → `exa`).

## 3. Twilio (voz)

Fuente: `twilio.com/docs/voice/conversationrelay/voice-configuration`, guía regulatoria de España, tarifas de voz. 31/10/2026.

- ✅ **ConversationRelay en `es-ES`:** STT por defecto **Deepgram `nova-3-general`**; TTS por defecto **ElevenLabs** (modelo Flash
  2.5 en idiomas distintos de en-US) con voz por defecto para es-ES. Las voces de Google/Amazon están en otra tabla que no leí.
  ElevenLabs v3/v4 no admiten SSML y exigen `speed = 1.0`.
- ❓ **Latencia hasta el primer token de voz:** **no medida** (exige cuenta de Twilio y un servidor con HTTPS: D-01). Es el
  primer experimento de F5.1; el objetivo del diseño (< 1,2 s) sigue sin comprobarse.
- ❓ **Precio de ConversationRelay:** la página de precios no se pudo abrir (404). Una comparativa de terceros da 0,07 $/min sin
  decir qué incluye: **no usar**.
- ✅ **Tarifas de voz a España (página de Twilio, sin fecha):** saliente a móvil **0,18 $/min** (0,0486 $/min desde el EEE),
  saliente a fijo **0,0178 $/min**, número local español **5,50 $/mes**. No figura precio de un número del rango 400.
- ✅ **Requisitos de un número local español:** registro mercantil/CIF de la empresa y **dirección dentro de la localidad o región
  del prefijo** (Sevilla = 95…; sin apartado de correos). Móvil/nacional/gratuito: basta dirección en España.
  La subcuenta «Growth» y el número aún no existen.

## 4. Prefijo 400 en llamadas comerciales (D-14, nuevo)

Fuente oficial: **Resolución de 14/04/2026 de la Secretaría de Estado de Telecomunicaciones e Infraestructuras Digitales**
(BOE núm. 93, 16/04/2026; en vigor el 17/04/2026), leída en `boe.es` (BOE-A-2026-8409). Twilio lo confirma: «desde el 17/10/2026
queda prohibido usar cualquier otro tipo de número para llamadas comerciales salientes en España».

- ✅ El rango **400** (9 cifras) es **solo saliente**: **no puede recibir llamadas** ni usarse para atención al cliente; solo
  llama a números de usuario final (geográficos, móviles, nómadas).
- ✅ Las empresas dentro del ámbito de la **Ley 10/2025** no pueden usar otro rango para llamadas comerciales, salvo lo que
  disponga su disposición transitoria; el rango debe estar operativo a los 6 meses (≈ 17/10/2026). Supervisa la CNMC.
- ❓ El texto **no menciona IA, consentimiento previo ni llamadas B2B**, y no describe la excepción transitoria. **Hay que
  preguntar al asesor** si nuestras llamadas (humanas B2B y de IA con consentimiento) entran en el ámbito.
- ❓ No he comprobado que Twilio ya ofrezca números 400 en España ni su precio.
- **Consecuencias de diseño (propuestas en D-14):** dos números (400 para salientes; geográfico para entrantes de cartas y
  anuncios); nadie puede devolver la llamada al 400, así que el guion y la carta apuntan al número entrante; el conector de voz
  se niega a originar una llamada comercial saliente desde un número que no sea 400.

## 5. Lista Robinson (D-08)

Fuente: `listarobinson.es/empresas` (Adigital). 31/10/2026.

- ✅ Cubre **cuatro canales**: correo postal, llamadas, SMS/MMS y correo electrónico. La consulta **vale un mes** (nuestra
  regla CG-08 de ≤ 30 días es coherente).
- ✅ **Tres formas de consultar:** herramienta de Adigital (se sube un CSV y devuelve otro), **API propia** (requisitos en el Anexo I
  del Reglamento del Servicio, que no leí) o un tercero que actúa como **encargado**.
- ✅ **Tarifas** (sin IVA, no socios de Adigital): microempresa 1.900 €/año (50.000 registros); pequeña 2.550 € (120.000);
  mediana 4.500 € (330.000); grande 5.500 € (600.000). **Tarifa bonificada gratuita para microempresas y pequeñas empresas hasta
  30.000 registros al año.** Registros extra 1,20 € por cada 10.000. Tamaño según el Reglamento (UE) 651/2014.
- ✅ Requiere alta: formulario y aceptación de las condiciones generales, con validación.
- ❓ La página **no dice si cubre a autónomos** ni el detalle de los datos que se envían.
- **Propuesta para D-08:** solicitar la tarifa bonificada (el piloto cabe de sobra en 30.000 registros) y consultar solo los
  `sole_trader`/`unknown` antes de cada lote (CG-08).

## 6. Cartas (D-07)

- ⚠️ Dos búsquedas **no encontraron ninguna API de «correo híbrido»** (impresión, ensobrado y franqueo) en España.
  Lo que hay de Correos son APIs de **paquetería** (para acceder: código de etiquetador, nº de cliente y de contrato; portal
  de APIs nuevo desde septiembre de 2025, según el centro de ayuda de AfterShip).
- **Se mantiene el valor por defecto de D-07:** impresión propia en Sevilla para el piloto (≤ 200 cartas). Evaluar proveedores de
  correo híbrido (contacto comercial) antes de la oleada 2; no se ha comprobado ninguno.

## 7. Resend (correo)

Fuente: `resend.com/docs`. 31/10/2026.

- ✅ Recomienda enviar desde **subdominios** (`updates.ejemplo.com`) para aislar la reputación; cada subdominio se verifica por
  separado con SPF y DKIM (registros TXT/MX/CNAME que da el panel) y **DMARC después** de verificar. Coherente con el
  subdominio dedicado del diseño (p. ej. `hola.turnosala.com`).
- ✅ Región UE disponible (`eu-west-1`). ✅ **Webhooks firmados con Svix** (`svix-id`, `svix-timestamp`, `svix-signature`):
  `resend.webhooks.verify()` con el **cuerpo en bruto**.
- ❓ **Recepción de correo entrante** (REQ-EML-02): no confirmada en las páginas leídas. **Se resuelve en F6** antes de depender de ello.
- ❓ Precios oficiales: no consultados (solo una reseña de terceros).

## 8. Festivos de Andalucía

✅ **Verificados leyendo el BOJA** y cargados en `packages/core/src/compliance/holidays.ts`: 2026 → Decreto 101/2025
(BOJA 93, 19/05/2025); 2027 → Decreto 84/2026 (BOJA 84, 05/05/2026). Traslados incluidos. Quedan fuera las dos fiestas
locales de cada municipio (BOJA 79, 27/04/2026) y los calendarios de otras comunidades.

---

## Lo que necesito del promotor para cerrar F0.9

1. **D-14:** decidir cómo tratar el prefijo 400 (propuesta en `decisions.md`) y trasladar la pregunta al asesor.
2. **D-15 y D-16:** qué rutas probar en OpenRouter y si se contrata el plan Business (DPA, región UE).
3. **D-08:** autorizar el alta en Lista Robinson (tarifa bonificada) cuando se acerque F4.
4. Una **cuenta de Twilio con la subcuenta «Growth»** para medir la latencia de ConversationRelay (F5.1) y consultar el
   precio de ConversationRelay y la disponibilidad de números 400.

Fuentes (todas el 31/10/2026): platform.claude.com (precios y skill `claude-api`); openrouter.ai/docs, /api/v1/models,
/privacy y /docs/faq; twilio.com/docs/voice/conversationrelay, /en-us/guidelines/es/regulatory, /en-us/voice/pricing/es;
boe.es (BOE-A-2026-8409); listarobinson.es/empresas; resend.com/docs; BOJA 93/2025 y 84/2026; aftership.com (Correos).
