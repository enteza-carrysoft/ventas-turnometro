import { classifyEmail, containsPersonName, normalizeAddress, normalizeName, normalizePhone, proposeSample, registrableDomain } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';
import { REVIEWABLE } from './review-read.js';

export { exportApprovedCsv, getCard, listQueue, REVIEWABLE, type Card, type QueueItem } from './review-read.js';

// Revisión humana (REQ-REV-02): aprobar, corregir un campo, descartar con motivo y bloquear. Aprobar NO contacta con nadie: solo habilita
// la ficha para planificar acciones (CA1). Todo queda en `audit_log` con quién lo hizo.

type Db = pg.Pool;
type Client = pg.PoolClient;
export type Reviewer = { userId: string; role: 'admin' | 'marketing' | 'sales' | 'auditor' | 'voice' | null };
const canReview = (a: Reviewer): boolean => a.role === 'admin' || a.role === 'marketing';

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

const audit = (c: Client, actor: string, action: string, id: string, payload: unknown): Promise<unknown> =>
  c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,$2,'prospect',$3,$4)`, [actor, action, id, JSON.stringify(payload)]);

async function lockStatus(c: Client, id: string): Promise<string | undefined> {
  return ((await c.query('select status from prospects where id = $1 for update', [id])).rows[0] as { status: string } | undefined)?.status;
}

export type ReviewInput = { action: 'approve' } | { action: 'discard'; reason: string } | { action: 'block'; reason: string };
export type ReviewResult = { ok: true; status: string } | { ok: false; reason: 'forbidden' | 'not_found' | 'not_reviewable' | 'reason_required' };

const FROM: Record<ReviewInput['action'], readonly string[]> = {
  approve: REVIEWABLE,
  discard: ['candidate', 'enriched', 'pending_review', 'approved'],
  block: ['candidate', 'enriched', 'pending_review', 'approved'],
};
const TO = { approve: 'approved', discard: 'discarded', block: 'blocked' } as const;

export async function reviewProspect(pool: Db, id: string, who: Reviewer, input: ReviewInput, extra: Record<string, unknown> = {}): Promise<ReviewResult> {
  if (!canReview(who)) return { ok: false, reason: 'forbidden' };
  const reason = input.action === 'approve' ? null : input.reason.trim();
  if (input.action !== 'approve' && !reason) return { ok: false, reason: 'reason_required' };
  return tx(pool, async (c) => {
    const st = await lockStatus(c, id);
    if (st === undefined) return { ok: false, reason: 'not_found' } as const;
    if (!FROM[input.action].includes(st)) return { ok: false, reason: 'not_reviewable' } as const;
    const to = TO[input.action];
    await c.query(
      `update prospects set status = $2, block_reason = case when $2 = 'blocked' then $3 else block_reason end, reviewed_by = $4, reviewed_at = now(), updated_at = now() where id = $1`,
      [id, to, reason === null ? null : `manual: ${reason}`, who.userId]);
    const action = input.action === 'approve' ? 'prospect.approved' : input.action === 'discard' ? 'prospect.discarded' : 'prospect.blocked_manual';
    await audit(c, who.userId, action, id, { from: st, to, ...(reason ? { reason } : {}), ...extra });
    return { ok: true, status: to } as const;
  });
}

export type CorrectInput = { field: 'name' | 'website' | 'sites_count'; value: string };
export type CorrectResult = { ok: true } | { ok: false; reason: 'forbidden' | 'invalid_field' | 'not_found' | 'not_reviewable' | 'invalid_value' | 'domain_taken' };

/** Aplica la corrección y devuelve las columnas a actualizar, o `null` si el valor no es válido. */
function applyCorrection(input: CorrectInput): { sql: string; args: unknown[] } | null {
  const value = input.value.trim();
  if (input.field === 'name') return value.length >= 2 ? { sql: 'name = $2, name_norm = $3', args: [value, normalizeName(value)] } : null;
  if (input.field === 'sites_count') return /^\d{1,3}$/.test(value) && Number(value) >= 1 ? { sql: 'sites_count = $2', args: [Number(value)] } : null;
  try {
    const u = new URL(value);
    const domain = u.protocol === 'http:' || u.protocol === 'https:' ? registrableDomain(u.hostname) : null;
    return domain ? { sql: 'website = $2, domain = $3', args: [value, domain] } : null;
  } catch {
    return null;
  }
}

export async function correctField(pool: Db, id: string, who: Reviewer, input: CorrectInput): Promise<CorrectResult> {
  if (!canReview(who)) return { ok: false, reason: 'forbidden' };
  if (!['name', 'website', 'sites_count'].includes(input.field)) return { ok: false, reason: 'invalid_field' };
  try {
    return await tx(pool, async (c): Promise<CorrectResult> => {
      const st = await lockStatus(c, id);
      if (st === undefined) return { ok: false, reason: 'not_found' };
      if (!['candidate', ...REVIEWABLE].includes(st)) return { ok: false, reason: 'not_reviewable' };
      const fix = applyCorrection(input);
      if (!fix) return { ok: false, reason: 'invalid_value' };
      await c.query(`update prospects set ${fix.sql}, updated_at = now() where id = $1`, [id, ...fix.args]);
      await c.query(
        `insert into evidences (id, prospect_id, field, value, provenance, source_url, fetched_at, extractor_version) values ($1,$2,$3,$4,'observed',$5,now(),'manual-review') on conflict do nothing`,
        [uuidv7(), id, input.field, input.value.trim(), `revision-manual://${who.userId}`]);
      await audit(c, who.userId, 'prospect.corrected', id, { field: input.field, value: input.value.trim() });
      return { ok: true };
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'domain_taken' };
    throw e;
  }
}

