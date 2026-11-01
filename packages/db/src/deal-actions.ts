import { normalizeName } from '@turnosala/core';
import type pg from 'pg';
import { applyOppositionIn } from './opposition.js';

// Acciones sobre oportunidades (REQ-CRM-01, -05, -06). Cada una es UNA transacción con la fila bloqueada: dos cierres simultáneos no dejan dos rastros.
// El rol sale SIEMPRE de la base de datos (`app_user_roles`), nunca de quien llama; el campo `role` del actor es solo informativo.

type Client = pg.PoolClient;
export interface DealActor {
  userId: string;
  /** informativo: no se usa para autorizar */
  role?: string | null | undefined;
}
export type DealFail = 'forbidden' | 'not_found' | 'closed' | 'invalid_stage' | 'invalid_reason' | 'invalid_owner' | 'use_win' | 'use_lose';
export type DealResult = { ok: true } | { ok: false; reason: DealFail };

interface DealRow {
  id: string;
  prospect_id: string;
  stage_id: string;
  owner_user_id: string | null;
  closed_at: Date | null;
}
type Need = 'edit' | 'admin';

const NOTE_MAX = 1000;
const ok: DealResult = { ok: true };
const no = (reason: DealFail): DealResult => ({ ok: false, reason });

async function roleOf(c: Client, userId: string): Promise<string | null> {
  const r = (await c.query('select role from app_user_roles where user_id = $1 limit 1', [userId])).rows[0] as { role: string } | undefined;
  return r?.role ?? null;
}

/** admin: todo. comercial: las suyas o las que nadie tiene. Marketing, auditor, voz y sin rol: nada. */
function allowed(role: string | null, need: Need, d: DealRow, userId: string): boolean {
  if (role === 'admin') return true;
  return need === 'edit' && role === 'sales' && (d.owner_user_id === null || d.owner_user_id === userId);
}

