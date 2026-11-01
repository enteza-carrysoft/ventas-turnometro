import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOpposition } from './opposition.js';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

// F2.2 — la oposición completa con el CRM (T-14): cierra la oportunidad como perdida por «oposición», cancela tareas, demos e intentos, todo en una transacción.
let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await t.admin.query(`insert into "user" ("id","name","email","emailVerified") values ('u-sales','Vera','u-sales@x.test',true)`);
}, 60_000);
afterAll(async () => { await t.drop(); });

const q = async <T>(sql: string, a: unknown[] = []): Promise<T[]> => (await t.admin.query(sql, a)).rows as T[];
const count = async (sql: string, a: unknown[] = []): Promise<number> => Number(((await q<{ n: string }>(sql, a))[0] as { n: string }).n);

async function world(over: { dealStage?: string } = {}) {
  n++;
  const email = `ana${n}@opos${n}clinica.es`;
  const phone = `+3495500${String(1000 + n)}`;
  const e = await ingestCandidate(t.app, { name: `Clínica Oposición ${'qwxz'.repeat(n)} S.L.`, website: `https://opos${n}clinica.es/`, sourceId: 'osm', externalId: `o${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const prospectId = e.prospectId as string;
  await t.admin.query(`update prospects set status = 'approved' where id = $1`, [prospectId]);
  const dealId = uuidv7();
  if (over.dealStage !== 'none') {
    const stage = over.dealStage ?? 'interested';
    const closed = stage === 'won' || stage === 'lost';
    await t.admin.query(
      `insert into deals (id, prospect_id, stage_id, owner_user_id, created_by, closed_at, lost_reason_id) values ($1,$2,$3,'u-sales','test',$4,$5)`,
      [dealId, prospectId, stage, closed ? AT : null, stage === 'lost' ? 'no_interest' : null]);
  }
  const taskIds = [uuidv7(), uuidv7(), uuidv7()];
  await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'call','Llamar','u-sales',now(),'test'), ($4,$2,null,'follow_up','Seguimiento','u-sales',now(),'test')`, [taskIds[0], prospectId, over.dealStage === 'none' ? null : dealId, taskIds[1]]);
  await t.admin.query(`insert into tasks (id, prospect_id, kind, title, assignee_user_id, due_at, created_by, status, done_at) values ($1,$2,'other','Ya hecha','u-sales',now(),'test','done',now())`, [taskIds[2], prospectId]);
  const decision = uuidv7();
  await t.admin.query(`insert into compliance_decisions (id, input, prospect_id, channel, direction, destination, decision, rule_ids, reasons) values ($1,'{}',$2,'email','outbound',$3,'ALLOW','{}','{}')`, [decision, prospectId, email]);
  const attempts = { toEmail: uuidv7(), toOther: uuidv7(), sent: uuidv7() };
  for (const [id, dest, status] of [[attempts.toEmail, email, 'planned'], [attempts.toOther, 'otra@parte.es', 'planned'], [attempts.sent, email, 'sent']] as const) {
    await t.admin.query(`insert into contact_attempts (id, prospect_id, channel, purpose, destination, decision_id, status, idempotency_key) values ($1,$2,'email','prospecting',$3,$4,$5,$6)`, [id, prospectId, dest, decision, status, `k-${id}`]);
  }
  const demoId = uuidv7();
  await t.admin.query(`insert into demos (id, prospect_id, deal_id, host_user_id, starts_at, ends_at, booked_via, requester_name, requester_email, status, manage_token) values ($1,$2,$3,'u-sales',$6,$7,'form','Ana',$4,'booked',$5)`, [demoId, prospectId, over.dealStage === 'none' ? null : dealId, email, `tok-${n}-${demoId}`, new Date(Date.UTC(2026, 11, 1, n)), new Date(Date.UTC(2026, 11, 1, n, 15))]);
  return { prospectId, dealId, email, phone, taskIds, attempts, demoId };
}
const oppose = (w: { prospectId: string; email: string; phone: string }, over: Record<string, unknown> = {}) =>
  applyOpposition(t.app, { actor: 'system:unsubscribe', origin: 'unsubscribe', reason: 'Baja desde el enlace', prospectId: w.prospectId, email: w.email, phone: w.phone, ...over });

describe('oposición completa (T-14)', () => {
  it('cierra la oportunidad abierta como PERDIDA por «oposición», con fecha de cierre y rastro en la auditoría', async () => {
    const w = await world();
    await oppose(w);
    const d = (await q<{ stage_id: string; lost_reason_id: string; closed_at: Date | null }>('select stage_id, lost_reason_id, closed_at from deals where id = $1', [w.dealId]))[0]!;
    expect(d.stage_id).toBe('lost');
    expect(d.lost_reason_id).toBe('opposition');
    expect(d.closed_at).not.toBeNull();
    const a = (await q<{ actor: string; payload: { from: string; to: string; reason: string } }>(`select actor, payload from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [w.dealId]))[0]!;
    expect(a.actor).toBe('system:unsubscribe');
    expect(a.payload).toMatchObject({ from: 'interested', to: 'lost', reason: 'opposition' });
  });

  it('cancela las tareas abiertas (de la ficha y de la oportunidad) y respeta las ya hechas', async () => {
    const w = await world();
    await oppose(w);
    const st = await q<{ id: string; status: string }>('select id, status from tasks where id = any($1)', [w.taskIds]);
    const by = Object.fromEntries(st.map((r) => [r.id, r.status]));
    expect(by[w.taskIds[0]!]).toBe('cancelled');
    expect(by[w.taskIds[1]!]).toBe('cancelled');
    expect(by[w.taskIds[2]!]).toBe('done');
  });

  it('cancela demos pendientes e intentos planificados; los ya enviados no se tocan; la ficha queda bloqueada por oposición', async () => {
    const w = await world();
    const r = await oppose(w);
    expect(r).toMatchObject({ cancelledDemos: 1, cancelledAttempts: 2, closedDeals: 1, cancelledTasks: 2 });
    expect((await q<{ status: string }>('select status from demos where id = $1', [w.demoId]))[0]!.status).toBe('cancelled');
    const at = Object.fromEntries((await q<{ id: string; status: string }>('select id, status from contact_attempts where prospect_id = $1', [w.prospectId])).map((x) => [x.id, x.status]));
    expect(at[w.attempts.toEmail]).toBe('cancelled');
    expect(at[w.attempts.toOther]).toBe('cancelled');
    expect(at[w.attempts.sent]).toBe('sent');
    expect((await q<{ status: string; block_reason: string }>('select status, block_reason from prospects where id = $1', [w.prospectId]))[0]).toMatchObject({ status: 'blocked', block_reason: 'opposition' });
  });

  it('no reabre ni modifica una oportunidad ya ganada o perdida', async () => {
    for (const stage of ['won', 'lost'] as const) {
      const w = await world({ dealStage: stage });
      const before = (await q<{ lost_reason_id: string | null; closed_at: Date }>('select lost_reason_id, closed_at from deals where id = $1', [w.dealId]))[0]!;
      const r = await oppose(w);
      expect(r.closedDeals).toBe(0);
      const after = (await q<{ stage_id: string; lost_reason_id: string | null; closed_at: Date }>('select stage_id, lost_reason_id, closed_at from deals where id = $1', [w.dealId]))[0]!;
      expect(after).toMatchObject({ stage_id: stage, lost_reason_id: before.lost_reason_id });
      expect(after.closed_at).toEqual(before.closed_at);
    }
  });

  it('una ficha sin oportunidad también funciona', async () => {
    const w = await world({ dealStage: 'none' });
    const r = await oppose(w);
    expect(r.closedDeals).toBe(0);
    expect((await q<{ status: string }>('select status from prospects where id = $1', [w.prospectId]))[0]!.status).toBe('blocked');
  });

  it('es idempotente: repetirla no duplica exclusiones ni cambia nada más', async () => {
    const w = await world();
    const first = await oppose(w);
    expect(first.suppressions).toBeGreaterThan(0);
    const second = await oppose(w);
    expect(second).toMatchObject({ suppressions: 0, withdrawnConsents: 0, cancelledAttempts: 0, cancelledDemos: 0, closedDeals: 0, cancelledTasks: 0 });
    expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [w.dealId])).toBe(1);
    expect(await count(`select count(*) n from suppressions where kind = 'email' and lower(value) = $1`, [w.email])).toBe(1);
  });

  it('atomicidad: si falla la última parte (la auditoría) NO queda nada a medias', async () => {
    const w = await world();
    await t.admin.query(`create or replace function boom() returns trigger language plpgsql as $$ begin raise exception 'fallo forzado'; end $$`);
    await t.admin.query(`create trigger boom_audit before insert on audit_log for each row when (new.action = 'opposition.apply') execute function boom()`);
    try {
      await expect(oppose(w)).rejects.toThrow(/fallo forzado/);
    } finally {
      await t.admin.query('drop trigger boom_audit on audit_log');
    }
    expect(await count(`select count(*) n from suppressions where lower(value) = $1`, [w.email])).toBe(0);
    expect((await q<{ stage_id: string; closed_at: Date | null }>('select stage_id, closed_at from deals where id = $1', [w.dealId]))[0]).toMatchObject({ stage_id: 'interested', closed_at: null });
    expect(await count(`select count(*) n from tasks where prospect_id = $1 and status = 'cancelled'`, [w.prospectId])).toBe(0);
    expect((await q<{ status: string }>('select status from demos where id = $1', [w.demoId]))[0]!.status).toBe('booked');
    expect((await q<{ status: string }>('select status from prospects where id = $1', [w.prospectId]))[0]!.status).toBe('approved');
    expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [w.dealId])).toBe(0);
  });
});

describe('oposición de un solo contacto (sin ficha)', () => {
  it('excluye ese correo y cancela solo los intentos planificados a ese destino; la ficha y la oportunidad siguen', async () => {
    const w = await world();
    const r = await applyOpposition(t.app, { actor: 'system:unsubscribe', origin: 'unsubscribe', reason: 'Baja del contacto', email: w.email });
    expect(r.suppressions).toBe(1);
    expect(r.cancelledAttempts).toBe(1);
    const at = Object.fromEntries((await q<{ id: string; status: string }>('select id, status from contact_attempts where prospect_id = $1', [w.prospectId])).map((x) => [x.id, x.status]));
    expect(at[w.attempts.toEmail]).toBe('cancelled');
    expect(at[w.attempts.toOther]).toBe('planned');
    expect(at[w.attempts.sent]).toBe('sent');
    expect((await q<{ status: string }>('select status from prospects where id = $1', [w.prospectId]))[0]!.status).toBe('approved');
    expect((await q<{ stage_id: string }>('select stage_id from deals where id = $1', [w.dealId]))[0]!.stage_id).toBe('interested');
  });
});
