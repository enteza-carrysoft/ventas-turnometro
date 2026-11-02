# Fuentes de datos — licencia, formato y acceso (F0.4)

**Fecha de la comprobación:** 31/10/2026 · **Estado:** borrador para revisión del promotor · **Responde a:** REQ-RES-02,
`design.md` §5, F0.4.

Leyenda: ✅ comprobado en la página oficial citada · ⚠️ comprobado en parte o solo en fuente secundaria · ❓ **no se pudo
confirmar** (qué falta y quién lo cierra). **Todas las fuentes siguen `active = false` en `allowed_sources`** hasta que el
promotor las apruebe en G0; esta nota no activa nada. No se ha descargado ni rastreado ningún dato real.

Resumen: de las 9 fuentes del diseño, **2 tienen condiciones claras** (OpenStreetMap, `place_id` de Google), **7 necesitan
una comprobación manual o una aclaración** antes de activarse. La mayor incertidumbre es la **licencia de los registros
sanitarios** (REGCESS y el andaluz), que son la fuente principal para las verticales A1–A3.

## Tabla resumen

| Fuente | Uso previsto | Acceso | Licencia / condiciones | Veredicto |
|---|---|---|---|---|
| REGCESS (Sanidad) | Clínicas, dentales, ópticas, fisio | Área de descarga web | ❓ no figura en la página | **Pendiente de muestra y aviso legal** |
| Registro andaluz de centros sanitarios | Ídem, detalle autonómico | ❓ no localizado el fichero | ❓ solo portal de datos abiertos CC BY 4.0 (general) | **Pendiente de localizar el conjunto** |
| OpenStreetMap (Overpass) | Ópticas, talleres, veterinarios, etc. | API pública con límites | ✅ ODbL, atribución | **Apta con condiciones** (ver abajo) |
| Datos abiertos (datos.gob.es, Junta, ayuntamientos) | Establecimientos por actividad | Por conjunto | ⚠️ una licencia por conjunto | **Caso a caso** |
| INE (DIRCE, INEbase) | Dimensionamiento (solo recuentos) | ✅ API JSON documentada (OpenAPI) | ❓ condiciones de reutilización no leídas | **Apta técnicamente; licencia pendiente** |
| Google Places (New) | Descubrimiento complementario | Clave de API de pago | ✅ `place_id` almacenable sin límite; ⚠️ resto no | **No necesaria en F1; no activar** |
| `web_search` de Claude | Descubrimiento y evidencias | API de Claude | ✅ 10 $ / 1.000 búsquedas + tokens | **Apta** (coste, ver `proveedores.md`) |
| Web corporativa | Fuente principal de la ficha | Rastreador propio | robots.txt y condiciones de cada sitio | **Apta; consulta jurídica sobre el rastreo** |
| Plataforma de Contratación | Señales de licitaciones | Sindicación ATOM | ❓ licencia no localizada; ⚠️ incidencias de actualización | **Solo señales (D-12); pendiente** |
| Vetadas | LinkedIn, directorios que lo prohíban, buscadores de personas | — | — | **No se usan** |

---

## 1. REGCESS — Registro General de Centros, Servicios y Establecimientos Sanitarios

- **Organismo:** Ministerio de Sanidad. Contenido y estructura fijados por la Orden SCO/3866/2007.
- ✅ La página oficial (`sanidad.gob.es/en/areas/saludDigital/regCess/home.htm`) enlaza un **«Área de descarga»**
  (`regcess.mscbs.es/regcessWeb/inicioDescargarCentrosAction.do`) y declara el registro de «carácter público e informativo».
- ⚠️ Una resolución del Consejo de Transparencia (2021) dice que los ficheros se publican **mensualmente** y se descargan
  libremente. Es fuente secundaria y de hace cinco años.
- ❓ **No confirmado:** (a) formato del fichero, (b) campos (nombre, dirección, tipo de centro, teléfono), (c) **licencia y
  atribución**: la página no las muestra y enlaza un aviso legal que no pude ver. Una resolución del mismo Consejo indica,
  además, que los ficheros ya publicados **carecen del campo de área/sector** de cada centro.
- **Cómo se cierra:** el promotor (o yo, con su permiso para descargar el fichero público) abre el área de descarga, baja una
  muestra, anota columnas y lee el aviso legal. Mientras no esté: `active = false`.
- **Limitación a recordar:** REGCESS describe **centros autorizados**, no su tamaño ni sus señales de encaje (nº de
  consultas, sala de espera). Esas señales salen de la web de cada centro (REQ-ENR-02).

## 2. Registro andaluz de centros, servicios y establecimientos sanitarios

- **Organismo y base legal:** Consejería de Salud de la Junta de Andalucía; creado por el Decreto 69/2008 (alimenta al REGCESS).
- ⚠️ Los datos se publican a través de **SICESS**, según una fuente secundaria. ❓ No localicé un fichero descargable.
- ⚠️ El portal de datos abiertos de la Junta figura en datos.gob.es bajo **CC BY 4.0**, pero eso es la licencia general del
  portal, **no** la de un conjunto concreto de este registro.
