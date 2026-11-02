# F1 — Investigación y fichas (MVP de datos)

**Estado:** **aprobada por el promotor el 31/10/2026 con los valores por defecto** (solo adaptador `openrouter`; fuentes OSM + `web_search` + web corporativa; verticales D-11 por defecto; 5 €/día). Pendientes para más adelante: persona que anota el conjunto dorado, clave `OPENROUTER_API_KEY` y tope de pruebas reales (solo F1.10 y contrato real) · **Fecha:** 31/10/2026 · **Puerta:** G1 · **Duración estimada:** 2 sprints

## Objetivo

Construir la tubería que, dado un segmento y un territorio, **descubre empresas, las enriquece con evidencias verificables,
las normaliza, deduplica y puntúa, y las pasa por revisión humana**, hasta tener un **piloto de 200 empresas de la provincia
de Sevilla** (2–3 verticales A) con cada dato respaldado por su fuente. **No se contacta a nadie**: ni carta, ni llamada, ni
email. Al cerrar la fase existe la pasarela de LLM (ADR-005) que usarán todas las fases siguientes.

## Requisitos (CA copiados de `requirements.md`; los REQ largos se citan por su ID)

**Mercado y descubrimiento**
- **REQ-MKT-02 (M)** — CA1: cada segmento cita URLs consultadas; el encaje es `inferred` con razonamiento. CA2: los segmentos
  quedan en `draft` hasta que marketing los aprueba o edita.
- **REQ-MKT-03 (M)** — dimensionamiento por segmento y territorio con fuentes estadísticas, separando lo **contado** de lo **estimado**.
- **REQ-RES-01 (M)** — CA1: solo se consultan fuentes de `allowed_sources` activas; cualquier otra petición se rechaza y se
  registra. CA2: un trabajo nunca supera su lote máximo (por defecto 200) ni el presupuesto diario de búsqueda/LLM. CA3: es
  reanudable tras un corte y se puede pausar/cancelar desde el panel. CA4: avance, coste acumulado y errores por fuente con
  refresco ≤ 10 s.
- **REQ-RES-02 (M)** — fuentes ordenadas por fiabilidad; cada adaptador declara licencia, límites y campos almacenables. CA1: de
  Google Places solo `place_id`. CA2: los datos de OpenStreetMap llevan atribución ODbL en la ficha.
- **REQ-RES-03 (M)** — ante fallo/429/bloqueo: registrar motivo, espera exponencial (máx. 3 intentos) y seguir con las demás tareas.

**Enriquecimiento, verificación y puntuación**
- **REQ-ENR-01 (M)** — máx. 6 páginas por web, rastreador propio (robots.txt, 1 petición/s por dominio, `User-Agent`
  identificable), extracción con **salida estructurada**. CA1: cada campo crea una `evidence` con URL, fecha, fragmento literal
  (≤ 300 caracteres) y `provenance`. CA2: si el fragmento literal no aparece en el HTML descargado, el campo se descarta.
  CA3: no se guardan nombres de personas, salvo la razón social. CA4: el contenido web va al modelo como dato delimitado, con
  instrucción de ignorar órdenes que contenga.
- **REQ-ENR-02 (M)** — señales de encaje del segmento, cada una con evidencia. **REQ-ENR-03 (M)** — clasificar canales de contacto
  (`switchboard_phone`, `mobile_phone`, `generic_email`, `personal_email` —se descarta—, `postal_address`, `web_form`, `booking_url`).
- **REQ-VER-01 (M)** — normalizar teléfono (E.164), dominio registrable, nombre, dirección y código INE. CA1: teléfono no
  normalizable ⇒ `not_callable`. CA2: se comprueba que la web responde (2xx/3xx) y que el email genérico tiene MX; los fallos se anotan.
- **REQ-VER-02 (M)** — antes de crear una ficha, buscar duplicados por dominio, teléfono y nombre normalizado + municipio (incluidas
  archivadas), `suppressions` y `turnosala_customers`. CA1: coincidencia ⇒ se fusiona la evidencia, no se crea otra. CA2: cliente
  de TurnoSala u oposición ⇒ ficha `blocked` con motivo.
- **REQ-VER-03 (M)** — `legal_form` (`company`|`sole_trader`|`public_body`|`unknown`) con evidencia; `unknown` se trata como `sole_trader`.
- **REQ-SCO-01 (M)** — puntuación 0–100 con función **pura** de `packages/core` (pesos por defecto 25/20/15/15/10/10/5). CA1: guarda
  versión del modelo, desglose y razonamiento de ≤ 2 líneas con URLs. CA2: `hot` ≥ 75 · `warm` 50–74 · `nurture` < 50. CA3: el LLM
  solo extrae señales; el número lo calcula el código.

**Revisión**
- **REQ-REV-01 (M)** — ficha con datos, mapa, señales, puntuación y desglose, evidencias enlazadas, canales permitidos (resultado de la
  puerta por canal), historial y siguiente mejor acción. **REQ-REV-02 (M)** — cola por lotes con atajos. CA1: aprobar no envía
  nada. CA2: se resaltan los campos `inferred`. CA3: muestreo de calidad: se propone revisar al menos el 10 % de cada lote al azar.
  **REQ-REV-03 (M)** — exportación CSV de fichas aprobadas, sin datos personales.

**Acceso a modelos (ADR-005)** — **REQ-LLM-01…04 (M)** y **REQ-LLM-05 (S)** (ver `requirements.md` §20); **REQ-OBS-01 (M)**: coste
por proveedor, campaña y día, con bloqueo al superar el presupuesto.

## Contexto real (comprobado el 31/10/2026)

| Dato | Estado |
|---|---|
| Fase anterior | F0 completada y G0 concedida; 233 tests y 6 e2e en verde; sin `push` ni CI real todavía |
| Tablas ya creadas | `segments`, `territories` (**vacía**), `allowed_sources` (9 fuentes, **todas inactivas**), `prospects`, `contact_points`, `robinson_checks`, `usage_costs`, `settings`, `audit_log` y las de contacto |
| Tablas que faltan (migración 0006) | `evidences`, `prospect_sources`, `research_jobs`, `research_tasks`, `turnosala_customers`; FK de `contact_points.evidence_id` → `evidences` |
| Dependencias | **No instaladas:** `pg-boss`, `libphonenumber-js`, `cheerio`, `undici`, `robots-parser`, `tldts`, Tailwind/shadcn. `apps/worker` y `packages/ai` son esqueletos |
| LLM | Ningún cliente real escrito. Proveedor por defecto: **OpenRouter** (D-15); `anthropic` directo solo para Batch y Haiku. `OPENROUTER_API_KEY` **no existe aún** |
| Presupuesto | D-03 mínimos: LLM **5 €/día**, búsqueda 2 €/día, 150 €/mes |
| Datos de partida | `product_facts` v1 de TurnoSala aprobado; ningún segmento ICP creado |
| Condiciones de la **primera ejecución con webs reales** | **D-16** (contrato y región de OpenRouter) y **D-13** (lista de clientes cargada). El desarrollo usa datos de prueba y fixtures |
| Fuentes (`research/fuentes.md`) | OSM y `web_search` y web corporativa: condiciones claras. **REGCESS: licencia sin confirmar** (falta una muestra del fichero y su aviso legal) |

