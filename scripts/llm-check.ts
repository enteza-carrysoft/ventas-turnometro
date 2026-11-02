// Comprobación previa de la clave de OpenRouter y de la ruta de IA (HACE UNA LLAMADA REAL: cuesta céntimos). Úsala antes de «npm run local:ai-on».
// Valida lo que hasta ahora no se ha podido probar contra el servicio real: que la clave sirve, que el modelo configurado en la ruta existe, que
// la salida estructurada (esquema JSON estricto) funciona y que el coste vuelve en la respuesta. Lee deploy/.env.local; no imprime la clave.
//
//   PowerShell:   npm run llm:check            # ruta enrich.extract
//                 npm run llm:check -- --route market.analyze
//                 npm run llm:check -- --search     # prueba real de la BÚSQUEDA WEB (ruta discovery): citas, nº de búsquedas y coste
import { readFileSync } from 'node:fs';
import { createGateway, createOpenRouterProvider, createPgLlmStore, ROUTE_IDS, type LlmResult, type RouteId } from '@turnosala/ai';
import pg from 'pg';
import { z } from 'zod';
import { getKey } from './lib/envfile.js';

const ENV_FILE = 'deploy/.env.local';
const i = process.argv.indexOf('--route');
const searchMode = process.argv.includes('--search');
const route = (i >= 0 ? process.argv[i + 1] : searchMode ? 'discovery' : 'enrich.extract') as RouteId;
if (!(ROUTE_IDS as readonly string[]).includes(route)) {
  console.error(`Ruta desconocida «${route}». Rutas: ${ROUTE_IDS.join(', ')}`);
  process.exit(1);
}

let env = '';
try {
  env = readFileSync(ENV_FILE, 'utf8');
} catch {
  console.error(`No existe ${ENV_FILE}. Ejecuta «npm run local:init» primero.`);
  process.exit(1);
}
const apiKey = getKey(env, 'OPENROUTER_API_KEY');
const appPassword = getKey(env, 'APP_PASSWORD');
if (!apiKey) {
  console.error(`Falta OPENROUTER_API_KEY en ${ENV_FILE}. Créala tú en OpenRouter y escríbela ahí (nunca en el chat).`);
  process.exit(1);
}
if (!appPassword) {
  console.error(`Falta APP_PASSWORD en ${ENV_FILE}. Ejecuta «npm run local:init».`);
  process.exit(1);
}

type Gateway = ReturnType<typeof createGateway>;

function report(r: LlmResult<unknown>): void {
  console.log(`Estado: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  console.log(`Proveedor: ${r.provider ?? '—'} · Modelo pedido: ${r.requestedModel ?? '—'} · Modelo que respondió: ${r.servedModel ?? '—'}${r.fallbackUsed ? ' (¡se usó un modelo alternativo!)' : ''}`);
  console.log(`Tokens: ${r.usage.input} entrada / ${r.usage.output} salida · Coste: ${r.usage.costEur.toFixed(5)} € (fuente: ${r.usage.costSource})`);
}

async function checkStructured(gateway: Gateway): Promise<boolean> {
  const r = await gateway.run(route, {
    system: 'Responde SOLO con el JSON del esquema indicado.',
    messages: [{ role: 'user', content: 'Devuelve ok=true y, en el campo eco, la palabra «hola».' }],
    schema: { name: 'comprobacion', zod: z.object({ ok: z.boolean(), eco: z.string() }) },
    maxTokens: 200,
  });
  report(r);
  const good = r.status === 'ok' && r.data?.ok === true;
  console.log(good ? 'RESULTADO: correcto. La clave, el modelo y la salida estructurada funcionan.' : 'RESULTADO: FALLÓ. No enciendas la IA hasta resolverlo.');
  if (good && r.usage.costSource !== 'provider') console.log('Aviso: el coste no vino del proveedor; el gasto se estima con la tabla de precios.');
  if (!good) console.log('Pistas: clave incorrecta (401), modelo no disponible para tu cuenta, o la ruta/proveedor deshabilitados en la configuración (llm_routes, llm_enabled_providers).');
  return good;
}

/** Búsqueda web real con un negocio conocido: comprueba que llegan citas, que se cuentan las búsquedas y que el coste las incluye. */
async function checkSearch(gateway: Gateway): Promise<boolean> {
  const r = await gateway.run(route, {
    system: 'Eres un buscador de webs oficiales de negocios. Con la herramienta de búsqueda, encuentra la web oficial. Responde con una sola línea: la URL, o NINGUNA.',
    messages: [{ role: 'user', content: 'Negocio: TurnoSala (gestión de turnos y colas)\nLocalidad: España' }],
    webSearch: { maxResults: 5, maxUses: 1, excludedDomains: ['linkedin.com'] },
  });
  report(r);
  const hosts = (r.citations ?? []).map((c) => { try { return new URL(c.url).hostname; } catch { return '(url no válida)'; } });
  console.log(`Búsquedas hechas: ${r.webSearches ?? 0} · Citas: ${hosts.length}${hosts.length ? ` (${[...new Set(hosts)].slice(0, 6).join(', ')})` : ''}`);
  const good = r.status === 'ok' && hosts.length > 0 && (r.webSearches ?? 0) > 0;
  console.log(good ? 'RESULTADO: correcto. La búsqueda web funciona y devuelve fuentes.' : 'RESULTADO: FALLÓ. No enciendas la búsqueda de webs (DISCOVER_ENABLED) hasta resolverlo.');
  if (good) console.log('Compara el coste con lo esperado: tokens + unos 0,005–0,01 $ por búsqueda del motor. Si es mucho mayor, avísame.');
  if (!good) console.log('Pistas: el modelo/proveedor puede no admitir la herramienta de búsqueda, o la respuesta no trajo citas (anotaciones url_citation).');
  return good;
}

console.log(`Comprobación real de la ruta «${route}»${searchMode ? ' con búsqueda web' : ''} (una sola llamada mínima, cuesta céntimos)…`);
const pool = new pg.Pool({ connectionString: `postgres://app:${encodeURIComponent(appPassword)}@127.0.0.1:5434/prospector` });
try {
  const gateway = createGateway({ store: createPgLlmStore(pool), providers: { openrouter: createOpenRouterProvider({ apiKey, baseUrl: getKey(env, 'OPENROUTER_BASE_URL') || undefined }) } });
  process.exitCode = (searchMode ? await checkSearch(gateway) : await checkStructured(gateway)) ? 0 : 1;
} finally {
  await pool.end();
}
