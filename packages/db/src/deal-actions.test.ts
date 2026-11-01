import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignDeal, loseDeal, moveDeal, winDeal, type DealActor } from './deal-actions.js';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

// F2.3 — mover, perder y ganar oportunidades con permisos por rol (REQ-CRM-01/05/06).
let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;
const A: Record<string, DealActor> = {
  admin: { userId: 'u-admin', role: 'admin' }, s1: { userId: 'u-s1', role: 'sales' }, s2: { userId: 'u-s2', role: 'sales' },
  mkt: { userId: 'u-mkt', role: 'marketing' }, aud: { userId: 'u-aud', role: 'auditor' }, voice: { userId: 'u-voice', role: 'voice' }, none: { userId: 'u-none', role: null },
};

beforeAll(async () => {
  t = await createTestDb();
  for (const a of Object.values(A)) await t.admin.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true)`, [a.userId]);
  await t.admin.query(`insert into app_user_roles (user_id, role) values ('u-admin','admin'), ('u-s1','sales'), ('u-s2','sales'), ('u-mkt','marketing'), ('u-aud','auditor'), ('u-voice','voice')`);
}, 60_000);
afterAll(async () => { await t.drop(); });

const q = async <T>(sql: string, a: unknown[] = []): Promise<T[]> => (await t.admin.query(sql, a)).rows as T[];
const count = async (sql: string, a: unknown[] = []): Promise<number> => Number(((await q<{ n: string }>(sql, a))[0] as { n: string }).n);

async function deal(over: { owner?: string | null; stage?: string } = {}) {
  n++;
  const e = await ingestCandidate(t.app, { name: `Clínica Acciones ${'qwxz'.repeat(n)} S.L.`, website: `https://acciones${n}clinica.es/`, phone: `955 40${n} 00${n}`, sourceId: 'osm', externalId: `da${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const prospectId = e.prospectId as string;
  await t.admin.query(`update prospects set status = 'approved' where id = $1`, [prospectId]);
  const id = uuidv7();
  await t.admin.query(`insert into deals (id, prospect_id, stage_id, owner_user_id, created_by) values ($1,$2,$3,$4,'test')`, [id, prospectId, over.stage ?? 'interested', over.owner === undefined ? 'u-s1' : over.owner]);
  return { id, prospectId, domain: `acciones${n}clinica.es` };
}
const row = async (id: string) => (await q<{ stage_id: string; owner_user_id: string | null; lost_reason_id: string | null; lost_note: string | null; closed_at: Date | null }>('select stage_id, owner_user_id, lost_reason_id, lost_note, closed_at from deals where id = $1', [id]))[0]!;

describe('moveDeal: permisos', () => {
  it('admin mueve cualquiera; el comercial solo las suyas; el resto de roles y sin rol, nada', async () => {
    const d = await deal({ owner: 'u-s1' });
    expect((await moveDeal(t.app, d.id, 'demo_booked', A.s2!))).toEqual({ ok: false, reason: 'forbidden' });
    for (const who of ['mkt', 'aud', 'voice', 'none']) expect(await moveDeal(t.app, d.id, 'demo_booked', A[who]!), who).toEqual({ ok: false, reason: 'forbidden' });
    expect((await row(d.id)).stage_id).toBe('interested');
    expect((await moveDeal(t.app, d.id, 'demo_booked', A.s1!)).ok).toBe(true);
    expect((await moveDeal(t.app, d.id, 'demo_held', A.admin!)).ok).toBe(true);
    expect((await row(d.id)).stage_id).toBe('demo_held');
  });

  it('marketing, auditor, voz y sin rol tampoco pueden tocar una oportunidad SIN asignar (solo el comercial puede quedársela)', async () => {
    const free = await deal({ owner: null });
    for (const who of ['mkt', 'aud', 'voice', 'none']) {
      expect(await moveDeal(t.app, free.id, 'demo_booked', A[who]!), who).toEqual({ ok: false, reason: 'forbidden' });
      expect(await loseDeal(t.app, free.id, { reasonId: 'other' }, A[who]!), who).toEqual({ ok: false, reason: 'forbidden' });
    }
    expect(await row(free.id)).toMatchObject({ stage_id: 'interested', owner_user_id: null });
  });

  it('un comercial que mueve una oportunidad SIN asignar se la queda; el admin no cambia el propietario', async () => {
    const free = await deal({ owner: null });
    await moveDeal(t.app, free.id, 'demo_booked', A.s2!);
    expect((await row(free.id)).owner_user_id).toBe('u-s2');
    const free2 = await deal({ owner: null });
    await moveDeal(t.app, free2.id, 'demo_booked', A.admin!);
    expect((await row(free2.id)).owner_user_id).toBeNull();
  });

  it('el rol sale de la base de datos, no del que llama: un actor que dice ser admin sin serlo es rechazado', async () => {
    const d = await deal({ owner: 'u-s1' });
    expect(await moveDeal(t.app, d.id, 'demo_booked', { userId: 'u-s2', role: 'admin' })).toEqual({ ok: false, reason: 'forbidden' });
    expect((await row(d.id)).stage_id).toBe('interested');
  });
});

