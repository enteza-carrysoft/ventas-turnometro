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