**Estimación de coste, sin medir** (hipótesis para validar en F1.10): Opus 5.5 a 4 $/20 $ por millón de tokens; ~6 páginas ≈ 20.000
tokens de entrada y ~3.000 de salida con razonamiento ⇒ ≈ 0,14 $ por ficha ⇒ **≈ 28 $ por 200 fichas**. Con el tope de 5 €/día
caben ≈ 35 fichas al día: **el piloto tardaría ≈ 6 días** salvo que se suba el presupuesto (decisión del promotor).

## Diseño

Se sigue `design.md` §4–§5. Diferencias y concreciones de F1:

- **Pasarela de LLM** (`packages/ai`): interfaz de rutas y capacidades de `design.md` §4.1. **En F1 solo se implementa el adaptador
  `openrouter`** (HTTP directo, sin SDK de LLM, con `require_parameters`, `data_collection: "deny"` y endpoint UE configurable).
  El adaptador `anthropic` **se aplaza** hasta que una ruta lo necesite (Batch, Haiku en voz/clasificación: F5–F6) por YAGNI; la
  interfaz se prueba con un proveedor **de pruebas** para demostrar que son intercambiables.
- **Ajustes nuevos** (`settings`, migración 0006): `llm_routes`, `llm_enabled_providers` (`["openrouter"]`), `llm_dpa_confirmed`
  (vacío: bloquea `production`), precios versionados por modelo.
- **Colas** (`apps/worker`, `pg-boss`): `market.analyze`, `market.size`, `discovery.task`, `enrich.site`, `enrich.extract`, `verify`,
  `dedupe`, `score`. Una cola idempotente por etapa con estado por registro; `research_tasks` guarda el cursor para reanudar.
- **Web** (`apps/web`): se **introducen Tailwind y shadcn/ui** (aplazados en F0): páginas de segmentos, trabajos de investigación
  (avance cada ≤ 10 s por sondeo), ficha de empresa, cola de revisión con atajos de teclado y exportación CSV.
- **Fuentes activables en el piloto:** `osm`, `web_search`, `corporate_web` y `ine` (solo recuentos). `regcess` solo si su licencia
  se confirma con una muestra. Activar una fuente = acción de `admin` con `audit_log`. `google_places`, registros autonómicos y
  contratación pública **no** se tocan.
- **Veto de dominios** (P2.6) aplicado **en código** sobre toda URL devuelta por búsqueda, además del filtro del proveedor.
- **Territorios:** se carga el nomenclátor de municipios INE de **Sevilla** (código, nombre, provincia, comunidad, población) en `territories`.
- **Atribución ODbL** en la ficha cuando haya evidencias de OpenStreetMap.

## Tareas

Orden: **F1.1** → (F1.2, F1.3, F1.6 en paralelo) ; F1.4 → F1.5 → F1.6 → F1.7 → F1.8 → F1.9 ; F1.10 tras F1.6. Cada tarea: test primero.

| # | Tarea | Verificación (la ejecuta el agente; nada se da por hecho sin ella) |
|---|---|---|
| F1.1 | Pasarela de LLM + adaptador `openrouter` + migración 0006 (ajustes) + **T-ARQ-LLM** | Pruebas de contrato con servidor HTTP simulado: envía `require_parameters` y `data_collection: "deny"`; **se niega** a ejecutar una ruta cuya capacidad no tiene el proveedor; descarta un modelo servido fuera de `allowedModels`; normaliza rechazo/truncado (`finish_reason`); registra proveedor, modelo pedido y servido, tokens, coste y fallback en `usage_costs`; bloquea antes de la llamada si se agotó el presupuesto; no llama a un proveedor no habilitado. T-ARQ-LLM con fixtures de violación (SDK de LLM y URLs de proveedor fuera de `packages/ai`) |
| F1.2 | `market.analyze`: segmentos ICP desde la web del producto + `product_facts`, con vista de aprobación | Esquema Zod de salida; segmentos en `draft`; cada uno con URLs y encaje `inferred` con razonamiento (CA1–CA2); la aprobación exige rol `marketing`/`admin` y queda en `audit_log`; salida del modelo inválida ⇒ error, no segmento |
| F1.3 | `market.size` + carga de municipios INE de Sevilla | Recuentos de la API de INEbase con fixtures grabadas; el desglose por municipio separa «contado» de «estimado»; la fuente y su licencia quedan anotadas |
| F1.4 | `research_jobs`/`research_tasks` con `pg-boss`, reanudables, pausa/cancelación y panel de avance | Test de corte: matar el worker a mitad y reanudar sin duplicar; el lote máximo (200) y el presupuesto frenan el trabajo; pausa/cancelación efectivas; el panel refresca ≤ 10 s (e2e) |
| F1.5 | Adaptadores de fuentes: OSM (Overpass), `web_search` (vía pasarela), web corporativa; `regcess` solo con licencia | Fuente inactiva ⇒ petición rechazada y registrada (CA1); 429/5xx ⇒ máx. 3 intentos con espera exponencial y el trabajo sigue (RES-03); `User-Agent`, caché y un solo hilo en Overpass; atribución ODbL; URLs vetadas descartadas; fixtures grabadas, **sin red en CI** |
| F1.6 | Rastreador propio + extracción estructurada con **verificación literal**, señales y canales | `robots.txt` respetado; 1 petición/s por dominio; ≤ 6 páginas; fragmento que no aparece en el texto ⇒ campo descartado y contado como `hallucination_rejected`; **nombres de personas descartados**; fixtures de **inyección de prompts** en el HTML no cambian el resultado ni la ficha; `personal_email` descartado |
| F1.7 | Normalización, verificación y deduplicación (contra fichas, `suppressions` y `turnosala_customers`) | Casos de normalización de teléfonos/dominios/nombres/INE; teléfono inválido ⇒ `not_callable`; duplicado por dominio, teléfono o nombre+municipio ⇒ fusión de evidencias; cliente u oposición ⇒ `blocked`; `unknown` tratado como `sole_trader`; MX y HTTP comprobados con dobles |
| F1.8 | Puntuación pura y versionada (`packages/core/scoring`) | Determinista y reproducible; umbrales `hot`/`warm`/`nurture` en sus límites exactos; el desglose suma el total; pesos por segmento; el LLM nunca aporta el número |
| F1.9 | Ficha y cola de revisión con atajos y muestreo del 10 %; exportación CSV | e2e: aprobar/corregir/descartar/bloquear con teclado; aprobar **no** crea ningún contacto; campos `inferred` resaltados; el muestreo propone ≥ 10 %; el CSV no trae datos personales; solo fichas `approved` son exportables |
| F1.10 | Conjunto dorado de 50 webs anotadas a mano y `npm run eval:extract` (`--route`, `--model`) | La precisión de campos y la tasa de rechazo literal se calculan y se imprimen; ≥ **90 %** de precisión; coste por ficha **medido** y comparado con la estimación |

