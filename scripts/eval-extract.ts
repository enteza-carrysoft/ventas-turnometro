// Evalúa la extracción contra el conjunto dorado (F1.10). GASTA DINERO REAL (llama al modelo): pide aprobación antes de ejecutarlo sin --dry-run.
//
//   PowerShell:
//     $env:DATABASE_URL = 'postgres://app:<clave>@<host>:5432/prospector'
//     $env:OPENROUTER_API_KEY = '<tu clave>'          # créala tú; nunca la pegues en el chat
//     npm run eval:extract -- --dry-run               # valida el conjunto dorado, no llama al modelo ni gasta
//     npm run eval:extract -- --max-eur 5             # ruta enrich.extract, modelo de la configuración
//     npm run eval:extract -- --route market.analyze --model anthropic/claude-opus-5.5
//
// Opciones: --route <id> (por defecto enrich.extract) · --model <slug de OpenRouter> (solo en esta ejecución, no toca la BD) ·
// --max-eur <n> (tope de gasto, por defecto 5) · --dir <ruta> (por defecto tests/golden) · --dry-run.
import { createGateway, createOpenRouterProvider, createPgLlmStore, ROUTE_IDS, type LlmConfig, type RouteId } from '@turnosala/ai';
import pg from 'pg';
import { runEval } from '../apps/worker/src/eval.js';
import { loadGolden } from '../apps/worker/src/golden-files.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const pct = (x: number | null): string => (x === null ? 'n/d' : `${(x * 100).toFixed(1)} %`);

const route = (arg('route') ?? 'enrich.extract') as RouteId;
if (!(ROUTE_IDS as readonly string[]).includes(route)) {
  console.error(`Ruta desconocida «${route}». Rutas: ${ROUTE_IDS.join(', ')}`);
  process.exit(1);
}
const loaded = loadGolden(arg('dir') ?? 'tests/golden');
for (const e of loaded.errors) console.error(`  ${e.file}: ${e.message}`);
console.log(`Conjunto dorado: ${loaded.cases.length} fichas válidas, ${loaded.errors.length} con problemas.`);
if (loaded.cases.length === 0) process.exit(1);
if (flag('dry-run')) {
  console.log(`Prueba en seco: se evaluarían ${loaded.cases.length} fichas con la ruta ${route}. No se ha llamado al modelo ni se ha gastado nada.`);
  process.exit(loaded.errors.length ? 1 : 0);
}

const url = process.env.DATABASE_URL;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!url || !apiKey) {
  console.error('Faltan DATABASE_URL y/o OPENROUTER_API_KEY (variables de entorno).');
  process.exit(1);
}
const maxEur = Number(arg('max-eur') ?? '5');
if (!(maxEur > 0)) { console.error('--max-eur debe ser un número positivo'); process.exit(1); }
const model = arg('model');

const pool = new pg.Pool({ connectionString: url });
const base = createPgLlmStore(pool);
// --model sustituye el modelo de la ruta solo en memoria para esta ejecución y lo permite; la configuración de la BD no cambia.
const store = {
  ...base,
  async loadConfig(): Promise<LlmConfig> {
    const cfg = await base.loadConfig();
    const r = cfg.routes[route];
    if (!model || !r) return cfg;
    return { ...cfg, routes: { ...cfg.routes, [route]: { ...r, models: { ...r.models, openrouter: model }, allowedModels: [...new Set([...r.allowedModels, model])] } } };
  },
};
try {
  const gateway = createGateway({ store, providers: { openrouter: createOpenRouterProvider({ apiKey, baseUrl: process.env.OPENROUTER_BASE_URL }) } });
  const report = await runEval({ gateway, route, maxEur, onProgress: (l) => console.log(`  ${l}`) }, loaded.cases);
  const a = report.aggregate;
  console.log('\n=== Resultado ===');
  console.log(`Fichas evaluadas: ${a.entries} (omitidas: ${report.skipped.length}${report.stoppedByBudget ? '; PARADO por el tope de gasto' : ''})`);
  console.log(`Precisión (campos + señales + contactos + forma jurídica): ${pct(a.precision)}   [puerta ≥ 90 %: ${a.passesGate ? 'SUPERADA' : 'NO superada'}]`);
  console.log(`Precisión solo de campos: ${pct(a.fieldPrecision)} · Exhaustividad: ${pct(a.recall)}`);
  console.log(`Tasa de rechazo literal (citas inventadas descartadas): ${pct(a.literalRejectionRate)}`);
  console.log(`Coste: ${a.costPerEntryEur === null ? 'n/d' : a.costPerEntryEur.toFixed(3)} € por ficha · ${a.totalCostEur.toFixed(2)} € en total`);
  for (const s of report.skipped) console.log(`  omitida ${s.id}: ${s.reason}`);
  process.exitCode = a.passesGate ? 0 : 1;
} finally {
  await pool.end();
}
