import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Trabajos de investigación (REQ-RES-01). La tabla de tareas es la cola: se reclama con `for update skip locked` y un arrendamiento;
// si el worker muere, el arrendamiento caduca y otro retoma la tarea. Idempotencia de los candidatos: la garantiza `ingestCandidate`.

export const MAX_BATCH = 200;
export const MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_SECONDS = 600;

type Client = pg.PoolClient;
type Db = pg.Pool;

export interface CreateJobInput {
  segmentId: string;
  ineCodes: string[];
  sourceIds: string[];
  maxCandidates?: number | undefined;
  budgetEur: number;
  createdBy: string;
}

async function tx<T>(pool: Db, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const audit = (c: Client | Db, actor: string, action: string, id: string, payload: unknown): Promise<unknown> =>
  c.query('insert into audit_log (actor, action, entity, entity_id, payload) values ($1,$2,$3,$4,$5)', [actor, action, 'research_job', id, JSON.stringify(payload)]);

/** Solo fuentes activas de `allowed_sources` (CA1): cualquier otra se rechaza y se registra. */
async function assertSourcesActive(pool: Db, sourceIds: string[], actor: string): Promise<void> {
  const rows = (await pool.query('select id, active from allowed_sources where id = any($1::text[])', [sourceIds])).rows as Array<{ id: string; active: boolean }>;
  const active = new Set(rows.filter((r) => r.active).map((r) => r.id));
  for (const s of sourceIds) {
    if (active.has(s)) continue;
    await audit(pool, actor, 'research.source_rejected', 'n/a', { source: s, reason: rows.some((r) => r.id === s) ? 'inactive' : 'unknown' });
    throw new Error(`La fuente «${s}» no está activa en allowed_sources: petición rechazada`);
  }
}

function validate(i: CreateJobInput): number {
  const max = i.maxCandidates ?? MAX_BATCH;
  if (!Number.isInteger(max) || max < 1 || max > MAX_BATCH) throw new Error(`El lote debe estar entre 1 y ${MAX_BATCH}`);
  if (!(i.budgetEur > 0)) throw new Error('El presupuesto debe ser positivo');
  if (i.sourceIds.length === 0 || i.ineCodes.length === 0) throw new Error('Hacen falta al menos una fuente y un municipio');
  return max;
}

/** Solo se investiga con segmentos aprobados por marketing (los del modelo nacen en borrador). */
async function assertSegmentApproved(pool: Db, segmentId: string): Promise<void> {
  const seg = (await pool.query('select status from segments where id = $1', [segmentId])).rows[0] as { status: string } | undefined;
  if (!seg) throw new Error('El segmento no existe');
  if (seg.status !== 'approved') throw new Error('El segmento no está aprobado: solo se investiga con segmentos aprobados');
}

export async function createResearchJob(pool: Db, input: CreateJobInput): Promise<{ jobId: string; tasks: number }> {
  const max = validate(input);
  await assertSegmentApproved(pool, input.segmentId);
  const sources = [...new Set(input.sourceIds)];
  const codes = [...new Set(input.ineCodes)];
  await assertSourcesActive(pool, sources, input.createdBy);
  const jobId = uuidv7();
  await tx(pool, async (c) => {
    await c.query(
      `insert into research_jobs (id, segment_id, territory_filter, max_candidates, budget_eur, status, created_by) values ($1,$2,$3,$4,$5,'queued',$6)`,
      [jobId, input.segmentId, JSON.stringify({ ine_codes: codes }), max, input.budgetEur, input.createdBy]);
    for (const s of sources) for (const code of codes) {
      await c.query(`insert into research_tasks (id, job_id, source_id, ine_code) values ($1,$2,$3,$4)`, [uuidv7(), jobId, s, code]);
    }
    await audit(c, input.createdBy, 'research.created', jobId, { sources, ine_codes: codes, max_candidates: max, budget_eur: input.budgetEur });
  });
  return { jobId, tasks: sources.length * codes.length };
}

interface JobStats {
  candidates: number;
  cost_eur: number;
  stop_reason?: string;
}
interface JobRow {
  id: string;
  status: string;
  max_candidates: number;
  budget_eur: string;
  stats: Partial<JobStats>;
}

async function lockJob(c: Client, jobId: string): Promise<JobRow> {
  return (await c.query('select id, status, max_candidates, budget_eur, stats from research_jobs where id = $1 for update', [jobId])).rows[0] as JobRow;
}

/** Cuando no queda nada pendiente ni en curso, el trabajo termina: `done` si algo se completó, `failed` si todo falló. */
async function rollup(c: Client, jobId: string): Promise<void> {
  const j = await lockJob(c, jobId);
  if (j.status !== 'queued' && j.status !== 'running') return;
  const r = (await c.query(`select count(*) filter (where status in ('pending','running')) open, count(*) filter (where status = 'done') done from research_tasks where job_id = $1`, [jobId])).rows[0] as { open: string; done: string };
  if (Number(r.open) > 0) return;
  await c.query('update research_jobs set status = $2 where id = $1', [jobId, Number(r.done) > 0 || j.stats.stop_reason ? 'done' : 'failed']);
}

/** Frenos de CA2: lote y presupuesto. Las tareas pendientes se saltan; las que están en curso terminan su paso. */
async function applyBrakes(c: Client, jobId: string): Promise<void> {
  const j = await lockJob(c, jobId);
  const s = j.stats;
  const reason = (s.candidates ?? 0) >= j.max_candidates ? 'batch_limit' : (s.cost_eur ?? 0) >= Number(j.budget_eur) ? 'budget' : null;
  if (!reason || s.stop_reason) return;
  await c.query(`update research_jobs set stats = stats || $2::jsonb where id = $1`, [jobId, JSON.stringify({ stop_reason: reason })]);
  await c.query(`update research_tasks set status = 'skipped', updated_at = now() where job_id = $1 and status = 'pending'`, [jobId]);
}

async function addToJob(c: Client, jobId: string, candidates: number, costEur: number): Promise<void> {
  const j = await lockJob(c, jobId);
  const stats = { ...j.stats, candidates: (j.stats.candidates ?? 0) + candidates, cost_eur: Math.round(((j.stats.cost_eur ?? 0) + costEur) * 1e6) / 1e6 };
  await c.query('update research_jobs set stats = $2 where id = $1', [jobId, JSON.stringify(stats)]);
}

export interface ClaimOptions {
  workerId: string;
  now?: Date | undefined;
  leaseSeconds?: number | undefined;
  /** limita la búsqueda a un trabajo (útil para un worker dedicado y para las pruebas) */
  jobId?: string | undefined;
  taskId?: string | undefined;
}
export interface ClaimedTask {
  id: string;
  jobId: string;
  segmentId: string;
  sourceId: string;
  ineCode: string | null;
  cursor: unknown;
  attempts: number;
  /** candidatos que aún caben en el lote del trabajo */
  remainingBatch: number;
}

/** Tareas con el arrendamiento caducado que ya agotaron sus intentos: se dan por fallidas para no reintentar eternamente. */
async function failExhausted(c: Client, now: Date, jobId: string | undefined): Promise<void> {
  const r = await c.query(
    `update research_tasks set status = 'failed', error = coalesce(error, 'arrendamiento caducado tras el máximo de intentos'), updated_at = $1
      where status = 'running' and lease_until < $1 and attempts >= $2 and ($3::uuid is null or job_id = $3) returning job_id`, [now, MAX_ATTEMPTS, jobId ?? null]);
  for (const id of new Set((r.rows as Array<{ job_id: string }>).map((x) => x.job_id))) await rollup(c, id);
}

export async function claimTask(pool: Db, o: ClaimOptions): Promise<ClaimedTask | null> {
  const now = o.now ?? new Date();
  const lease = new Date(now.getTime() + (o.leaseSeconds ?? DEFAULT_LEASE_SECONDS) * 1000);
  return tx(pool, async (c) => {
    await failExhausted(c, now, o.jobId);
    const r = await c.query(
      `with next as (
         select t.id from research_tasks t join research_jobs j on j.id = t.job_id
          where j.status in ('queued','running') and (t.status = 'pending' or (t.status = 'running' and t.lease_until < $1))
            and ($3::uuid is null or t.job_id = $3) and ($4::uuid is null or t.id = $4)
          order by t.updated_at, t.id limit 1 for update of t skip locked)
       update research_tasks t set status = 'running', attempts = t.attempts + 1, lease_until = $2, worker = $5, updated_at = $1
         from next where t.id = next.id returning t.id, t.job_id, t.source_id, t.ine_code, t.cursor, t.attempts`,
      [now, lease, o.jobId ?? null, o.taskId ?? null, o.workerId]);
    const t = r.rows[0] as { id: string; job_id: string; source_id: string; ine_code: string | null; cursor: unknown; attempts: number } | undefined;
    if (!t) return null;
    await c.query(`update research_jobs set status = 'running' where id = $1 and status = 'queued'`, [t.job_id]);
    const j = (await c.query('select segment_id, max_candidates, stats from research_jobs where id = $1', [t.job_id])).rows[0] as { segment_id: string; max_candidates: number; stats: Partial<JobStats> };
    return { id: t.id, jobId: t.job_id, segmentId: j.segment_id, sourceId: t.source_id, ineCode: t.ine_code, cursor: t.cursor, attempts: t.attempts, remainingBatch: Math.max(0, j.max_candidates - (j.stats.candidates ?? 0)) };
  });
}

export interface FinishInfo {
  candidates: number;
  costEur: number;
  cursor?: unknown;
}

/** Cierra una tarea en curso. Si ya no estaba en curso (otro worker la retomó), no hace nada. */
export async function finishTask(pool: Db, taskId: string, info: FinishInfo, now: Date = new Date()): Promise<{ applied: boolean }> {
  return tx(pool, async (c) => {
    const t = (await c.query(`select job_id from research_tasks where id = $1 and status = 'running' for update`, [taskId])).rows[0] as { job_id: string } | undefined;
    if (!t) return { applied: false };
    await c.query(`update research_tasks set status = 'done', cursor = $2, stats = $3, lease_until = null, error = null, updated_at = $4 where id = $1`,
      [taskId, info.cursor === undefined ? null : JSON.stringify(info.cursor), JSON.stringify({ candidates: info.candidates, cost_eur: info.costEur }), now]);
    await addToJob(c, t.job_id, info.candidates, info.costEur);
    await applyBrakes(c, t.job_id);
    await rollup(c, t.job_id);
    return { applied: true };
  });
}

/**
 * Un fallo devuelve la tarea a la cola hasta `MAX_ATTEMPTS` intentos; después queda fallida y el trabajo sigue con el resto (RES-03).
 * Con `final` (la fuente ya agotó sus propios reintentos con espera) queda fallida al primer intento: no se vuelve a golpear una fuente caída.
 */
export async function failTask(pool: Db, taskId: string, error: string, now: Date = new Date(), extra: { costEur?: number; final?: boolean } = {}): Promise<{ applied: boolean }> {
  return tx(pool, async (c) => {
    const t = (await c.query(`select job_id, attempts from research_tasks where id = $1 and status = 'running' for update`, [taskId])).rows[0] as { job_id: string; attempts: number } | undefined;
    if (!t) return { applied: false };
    await c.query(`update research_tasks set status = $2, error = $3, lease_until = null, updated_at = $4 where id = $1`, [taskId, extra.final || t.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error.slice(0, 500), now]);
    if (extra.costEur) await addToJob(c, t.job_id, 0, extra.costEur);
    await applyBrakes(c, t.job_id);
    await rollup(c, t.job_id);
    return { applied: true };
  });
}

async function control(pool: Db, jobId: string, actor: string, from: string[], to: string, action: string): Promise<boolean> {
  return tx(pool, async (c) => {
    const j = await lockJob(c, jobId);
    if (!j || !from.includes(j.status)) return false;
    await c.query('update research_jobs set status = $2 where id = $1', [jobId, to]);
    if (to === 'cancelled') await c.query(`update research_tasks set status = 'skipped', updated_at = now() where job_id = $1 and status = 'pending'`, [jobId]);
    await audit(c, actor, action, jobId, { from: j.status, to });
    return true;
  });
}

export const pauseJob = (pool: Db, jobId: string, actor: string): Promise<boolean> => control(pool, jobId, actor, ['queued', 'running'], 'paused', 'research.paused');
export const resumeJob = (pool: Db, jobId: string, actor: string): Promise<boolean> => control(pool, jobId, actor, ['paused'], 'running', 'research.resumed');
export const cancelJob = (pool: Db, jobId: string, actor: string): Promise<boolean> => control(pool, jobId, actor, ['queued', 'running', 'paused'], 'cancelled', 'research.cancelled');

export interface Progress {
  jobId: string;
  status: string;
  tasks: Record<'pending' | 'running' | 'done' | 'failed' | 'skipped', number>;
  candidates: number;
  costEur: number;
  maxCandidates: number;
  budgetEur: number;
  stopReason: string | null;
  errorsBySource: Array<{ sourceId: string; failed: number; lastError: string | null }>;
}

/** Datos del panel (CA4): avance, coste acumulado y errores por fuente. */
export async function getProgress(pool: Db, jobId: string): Promise<Progress> {
  const j = (await pool.query('select status, max_candidates, budget_eur, stats from research_jobs where id = $1', [jobId])).rows[0] as JobRow | undefined;
  if (!j) throw new Error('Trabajo no encontrado');
  const tasks = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const r of (await pool.query('select status, count(*) n from research_tasks where job_id = $1 group by status', [jobId])).rows as Array<{ status: keyof typeof tasks; n: string }>) tasks[r.status] = Number(r.n);
  const errs = (await pool.query(
    `select source_id, count(*) filter (where status = 'failed') failed, (array_agg(error order by updated_at desc) filter (where error is not null))[1] last_error
       from research_tasks where job_id = $1 group by source_id having count(*) filter (where status = 'failed') > 0 order by source_id`, [jobId])).rows as Array<{ source_id: string; failed: string; last_error: string | null }>;
  return {
    jobId, status: j.status, tasks, candidates: j.stats.candidates ?? 0, costEur: j.stats.cost_eur ?? 0, maxCandidates: j.max_candidates, budgetEur: Number(j.budget_eur),
    stopReason: j.stats.stop_reason ?? null, errorsBySource: errs.map((e) => ({ sourceId: e.source_id, failed: Number(e.failed), lastError: e.last_error })),
  };
}