## Plan de pruebas

Un test por cada CA (incluidos los negativos): `tests` de núcleo en Vitest (normalización, dedupe, puntuación, verificación literal),
integración con Postgres efímero (colas, reanudación, dedupe contra la BD), contrato de la pasarela con servidor simulado, e2e Playwright
del flujo «lanzar trabajo → ver avance → revisar → aprobar → exportar» con datos de prueba, y la evaluación del conjunto dorado
(`eval:extract`). **Ninguna prueba de CI usa la red ni gasta dinero**; las pruebas reales llevan la etiqueta `contract` y requieren
aprobación expresa del gasto (P6.2).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **REGCESS sin licencia confirmada** (la fuente principal de las verticales A1–A3) | El piloto arranca con OSM + web corporativa + `web_search`; REGCESS se activa solo tras comprobar la muestra y su aviso legal |
| OpenRouter ignora parámetros no soportados / el modelo cambia por fallback | `require_parameters: true`, lista cerrada de modelos y registro del modelo servido (REQ-LLM-02/04) |
| Texto de webs con nombres de personas enviado a un tercero | D-16 antes de la primera ejecución real; descarte de nombres en el código y `data_collection: "deny"` |
| Inyección de prompts desde una web | Contenido delimitado como dato, salida validada con Zod, verificación literal y fixtures de ataque |
| El presupuesto de 5 €/día alarga el piloto (~6 días) | Se mide el coste real en F1.10; el promotor decide si sube el tope |
| Cobertura de OSM pobre para clínicas | Se mide en F1.5 y se informa; `regcess` o fuentes autonómicas pasan a ser prioritarias |
| `pg-boss`, Tailwind y shadcn añaden superficie | Se instalan en la tarea que los necesita, con test, y se anotan en «Aprendizajes» |

## Aprendizajes

- **Cambio de modelo a GPT-6 Luna (02/11/2026, decisión del promotor)** — migración 0015: `market.analyze`, `market.size`, `discovery` y `enrich.extract` pasan a `openai/gpt-6-luna` (unas 40 veces más barato que Opus 5.5); precios en `llm_prices`; la `effort` sigue sin enviarse. Test en `pg-store.test.ts`. Datos de prueba del entorno local borrados el mismo día.
- **Búsqueda con GPT-6 Luna sin citas (02/11/2026)** — con el motor nativo no llegan `url_citation` y `discovery` no aceptaría ninguna web. Nuevo ajuste opcional de ruta `searchEngine` (lo aplica la pasarela; quien pide la ruta no lo elige) enviado como `parameters.engine`; migración 0016 pone `exa` en `discovery`. Tests en adaptador, pasarela y ajuste sembrado.
- **Esquemas estrictos y OpenAI (02/11/2026)** — el análisis de mercado falló con `bad_request`: OpenAI (vía OpenRouter, servido por Azure u OpenAI) rechaza tuplas en `json_schema` estricto (`array schema items is not an object`); Opus las admitía. `osm_filters` pasa a objetos `{key, value}` en la salida del modelo y se sigue guardando como `[clave, valor]`. Test que impide `prefixItems` en el esquema. El de extracción (`ficha_empresa`) se probó contra el modo estricto real y es válido. **Regla:** todo esquema que vaya a un modelo, sin tuplas ni uniones de tipos raras.
- **Mercados sugeridos y más segmentos (02/11/2026, petición del promotor)** — el análisis solo daba 5 segmentos (máximo 8, prompt sin pedir variedad, sin forma de sugerir). Ahora: campo «Mercados que quieres que estudie» (hasta 10, `parseMarketHints` en `core`), que viaja en la carga del trabajo y llega al modelo entre `<mercados_sugeridos>` como datos neutralizados; se piden 8–15 segmentos de sectores variados y uno por mercado sugerido con encaje honesto aunque sea bajo; máximo del esquema 15. Las fuentes siguen siendo solo páginas de la web del producto (CA1).
- **Fuente Google Places (02/11/2026, D-19)** — `connectors/sources/google-places.ts`: Text Search (New) con máscara mínima, hasta 3 páginas, reintentos de `withRetry`; cada sugerencia se confirma abriendo su web (`matchBusiness` con nombre y municipio, sin nombres de persona, sin redes ni directorios). La búsqueda es el **nombre del segmento** (`searchQuery` en `SourceRequest`). Activación con `local:maps-on`; migración 0017 anota condiciones y precios. Las búsquedas por segmento con nombres largos pueden dar menos resultados: si pasa, añadir una búsqueda propia al segmento.
- **Auto-blindaje:** no encadenar `npm run ci … | tail` con `&&` para decidir un commit (el código de salida es el de `tail`): redirigir a un fichero y mirar `$?`. Y no usar `node -e` con plantillas de texto (comillas invertidas) dentro de comillas de bash: usar la herramienta de edición.
- **PowerShell 5.1 se come el `--`** de `npm run <script> -- --opción` (el atajo `npm.ps1`): la opción no llega al script. Funcionan `npm run <script> '--' --opción` y `npm.cmd run <script> -- --opción`. Anotado en `deploy/LEEME-LOCAL.md`.

