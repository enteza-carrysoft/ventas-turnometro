import { applyOpposition, check, createTestDb, uuidv7, type TestDb } from '@turnosala/db';
import type { CheckInput } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execute } from './execute.js';
import type { Connector, ContactDeps, PlannedAction } from './types.js';

let t: TestDb;
let campaignId: string;
const AT = new Date('2026-11-10T10:00:00Z'); // martes 11:00 Madrid
const clock = (): Date => AT;
let seq = 0;

beforeAll(async () => {
  t = await createTestDb();
  const product = uuidv7();
  const segment = uuidv7();
  campaignId = uuidv7();
  await t.app.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [product]);
  await t.app.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,'clinicas','Clínicas','approved','{}')`, [segment, product]);
  await t.app.query(
    `insert into campaigns (id, product_id, segment_id, name, wave, territory_filter, sequence, budget_eur, status, utm)
     values ($1,$2,$3,'Sevilla','sevilla','{}','[]',100,'active','{}')`,
    [campaignId, product, segment],
  );
  await t.app.query(`update settings set value = 'true' where key = 'b2b_human_calls_approved'`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

async function mkProspect(withAiConsent = false): Promise<{ id: string; phone: string }> {
  seq++;
  const id = uuidv7();
  const phone = `+3460012${String(seq).padStart(4, '0')}`;
  await t.app.query(`insert into prospects (id, name, name_norm, legal_form, domain, status) values ($1,$2,$2,'company',$3,'approved')`, [id, `Clínica ${seq}`, `clinica${seq}.es`]);
  await t.app.query(`insert into contact_points (id, prospect_id, type, value, value_norm) values ($1,$2,'switchboard_phone',$3,$3)`, [uuidv7(), id, phone]);
  await t.app.query(`insert into test_contacts (id, kind, value, label) values ($1,'phone',$2,'prueba')`, [uuidv7(), phone]);
  if (withAiConsent) {
    await t.app.query(
      `insert into consents (id, prospect_id, channel, purpose, action, phone, text_version, text_snapshot, source_url, created_at)
       values ($1,$2,'ai_call','prospecting','grant',$3,'ai-v1','Acepto','https://go.turnosala.com/demo','2026-11-01T09:00:00Z')`,
      [uuidv7(), id, phone],
    );
  }
  return { id, phone };
}

function fakeConnector(over: Partial<Connector> = {}): Connector & { send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ providerRef: 'ref-1', costEur: 0.5 }));
  return { provider: 'twilio', send, ...over } as Connector & { send: ReturnType<typeof vi.fn> };
}

const deps = (c: Connector, extra: Partial<ContactDeps> = {}): ContactDeps =>
  ({ pool: t.app, connectors: { ai_call: c, human_call: c }, clock, ...extra });

const aiInput = (p: { id: string; phone: string }, over: Partial<CheckInput> = {}): CheckInput =>
  ({ prospectId: p.id, channel: 'ai_call', purpose: 'prospecting', direction: 'outbound', phone: p.phone, at: AT, campaignId, ...over });

const action = (input: CheckInput, over: Partial<PlannedAction> = {}): PlannedAction => ({ id: uuidv7(), input, ...over });

const attempts = async (prospectId: string): Promise<Array<Record<string, unknown>>> =>
  (await t.app.query('select * from contact_attempts where prospect_id = $1', [prospectId])).rows;

describe('ContactService.execute — camino feliz y BLOCK', () => {
  it('ALLOW: re-evalúa, registra el intento, llama al conector una vez y guarda coste', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    const r = await execute(deps(c), action(aiInput(p), { estimatedCostEur: 0.2 }));
    expect(r.status).toBe('sent');
    expect(r.decision?.ruleIds).toEqual(['CG-11']);
    expect(c.send).toHaveBeenCalledTimes(1);
    const [a] = await attempts(p.id);
    expect(a).toMatchObject({ status: 'sent', provider: 'twilio', provider_ref: 'ref-1', decision_id: r.decision?.decisionId, campaign_id: campaignId });
    expect(Number(a?.cost_eur)).toBe(0.5);
    const cost = await t.app.query(`select coalesce(sum(cost_eur),0) as s from usage_costs where provider = 'voice' and route = 'contact.ai_call'`);
    expect(Number(cost.rows[0]?.s)).toBeCloseTo(0.5, 4); // 0,2 reservado + 0,3 de ajuste
  });

  it('BLOCK (sin consentimiento): no llama al conector ni registra intento', async () => {
    const p = await mkProspect(false);
    const c = fakeConnector();
    const r = await execute(deps(c), action(aiInput(p)));
    expect(r).toMatchObject({ status: 'blocked' });
    expect(r.decision?.ruleIds).toEqual(['CG-12']);
    expect(c.send).not.toHaveBeenCalled();
    expect(await attempts(p.id)).toHaveLength(0);
  });

  it('kill_switch activado justo antes de ejecutar → BLOCK CG-01', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    await t.app.query(`update settings set value = 'true' where key = 'kill_switch'`);
    try {
      const r = await execute(deps(c), action(aiInput(p)));
      expect(r.decision?.ruleIds).toEqual(['CG-01']);
      expect(c.send).not.toHaveBeenCalled();
    } finally {
      await t.app.query(`update settings set value = 'false' where key = 'kill_switch'`);
    }
  });

  it('una oposición entre la planificación y el envío gana (re-evaluación)', async () => {
    const p = await mkProspect(true);
    const planned = await check(t.app, aiInput(p), { clock });
    expect(planned.decision).toBe('ALLOW');
    await applyOpposition(t.app, { actor: 'u', origin: 'call', reason: 'no llamar', prospectId: p.id, phone: p.phone });
    const c = fakeConnector();
    const r = await execute(deps(c), action(aiInput(p), { decisionId: planned.decisionId }));
    expect(r.status).toBe('blocked');
    expect(r.decision?.ruleIds).toEqual(['CG-03']);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('sin conector registrado para el canal → failed, sin intento', async () => {
    const p = await mkProspect(true);
    const r = await execute({ pool: t.app, connectors: {}, clock }, action(aiInput(p)));
    expect(r).toMatchObject({ status: 'failed', reason: 'no_connector' });
    expect(await attempts(p.id)).toHaveLength(0);
  });
});

describe('idempotencia y fallos del proveedor', () => {
  it('misma acción dos veces → la segunda es duplicate y no vuelve a enviar', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    const a = action(aiInput(p));
    const decisions = async (): Promise<number> =>
      (await t.app.query('select count(*)::int as n from compliance_decisions where prospect_id = $1', [p.id])).rows[0]?.n as number;
    expect((await execute(deps(c), a)).status).toBe('sent');
    const before = await decisions();
    expect((await execute(deps(c), a)).status).toBe('duplicate');
    expect(await decisions()).toBe(before); // el duplicado se corta antes de re-evaluar
    expect(c.send).toHaveBeenCalledTimes(1);
    expect(await attempts(p.id)).toHaveLength(1);
  });

  it('dos ejecuciones simultáneas de la misma acción → un solo envío', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    const a = action(aiInput(p));
    const [r1, r2] = await Promise.all([execute(deps(c), a), execute(deps(c), a)]);
    expect([r1.status, r2.status].sort()).toEqual(['duplicate', 'sent']);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('el conector falla → intento «failed» y resultado failed (sin reintento en F0)', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector({ send: vi.fn(async () => { throw new Error('proveedor caído'); }) });
    const r = await execute(deps(c), action(aiInput(p)));
    expect(r).toMatchObject({ status: 'failed', reason: 'connector_error' });
    expect((await attempts(p.id))[0]).toMatchObject({ status: 'failed' });
  });
});

describe('T-20 decisiones externas de más de 60 s o de otro contacto', () => {
  const insertDecision = async (p: { id: string; phone: string }, createdAt: string, over: Record<string, string> = {}): Promise<string> => {
    const id = uuidv7();
    await t.app.query(
      `insert into compliance_decisions (id, input, prospect_id, channel, direction, destination, decision, rule_ids, reasons, created_at)
       values ($1,'{}',$2,$3,'outbound',$4,'ALLOW','{CG-11}','{x}',$5)`,
      [id, p.id, over.channel ?? 'ai_call', over.destination ?? p.phone, createdAt],
    );
    return id;
  };

  it('decisión de hace 10 min → rejected decision_stale; no se envía', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    const d = await insertDecision(p, '2026-11-10T09:50:00Z');
    const r = await execute(deps(c), action(aiInput(p), { decisionId: d }));
    expect(r).toMatchObject({ status: 'rejected', reason: 'decision_stale' });
    expect(r.decision).toBeDefined(); // se re-evaluó igualmente
    expect(c.send).not.toHaveBeenCalled();
  });

  it('decisión de hace 59 s (dentro del límite) → se acepta y se ejecuta', async () => {
    const p = await mkProspect(true);
    const c = fakeConnector();
    const d = await insertDecision(p, '2026-11-10T09:59:01Z');
    expect((await execute(deps(c), action(aiInput(p), { decisionId: d }))).status).toBe('sent');
  });

  it('decisión de otro contacto, de otro canal o de otro destino → rejected decision_mismatch', async () => {
    const p = await mkProspect(true);
    const other = await mkProspect(true);
    const c = fakeConnector();
    const now = '2026-11-10T09:59:50Z';
    for (const d of [
      await insertDecision(other, now),
      await insertDecision(p, now, { channel: 'human_call' }),
      await insertDecision(p, now, { destination: '+34699999999' }),
    ]) {
      expect(await execute(deps(c), action(aiInput(p), { decisionId: d }))).toMatchObject({ status: 'rejected', reason: 'decision_mismatch' });
    }
    expect(c.send).not.toHaveBeenCalled();
  });

  it('decisión inexistente → rejected decision_unknown', async () => {
    const p = await mkProspect(true);
    const r = await execute(deps(fakeConnector()), action(aiInput(p), { decisionId: uuidv7() }));
    expect(r).toMatchObject({ status: 'rejected', reason: 'decision_unknown' });
  });
});

describe('REVIEW: aprobación del lote (REQ-OUT-03, T-21)', () => {
  const humanInput = (p: { id: string; phone: string }, batch: string): { input: CheckInput; batchId: string } =>
    ({ input: { prospectId: p.id, channel: 'human_call', purpose: 'prospecting', direction: 'outbound', phone: p.phone, at: AT, campaignId }, batchId: batch });

  async function batch(status: string, createdAt: string, approvalRole?: string): Promise<string> {
    const id = uuidv7();
    await t.app.query(`insert into send_batches (id, campaign_id, channel, size, est_cost_eur, status, created_at) values ($1,$2,'human_call',1,0,$3,$4)`, [id, campaignId, status, createdAt]);
    if (approvalRole) await t.app.query(`insert into review_approvals (id, batch_id, approved_by, role) values ($1,$2,'u-1',$3)`, [uuidv7(), id, approvalRole]);
    return id;
  }

  it('REVIEW sin lote → rejected review_not_approved', async () => {
    const p = await mkProspect();
    const c = fakeConnector();
    const r = await execute(deps(c), action(humanInput(p, '').input));
    expect(r).toMatchObject({ status: 'rejected', reason: 'review_not_approved' });
    expect(r.decision?.decision).toBe('REVIEW');
    expect(c.send).not.toHaveBeenCalled();
  });

  it('T-21 lote sin aprobar tras 48 h (72 h) → sigue sin ejecutarse: el silencio no aprueba', async () => {
    const p = await mkProspect();
    const c = fakeConnector();
    const b = await batch('pending_approval', '2026-11-07T10:00:00Z');
    const r = await execute(deps(c), action(humanInput(p, b).input, { batchId: b }));
    expect(r).toMatchObject({ status: 'rejected', reason: 'review_not_approved' });
    expect(c.send).not.toHaveBeenCalled();
  });

  it('lote aprobado pero con rol que no corresponde (marketing para llamada) → rechazado', async () => {
    const p = await mkProspect();
    const c = fakeConnector();
    const b = await batch('approved', '2026-11-09T10:00:00Z', 'marketing');
    expect(await execute(deps(c), action(humanInput(p, b).input, { batchId: b }))).toMatchObject({ status: 'rejected', reason: 'review_not_approved' });
    expect(c.send).not.toHaveBeenCalled();
  });

  it('lote con aprobación pero estado pending_approval → rechazado', async () => {
    const p = await mkProspect();
    const b = await batch('pending_approval', '2026-11-09T10:00:00Z', 'sales');
    const r = await execute(deps(fakeConnector()), action(humanInput(p, b).input, { batchId: b }));
    expect(r).toMatchObject({ status: 'rejected', reason: 'review_not_approved' });
  });

  it('lote aprobado por sales → se ejecuta con la decisión REVIEW re-evaluada', async () => {
    const p = await mkProspect();
    const c = fakeConnector();
    const b = await batch('approved', '2026-11-09T10:00:00Z', 'sales');
    const r = await execute(deps(c), action(humanInput(p, b).input, { batchId: b }));
    expect(r.status).toBe('sent');
    expect(r.decision?.ruleIds).toEqual(['CG-21']);
    expect(c.send).toHaveBeenCalledTimes(1);
  });

  it('si tras aprobar el lote llega una oposición, gana BLOCK', async () => {
    const p = await mkProspect();
    const c = fakeConnector();
    const b = await batch('approved', '2026-11-09T10:00:00Z', 'sales');
    await applyOpposition(t.app, { actor: 'u', origin: 'sales', reason: 'no', prospectId: p.id, phone: p.phone });
    const r = await execute(deps(c), action(humanInput(p, b).input, { batchId: b }));
    expect(r.status).toBe('blocked');
    expect(c.send).not.toHaveBeenCalled();
  });
});