/** Canales que el revisor puede añadir a mano. `personal_email` no existe aquí: REQ-ENR-03 lo descarta siempre. */
export const MANUAL_CONTACT_TYPES = ['generic_email', 'switchboard_phone', 'mobile_phone', 'postal_address', 'web_form', 'booking_url'] as const;
export type ManualContactType = (typeof MANUAL_CONTACT_TYPES)[number];
export interface AddContactInput { type: ManualContactType; value: string; sourceUrl: string }
export type AddContactResult = { ok: true } | { ok: false; reason: 'forbidden' | 'invalid_field' | 'invalid_value' | 'invalid_source' | 'personal_email' | 'not_found' | 'not_reviewable' | 'already_exists' };

const httpUrl = (raw: string): string | null => {
  try {
    const u = new URL(raw.trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
};

/** Valida y normaliza con las mismas reglas que la extracción automática (REQ-ENR-03, REQ-VER-01): el revisor no se salta ninguna. */
function manualContact(input: AddContactInput): { type: ManualContactType; value: string; norm: string } | 'invalid_value' | 'personal_email' {
  const v = input.value.trim();
  if (!v || v.length > 300) return 'invalid_value';
  switch (input.type) {
    case 'generic_email': {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'invalid_value';
      if (classifyEmail(v) === 'personal_email') return 'personal_email';
      return { type: 'generic_email', value: v.toLowerCase(), norm: v.toLowerCase() };
    }
    case 'switchboard_phone':
    case 'mobile_phone': {
      const p = normalizePhone(v);
      if (!p.e164 || p.notCallable) return 'invalid_value';
      const type = p.kind === 'mobile' ? 'mobile_phone' : 'switchboard_phone';
      return { type, value: p.e164, norm: p.e164 };
    }
    case 'postal_address':
      return containsPersonName(v) ? 'invalid_value' : { type: 'postal_address', value: v, norm: normalizeAddress(v) };
    case 'web_form':
    case 'booking_url': {
      const u = httpUrl(v);
      return u ? { type: input.type, value: u, norm: u } : 'invalid_value';
    }
  }
}

/**
 * Añade a mano un canal de contacto que el revisor ha encontrado (p. ej. el email genérico que la IA no extrajo). Exige la página donde se vio,
 * que queda como evidencia «observed» de revisión manual. Añadir un canal no contacta con nadie: su uso sigue pasando por la puerta (P1).
 */
export async function addContactPoint(pool: Db, id: string, who: Reviewer, input: AddContactInput): Promise<AddContactResult> {
  if (!canReview(who)) return { ok: false, reason: 'forbidden' };
  if (!(MANUAL_CONTACT_TYPES as readonly string[]).includes(input.type)) return { ok: false, reason: 'invalid_field' };
  const source = httpUrl(input.sourceUrl ?? '');
  if (!source) return { ok: false, reason: 'invalid_source' };
  const c = manualContact(input);
  if (typeof c === 'string') return { ok: false, reason: c };
  return tx(pool, async (cl): Promise<AddContactResult> => {
    const st = await lockStatus(cl, id);
    if (st === undefined) return { ok: false, reason: 'not_found' };
    if (!['candidate', ...REVIEWABLE].includes(st)) return { ok: false, reason: 'not_reviewable' };
    const dup = await cl.query('select 1 from contact_points where prospect_id = $1 and type = $2 and value_norm = $3', [id, c.type, c.norm]);
    if (dup.rowCount) return { ok: false, reason: 'already_exists' };
    const ev = await cl.query(
      `insert into evidences (id, prospect_id, field, value, provenance, source_url, fetched_at, extractor_version) values ($1,$2,$3,$4,'observed',$5,now(),'manual-review')
       on conflict (prospect_id, field, coalesce(value, ''), source_url) do update set fetched_at = excluded.fetched_at returning id`,
      [uuidv7(), id, `contact:${c.type}`, c.value, source]);
    await cl.query(`insert into contact_points (id, prospect_id, type, value, value_norm, evidence_id) values ($1,$2,$3,$4,$5,$6)`,
      [uuidv7(), id, c.type, c.value, c.norm, (ev.rows[0] as { id: string }).id]);
    await cl.query(`update prospects set updated_at = now() where id = $1`, [id]);
    await audit(cl, who.userId, 'prospect.contact_added', id, { type: c.type, value: c.value, sourceUrl: source });
    return { ok: true };
  });
}

export interface BulkResult {
  approved: string[];
  /** muestra de calidad: se queda en la cola para revisarla una a una */
  sample: string[];
  skipped: Array<{ id: string; reason: 'not_found' | 'not_reviewable' }>;
  forbidden?: true;
}

/** Aprueba en bloque, salvo una muestra al azar de al menos el 10 % que el revisor debe mirar una a una (CA3). */
export async function bulkApprove(pool: Db, ids: string[], who: Reviewer, rng: () => number = Math.random): Promise<BulkResult> {
  if (!canReview(who)) return { approved: [], sample: [], skipped: [], forbidden: true };
  const unique = [...new Set(ids)];
  const found = (await pool.query('select id, status from prospects where id = any($1::uuid[])', [unique])).rows as Array<{ id: string; status: string }>;
  const byId = new Map(found.map((r) => [r.id, r.status]));
  const skipped: BulkResult['skipped'] = [];
  const reviewable: string[] = [];
  for (const id of unique) {
    const st = byId.get(id);
    if (st === undefined) skipped.push({ id, reason: 'not_found' });
    else if (!(REVIEWABLE as readonly string[]).includes(st)) skipped.push({ id, reason: 'not_reviewable' });
    else reviewable.push(id);
  }
  const sample = proposeSample(reviewable, rng);
  const approved: string[] = [];
  for (const id of reviewable.filter((x) => !sample.includes(x))) {
    const r = await reviewProspect(pool, id, who, { action: 'approve' }, { bulk: true });
    if (r.ok) approved.push(id);
    else skipped.push({ id, reason: r.reason === 'not_found' ? 'not_found' : 'not_reviewable' });
  }
  return { approved, sample, skipped };
}