- **F1.1 completada (31/10/2026)** — `packages/ai`: pasarela (`createGateway`), adaptador `openrouter` (HTTP directo con `fetch`, sin SDK),
  tienda sobre Postgres (`createPgLlmStore`), migración 0006 con las 8 rutas y **T-ARQ-LLM** (escáner de SDK y URL de LLM fuera de
  `packages/ai`, con 6 fixtures de violación y comprobado con una violación real plantada). 299 tests en verde; 8 mutaciones de la
  pasarela y del adaptador detectadas. **Ninguna prueba usa la red ni gasta dinero**: servidor HTTP simulado.
- **F1.1 — Falla cerrado en todo:** sin configuración (`no_config`), sin poder leer el gasto (`budget_unknown`), sin poder registrar el
  uso (`usage_not_recorded`), proveedor no habilitado, contrato de encargo ausente en `production`, capacidad no soportada, modelo
  servido fuera de la lista, salida que no cumple el esquema. El mensaje de una excepción del proveedor nunca se propaga (puede
  llevar datos del prompt) y el registro de uso **no guarda contenido de mensajes ni respuestas**.
- **F1.1 — Error corregido en código de F0:** `dayStartMadrid` (inicio del día para el presupuesto, CG-04) restaba horas de reloj y se
  equivocaba **una hora los dos días del año con cambio de hora**. Se reescribió por bisección sobre el reloj local, se movió a
  `packages/core` y se probó con los días 29-mar-2026 (23 h) y 25-oct-2026 (25 h).
- **F1.1 — Qué NO está verificado (necesita la clave `OPENROUTER_API_KEY` y una prueba de contrato real, con gasto aprobado):**
  (1) que el modelo servido llegue como `anthropic/claude-opus-5.5` o con `[1m]` (`allowedModels` admite ambos); (2) que
  `provider.require_parameters`/`data_collection` no dejen la ruta sin proveedor disponible para ese modelo (si fuera así, saldría
  `unavailable`, no un contacto indebido); (3) **el parámetro de esfuerzo**: la documentación de OpenRouter lo expone como `reasoning`,
  pero en la API directa Opus 5.5 rechaza `budget_tokens`; por eso **`effort` está guardado y no se envía**; (4) que un esquema de
  `z.toJSONSchema` cumpla el modo estricto; (5) que `usage.cost` («créditos») equivalga a USD: `usd_to_eur = 1` sobrestima el gasto
  hasta tener un cambio real; (6) el camino de la región UE (`eu.openrouter.ai`), que depende de D-16; (7) los límites de peticiones.
- **F1.8 completada (31/10/2026)** — `packages/core/src/scoring`: función pura con el modelo v1 (pesos 25/20/15/15/10/10/5 y criterios del §4 de
  los documentos de ventas). Por criterio cuenta **solo la señal más fuerte** y cada señal una vez; las desconocidas se ignoran y se devuelven.
  Redondeo al entero más cercano con .5 hacia arriba; umbrales comprobados en 0/1/49/50/51/74/75/76/100. El razonamiento son ≤ 2 líneas con
  hasta 3 URL. 25 tests, 5 mutaciones detectadas. **El mapa señal → criterio es mío** (propuesta razonable, no un dato del promotor): se
  guardará en `segments.definition` al aprobar cada segmento (F1.2) y se recalibrará con resultados reales (REQ-SCO-02, F7).
- **F1.7 completada (31/10/2026)** — migración 0007 (`evidences`, `prospect_sources`, `turnosala_customers`, `contact_points.invalid_reason`);
  `core/normalize` (teléfono E.164 con `libphonenumber-js`, dominio registrable con `tldts`, nombre, dirección, municipio, forma jurídica y
  similitud de trigramas **idéntica a `pg_trgm`**, comprobada contra la propia BD), `core/dedupe` (decisión pura), `core/verify` (web 2xx/3xx
  y MX con puertos) y, en `db`, `ingestCandidate`, `importTurnosalaCustomers` y `annotateVerification`. 438 tests en total; 9 mutaciones detectadas.
- **F1.7 — Decisiones mías (revisables):** (1) la ingesta se **serializa con un cerrojo global** de transacción: evita duplicados bajo concurrencia
  (probado con 5 ingestas simultáneas) a costa de procesar de una en una; suficiente para cientos de fichas, revisar si F1.4 usa muchos
  workers; (2) para identificar a una empresa solo valen teléfonos **fijos o móviles válidos** (un 902 lo comparten cadenas enteras);
  (3) una red social, un directorio o un acortador **no es el dominio de la empresa** (`domain = null`), y plataformas como `wixsite.com`
  conservan el subdominio; (4) el umbral de nombre es 0,8 dentro del mismo municipio y 0,9 contra clientes; (5) un cliente o una oposición
  **bloquean** la ficha con motivo y dejan constancia en `audit_log`; si la ficha ya existía, es esa la que pasa a `blocked`.
- **F1.7 — Limitaciones conocidas:** si una fuente añade la ciudad al nombre («… sol sevilla») la similitud (≈ 0,74) queda por debajo del
  umbral y no se fusiona solo por nombre (lo cazan el dominio, el teléfono o el revisor); dos empresas en subdominios del mismo dominio
  registrable se fusionan; el nombre muy parecido a un cliente bloquea aunque sea otra empresa (queda visible con motivo para revisión).
  Los adaptadores reales de HTTP (con `robots.txt` y 1 req/s) y de DNS para `checkWebsite`/`checkEmailMx` se escriben con el rastreador (F1.6);
  la clasificación de emails genéricos/personales (REQ-ENR-03) también va en F1.6.
