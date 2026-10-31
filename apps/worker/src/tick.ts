import type { LlmRequest, LlmResult, RouteId } from '@turnosala/ai';
import type { CrawlOptions, CrawlResult } from '@turnosala/connectors';
import { claimEnrichable, claimRequest, failRequest, finishRequest, recordEnrichFailure, touchWorkerHeartbeat, unclaimEnrichable, type ClaimedRequest } from '@turnosala/db';
import type pg from 'pg';
import { z } from 'zod';
import { analyzeMarket } from './analyze.js';
import { enrichProspect, type EnrichOutcome } from './enrich.js';
import { runUntilIdle, type SourceAdapter } from './research.js';

// Ciclo del worker: atiende las peticiones del panel, ejecuta los trabajos de investigación y enriquece las candidatas. El gasto en LLM
// (análisis y enriquecimiento) solo ocurre con `llmEnabled`; la investigación por fuentes abiertas no cuesta nada y siempre corre.

export interface TickDeps {
  pool: pg.Pool;
  workerId: string;
  adapters: Partial<Record<string, SourceAdapter>>;
  gateway: { run<T>(route: RouteId, req: LlmRequest<T>): Promise<LlmResult<T>> };
  crawl(url: string, opts: CrawlOptions): Promise<CrawlResult>;
  userAgent: string;
  llmEnabled: boolean;
  limits: { researchTasks: number; enrich: number };
  now?: (() => Date) | undefined;
}
export interface TickStats {
  research: { done: number; failed: number };
  requests: number;
  enriched: number;
  enrichFailed: number;
  /** motivo del fallo del sistema que paró el enriquecimiento (p. ej. presupuesto agotado) */
  stoppedBy?: string | undefined;
}

/** Fallos del sistema (no de la ficha): si ocurren, se para el lote y no se consume ningún intento de las fichas. */
const SYSTEMIC = new Set(['budget', 'budget_unknown', 'provider_disabled', 'dpa_missing', 'no_config', 'capability_unsupported', 'no_model_for_provider', 'provider_unavailable', 'usage_not_recorded']);

const analyzePayload = z.object({ productId: z.string().min(1) });

async function handleRequest(deps: TickDeps, req: ClaimedRequest): Promise<void> {
  const parsed = analyzePayload.safeParse(req.payload);
  const now = deps.now?.();
  if (!parsed.success) { await failRequest(deps.pool, req.id, 'carga no válida: falta productId', now); return; }
  const out = await analyzeMarket({ pool: deps.pool, gateway: deps.gateway, crawl: deps.crawl, userAgent: deps.userAgent, actor: 'system:market.analyze' }, parsed.data.productId);
  if (out.status === 'analyzed') await finishRequest(deps.pool, req.id, out, now);
  else await failRequest(deps.pool, req.id, out.status === 'llm_failed' ? `llm_failed: ${out.reason ?? 'desconocido'}` : out.status, now);
}

async function serveRequests(deps: TickDeps): Promise<number> {
  let n = 0;
  for (;;) {
    const req = await claimRequest(deps.pool, { now: deps.now?.() });
    if (!req) return n;
    n++;
    try {
      await handleRequest(deps, req);
    } catch (e) {
      await failRequest(deps.pool, req.id, e instanceof Error ? e.message : String(e), deps.now?.());
    }
  }
}

function describeFailure(o: EnrichOutcome): string {
  if (o.status === 'no_pages') return `no_pages (robots: ${o.robots}; omitidas: ${o.skipped.map((s) => s.reason).join(', ') || 'ninguna'})`;
  if (o.status === 'llm_failed') return `llm_failed: ${o.reason ?? 'desconocido'}`;
  return o.status;
}

async function enrichBatch(deps: TickDeps, stats: TickStats): Promise<void> {
  const ids = await claimEnrichable(deps.pool, { limit: deps.limits.enrich, now: deps.now?.() });
  for (const [i, id] of ids.entries()) {
    let outcome: EnrichOutcome | null = null;
    let error = '';
    try {
      outcome = await enrichProspect({ pool: deps.pool, gateway: deps.gateway, crawl: deps.crawl, userAgent: deps.userAgent, now: deps.now }, id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (outcome?.status === 'enriched') { stats.enriched++; continue; }
    if (outcome?.status === 'llm_failed' && SYSTEMIC.has(outcome.reason ?? '')) {
      stats.stoppedBy = outcome.reason;
      await unclaimEnrichable(deps.pool, ids.slice(i));
      return;
    }
    stats.enrichFailed++;
    await recordEnrichFailure(deps.pool, id, outcome ? describeFailure(outcome) : error);
  }
}

export async function tick(deps: TickDeps): Promise<TickStats> {
  const stats: TickStats = { research: { done: 0, failed: 0 }, requests: 0, enriched: 0, enrichFailed: 0 };
  await touchWorkerHeartbeat(deps.pool, { workerId: deps.workerId, llmEnabled: deps.llmEnabled }, deps.now?.()); // antes de trabajar: un ciclo lento o fallido no debe parecer un worker muerto
  if (deps.llmEnabled) stats.requests = await serveRequests(deps);
  stats.research = await runUntilIdle({ pool: deps.pool, adapters: deps.adapters, workerId: deps.workerId, now: deps.now }, { maxTasks: deps.limits.researchTasks });
  if (deps.llmEnabled) await enrichBatch(deps, stats);
  return stats;
}

const SINGLETON_LOCK = 7101;

/** Solo una instancia del worker a la vez (cerrojo de sesión de Postgres). `null` si ya hay otra. */
export async function acquireSingleton(pool: pg.Pool): Promise<{ release(): Promise<void> } | null> {
  const client = await pool.connect();
  const ok = ((await client.query('select pg_try_advisory_lock($1) as ok', [SINGLETON_LOCK])).rows[0] as { ok: boolean }).ok;
  if (!ok) { client.release(); return null; }
  return { release: async () => { await client.query('select pg_advisory_unlock($1)', [SINGLETON_LOCK]); client.release(); } };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** Repite `step` hasta que se pida parar; un ciclo que falla se anota y no tumba el proceso. */
export async function runLoop(step: () => Promise<void>, o: { intervalMs: number; signal: AbortSignal; onError: (e: unknown) => void }): Promise<void> {
  while (!o.signal.aborted) {
    try {
      await step();
    } catch (e) {
      o.onError(e);
    }
    if (o.signal.aborted) break;
    await sleep(o.intervalMs, o.signal);
  }
}