describe('moveDeal: reglas', () => {
  it('ganar y perder no se hacen moviendo; etapa inexistente ⇒ inválida; oportunidad inexistente ⇒ no encontrada', async () => {
    const d = await deal();
    expect(await moveDeal(t.app, d.id, 'won', A.admin!)).toEqual({ ok: false, reason: 'use_win' });
    expect(await moveDeal(t.app, d.id, 'lost', A.admin!)).toEqual({ ok: false, reason: 'use_lose' });
    expect(await moveDeal(t.app, d.id, 'inventada', A.admin!)).toEqual({ ok: false, reason: 'invalid_stage' });
    expect(await moveDeal(t.app, uuidv7(), 'trial', A.admin!)).toEqual({ ok: false, reason: 'not_found' });
    expect((await row(d.id)).stage_id).toBe('interested');
  });

  it('deja rastro con autor, etapa anterior y nueva; mover a la misma etapa no hace nada ni audita', async () => {
    const d = await deal();
    await moveDeal(t.app, d.id, 'trial', A.s1!);
    const a = (await q<{ actor: string; payload: { from: string; to: string } }>(`select actor, payload from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [d.id]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor: 'u-s1', payload: { from: 'interested', to: 'trial' } });
    expect((await moveDeal(t.app, d.id, 'trial', A.s1!)).ok).toBe(true);
    expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [d.id])).toBe(1);
  });

  it('se puede retroceder de etapa (corregir un error) y una oportunidad cerrada ya no se mueve', async () => {
    const d = await deal({ stage: 'demo_held' });
    expect((await moveDeal(t.app, d.id, 'new', A.s1!)).ok).toBe(true);
    await loseDeal(t.app, d.id, { reasonId: 'no_interest' }, A.s1!);
    expect(await moveDeal(t.app, d.id, 'trial', A.admin!)).toEqual({ ok: false, reason: 'closed' });
    expect((await row(d.id)).stage_id).toBe('lost');
  });
});

describe('loseDeal', () => {
  it('exige un motivo existente; con motivo cierra, guarda la nota y cancela las tareas ABIERTAS de esa oportunidad', async () => {
    const d = await deal();
    await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'call','De la oportunidad','u-s1',now(),'t'), ($4,$2,null,'other','De la ficha','u-s1',now(),'t')`, [uuidv7(), d.prospectId, d.id, uuidv7()]);
    expect(await loseDeal(t.app, d.id, { reasonId: 'no_existe' }, A.s1!)).toEqual({ ok: false, reason: 'invalid_reason' });
    expect(await loseDeal(t.app, d.id, { reasonId: '' }, A.s1!)).toEqual({ ok: false, reason: 'invalid_reason' });
    expect((await row(d.id)).closed_at).toBeNull();
    expect((await loseDeal(t.app, d.id, { reasonId: 'no_budget', note: 'Dice que el año que viene' }, A.s1!)).ok).toBe(true);
    expect(await row(d.id)).toMatchObject({ stage_id: 'lost', lost_reason_id: 'no_budget', lost_note: 'Dice que el año que viene' });
    expect((await row(d.id)).closed_at).not.toBeNull();
    expect(await count(`select count(*) n from tasks where deal_id = $1 and status = 'cancelled'`, [d.id])).toBe(1);
    expect(await count(`select count(*) n from tasks where prospect_id = $1 and deal_id is null and status = 'open'`, [d.prospectId])).toBe(1);
    expect((await q<{ status: string }>('select status from prospects where id = $1', [d.prospectId]))[0]!.status).toBe('approved');
  });

  it('permisos: un comercial no pierde la oportunidad ajena; marketing/auditor/voz tampoco; ya cerrada ⇒ closed', async () => {
    const d = await deal({ owner: 'u-s1' });
    for (const who of ['s2', 'mkt', 'aud', 'voice', 'none']) expect(await loseDeal(t.app, d.id, { reasonId: 'other' }, A[who]!), who).toEqual({ ok: false, reason: 'forbidden' });
    expect((await loseDeal(t.app, d.id, { reasonId: 'other' }, A.admin!)).ok).toBe(true);
    expect(await loseDeal(t.app, d.id, { reasonId: 'other' }, A.admin!)).toEqual({ ok: false, reason: 'closed' });
  });

  it('el motivo «Oposición / no contactar» aplica la oposición en LA MISMA transacción (T-14)', async () => {
    const d = await deal();
    const decision = uuidv7();
    await t.admin.query(`insert into compliance_decisions (id, input, prospect_id, channel, direction, destination, decision, rule_ids, reasons) values ($1,'{}',$2,'email','outbound','x@y.es','ALLOW','{}','{}')`, [decision, d.prospectId]);
    await t.admin.query(`insert into contact_attempts (id, prospect_id, channel, purpose, destination, decision_id, status, idempotency_key) values ($1,$2,'email','prospecting','x@y.es',$3,'planned',$4)`, [uuidv7(), d.prospectId, decision, `k-${uuidv7()}`]);
    await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'call','Llamar','u-s1',now(),'t')`, [uuidv7(), d.prospectId, d.id]);
    expect((await loseDeal(t.app, d.id, { reasonId: 'opposition', note: 'Pidió que no le llamemos más' }, A.s1!)).ok).toBe(true);
    expect(await row(d.id)).toMatchObject({ stage_id: 'lost', lost_reason_id: 'opposition', lost_note: 'Pidió que no le llamemos más' });
    expect((await q<{ status: string; block_reason: string }>('select status, block_reason from prospects where id = $1', [d.prospectId]))[0]).toMatchObject({ status: 'blocked', block_reason: 'opposition' });
    expect(await count(`select count(*) n from suppressions where kind = 'prospect' and value = $1 and origin = 'crm' and created_by = 'u-s1'`, [d.prospectId])).toBe(1);
    expect(await count(`select count(*) n from contact_attempts where prospect_id = $1 and status = 'cancelled'`, [d.prospectId])).toBe(1);
    expect(await count(`select count(*) n from tasks where deal_id = $1 and status = 'cancelled'`, [d.id])).toBe(1);
    expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [d.id])).toBe(1); // una sola, no duplicada
  });

  it('la oposición es atómica con perder: si falla la auditoría, la oportunidad sigue abierta y la ficha sin bloquear', async () => {
    const d = await deal();
    await t.admin.query(`create or replace function boom2() returns trigger language plpgsql as $$ begin raise exception 'fallo forzado'; end $$`);
    await t.admin.query(`create trigger boom2_audit before insert on audit_log for each row when (new.action = 'opposition.apply') execute function boom2()`);
    try {
      await expect(loseDeal(t.app, d.id, { reasonId: 'opposition' }, A.s1!)).rejects.toThrow(/fallo forzado/);
    } finally {
      await t.admin.query('drop trigger boom2_audit on audit_log');
    }
    expect(await row(d.id)).toMatchObject({ stage_id: 'interested', lost_reason_id: null });
    expect((await q<{ status: string }>('select status from prospects where id = $1', [d.prospectId]))[0]!.status).toBe('approved');
    expect(await count(`select count(*) n from suppressions where value = $1`, [d.prospectId])).toBe(0);
  });
});

describe('winDeal', () => {
  it('solo el admin gana una oportunidad; la ficha pasa a cliente (turnosala_customers) y queda excluida', async () => {
    const d = await deal();
    for (const who of ['s1', 's2', 'mkt', 'aud', 'voice', 'none']) expect(await winDeal(t.app, d.id, A[who]!), who).toEqual({ ok: false, reason: 'forbidden' });
    expect((await row(d.id)).stage_id).toBe('interested');
    expect((await winDeal(t.app, d.id, A.admin!)).ok).toBe(true);
    expect(await row(d.id)).toMatchObject({ stage_id: 'won', lost_reason_id: null });
    expect((await row(d.id)).closed_at).not.toBeNull();
    const c = (await q<{ org_id: string; domain: string; prospect_id: string }>('select org_id, domain, prospect_id from turnosala_customers where prospect_id = $1', [d.prospectId]))[0]!;
    expect(c).toMatchObject({ org_id: `manual:${d.prospectId}`, domain: d.domain });
    expect((await q<{ status: string; block_reason: string }>('select status, block_reason from prospects where id = $1', [d.prospectId]))[0]).toMatchObject({ status: 'blocked', block_reason: 'customer' });
  });

  it('un cliente ganado no vuelve a entrar por la investigación (la ingesta lo bloquea) y se cancelan sus intentos de prospección planificados y sus tareas abiertas', async () => {
    const d = await deal();
    const decision = uuidv7();
    await t.admin.query(`insert into compliance_decisions (id, input, prospect_id, channel, direction, destination, decision, rule_ids, reasons) values ($1,'{}',$2,'email','outbound','x@y.es','ALLOW','{}','{}')`, [decision, d.prospectId]);
    await t.admin.query(`insert into contact_attempts (id, prospect_id, channel, purpose, destination, decision_id, status, idempotency_key) values ($1,$2,'email','prospecting','x@y.es',$3,'planned',$4)`, [uuidv7(), d.prospectId, decision, `k-${uuidv7()}`]);
    await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'call','Llamar','u-s1',now(),'t')`, [uuidv7(), d.prospectId, d.id]);
    await winDeal(t.app, d.id, A.admin!);
    expect(await count(`select count(*) n from contact_attempts where prospect_id = $1 and status = 'cancelled'`, [d.prospectId])).toBe(1);
    expect(await count(`select count(*) n from tasks where prospect_id = $1 and status = 'cancelled'`, [d.prospectId])).toBe(1);
    const again = await ingestCandidate(t.app, { name: `Otra Ficha Distinta Sin Parecido ${n}`, website: `https://www.${d.domain}/`, sourceId: 'osm', externalId: `dup${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
    expect(['blocked', 'merged']).toContain(again.action);
    expect((await q<{ status: string }>('select status from prospects where id = $1', [again.prospectId]))[0]!.status).toBe('blocked');
  });

  it('ganar dos veces ⇒ closed; sin rastro duplicado; auditado con el admin como autor', async () => {
    const d = await deal();
    await winDeal(t.app, d.id, A.admin!);
    expect(await winDeal(t.app, d.id, A.admin!)).toEqual({ ok: false, reason: 'closed' });
    expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1 and actor = 'u-admin'`, [d.id])).toBe(1);
    expect(await count('select count(*) n from turnosala_customers where prospect_id = $1', [d.prospectId])).toBe(1);
  });
});