- **Cómo se cierra:** buscar el conjunto en `juntadeandalucia.es/datosabiertos`; si no existe, el REGCESS (que lo incluye)
  basta para Sevilla. Es posible que no haga falta esta fuente en el piloto.

## 3. OpenStreetMap (Overpass API y Nominatim)

- ✅ **Licencia ODbL** (`openstreetmap.org/copyright`): obliga a **atribuir a OpenStreetMap y a indicar que los datos están bajo
  ODbL**; una base de datos derivada solo puede **distribuirse** bajo la misma licencia. El texto no aclara si el uso
  puramente interno activa alguna obligación → **pregunta para el asesor (D-04)**: nuestras fichas son una base interna que
  no se distribuye, pero las cartas y landings sí muestran datos de la empresa. Solo `evidences` que provengan de OSM llevan
  la atribución (REQ-RES-02 CA2).
- ✅ **Overpass público** (`wiki.openstreetmap.org/wiki/Overpass_API`): para uso puntual, no superar ~10.000 consultas y 1 GB
  al día; **para uso regular, dividir esos límites por 100** (≈ 100 consultas/día); no lanzar scripts en paralelo; enviar
  `User-Agent` identificable; tras un 429 o 406 esperar 30 s; **«el uso comercial debe hacerse con un servidor propio o de
  pago»**. La página avisa de que el servidor principal está sobrecargado.
  - Consecuencia para nosotros (producto comercial): el piloto de 200 empresas en Sevilla cabe de sobra en el límite, pero
    **para escalar a Andalucía y España hay que usar un servidor propio o de pago**. Opciones por evaluar (no probadas):
    una instancia con límites gratuitos mayores (la página cita `overpass.ch`, 10.000 consultas/mes y 30/min, cuyas condiciones
    no leí) o un extracto de OSM autoalojado.
- ✅ **Nominatim público** (`operations.osmfoundation.org/policies/nominatim/`): máximo **1 petición/s**; **no se desaconseja
  pero se limita la geocodificación masiva**; prohíbe consultas sistemáticas (rejillas, descargas masivas de POI) y revender
  resultados. → No usar Nominatim público para geocodificar lotes; el municipio INE se asigna con el nomenclátor (INE).
- **Veredicto:** apta para el piloto con `User-Agent`, caché, 1 hilo y atribución; **plan de servidor propio antes de la
  oleada 2**.

## 4. Conjuntos de datos abiertos (datos.gob.es, Junta/IECA, ayuntamientos)

- ⚠️ Cada conjunto lleva **su propia licencia**; que falte el aviso **no** significa reutilización libre (guía del
  reutilizador de datos.gob.es). El mecanismo del sistema ya lo prevé: una fila de `allowed_sources` por conjunto con su
  licencia anotada antes de activarlo.
- No se ha identificado todavía ningún conjunto concreto útil para Sevilla. Tarea de F1.5 si hace falta.

## 5. INE — DIRCE e INEbase (dimensionamiento, REQ-MKT-03)

- ✅ INE publica una **API JSON** de INEbase documentada con OpenAPI/Swagger (`ine.es/dyngs/DataLab/manual.html`); el DIRCE
  ofrece recuentos de empresas y locales por actividad (CNAE), tramo de asalariados, condición jurídica y **municipio**.
- ❓ **Condiciones de reutilización: no confirmadas** (la página de aviso legal que intenté abrir devolvió 404). Dado que solo
  usamos **recuentos agregados** (no datos de empresas concretas), el riesgo es bajo, pero hay que leer y citar la fuente.
- **Veredicto:** apta técnicamente; anotar licencia y atribución al implementar F1.3.

## 6. Google Places API (New)

- ✅ La política de Places (`developers.google.com/maps/documentation/places/web-service/policies`) dice: **«puedes
  almacenar `place_id` indefinidamente»**; para el resto del contenido, **«no debes pre-obtener, cachear ni almacenar
  contenido de Places API más allá de las excepciones permitidas»**.
- ❓ No cubre captación de clientes ni bases de datos; remite a las Condiciones Específicas de Google Maps Platform, que no
  conseguí leer (una fuente de terceros menciona 30 días para latitud/longitud: **no verificado**).
- **Veredicto:** coherente con REQ-RES-02 CA1 (solo `place_id`). **No hace falta en F1**; si se activa, se almacena solo
  `place_id` y el resto se pide a la web de la empresa. No activar sin leer las condiciones específicas.

## 7. `web_search` y `web_fetch` de Claude

- ✅ Precio oficial (`platform.claude.com/docs/en/about-claude/pricing`, 31/10/2026): **10 USD por 1.000 búsquedas** más los
  tokens del contenido; `web_fetch` **sin coste adicional** (solo tokens); la ejecución de código usada por el filtrado
  dinámico (`*_20260209`) **no se cobra aparte**. Detalle en `proveedores.md`.