- **Worker y pantallas de investigación (31/10/2026) — cierre operativo de F1.4/F1.2** — `apps/worker` (`tick`, `main`, `config`), migración 0010, `db/worker-queue`, rutas
  `/api/investigacion/*` y `/api/analisis`, pantalla `/investigacion` y botón «Pedir análisis de mercado» en `/segmentos`, `deploy/Dockerfile.worker`, 7 e2e nuevos (22 en total).
  **Decisiones mías (revisables):** (1) **el panel no llama al modelo ni a las fuentes**: encola (`research_jobs`, `worker_requests`) y el worker ejecuta; así las claves solo viven
  en el worker. (2) **El gasto en IA está APAGADO por defecto**: sólo `ENRICH_ENABLED=1` (valor exacto) lo enciende y entonces exige `OPENROUTER_API_KEY`. Con él apagado el worker sigue
  investigando con fuentes abiertas (coste 0) pero no enriquece ni atiende análisis, y la pantalla lo dice. (3) **Una sola instancia** del worker (cerrojo de sesión de Postgres). (4)
  **Enriquecimiento con reintentos acotados**: 3 intentos con espera 1 h / 6 h / 24 h; un fallo del sistema (presupuesto agotado, proveedor deshabilitado, falta de DPA…) para el lote y **devuelve
  los intentos** (no se queman los reintentos de las fichas por un problema ajeno a ellas). (5) **Una fuente caída no se golpea 9 veces**: el adaptador ya reintenta 3 veces con espera, así que
  un `SourceError` marca la tarea como fallida a la primera (`failTask(..., { final: true })`); lo detectó la prueba con el proceso real. (6) Solo se investiga con **segmentos
  aprobados**, y sus `osmFilters` viajan en cada petición de fuente (mandan sobre los del adaptador). (7) El worker marca un **latido** en `settings`; el panel avisa «Sin señal del worker» pasados
  90 s y se refresca solo cada 5 s mientras haya trabajo (CA4, ≤ 10 s, probado en e2e sin recargar). (8) Máx. 100 € de presupuesto por trabajo desde la pantalla. **Mutaciones:** latido,
  existencia del trabajo, segmento sin aprobar, presupuesto sin tope, análisis duplicado, devolución de intentos, parada ante fallo sistémico, cerrojo, límite de lote, refresco automático y
  `final` ante `SourceError` hacen fallar tests. **Guardianes que acertaron:** T-ARQ-LLM detectó una URL de proveedor en un test mío y el test de `.env.example` un valor `0`; los corregí sin
  tocar los guardianes. **Probado con el proceso real:** el worker arranca, se niega a una segunda instancia (código 1) y, dentro de Docker, escribe su latido y sale con código 0 al parar.
  **Límites:** (a) el enriquecimiento no está atado a un trabajo concreto (su coste no cuenta contra el presupuesto del trabajo, sólo contra el diario de la pasarela); (b) un único worker
  procesa en serie; (c) el worker corre con `tsx` (sin empaquetar); (d) sin mapa ni «siguiente mejor acción» en la ficha todavía.
- **F1.5 completada: búsqueda de la web de las candidatas (01/11/2026)** — `ai` (capacidad `web_search` en el adaptador y la pasarela), `core/discovery/match`, `db/discovery` (migración 0011),
  `apps/worker/discover` + integración en el ciclo, `DISCOVER_ENABLED`, `llm:check --search`. **Documentación consultada el 01/11/2026** (OpenRouter: plugin web / herramienta de servidor
  `openrouter:web_search`). **Decisiones mías (revisables):** (1) se usa la **herramienta de servidor** `openrouter:web_search` con `max_results`, `max_uses` y `excluded_domains`; el
  proveedor devuelve las fuentes en `annotations` (`url_citation`) y las búsquedas en `usage.server_tool_use_details.web_search_requests`. (2) **No se combina con salida estructurada**:
  la documentación no dice que se pueda, así que la ruta `discovery` pasa a exigir solo `web_search` (migración 0011, auditada) y la respuesta es texto + citas. (3) **El modelo sugiere,
  el código decide**: las URL salen solo de las citas del proveedor (no del texto del modelo); se descartan dominios vetados, redes y directorios; se prueban como mucho 3 dominios distintos con
  el rastreador educado (solo la portada); y la web se acepta solo si el texto contiene un **teléfono** de la ficha o **todas las palabras del nombre + la localidad** (`matchBusiness`, función
  pura; palabras genéricas del sector no bastan). (4) La web se guarda como **evidencia inferida** con la línea literal (sin nombres de personas ni emails personales, P2.3), la página y cómo se
  verificó. Un dominio ya usado por otra ficha se rechaza (posible duplicado). (5) Al buscador solo llegan **nombre y localidad**; nunca el teléfono. Un negocio cuyo nombre incluye el de una
  persona no se manda a buscar. (6) Es **otro gasto**: `DISCOVER_ENABLED=1` (exige `ENRICH_ENABLED=1`), lote por ciclo (`WORKER_DISCOVER_BATCH`, 3 por defecto) y **presupuesto diario de búsqueda
  (2 €, D-03) medido sobre el gasto real de la ruta**; al alcanzarlo se para y se **devuelven** los intentos sin usar. Reintentos muy espaciados (7 días, máx. 2). (7) `local:ai-on` enciende ambas cosas
  (`--no-search` solo enriquece). **Mutaciones:** nombre sin localidad, teléfono dentro de un número más largo (delante y detrás), dominios vetados, nombres de personas, más de 3 candidatas, cita sin
  redactar, sobrescribir una web, sin presupuesto, sin devolver intentos y sin límite por ciclo hacen fallar tests; dos de ellas destaparon huecos de mis propios tests, ya corregidos. **SIN VERIFICAR
  contra el servicio real** (necesita la clave; `npm run llm:check -- --search` lo comprueba con una llamada): que el modelo configurado admite la herramienta, que `usage.cost` incluye las búsquedas
  y el coste real por búsqueda, y la tasa de acierto (qué fracción de las 13 candidatas sin web de Sevilla se resuelve). El campo `servedModel` de las respuestas con búsqueda tampoco está probado.
- **Entorno local en Docker (31/10/2026)** — `deploy/docker-compose.local.yml`, `scripts/local.ts` (`npm run local:init|up|down|logs|status|ai-on|ai-off|reset`), `scripts/llm-check.ts`
  (`npm run llm:check`), `scripts/lib/envfile.ts`, `db/sources.ts` (`setSourceActive`, auditado) y `deploy/LEEME-LOCAL.md`. **Decisiones mías (revisables):** (1) proyecto Compose y base de
  datos **propios** (puerto 5434, volumen aparte): no tocan los de las pruebas automáticas (5433). (2) `APP_MODE=sandbox` **fijo** en el compose local, puertos solo en `127.0.0.1`, secretos generados
  en `deploy/.env.local` (fuera de git y de Docker) y **nunca impresos**; `init` es repetible y no pisa lo que la persona ya puso (clave de API). (3) La IA arranca **apagada**; `local:ai-on` exige
  la clave y `llm:check` hace una llamada real mínima antes (valida clave, modelo de la ruta, salida estructurada y coste), sin ejecutarse nunca por su cuenta. (4) `--demo-segment` crea un segmento
  de prueba **definido a mano y etiquetado como tal** (no del modelo) para poder validar las fuentes sin clave. (5) Activar una fuente (`allowed_sources`) exige actor y motivo y queda en `audit_log`.
  **Lo que la prueba real destapó:** (a) **error mío**: el adaptador de OpenStreetMap buscaba el municipio por la etiqueta `ref:ine`, programada de memoria; la real es **`ine:municipio`**
  (comprobado contra Overpass). Con `ref:ine` toda investigación devolvía 0 candidatas sin dar error. Corregido (unión de ambas etiquetas) y el test ahora exige la verificada. Lección: los datos
  externos no se programan de memoria (CLAUDE.md). (b) **Cobertura**: en Sevilla (dentistas, ópticas, fisioterapia) salieron 17 fichas y **solo 4 con web** (24 %): el enriquecimiento necesita web,
  así que `web_search` (pendiente de F1.5) deja de ser opcional para encontrar la web del resto. (c) Una consulta a Overpass de un municipio grande tarda **~35–60 s**. **Probado:** init completo en
  Docker, repetido sin romper nada, inicio de sesión real, pantallas con sesión y redirección sin ella, trabajo real de punta a punta (panel → worker → Overpass → fichas con atribución y fuente).
