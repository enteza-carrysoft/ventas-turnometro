import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from './uuid.js';

const inputSchema = z
  .object({
    actor: z.string().trim().min(1),
    origin: z.string().trim().min(1), // 'unsubscribe' | 'call' | 'email_reply' | 'crm' | 'sales' | 'letter_return'
    reason: z.string().trim().min(1),
    prospectId: z.uuid().nullish(),
    phone: z.string().trim().min(1).nullish(),
    email: z.string().trim().min(1).nullish(),
  })
  .refine((v) => v.prospectId || v.phone || v.email, { message: 'hace falta ficha, teléfono o email' });

export type OppositionInput = z.input<typeof inputSchema>;
export interface OppositionResult {
  suppressions: number;
  withdrawnConsents: number;
  cancelledAttempts: number;
  cancelledDemos: number;
  /** oportunidades abiertas cerradas como perdidas por oposición */
  closedDeals: number;
  cancelledTasks: number;
}

type Row = Record<string, unknown>;

async function suppress(c: pg.PoolClient, kind: string, value: string, a: z.output<typeof inputSchema>): Promise<number> {
  const r = await c.query(
    `insert into suppressions (id, kind, value, reason, origin, created_by)
     select $1,$2,$3,$4,$5,$6 where not exists (select 1 from suppressions where kind = $2 and lower(value) = lower($3))`,
    [uuidv7(), kind, value, a.reason, a.origin, a.actor],
  );
  return r.rowCount ?? 0;
}

async function withdrawConsents(c: pg.PoolClient, a: z.output<typeof inputSchema>): Promise<number> {
  const open = await c.query(
    `select distinct g.channel, g.purpose, g.phone, g.email, g.prospect_id from consents g
     where g.action = 'grant' and (g.prospect_id = $1 or g.phone = $2 or lower(g.email) = lower($3))
       and not exists (select 1 from consents w where w.action = 'withdraw' and w.channel = g.channel
         and w.phone is not distinct from g.phone and lower(w.email) is not distinct from lower(g.email)
         and w.created_at >= g.created_at)`,
    [a.prospectId ?? null, a.phone ?? null, a.email ?? null],
  );
  const seen = new Set<string>();
  let n = 0;
  for (const g of open.rows as Row[]) {
    const key = `${g.channel}|${g.phone ?? ''}|${g.email ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await c.query(
      `insert into consents (id, prospect_id, channel, purpose, action, phone, email, text_version, text_snapshot, source_url)
       values ($1,$2,$3,$4,'withdraw',$5,$6,'oposicion-v1',$7,$8)`,
      [uuidv7(), g.prospect_id, g.channel, g.purpose, g.phone, g.email, `Retirada por oposición (${a.origin}): ${a.reason}`, `urn:opposition:${a.origin}`],
    );
    n++;
  }
  return n;
}

/** Cierra como perdida («oposición») la oportunidad abierta de la ficha y cancela sus tareas abiertas. Las cerradas no se tocan. */
async function closeCrm(c: pg.PoolClient, prospectId: string, a: z.output<typeof inputSchema>): Promise<{ closedDeals: number; cancelledTasks: number }> {
  const open = (await c.query(`select id, stage_id from deals where prospect_id = $1 and closed_at is null for update`, [prospectId])).rows as Array<{ id: string; stage_id: string }>;
  for (const d of open) {
    await c.query(`update deals set stage_id = 'lost', lost_reason_id = 'opposition', closed_at = now(), updated_at = now() where id = $1`, [d.id]);
    await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'deal.stage_changed','deal',$2,$3)`,
      [a.actor, d.id, JSON.stringify({ prospect_id: prospectId, from: d.stage_id, to: 'lost', reason: 'opposition', origin: a.origin })]);
  }
  const tasks = await c.query(`update tasks set status = 'cancelled' where prospect_id = $1 and status = 'open'`, [prospectId]);
  return { closedDeals: open.length, cancelledTasks: tasks.rowCount ?? 0 };
}

/** Intentos planificados hacia un destino concreto (también cuando la oposición es de un solo contacto, sin ficha). */
async function cancelAttemptsTo(c: pg.PoolClient, a: z.output<typeof inputSchema>): Promise<number> {
  const dests = [a.phone, a.email?.toLowerCase()].filter((x): x is string => !!x);
  if (dests.length === 0) return 0;
  return (await c.query(`update contact_attempts set status = 'cancelled', updated_at = now() where status = 'planned' and lower(destination) = any($1::text[])`, [dests])).rowCount ?? 0;
}

/**
 * REQ-CNS-03 y T-14: en UNA transacción inserta las exclusiones (teléfono, email y, si hay ficha, ficha y dominio), retira los consentimientos
 * vigentes, cancela intentos planificados, demos pendientes y tareas abiertas, cierra la oportunidad abierta como perdida por «oposición»,
 * bloquea la ficha y audita. Es idempotente. Si algo falla, no queda nada a medias.
 */
export async function applyOpposition(pool: pg.Pool, raw: OppositionInput): Promise<OppositionResult> {
  const a = inputSchema.parse(raw);
  const c = await pool.connect();
  try {
    await c.query('begin');
    const res: OppositionResult = { suppressions: 0, withdrawnConsents: 0, cancelledAttempts: 0, cancelledDemos: 0, closedDeals: 0, cancelledTasks: 0 };
    let domain: string | null = null;
    if (a.prospectId) {
      const p = await c.query('select domain from prospects where id = $1 for update', [a.prospectId]);
      if (!p.rows[0]) throw new Error('ficha no encontrada');
      domain = ((p.rows[0] as Row).domain as string | null) ?? null;
      res.suppressions += await suppress(c, 'prospect', a.prospectId, a);
      if (domain) res.suppressions += await suppress(c, 'domain', domain, a);
    }
    if (a.phone) res.suppressions += await suppress(c, 'phone', a.phone, a);
    if (a.email) res.suppressions += await suppress(c, 'email', a.email.toLowerCase(), a);
    res.withdrawnConsents = await withdrawConsents(c, a);
    if (a.prospectId) {
      res.cancelledAttempts = (await c.query(`update contact_attempts set status = 'cancelled', updated_at = now() where prospect_id = $1 and status = 'planned'`, [a.prospectId])).rowCount ?? 0;
      Object.assign(res, await closeCrm(c, a.prospectId, a));
      res.cancelledDemos = (await c.query(`update demos set status = 'cancelled' where prospect_id = $1 and status in ('booked','confirmed')`, [a.prospectId])).rowCount ?? 0;
      await c.query(`update prospects set status = 'blocked', block_reason = 'opposition', updated_at = now() where id = $1`, [a.prospectId]);
    }
    res.cancelledAttempts += await cancelAttemptsTo(c, a); // los de la ficha ya están cancelados: aquí caen solo los de ese destino que cuelguen de otras fichas
    await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'opposition.apply','prospect',$2,$3)`, [a.actor, a.prospectId ?? null, JSON.stringify({ origin: a.origin, reason: a.reason, ...res })]);
    await c.query('commit');
    return res;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
