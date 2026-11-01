# Entorno local de pruebas (Docker, modo sandbox)

Sirve para probar la aplicación en tu equipo **sin contactar con nadie**: el modo está fijo a `sandbox` y los puertos solo escuchan en `127.0.0.1`.
Qué incluye: PostgreSQL propio (puerto 5434, no interfiere con las pruebas automáticas del 5433), el panel web (http://localhost:3000) y el worker.

## Requisitos

- Docker Desktop en marcha, Node 22 y `npm install` hecho en la raíz del repositorio.
- Todos los comandos se ejecutan en PowerShell desde la raíz del repositorio.

## Primera vez

    npm run local:init -- tu@correo.es "Tu Nombre" --demo-territories --demo-segment

Es repetible (puedes volver a ejecutarlo sin romper nada). Hace, en este orden:

1. Crea `deploy/.env.local` (**fuera de git**) con contraseñas generadas. No se imprimen nunca.
2. Arranca PostgreSQL, crea los roles y aplica las migraciones.
3. Siembra los datos iniciales: hechos del producto aprobados (el contenido lo aprobó el promotor el 31/10/2026), el administrador, la fuente
   OpenStreetMap activada (queda en la auditoría) y, con las opciones indicadas, tres municipios de Sevilla (sin población) y un segmento de prueba
   definido a mano (no es una propuesta del modelo).
4. Construye y arranca el panel y el worker (la primera vez tarda unos minutos).

Entra en http://localhost:3000 con el correo que pusiste. La contraseña está en `deploy/.env.local`, clave `ADMIN_PASSWORD`.

Para cargar **todos** los municipios usa el CSV del INE (`ine_code,name,province,region,population`):

    npm run local:init -- tu@correo.es "Tu Nombre" --territories .\municipios.csv

## Día a día

| Comando | Qué hace |
|---|---|
| `npm run local:up` | Arranca (y reconstruye si cambió el código) |
| `npm run local:down` | Para todo, conservando los datos |
| `npm run local:status` | Estado: contenedores, web, worker, IA, fichas y trabajos |
| `npm run local:logs` | Registros en vivo (`-- worker` o `-- web` para uno solo) |
| `npm run local:reset -- --yes` | **Borra** la base de datos local y empieza de cero |

## Qué se puede probar SIN claves de API

Todo lo que no usa IA: **Investigación → Nueva investigación** (segmento de prueba, Sevilla, OpenStreetMap, lote ≤ 20, presupuesto 1 €). El worker
consulta OpenStreetMap y crea fichas candidatas, con la atribución ODbL y su fuente. Es **una consulta educada** al servidor público de Overpass
(tarda del orden de un minuto). En la prueba de preparación salieron 17 fichas en Sevilla, **solo 4 con web**: el enriquecimiento necesita web, así
que el resto requerirá `web_search` para encontrarla.

También: ver el estado del worker, pausar/cancelar un trabajo, y los segmentos.

## Cuando tengas las claves

1. Crea tu clave en OpenRouter. **Nunca la pegues en el chat.**
2. Abre `deploy/.env.local` con el Bloc de notas y escribe `OPENROUTER_API_KEY=<tu clave>` (sin comillas). Guarda.
3. Comprueba la clave y el modelo con **una llamada real mínima (cuesta céntimos)**:

       npm run llm:check

   Valida a la vez que la clave sirve, que el modelo de la ruta existe en tu cuenta, que la salida estructurada funciona y que el coste vuelve en la
   respuesta. Si falla, no enciendas la IA y dime el mensaje (sin la clave).
4. Comprueba también la **búsqueda web** (otra llamada real, algo más cara por la búsqueda):

       npm run llm:check -- --search

   Debe mostrar citas (las webs que encontró), el número de búsquedas y el coste; compáralo con lo esperado (tokens + unos 0,005–0,007 € por búsqueda).
5. Enciende la IA: `npm run local:ai-on`. El worker empieza a:
   - enriquecer las candidatas que tienen web,
   - **buscar la web** de las candidatas que no la tienen (en la prueba de Sevilla, 13 de 17) y verificarla en código,
   - atender «Pedir análisis de mercado» (en **Segmentos**).

   Si solo quieres enriquecer y no buscar webs: `npm run local:ai-on -- --no-search`. Apagarlo todo: `npm run local:ai-off`.

**Antes de encenderla** — el texto público de las webs de las empresas se envía a OpenRouter. La pasarela ya exige `data_collection: deny` y
`require_parameters`, pero la decisión **D-16** (contrato de encargo/DPA y región `eu.`) sigue abierta; para pruebas en sandbox con webs públicas
es tu decisión asumirlo.

**Presupuesto:** tope diario de IA 5 € y de búsqueda de webs 2 € (D-03); el worker y la pasarela cortan solos al alcanzarlos. Al principio usa lotes
pequeños (≤ 20) y mira el coste en **Investigación**.

**Cómo se busca la web de una candidata (y por qué es seguro):** el modelo solo *sugiere*, con la búsqueda del proveedor. El código se queda únicamente con
las fuentes que la búsqueda *cita* (nunca con URLs escritas en el texto del modelo), descarta los dominios vetados, redes sociales y directorios, abre la
portada con el rastreador educado y la acepta solo si en el texto aparece el **teléfono** de la ficha o el **nombre y la localidad**. La web se guarda como
**dato inferido**, con la línea literal que la demostró, para que la veas resaltada en la revisión. Un negocio cuyo nombre incluye el de una persona no se manda a buscar.

## Flujo de prueba recomendado

1. `local:init` (una vez) → entrar en el panel.
2. Investigación → lanzar con el segmento de prueba (sin IA) → ver las fichas candidatas.
3. Poner la clave → `llm:check` → `local:ai-on`.
4. Las candidatas con web (o a las que se les encuentre) pasan solas a «enriquecidas» y puntúan; abre **Cola de revisión** y prueba los atajos (A aprobar, D descartar, B bloquear, C corregir).
5. **Segmentos → Pedir análisis de mercado** para que el modelo proponga segmentos reales; apruébalos y repite con ellos.
6. Cuando tengas fichas aprobadas, **Exportar fichas aprobadas (CSV)**.

## Seguridad

- `APP_MODE=sandbox` está fijado en `docker-compose.local.yml`: no es configurable desde fuera.
- `deploy/.env.local` está en `.gitignore` y en `.dockerignore`. No lo compartas ni lo pegues en conversaciones.
- La IA arranca apagada; solo `ENRICH_ENABLED=1` (que escribe `local:ai-on`) la enciende y exige la clave.

## Problemas frecuentes

- **«Docker no está en marcha»** — abre Docker Desktop y espera a que diga «running».
- **Puerto 3000 o 5434 ocupado** — para lo que lo use (o `npm run local:down`) y repite.
- **Sin señal del worker** — `npm run local:logs -- worker`; reinicia con `npm run local:up`.
- **Olvidé la contraseña** — está en `deploy/.env.local` (`ADMIN_PASSWORD`).
- **Quiero empezar de cero** — `npm run local:reset -- --yes` y luego `local:init`.