- **F1.10 — arnés preparado, medición PENDIENTE (31/10/2026)** — `core/eval/golden` (esquema de anotación y métricas puras), `apps/worker/eval` + `golden-files` (ejecución y carga),
  `npm run golden:snapshot` y `npm run eval:extract` (`--route`, `--model`, `--max-eur`, `--dir`, `--dry-run`) y la guía `tests/golden/README.md`. **No se ha ejecutado ninguna
  evaluación real: no hay anotaciones, clave ni gasto aprobado, y la puerta de ≥ 90 % sigue sin medirse.** **Decisiones mías (revisables):** (1) se anota sobre una
  **instantánea congelada del texto ya minimizado** (sin nombres de personas ni emails personales), para que la persona y el modelo vean exactamente lo mismo y el resultado sea
  reproducible; las instantáneas son texto de terceros y quedan **locales y fuera de git**, solo se versionan las anotaciones (`tests/golden/entries/`). (2) **Precisión** =
  aciertos / devueltos sobre campos + señales + contactos + forma jurídica, en micro-promedio (se suman los recuentos de todas las fichas, no se promedian porcentajes) y medida
  sobre lo que **sobrevive a la verificación literal**; la **tasa de rechazo literal** (citas inventadas descartadas / propuestas) se informa aparte. La puerta (≥ 90 %) se compara
  con enteros (27/30 = 90 %) para que no dependa de la coma flotante, y sin ninguna respuesta no se supera. (3) La anotación debe ser **exhaustiva**: lo que la web dice y no se
  anota cuenta como error del modelo. (4) `--model` sustituye el modelo de la ruta solo en memoria (y lo permite para esa ejecución); la configuración de la BD no cambia.
  (5) `--max-eur` (por defecto 5) corta la ejecución al alcanzar el gasto acumulado; `--dry-run` valida las anotaciones sin llamar al modelo. (6) `--provider` (design §11) no
  existe aún: solo hay adaptador `openrouter` (ADR-005). **Mutaciones:** puerta al 80 %, pasar sin datos, promediar mal, no normalizar valores, sin tope de gasto, aceptar
  entradas sin anotar y aceptar un id distinto del archivo hacen fallar tests. **Para cerrar F1.10 hace falta:** 50 webs anotadas por una persona (2–3 h), `OPENROUTER_API_KEY` creada
  por ti fuera del chat, D-16 (contrato y región de OpenRouter) y un tope de gasto aprobado (propongo ≤ 10 €); con eso, `npm run eval:extract` mide la precisión, la tasa de rechazo y
  el coste real por ficha (la estimación de ≈ 0,14 $/ficha es una hipótesis sin medir).
- **F1.9 completada salvo mapa y canales (31/10/2026)** — `core/review` (muestreo y CSV seguro), `db/review` (cola, ficha, aprobar/descartar/bloquear, corregir, aprobación
  en bloque, exportación), `apps/web` (rutas `/api/fichas/*` y `/api/segmentos/*`, pantallas `/fichas`, `/fichas/[id]`, `/segmentos`) y 9 e2e nuevos. **Decisiones
  mías (revisables):** (1) **sin Tailwind ni shadcn/ui por ahora**: el panel sigue con estilos en línea; una librería de UI no aporta a ningún criterio de aceptación de
  F1.9 y se introducirá cuando la interfaz crezca (F2). (2) Revisar (aprobar, descartar, bloquear, corregir, aprobar en bloque, aprobar/retirar segmentos) exige rol
  `marketing`/`admin`; la comprobación está en servidor (origen exacto, JSON, sesión y rol) **y** otra vez en la capa de BD (defensa en profundidad). `sales`, `auditor` y
  `voice` no revisan; pueden exportar, salvo `voice`. (3) **Aprobar no contacta con nadie**: probado con e2e y test de BD (cuentan `contact_attempts`, `consents`,
  `compliance_decisions`, `suppressions` antes y después). (4) **Muestreo de calidad obligatorio**: al aprobar en bloque, una muestra al azar de ≥10 % del lote (mínimo 1,
  redondeo hacia arriba) NO se aprueba y queda en la cola para revisarla una a una. Un lote de 1 ficha se queda entero para revisión individual. (5) Estados: se revisa
  `enriched`/`pending_review`; se puede descartar o bloquear también una aprobada (seguridad); bloqueada/descartada/archivada no se reabre. Bloquear guarda
  `block_reason = «manual: <motivo>»`. (6) Corregir solo nombre, web y sedes; deja una evidencia `observed` con origen `revision-manual://<usuario>` y
  `extractor_version = manual-review`, y la auditoría. Una web con dominio ya existente se rechaza (`domain_taken`). (7) **Exportación CSV** solo de fichas `approved`,
  **sin teléfonos ni emails**; autónomos y forma jurídica desconocida (tratada como autónomo) salen **sin nombre, web ni dominio**; las celdas que empiezan por `= + - @`
  se neutralizan contra la inyección de fórmulas de Excel. (8) Las pantallas solo enlazan URL `http(s)` (las evidencias manuales usan otro esquema) con
  `rel="noopener noreferrer"`. (9) `@turnosala/db/web` es un punto de entrada reducido para Next/webpack: el índice completo arrastra `migrate.ts`, que no se
  puede empaquetar. **Mutaciones:** rol abierto, aprobar desde cualquier estado, sin muestra, exportar todo, autónomos con nombre, fórmulas sin neutralizar, redondeo a la
  baja, sin comprobación de origen, exportación a `voice` y atajos activos dentro de un campo de texto hacen fallar tests. **Error que cacé:** el primer test del campo de
  texto usaba `fill()` (no emite teclas) y no detectaba la guarda; ahora usa `pressSequentially`. **Pendiente:** el mapa y los canales permitidos por la puerta (REQ-REV-01)
  llegan con las campañas (F2), y la edición de segmentos tiene API en BD pero aún no pantalla.