/** Bloquea la oportunidad, comprueba permiso (antes que «cerrada», para no revelar su estado) y ejecuta; confirma solo si salió bien. */
async function withDeal(
  pool: pg.Pool, dealId: string, actor: DealActor, need: Need,
  run: (c: Client, d: DealRow, role: string | null) => Promise<DealResult>,
): Promise<DealResult> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const d = (await c.query('select id, prospect_id, stage_id, owner_user_id, closed_at from deals where id = $1 for update', [dealId])).rows[0] as DealRow | undefined;
    if (!d) { await c.query('rollback'); return no('not_found'); }
    const role = await roleOf(c, actor.userId);
    if (!allowed(role, need, d, actor.userId)) { await c.query('rollback'); return no('forbidden'); }
    if (d.closed_at) { await c.query('rollback'); return no('closed'); }
    const res = await run(c, d, role);
    await c.query(res.ok ? 'commit' : 'rollback');
    return res;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const audit = (c: Client, actor: string, action: string, dealId: string, payload: unknown): Promise<unknown> =>
  c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,$2,'deal',$3,$4)`, [actor, action, dealId, JSON.stringify(payload)]);

/** Cambia de etapa entre las abiertas (se puede retroceder para corregir). Ganar y perder tienen su propia acción. */
export function moveDeal(pool: pg.Pool, dealId: string, toStage: string, actor: DealActor): Promise<DealResult> {
  return withDeal(pool, dealId, actor, 'edit', async (c, d, role) => {
    if (toStage === 'won') return no('use_win');
    if (toStage === 'lost') return no('use_lose');
    if (!(await c.query('select 1 from deal_stages where id = $1', [toStage])).rowCount) return no('invalid_stage');
    if (toStage === d.stage_id) return ok;
    const claim = d.owner_user_id === null && role === 'sales'; // quien mueve una oportunidad sin dueño se la queda
    await c.query('update deals set stage_id = $2, owner_user_id = $3, updated_at = now() where id = $1', [d.id, toStage, claim ? actor.userId : d.owner_user_id]);
    await audit(c, actor.userId, 'deal.stage_changed', d.id, { prospect_id: d.prospect_id, from: d.stage_id, to: toStage, ...(claim ? { claimed_by: actor.userId } : {}) });
    return ok;
  });
}

/**
 * Perder exige un motivo de la lista. Si el motivo aplica oposición («Oposición / no contactar»), la oposición completa (T-14) se aplica en la MISMA transacción:
 * exclusiones, consentimientos retirados, tareas, demos e intentos cancelados, ficha bloqueada. Si algo falla, la oportunidad sigue abierta.
 */
export function loseDeal(pool: pg.Pool, dealId: string, o: { reasonId: string; note?: string | undefined }, actor: DealActor): Promise<DealResult> {
  return withDeal(pool, dealId, actor, 'edit', async (c, d) => {
    const reason = (await c.query('select applies_opposition from lost_reasons where id = $1', [o.reasonId])).rows[0] as { applies_opposition: boolean } | undefined;
    if (!reason) return no('invalid_reason');
    const note = o.note?.trim().slice(0, NOTE_MAX) || null;
    if (reason.applies_opposition) {
      await applyOppositionIn(c, { actor: actor.userId, origin: 'crm', reason: note ? `Oportunidad perdida por oposición: ${note}` : 'Oportunidad perdida por oposición', prospectId: d.prospect_id });
      await c.query('update deals set lost_note = $2 where id = $1', [d.id, note]); // la oposición ya la cerró (motivo «opposition») y la auditó
      return ok;
    }
    await c.query(`update deals set stage_id = 'lost', lost_reason_id = $2, lost_note = $3, closed_at = now(), updated_at = now() where id = $1`, [d.id, o.reasonId, note]);
    await c.query(`update tasks set status = 'cancelled' where deal_id = $1 and status = 'open'`, [d.id]);
    await audit(c, actor.userId, 'deal.stage_changed', d.id, { prospect_id: d.prospect_id, from: d.stage_id, to: 'lost', reason: o.reasonId, ...(note ? { note } : {}) });
    return ok;
  });
}

/**
 * Ganar (solo `admin`, REQ-CRM-06): la ficha queda como cliente (`turnosala_customers`, org_id «manual:<ficha>» hasta que TurnoSala informe del primer pago) y excluida
 * de la prospección: se bloquea con motivo «customer» y se cancelan sus tareas abiertas e intentos planificados.
 */
export function winDeal(pool: pg.Pool, dealId: string, actor: DealActor): Promise<DealResult> {
  return withDeal(pool, dealId, actor, 'admin', async (c, d) => {
    await c.query(`update deals set stage_id = 'won', lost_reason_id = null, closed_at = now(), updated_at = now() where id = $1`, [d.id]);
    const p = (await c.query('select name, domain from prospects where id = $1 for update', [d.prospect_id])).rows[0] as { name: string; domain: string | null };
    await c.query(
      `insert into turnosala_customers (org_id, name, name_norm, domain, prospect_id, refreshed_at) values ($1,$2,$3,$4,$5,now())
       on conflict (org_id) do update set name = excluded.name, name_norm = excluded.name_norm, domain = excluded.domain, refreshed_at = excluded.refreshed_at`,
      [`manual:${d.prospect_id}`, p.name, normalizeName(p.name), p.domain, d.prospect_id]);
    await c.query(`update prospects set status = 'blocked', block_reason = 'customer', updated_at = now() where id = $1`, [d.prospect_id]);
    await c.query(`update tasks set status = 'cancelled' where prospect_id = $1 and status = 'open'`, [d.prospect_id]);
    await c.query(`update contact_attempts set status = 'cancelled', updated_at = now() where prospect_id = $1 and status = 'planned'`, [d.prospect_id]);
    await audit(c, actor.userId, 'deal.stage_changed', d.id, { prospect_id: d.prospect_id, from: d.stage_id, to: 'won', via: 'manual' });
    return ok;
  });
}

/** Solo `admin` reasigna. El destino debe ser un comercial real, o `null` para dejarla sin asignar. */
export function assignDeal(pool: pg.Pool, dealId: string, ownerUserId: string | null, actor: DealActor): Promise<DealResult> {
  return withDeal(pool, dealId, actor, 'admin', async (c, d) => {
    if (ownerUserId !== null && (await roleOf(c, ownerUserId)) !== 'sales') return no('invalid_owner');
    await c.query('update deals set owner_user_id = $2, updated_at = now() where id = $1', [d.id, ownerUserId]);
    await audit(c, actor.userId, 'deal.assigned', d.id, { prospect_id: d.prospect_id, from: d.owner_user_id, to: ownerUserId });
    return ok;
  });
}
