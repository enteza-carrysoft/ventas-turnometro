import type pg from 'pg';

// Activar o desactivar una fuente de `allowed_sources` (REQ-RES-01 CA1: solo se consultan las activas). Es una decisión con implicaciones de
// licencia, así que exige actor y motivo y queda en `audit_log`.

export type SetSourceResult = { ok: true; changed: boolean } | { ok: false; reason: 'not_found' | 'reason_required' };

export async function setSourceActive(pool: pg.Pool, id: string, active: boolean, o: { actor: string; reason: string }): Promise<SetSourceResult> {
  if (!o.actor.trim() || !o.reason.trim()) return { ok: false, reason: 'reason_required' };
  const c = await pool.connect();
  try {
    await c.query('begin');
    const cur = (await c.query('select active from allowed_sources where id = $1 for update', [id])).rows[0] as { active: boolean } | undefined;
    if (!cur) { await c.query('rollback'); return { ok: false, reason: 'not_found' }; }
    if (cur.active === active) { await c.query('rollback'); return { ok: true, changed: false }; }
    await c.query('update allowed_sources set active = $2 where id = $1', [id, active]);
    await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'source.set_active','allowed_source',$2,$3)`, [o.actor, id, JSON.stringify({ active, reason: o.reason.trim() })]);
    await c.query('commit');
    return { ok: true, changed: true };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