describe('concurrencia', () => {
  it('dos cierres simultáneos de la misma oportunidad: uno gana y el otro recibe «closed»; nunca dos rastros', async () => {
    for (let round = 0; round < 3; round++) {
      const d = await deal();
      const racers = [
        ...Array.from({ length: 4 }, () => loseDeal(t.app, d.id, { reasonId: 'no_interest' }, A.s1!)),
        ...Array.from({ length: 4 }, () => loseDeal(t.app, d.id, { reasonId: 'other' }, A.admin!)),
        ...Array.from({ length: 2 }, () => winDeal(t.app, d.id, A.admin!)),
      ];
      const rs = await Promise.all(racers);
      expect(rs.filter((r) => r.ok), `ronda ${round}`).toHaveLength(1);
      expect(rs.filter((r) => !r.ok && r.reason === 'closed')).toHaveLength(9);
      expect(await count(`select count(*) n from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [d.id])).toBe(1);
    }
  });
});

describe('assignDeal', () => {
  it('solo el admin reasigna; el destino debe ser un comercial real; null deja la oportunidad sin asignar', async () => {
    const d = await deal({ owner: 'u-s1' });
    expect(await assignDeal(t.app, d.id, 'u-s2', A.s1!)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await assignDeal(t.app, d.id, 'u-mkt', A.admin!)).toEqual({ ok: false, reason: 'invalid_owner' });
    expect(await assignDeal(t.app, d.id, 'u-fantasma', A.admin!)).toEqual({ ok: false, reason: 'invalid_owner' });
    expect((await assignDeal(t.app, d.id, 'u-s2', A.admin!)).ok).toBe(true);
    expect((await row(d.id)).owner_user_id).toBe('u-s2');
    expect((await assignDeal(t.app, d.id, null, A.admin!)).ok).toBe(true);
    expect((await row(d.id)).owner_user_id).toBeNull();
    expect(await count(`select count(*) n from audit_log where action = 'deal.assigned' and entity_id = $1`, [d.id])).toBe(2);
  });
});
