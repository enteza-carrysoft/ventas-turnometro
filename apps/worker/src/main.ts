import { createGateway, createOpenRouterProvider, createPgLlmStore } from '@turnosala/ai';
import { crawlSite, createOsmAdapter } from '@turnosala/connectors';
import pg from 'pg';
import { readConfig } from './config.js';
import { acquireSingleton, runLoop, tick, type TickDeps } from './tick.js';

// Proceso del worker: investiga con las fuentes abiertas, atiende las peticiones del panel y enriquece candidatas.
//   PowerShell:   $env:DATABASE_URL = 'postgres://app:<clave>@<host>:5432/prospector'; npm run worker
// El gasto en LLM está apagado salvo ENRICH_ENABLED=1 (que exige OPENROUTER_API_KEY). Se detiene limpiamente con Ctrl+C o SIGTERM.

const log = (event: string, data: Record<string, unknown> = {}): void => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

function buildGateway(cfg: ReturnType<typeof readConfig>, pool: pg.Pool): TickDeps['gateway'] {
  if (!cfg.llmEnabled || !cfg.openRouterApiKey) {
    return { run: () => Promise.reject(new Error('El LLM está desactivado (ENRICH_ENABLED distinto de 1)')) };
  }
  return createGateway({ store: createPgLlmStore(pool), providers: { openrouter: createOpenRouterProvider({ apiKey: cfg.openRouterApiKey, baseUrl: cfg.openRouterBaseUrl }) } });
}

async function main(): Promise<void> {
  const cfg = readConfig(process.env);
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 5 });
  pool.on('error', (e) => log('pg_idle_error', { message: e.message }));
  const singleton = await acquireSingleton(pool);
  if (!singleton) {
    log('already_running');
    await pool.end();
    process.exitCode = 1;
    return;
  }
  const ac = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { log('stopping', { signal: sig }); ac.abort(); });
  const deps: TickDeps = {
    pool, workerId: cfg.workerId, userAgent: cfg.userAgent, llmEnabled: cfg.llmEnabled, limits: cfg.limits, gateway: buildGateway(cfg, pool),
    crawl: (url, opts) => crawlSite(url, opts),
    adapters: { osm: createOsmAdapter({ userAgent: cfg.userAgent, filters: [], endpoint: cfg.osmEndpoint }) },
  };
  log('started', { workerId: cfg.workerId, llmEnabled: cfg.llmEnabled, intervalMs: cfg.intervalMs, limits: cfg.limits });
  try {
    await runLoop(async () => {
      const s = await tick(deps);
      if (s.research.done + s.research.failed + s.requests + s.enriched + s.enrichFailed > 0 || s.stoppedBy) log('tick', { ...s });
    }, { intervalMs: cfg.intervalMs, signal: ac.signal, onError: (e) => log('tick_error', { message: e instanceof Error ? e.message : String(e) }) });
  } finally {
    await singleton.release();
    await pool.end();
    log('stopped');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