- La ficha **no se apoya en el buscador** sino en la web de la empresa (REQ-RES-02): el buscador solo descubre URLs.
- **Veredicto:** apta; coste acotado por `max_uses` y el presupuesto diario de búsqueda (D-03: 5 €/día ≈ 500 búsquedas).

## 8. Web corporativa (rastreador propio)

- Reglas del diseño: `robots.txt`, 1 petición/s por dominio, `User-Agent` identificable, máximo 6 páginas, sin eludir
  captchas ni logins (P2.6).
- **Pregunta para el asesor (D-04):** base jurídica y límites de rastrear webs de empresas y de extraer sus datos con un LLM
  (en particular, autónomos con web personal). No es una comprobación técnica.
- **Veredicto:** apta técnicamente; la validación jurídica entra en la LIA ya prevista en `compliance.md`.

## 9. Plataforma de Contratación del Sector Público

- ✅ Hay **especificación oficial de sindicación ATOM** (Dirección General del Patrimonio del Estado, versión del 05/08/2020)
  y **6 conjuntos de datos abiertos** de licitaciones desde 01/01/2012 (Hacienda); el catálogo de datos.gob.es muestra la
  URL de sindicación bajo `contrataciondelsectorpublico.gob.es/sindicacion/`.
- ⚠️ El mismo catálogo reporta **incidencias abiertas**: las descargas ZIP no se actualizaban y los últimos ficheros eran de
  finales de julio de 2026. Comprobar el estado antes de depender de ello.
- ❓ Licencia concreta no localizada.
- **Veredicto:** solo para **señales** (REQ-RES-04, F7) y no para el piloto; el sector público es canal aparte (D-12).

## 10. Fuentes vetadas

LinkedIn, directorios cuyas condiciones prohíban la extracción y buscadores de personas. No se implementan adaptadores ni
se consultan por `web_search` (`blocked_domains`, `design.md` §4.1).

---

## Lo que necesito del promotor para cerrar F0.4

1. **Permiso para descargar una muestra pública de REGCESS** (o que la descargue y me pase las columnas) y leer su aviso legal.
2. **Decidir si el piloto arranca solo con REGCESS + OpenStreetMap + web corporativa + `web_search`** (mi propuesta; no
   requiere Google ni el registro andaluz).
3. Las dos preguntas jurídicas para el asesor (D-04): ODbL en nuestro uso y rastreo de webs corporativas.

Fuentes consultadas (todas el 31/10/2026): sanidad.gob.es (REGCESS); openstreetmap.org/copyright;
wiki.openstreetmap.org/wiki/Overpass_API; operations.osmfoundation.org/policies/nominatim; developers.google.com/maps
(policies de Places); ine.es (manual de la API JSON); hacienda.gob.es (datos abiertos de licitaciones);
datos.gob.es (catálogo y guía del reutilizador); platform.claude.com (precios).

### 6.1 Actualización del 02/11/2026: Google Places activable (decisión del promotor)

- ✅ **Política de Places** (`…/places/web-service/policies`): «el place ID … está exento de las restricciones de caché; puedes
  almacenarlo indefinidamente». Atribución: si se muestra contenido de Google sin un mapa de Google, logotipo o texto «Google Maps».
- ✅ **Text Search (New)**: `POST https://places.googleapis.com/v1/places:searchText`, cabeceras `X-Goog-Api-Key` y `X-Goog-FieldMask`
  (obligatoria); `textQuery`, `languageCode`, `regionCode`, `pageSize` 1–20, `pageToken`; **máximo 60 resultados** por búsqueda.
  Niveles de los campos: `places.id` = Essentials ID Only; `displayName` = Pro; **`websiteUri` = Enterprise**.
- ✅ **Precios** (`…/billing-and-pricing/pricing`): Text Search Enterprise **1.000 peticiones gratis al mes**, después **35 $/1.000**;
  Pro 5.000 gratis y 32 $/1.000. ⚠️ La página no dice expresamente que se facture por el campo de nivel más alto: el código estima
  prudentemente 0,035 € por petición sin descontar la franja gratuita.
- **Diseño (REQ-RES-02 CA1):** máscara mínima `places.id,places.displayName,places.websiteUri,nextPageToken` (sin teléfono, dirección
  ni reseñas). Google **solo sugiere**: se abre la web con el rastreador educado y la candidata se acepta solo si su nombre (y la
  localidad) aparece en esa web; la evidencia es la línea literal de la web. Se guarda el `place_id` como identificador externo. Lo que no
  se confirma no se guarda. ⚠️ El nombre que se guarda es el que Google devuelve una vez **confirmado** en la web de la empresa; no he
  leído las Condiciones Específicas completas (la página no se dejó descargar): revisarlas antes de producción.
