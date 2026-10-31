import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Cola de trabajo del worker: enriquecimiento de candidatas y peticiones del panel. Todo con arrendamientos y reintentos acotados, para que
// un fallo no se reintente eternamente (ni gaste de más) y para que dos workers no hagan lo mismo.

type Db = pg.Pool;
export const MAX_ENRICH_ATTEMPTS = 3;
export const MAX_REQUEST_ATTEMPTS = 3;
const REQUEST_LEASE_SECONDS = 900;

/** Candidatas con web pendientes de enriquecer. Cada reclamo cuenta un intento y programa el siguiente (1 h, 6 h, 24 h). */
export async function claimEnrichable(pool: Db, o: { limit: number; now?: Date | undefined }): Promise<string[]> {
  const now = o.now ?? new Date();
  const r = await pool.query(
    `with c as (
       select id, enrich_attempts from prospects
        where status = 'candidate' and website is not null and enrich_attempts < $3 and (enrich_next_at is null or enrich_next_at <= $1)
        order by created_at, id limit $2 for update skip locked)
     update prospects p set enrich_attempts = c.enrich_attempts + 1,
            enrich_next_at = $1::timestamptz + (case c.enrich_attempts + 1 when 1 then interval '1 hour' when 2 then interval '6 hours' else interval '24 hours' end)
       from c where p.id = c.id returning p.id`, [now, o.limit, MAX_ENRICH_ATTEMPTS]);
  return (r.rows as Array<{ id: string }>).map((x) => x.id);
}

/** Devuelve el intento de fichas que no se pudieron procesar por un fallo del sistema (p. ej. presupuesto agotado), no de la ficha. */
export async function unclaimEnrichable(pool: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(`update prospects set enrich_attempts = greatest(enrich_attempts - 1, 0), enrich_next_at = null where id = any($1::uuid[]) and status = 'candidate'`, [ids]);
}

export async function recordEnrichFailure(pool: Db, prospectId: string, error: string): Promise<void> {
  await pool.query('update prospects set enrich_error = left($2, 300) where id = $1', [prospectId, error]);
}

export interface EnrichBacklog {
  waiting: number;
  failed: number;
  noWebsite: number;
}

/** Para el panel: cuántas candidatas esperan, cuántas agotaron los intentos y cuántas no tienen web. */
export async function enrichBacklog(pool: Db): Promise<EnrichBacklog> {
  const r = (await pool.query(
    `select count(*) filter (where website is not null and enrich_attempts < $1)::int as waiting,
            count(*) filter (where website is not null and enrich_attempts >= $1)::int as failed,
            count(*) filter (where website is null)::int as no_website
       from prospects where status = 'candidate'`, [MAX_ENRICH_ATTEMPTS])).rows[0] as { waiting: number; failed: number; no_website: number };
  return { waiting: r.waiting, failed: r.failed, noWebsite: r.no_website };
}

export type RequestKind = 'market.analyze';
const KINDS: readonly RequestKind[] = ['market.analyze'];

export async function requestWork(pool: Db, kind: RequestKind, payload: unknown, requestedBy: string): Promise<string> {
  if (!KINDS.includes(kind)) throw new Error(`Tipo de petición desconocido: ${kind}`);
  const id = uuidv7();
  await pool.query(`insert into worker_requests (id, kind, payload, requested_by) values ($1,$2,$3,$4)`, [id, kind, JSON.stringify(payload ?? {}), requestedBy]);
  return id;
}

export interface ClaimedRequest {
  id: string;
  kind: RequestKind;
  payload: unknown;
  attempts: number;
}

export async function claimRequest(pool: Db, o: { now?: Date | undefined; leaseSeconds?: number | undefined } = {}): Promise<ClaimedRequest | null> {
  const now = o.now ?? new Date();
  const lease = new Date(now.getTime() + (o.leaseSeconds ?? REQUEST_LEASE_SECONDS) * 1000);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `update worker_requests set status = 'failed', error = coalesce(error, 'arrendamiento caducado tras el máximo de intentos'), finished_at = $1
        where status = 'running' and lease_until < $1 and attempts >= $2`, [now, MAX_REQUEST_ATTEMPTS]);
    const r = await c.query(
      `with next as (
         select id from worker_requests where status = 'queued' or (status = 'running' and lease_until < $1)
          order by created_at, id limit 1 for update skip locked)
       update worker_requests w set status = 'running', attempts = w.attempts + 1, started_at = coalesce(w.started_at, $1), lease_until = $2
         from next where w.id = next.id returning w.id, w.kind, w.payload, w.attempts`, [now, lease]);
    await c.query('commit');
    const row = r.rows[0] as ClaimedRequest | undefined;
    return row ?? null;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Cierra solo una petición que sigue en curso (si otro worker la retomó o ya terminó, no hace nada). */
export async function finishRequest(pool: Db, id: string, result: unknown, now: Date = new Date()): Promise<{ applied: boolean }> {
  const r = await pool.query(`update worker_requests set status = 'done', result = $2, finished_at = $3, lease_until = null where id = $1 and status = 'running'`, [id, JSON.stringify(result ?? {}), now]);
  return { applied: (r.rowCount ?? 0) > 0 };
}

export async function failRequest(pool: Db, id: string, error: string, now: Date = new Date()): Promise<{ applied: boolean }> {
  const r = await pool.query(`update worker_requests set status = 'failed', error = left($2, 500), finished_at = $3, lease_until = null where id = $1 and status = 'running'`, [id, error, now]);
  return { applied: (r.rowCount ?? 0) > 0 };
}

export interface RequestRow {
  id: string;
  kind: RequestKind;
  status: string;
  result: unknown;
  error: string | null;
  requestedBy: string;
  createdAt: Date;
  finishedAt: Date | null;
}

export async function listRequests(pool: Db, kind: RequestKind, limit: number): Promise<RequestRow[]> {
  const r = await pool.query('select id, kind, status, result, error, requested_by, created_at, finished_at from worker_requests where kind = $1 order by created_at desc, id desc limit $2', [kind, limit]);
  return (r.rows as Array<Record<string, unknown>>).map((x) => ({
    id: x.id as string, kind: x.kind as RequestKind, status: x.status as string, result: x.result, error: x.error as string | null,
    requestedBy: x.requested_by as string, createdAt: x.created_at as Date, finishedAt: x.finished_at as Date | null,
  }));
}