- **F1.2 completada salvo la pantalla (31/10/2026)** — `core/market/segments` (esquema, prompt, verificación), `db/segments` (borradores, aprobar, editar, retirar) y
  `apps/worker/analyze` (orquestación). Todo con modelo simulado y web simulada; **sin gasto ni red**. **Decisiones mías (revisables):** (1) el modelo solo propone:
  los segmentos nacen en `draft`, el encaje es siempre `inferred` con razonamiento y solo se aceptan las URL que de verdad se rastrearon (CA1; sin ninguna válida, el
  segmento se rechaza). (2) Aprobar, editar y retirar exigen rol `marketing`/`admin` y quedan en `audit_log`; el encaje y las fuentes (inferidos) **no se editan a mano**.
  (3) Repetir el análisis actualiza los borradores pero **nunca sobrescribe** un segmento aprobado o retirado. (4) Sin `product_facts` aprobados no se llama al modelo.
  (5) El segmento trae `osm_filters` (para el adaptador de F1.5) y `signals` del vocabulario de puntuación; lo que no está en el vocabulario se quita y se informa; los
  filtros OSM con caracteres peligrosos se descartan. (6) **No se analizan competidores todavía**: la ruta `market.analyze` prevé un agente con `web_search`/`web_fetch`, que
  no está verificado contra la API real (pendiente con `web_search`, F1.5); hoy solo lee la web del producto. **Mutaciones:** URLs sin filtrar, cualquier rol aprueba,
  sobrescribir aprobados y aprobar sin comprobar el estado hacen fallar tests. **Pendiente:** la vista de aprobación (pantalla) va con F1.9.
- **F1.3 completada en lo verificable (31/10/2026)** — `core/market/size` (función pura), `db/territories` (carga de municipios por CSV y guardado de dimensionamientos),
  migración 0009 (`market_sizings`) y `npm run territories:import`. **Decisiones mías (revisables):** (1) el modelo **no pone cifras**: `market.size` es código
  determinista, sin LLM. (2) Separa **contado** (recuento oficial por municipio; el 0 cuenta) de **estimado** (total provincial − contado, repartido por población con el
  método del mayor resto, suma exacta) y de **unknown** (sin total provincial o sin población: sin cifra, no suma); nunca produce negativos y avisa si lo contado supera el
  total. (3) Fuente y licencia anotadas en cada resultado: INE/DIRCE, **CC BY-SA 4.0 según el pie de ine.es; el aviso legal de reutilización sigue sin leer**
  (`licenseVerified: false`). **Lo que NO pude verificar:** el identificador de la tabla municipal del DIRCE y su formato de respuesta. Los metadatos del INE que leí
  solo documentan niveles nacional, autonómico y provincial, y el DIRCE municipal suprime celdas con menos de 4 empresas (esas serán «estimadas»). Por eso **no hay
  cliente HTTP del INE**: hace falta localizar la tabla en INEbase (o pedirla al INE) antes de programarlo, y grabar fixtures reales. **Los municipios de Sevilla no están
  cargados**: necesito el CSV del INE (nomenclátor + padrón: `ine_code,name,province,region,population`) o autorización para descargarlo del INE.
- **F1.5 completada solo en parte (31/10/2026)** — `connectors/sources`: contrato común (`SourceAdapter`), reintentos, veto de dominios, caché y adaptador **OSM/Overpass**.
  Fixtures **sintéticas** con la forma documentada de Overpass (no capturas reales); ninguna prueba usa red. **Decisiones mías (revisables):** (1) reintentos
  (RES-03): máx. 3 intentos; 429/406 esperan 30 s (política de Overpass), 5xx/red/tiempo agotado 2 s y 4 s; 403 y respuestas no JSON no se reintentan; al
  fallar, la tarea queda con el motivo y el trabajo sigue (F1.4). (2) Overpass: consulta por `area["ine:municipio"=…]` (corregido el 31/10/2026: antes `ref:ine`; el código INE del municipio), POST con
  `User-Agent` identificable, **un solo hilo** (consultas encadenadas), caché de 24 h por consulta y `out tags center` (no se guardan coordenadas). El
  endpoint es configurable: el público vale para el piloto, **para escalar hace falta servidor propio o de pago** (fuentes.md §3). (3) Cada candidato de OSM lleva
  la evidencia `osm_attribution` («© OpenStreetMap contributors, ODbL 1.0») con enlace a `openstreetmap.org/copyright` (RES-02 CA2). La pregunta jurídica sobre ODbL
  sigue abierta para el asesor (D-04). (4) Emails de OSM: solo genéricos de empresa (el personal se descarta con `classifyEmail`); webs de dominios vetados se
  descartan en código (`VETOED_DOMAINS`: LinkedIn y buscadores de personas; **lista inicial conservadora a revisar con el asesor** y ampliar con los directorios cuyas
  condiciones se lean una a una). (5) Los filtros de etiquetas OSM (p. ej. `healthcare=dentist`, `shop=optician`) los aportará la definición del segmento (F1.2); el
  adaptador los recibe por configuración. (6) El ejecutor del worker resuelve nombre y provincia del municipio desde `territories` y se los pasa al adaptador.
  **Mutaciones:** sin veto, 5 intentos, sin atribución, email personal admitido y sin cola de un hilo hacen fallar tests. **Pendiente de F1.5:** `web_search` vía pasarela
  (requiere añadir la capacidad al adaptador de OpenRouter y verificarla contra la API real: herramienta `openrouter:web_search`, filtro de dominios y coste por búsqueda;
  hasta entonces no se programa de memoria, CLAUDE.md), medir la cobertura real de OSM para clínicas en Sevilla (necesita red) y `regcess` solo si se confirma su
  licencia. La «web corporativa» no es una fuente de descubrimiento: es el enriquecimiento de F1.6.
