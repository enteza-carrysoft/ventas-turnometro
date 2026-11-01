import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Textos de consentimiento versionados. El formulario guarda copia literal en `consents.text_snapshot`; aquí vive la versión vigente.

export const CONSENT_BOXES = ['privacy', 'email', 'human_call', 'ai_call', 'sms_whatsapp'] as const;
export type ConsentBox = (typeof CONSENT_BOXES)[number];
export type TextActor = { userId: string; role: 'admin' | 'marketing' | 'sales' | 'auditor' | 'voice' | null };

export interface ConsentTextRow {
  id: string;
  version: string;
  text: string;
  approved: boolean;
}
export type CurrentTexts =
  | { ok: true; texts: Record<ConsentBox, ConsentTextRow>; allApproved: boolean }
  | { ok: false; unapproved: ConsentBox[] };

/**
 * Textos vigentes: la última versión APROBADA de cada casilla; si no hay y no se exige aprobación (sandbox), la última en borrador.
 * Con `requireApproved` (producción), si falta alguna aprobada devuelve `ok:false` y la página no muestra el formulario (G2).
 */
export async function currentConsentTexts(pool: pg.Pool, o: { requireApproved: boolean }): Promise<CurrentTexts> {
  const rows = (await pool.query('select id, box, version, text, status from consent_texts order by (status = \'approved\') desc, coalesce(approved_at, created_at) desc, created_at desc')).rows as
    Array<{ id: string; box: ConsentBox; version: string; text: string; status: string }>;
  const texts: Partial<Record<ConsentBox, ConsentTextRow>> = {};
  const unapproved: ConsentBox[] = [];
  for (const box of CONSENT_BOXES) {
    const best = rows.find((r) => r.box === box && (r.status === 'approved' || !o.requireApproved));
    if (!best) { unapproved.push(box); continue; }
    texts[box] = { id: best.id, version: best.version, text: best.text, approved: best.status === 'approved' };
    if (best.status !== 'approved') unapproved.push(box);
  }
  if (o.requireApproved && unapproved.length > 0) return { ok: false, unapproved };
  if (CONSENT_BOXES.some((b) => !texts[b])) return { ok: false, unapproved };
  return { ok: true, texts: texts as Record<ConsentBox, ConsentTextRow>, allApproved: unapproved.length === 0 };
}

const VERSION = /^[A-Za-z0-9._-]{1,30}$/;

export async function createConsentTextDraft(
  pool: pg.Pool, box: ConsentBox, v: { version: string; text: string }, actor: TextActor,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'forbidden' | 'invalid' | 'version_exists' }> {
  if (actor.role !== 'admin') return { ok: false, reason: 'forbidden' };
  const text = v.text.trim();
  if (!CONSENT_BOXES.includes(box) || !VERSION.test(v.version) || text === '') return { ok: false, reason: 'invalid' };
  const id = uuidv7();
  try {
    await pool.query(`insert into consent_texts (id, box, version, text, created_by) values ($1,$2,$3,$4,$5)`, [id, box, v.version, text, actor.userId]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'version_exists' };
    throw e;
  }
  await pool.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'consent_text.created','consent_text',$2,$3)`, [actor.userId, id, JSON.stringify({ box, version: v.version })]);
  return { ok: true, id };
}

export async function approveConsentText(
  pool: pg.Pool, id: string, actor: TextActor,
): Promise<{ ok: true } | { ok: false; reason: 'forbidden' | 'not_found' | 'already_approved' }> {
  if (actor.role !== 'admin') return { ok: false, reason: 'forbidden' };
  const cur = (await pool.query('select box, version, status from consent_texts where id = $1', [id])).rows[0] as { box: string; version: string; status: string } | undefined;
  if (!cur) return { ok: false, reason: 'not_found' };
  if (cur.status === 'approved') return { ok: false, reason: 'already_approved' };
  const r = await pool.query(`update consent_texts set status = 'approved', approved_by = $2, approved_at = now() where id = $1 and status = 'draft'`, [id, actor.userId]);
  if (!r.rowCount) return { ok: false, reason: 'already_approved' };
  await pool.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'consent_text.approved','consent_text',$2,$3)`, [actor.userId, id, JSON.stringify({ box: cur.box, version: cur.version })]);
  return { ok: true };
}
