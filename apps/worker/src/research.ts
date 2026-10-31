import { claimTask, failTask, finishTask, ingestCandidate, type ClaimedTask, type IngestCandidate } from '@turnosala/db';
import type pg from 'pg';

// Ejecutor de trabajos de investigación (REQ-RES-01): reclama una tarea (fuente × municipio), pide candidatos al adaptador de la fuente
// (puerto; los reales llegan en F1.5), los ingesta con deduplicación y cierra la tarea. Reanudable: la ingesta es idempotente.

export interface SourceRequest {
  sourceId: string;
  ineCode: string | null;
  cursor: unknown;
  /** candidatos que aún caben en el lote del trabajo */
  limit: number;
}
export interface SourceResult {
  candidates: IngestCandidate[];
  costEur: number;
  cursor?: unknown;
}
export interface SourceAdapter {
  fetch(req: SourceRequest): Promise<SourceResult>;
}
export interface ResearchDeps {
  pool: pg.Pool;
  adapters: Partial<Record<string, SourceAdapter>>;
  workerId: string;
  now?: (() => Date) | undefined;
  leaseSeconds?: number | undefined;
}

const clock = (d: ResearchDeps): Date => (d.now ?? (() => new Date()))();

/** Ingesta hasta `limit` candidatos nuevos; los que se fusionan con fichas existentes no cuentan. */
async function ingestUpTo(pool: pg.Pool, candidates: IngestCandidate[], limit: number): Promise<number> {
  let created = 0;
  for (const c of candidates) {
    if (created >= limit) break;
    if ((await ingestCandidate(pool, c)).action === 'created') created++;
  }
  return created;
}

async function execute(deps: ResearchDeps, task: ClaimedTask): Promise<'done' | 'failed'> {
  const adapter = deps.adapters[task.sourceId];
  if (!adapter) {
    await failTask(deps.pool, task.id, `No hay adaptador para la fuente «${task.sourceId}»`, clock(deps));
    return 'failed';
  }
  try {
    const res = await adapter.fetch({ sourceId: task.sourceId, ineCode: task.ineCode, cursor: task.cursor, limit: task.remainingBatch });
    const created = await ingestUpTo(deps.pool, res.candidates, task.remainingBatch);
    await finishTask(deps.pool, task.id, { candidates: created, costEur: res.costEur, cursor: res.cursor }, clock(deps));
    return 'done';
  } catch (e) {
    await failTask(deps.pool, task.id, e instanceof Error ? e.message : String(e), clock(deps));
    return 'failed';
  }
}

/** Procesa una tarea. `idle` si no hay ninguna disponible (cola vacía, trabajo en pausa o cancelado). */
export async function processOne(deps: ResearchDeps, jobId?: string): Promise<'done' | 'failed' | 'idle'> {
  const task = await claimTask(deps.pool, { workerId: deps.workerId, now: clock(deps), leaseSeconds: deps.leaseSeconds, jobId });
  return task ? execute(deps, task) : 'idle';
}

export async function runUntilIdle(deps: ResearchDeps, opts: { jobId?: string | undefined; maxTasks?: number | undefined } = {}): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 };
  for (let i = 0; i < (opts.maxTasks ?? 10_000); i++) {
    const r = await processOne(deps, opts.jobId);
    if (r === 'idle') break;
    out[r]++;
  }
  return out;
}