- **F1.4 completada en lo que no necesita interfaz (31/10/2026)** — migración 0008 (`research_jobs`, `research_tasks`), `db/research.ts` (cola, frenos,
  control, progreso) y `apps/worker/research.ts` (ejecutor con adaptadores de fuente como puerto). **Decisiones mías (revisables):** (1) **sin `pg-boss`**: la
  propia tabla de tareas es la cola (`for update skip locked` + arrendamiento `lease_until`, 10 min). El estado por tarea ya da la reanudación tras un corte
  (CA3) y evita una dependencia y un esquema extra; si más adelante hace falta cron o prioridades se reconsidera. (2) Una tarea cuyo arrendamiento caduca se
  reclama de nuevo; tras 3 intentos se da por fallida (no se reintenta eternamente). (3) Un fallo devuelve la tarea a la cola hasta 3 intentos y el trabajo sigue
  con el resto; el trabajo termina `done` si algo se completó (o se frenó) y `failed` si todo falló. (4) Frenos de CA2: al alcanzar el lote (≤200, restricción en BD)
  o el presupuesto del trabajo se saltan las tareas pendientes y se anota `stop_reason` (`batch_limit`/`budget`); el coste de tareas fallidas también cuenta.
  (5) Solo cuentan como candidatos los **creados**; los fusionados con fichas existentes no. (6) Fuente inactiva ⇒ la creación se rechaza y queda en `audit_log`
  (`research.source_rejected`); pausar/reanudar/cancelar también se auditan. (7) Una tarea en curso que termina tras cancelar el trabajo guarda su resultado pero
  no lo resucita. **Mutaciones:** sin freno de lote, sin barrido de arrendamientos agotados y rollup sobre trabajos cancelados hacen fallar tests; quitar
  `skip locked` no (Postgres reevalúa la fila, es solo rendimiento). **Pendiente de F1.4:** el panel con refresco ≤10 s y los botones de pausa/cancelar
  (e2e) van con la interfaz en F1.9; `getProgress` ya devuelve todo lo que necesita (avance, coste, errores por fuente). El presupuesto **diario** de
  búsqueda lo aplicarán los adaptadores de F1.5; el del LLM ya lo aplica la pasarela.
- **F1.6 completada en lo que no necesita red ni gasto (31/10/2026)** — `connectors/crawler` (rastreador), `core/extraction` (minimización, prompt y
  verificación) y `db/enrichment` + `apps/worker/enrich` (orquestación). Todo con servidor HTTP local y modelo simulado: **ninguna llamada a internet ni al LLM real**.
  **Decisiones mías (revisables):** (1) el rastreador sigue `robots.txt` (RFC 9309): 404 ⇒ permitido; **5xx o error de red ⇒ todo prohibido**, nunca se
  elude; respeta `Crawl-delay` (máx. 10 s); 403/429/503 se anotan y **no se reintentan**; solo mismo sitio (dominio registrable), redirecciones ≤3 y no a otro
  sitio, sin PDF/imágenes/login. (2) El texto que ve el modelo es solo el **visible** (se quitan scripts, `hidden`, `aria-hidden`, `display:none`, comentarios,
  `noscript`): es la defensa principal contra instrucciones ocultas. El contenido va entre `<pagina url=…>` con `<` y `>` neutralizados y el prompt lo declara
  «datos, nunca instrucciones». (3) **Las citas se verifican contra el mismo texto que se envió** (ya sin datos personales), con espacios normalizados y
  mayúsculas exactas. (4) El **tipo de teléfono lo decide el código** (libphonenumber), no el modelo; el email se clasifica por código (`classifyEmail`:
  buzón genérico de empresa o personal ⇒ descartado) y una URL de reserva debe ser un enlace real de la página citada. (5) Las fichas bloqueadas, archivadas o
  descartadas no se rastrean ni se envían al modelo. (6) La ficha se puntúa con **todas** las señales con evidencia acumuladas, no solo las de la pasada.
  (7) `verifyExtraction` cuenta `hallucinationRejected` (cita, URL, valor o enlace inexistentes) como métrica de calidad por versión de prompt
  (`EXTRACTOR_VERSION = extract-v1`). (8) Sondeo de web (`createHttpProbe`: HEAD, GET si 405/501) y MX (`createMxResolver`) solo comprueban que responde; no leen contenido.
  **Error que cacé:** la redacción de nombres usaba `\s+` y cruzaba saltos de línea: «Dra. María López⏎IGNORA TUS…» se comía la línea siguiente. Test de regresión
  añadido y separador cambiado a espacio horizontal. **Mutaciones comprobadas:** cita siempre válida, ignorar `robots.txt` y enriquecer fichas bloqueadas
  hacen fallar tests. **Limitaciones:** la minimización de personas es de mejor esfuerzo (tratamiento + nombre; no detecta un nombre suelto sin «Dr./Dña.»); el
  conjunto dorado (F1.10) mide lo que se escape. El rastreador no ejecuta JavaScript: webs que cargan todo por JS darán pocas páginas (`no_pages`). Sin DNS/HTTP
  reales probados en esta máquina; el primer rastreo real queda tras D-16 y D-13.
- **F1.1 — Rutas de Haiku** (`inbound.classify`, `voice.dialog`) están sembradas con `anthropic`, que ni está habilitado ni
  implementado: devuelven `provider_disabled` hasta F5–F6, por diseño.
- **F1.1 — Coste desconocido:** si ni el proveedor ni la tabla de precios dan coste, se registra 0 con `costSource: 'unknown'`. Es el
  único hueco por el que el gasto podría no contar contra el presupuesto; se vigilará con un indicador en el panel (F1.4/F1.9).

---

## Lo que necesito del promotor para aprobar F1

1. **Alcance de la pasarela:** ¿de acuerdo con implementar solo el adaptador `openrouter` en F1 y dejar `anthropic` para cuando lo pida una ruta (Batch/Haiku, F5–F6)?
2. **Fuentes del piloto:** ¿OSM + `web_search` + web corporativa, y REGCESS solo si se confirma su licencia?
3. **Verticales (D-11):** ¿policlínicas y clínicas dentales multiconsulta, ópticas con gabinete y fisioterapia (propuesta por defecto)?
4. **Conjunto dorado:** 50 webs **anotadas a mano por una persona** (unas 2–3 horas): ¿quién lo hace? No puede hacerlo el modelo, sería circular.
5. **Gasto de pruebas reales:** autorizar un tope de pruebas con el LLM real (propongo ≤ 10 € en total para F1.1 y F1.10) y crear la clave `OPENROUTER_API_KEY` **tú**, fuera del chat.
6. **Presupuesto del piloto:** ¿se mantienen 5 €/día (≈ 6 días de piloto) o se sube temporalmente?
7. **Antes de la primera ejecución con webs reales:** D-16 (contrato de OpenRouter) y D-13 (lista de clientes).