export interface JobSummary {
  id: string;
  segmentName: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  maxCandidates: number;
  budgetEur: number;
  candidates: number;
  costEur: number;
  stopReason: string | null;
  tasks: Progress['tasks'];
  lastError: string | null;
}

/** Trabajos recientes con su avance, para el panel (CA4). */
export async function listResearchJobs(pool: Db, limit: number): Promise<JobSummary[]> {
  const r = await pool.query(
    `select j.id, s.name as segment_name, j.status, j.created_by, j.created_at, j.max_candidates, j.budget_eur, j.stats,
            c.pending, c.running, c.done, c.failed, c.skipped, c.last_error
       from research_jobs j join segments s on s.id = j.segment_id
       left join lateral (
         select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'running')::int as running,
                count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'failed')::int as failed,
                count(*) filter (where status = 'skipped')::int as skipped,
                (array_agg(error order by updated_at desc) filter (where status = 'failed' and error is not null))[1] as last_error
           from research_tasks where job_id = j.id) c on true
      order by j.created_at desc, j.id desc limit $1`, [limit]);
  return (r.rows as Array<Record<string, unknown>>).map((x) => {
    const st = (x.stats ?? {}) as Partial<JobStats>;
    return {
      id: x.id as string, segmentName: x.segment_name as string, status: x.status as string, createdBy: x.created_by as string, createdAt: x.created_at as Date,
      maxCandidates: x.max_candidates as number, budgetEur: Number(x.budget_eur), candidates: st.candidates ?? 0, costEur: st.cost_eur ?? 0, stopReason: st.stop_reason ?? null,
      tasks: { pending: x.pending as number, running: x.running as number, done: x.done as number, failed: x.failed as number, skipped: x.skipped as number }, lastError: x.last_error as string | null,
    };
  });
}

export interface Heartbeat {
  workerId: string;
  llmEnabled: boolean;
  at: Date;
}

/** El worker marca que sigue vivo; el panel lo lee para avisar si no hay worker en marcha. */
export async function touchWorkerHeartbeat(pool: Db, h: { workerId: string; llmEnabled: boolean }, at: Date = new Date()): Promise<void> {
  await pool.query(
    `insert into settings (key, value, updated_by) values ('worker_heartbeat', $1, 'worker')
       on conflict (key) do update set value = excluded.value, updated_by = 'worker', updated_at = now()`,
    [JSON.stringify({ workerId: h.workerId, llmEnabled: h.llmEnabled, at: at.toISOString() })]);
}

export async function getWorkerHeartbeat(pool: Db): Promise<Heartbeat | null> {
  const v = (await pool.query(`select value from settings where key = 'worker_heartbeat'`)).rows[0] as { value: { workerId: string; llmEnabled: boolean; at: string } } | undefined;
  return v ? { workerId: v.value.workerId, llmEnabled: v.value.llmEnabled, at: new Date(v.value.at) } : null;
}
