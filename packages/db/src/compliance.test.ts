import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckInput } from '@turnosala/core';
import { applyOpposition } from './opposition.js';
import { check } from './compliance-check.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
const PROSPECT = uuidv7();
const PHONE = '+34600111222';
const ADDR = uuidv7();
const ADDR_NORM = 'calle sierpes 1 41004 sevilla';
const EMAIL = 'recepcion@clinicaejemplo.es';
const AT = new Date('2026-11-10T10:00:00Z'); // martes 11:00 Madrid
const clock = () => AT;

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(
    `insert into prospects (id, name, name_norm, legal_form, domain, status) values ($1,'Clínica Ejemplo','clinica ejemplo','company','clinicaejemplo.es','approved')`,
    [PROSPECT],
  );
  await t.app.query(`insert into contact_points (id, prospect_id, type, value, value_norm) values ($1,$2,'switchboard_phone',$3,$3)`, [uuidv7(), PROSPECT, PHONE]);
  await t.app.query(`insert into contact_points (id, prospect_id, type, value, value_norm) values ($1,$2,'postal_address','Calle Sierpes 1, Sevilla',$3)`, [ADDR, PROSPECT, ADDR_NORM]);
  for (const [kind, value] of [['phone', PHONE], ['email', EMAIL], ['postal', ADDR_NORM]] as const) {
    await t.app.query(`insert into test_contacts (id, kind, value, label) values ($1,$2,$3,'prueba')`, [uuidv7(), kind, value]);
  }
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const ai = (over: Partial<CheckInput> = {}): CheckInput =>
  ({ prospectId: PROSPECT, channel: 'ai_call', purpose: 'prospecting', direction: 'outbound', phone: PHONE, at: AT, ...over });

async function grantAi(createdAt = '2026-11-01T09:00:00Z'): Promise<string> {
  const id = uuidv7();
  await t.app.query(
    `insert into consents (id, prospect_id, channel, purpose, action, phone, text_version, text_snapshot, source_url, created_at)
     values ($1,$2,'ai_call','prospecting','grant',$3,'ai-v1','Acepto que me llame un asistente de IA','https://go.turnosala.com/demo',$4)`,
    [id, PROSPECT, PHONE, createdAt],
  );
  return id;
}

describe('check() con la BD (REQ-CMP-01)', () => {
  it('T-01 sin consentimiento → BLOCK CG-12, y la decisión queda guardada', async () => {
    const r = await check(t.app, ai(), { clock });
    expect(r.decision).toBe('BLOCK');
    expect(r.ruleIds).toEqual(['CG-12']);
    const row = await t.app.query(`select decision, rule_ids, channel, direction, destination, prospect_id from compliance_decisions where id = $1`, [r.decisionId]);
    expect(row.rows[0]).toMatchObject({ decision: 'BLOCK', rule_ids: ['CG-12'], channel: 'ai_call', direction: 'outbound', destination: PHONE, prospect_id: PROSPECT });
  });

  it('T-12 sandbox: teléfono que no está en test_contacts → BLOCK CG-02', async () => {
    const r = await check(t.app, ai({ phone: '+34699000111' }), { clock });
    expect(r.ruleIds).toEqual(['CG-02']);
  });

  it('T-02 con consentimiento ai_call de la BD → ALLOW CG-11 y consent_id guardado', async () => {
    const consentId = await grantAi();
    const r = await check(t.app, ai(), { clock });
    expect(r.decision).toBe('ALLOW');
    expect(r.ruleIds).toEqual(['CG-11']);
    expect(r.consentId).toBe(consentId);
    const row = await t.app.query(`select consent_id from compliance_decisions where id = $1`, [r.decisionId]);
    expect(row.rows[0]?.consent_id).toBe(consentId);
  });

  it('T-03b retirada del consentimiento sin suppressions → BLOCK CG-12', async () => {
    await t.app.query(
      `insert into consents (id, prospect_id, channel, purpose, action, phone, text_version, text_snapshot, source_url, created_at)
       values ($1,$2,'ai_call','prospecting','withdraw',$3,'ai-v1','Retiro mi consentimiento','https://go.turnosala.com/baja','2026-11-02T09:00:00Z')`,
      [uuidv7(), PROSPECT, PHONE],
    );
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-12']);
    await grantAi('2026-11-03T09:00:00Z'); // nueva concesión posterior
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-11']);
  });

  it('CG-01 con kill_switch en settings → BLOCK; al apagarlo vuelve a decidir', async () => {
    await t.app.query(`update settings set value = 'true' where key = 'kill_switch'`);
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-01']);
    await t.app.query(`update settings set value = 'false' where key = 'kill_switch'`);
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-11']);
  });

  it('CG-04 gasto de voz del día igual al tope → BLOCK', async () => {
    await t.app.query(`insert into usage_costs (provider, route, units, cost_eur, created_at) values ('voice','call','{}',10,'2026-11-10T07:00:00Z')`);
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-04']);
    await t.app.query(`insert into usage_costs (provider, route, units, cost_eur, created_at) values ('voice','call','{}',-10,'2026-11-10T08:00:00Z')`);
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-11']);
  });

  it('T-06 el tercer intento con el mismo consentimiento → BLOCK CG-06', async () => {
    const ok = await check(t.app, ai(), { clock });
    for (const [i, when] of ['2026-11-04T10:00:00Z', '2026-11-06T10:00:00Z'].entries()) {
      await t.app.query(
        `insert into contact_attempts (id, prospect_id, channel, purpose, destination, decision_id, status, idempotency_key, created_at)
         values ($1,$2,'ai_call','prospecting',$3,$4,'sent',$5,$6)`,
        [uuidv7(), PROSPECT, PHONE, ok.decisionId, `k${i}`, when],
      );
    }
    expect((await check(t.app, ai(), { clock })).ruleIds).toEqual(['CG-06']);
  });

  it('T-22b confirmación por email de una demo pedida en el formulario → ALLOW CG-40', async () => {
    const demoId = uuidv7();
    await t.app.query(
      `insert into demos (id, prospect_id, host_user_id, starts_at, ends_at, booked_via, requester_name, requester_email, status, manage_token)
       values ($1,$2,'u-sales','2026-11-12T09:00:00Z','2026-11-12T09:15:00Z','form','Ana',$3,'booked','tok1')`,
      [demoId, PROSPECT, EMAIL],
    );
    const r = await check(t.app, { prospectId: PROSPECT, channel: 'email_transactional', purpose: 'demo_confirmation', direction: 'outbound', email: EMAIL, demoId, at: AT }, { clock });
    expect(r.ruleIds).toEqual(['CG-40']);
    const otra = await check(t.app, { prospectId: PROSPECT, channel: 'email_transactional', purpose: 'demo_confirmation', direction: 'outbound', email: 'otro@clinicaejemplo.es', demoId, at: AT }, { clock });
    expect(otra.decision).toBe('BLOCK');
  });
});

describe('applyOpposition() — REQ-CNS-03, T-03 y T-14', () => {
  it('en una transacción: exclusiones, retiradas, demos y acciones canceladas, ficha bloqueada, auditoría', async () => {
    const demoId = uuidv7();
    await t.app.query(
      `insert into demos (id, prospect_id, host_user_id, starts_at, ends_at, booked_via, requester_name, requester_email, status, manage_token)
       values ($1,$2,'u-sales','2026-11-20T09:00:00Z','2026-11-20T09:15:00Z','form','Ana',$3,'booked','tok2')`,
      [demoId, PROSPECT, EMAIL],
    );
    const dec = await check(t.app, ai(), { clock });
    const planned = uuidv7();
    await t.app.query(
      `insert into contact_attempts (id, prospect_id, channel, purpose, destination, decision_id, status, idempotency_key)
       values ($1,$2,'postal_letter','prospecting','x',$3,'planned','kplanned')`,
      [planned, PROSPECT, dec.decisionId],
    );
    // antes de la oposición la entrante está permitida (la saliente ya está topada por cadencia por el test T-06)
    expect((await check(t.app, ai({ direction: 'inbound' }), { clock })).ruleIds).toEqual(['CG-10']);

    const out = await applyOpposition(t.app, { actor: 'u-sales', origin: 'sales', reason: 'dijo que no la llamen', prospectId: PROSPECT, phone: PHONE, email: EMAIL });
    expect(out.suppressions).toBeGreaterThanOrEqual(3);

    const sup = await t.app.query(`select kind from suppressions order by kind`);
    expect(sup.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['phone', 'email', 'prospect', 'domain']));
    expect((await t.app.query(`select status from demos where id = $1`, [demoId])).rows[0]?.status).toBe('cancelled');
    expect((await t.app.query(`select status from contact_attempts where id = $1`, [planned])).rows[0]?.status).toBe('cancelled');
    expect((await t.app.query(`select status, block_reason from prospects where id = $1`, [PROSPECT])).rows[0]).toMatchObject({ status: 'blocked', block_reason: 'opposition' });
    expect((await t.app.query(`select count(*)::int as n from audit_log where action = 'opposition.apply'`)).rows[0]?.n).toBe(1);
  });

  it('T-03/T-14 después, check() devuelve BLOCK CG-03 en todos los canales', async () => {
    const base = { prospectId: PROSPECT, direction: 'outbound', at: AT } as const;
    const inputs: CheckInput[] = [
      { ...base, channel: 'ai_call', purpose: 'prospecting', phone: PHONE },
      { ...base, channel: 'human_call', purpose: 'prospecting', phone: PHONE },
      { ...base, channel: 'email_marketing', purpose: 'prospecting', email: EMAIL },
      { ...base, channel: 'ai_call', purpose: 'prospecting', direction: 'inbound', phone: PHONE },
      { ...base, channel: 'visit', purpose: 'prospecting', postalAddressId: ADDR },
      { ...base, channel: 'postal_letter', purpose: 'prospecting', postalAddressId: ADDR },
    ];
    for (const i of inputs) expect((await check(t.app, i, { clock })).ruleIds, `${i.channel}/${i.direction}`).toContain('CG-03');
  });

  it('entrada inválida (sin autor, sin destino o ficha inexistente) → error y no se escribe nada', async () => {
    const count = async (): Promise<number> =>
      ((await t.app.query(`select (select count(*) from suppressions) + (select count(*) from audit_log) as n`)).rows[0]?.n as number) * 1;
    const before = Number(await count());
    await expect(applyOpposition(t.app, { actor: '', origin: 'crm', reason: 'x', phone: '+34611222444' })).rejects.toThrow();
    await expect(applyOpposition(t.app, { actor: 'u', origin: 'crm', reason: 'x' })).rejects.toThrow();
    await expect(applyOpposition(t.app, { actor: 'u', origin: 'crm', reason: 'x', prospectId: uuidv7(), phone: '+34611222333' })).rejects.toThrow(/ficha/);
    expect(Number(await count())).toBe(before);
  });
});

describe('fail-safe (P1.2)', () => {
  it('un ajuste obligatorio ausente → BLOCK CG-99 con la decisión guardada', async () => {
    const saved = (await t.app.query(`select value from settings where key = 'cadences'`)).rows[0]?.value as unknown;
    await t.app.query(`delete from settings where key = 'cadences'`);
    const r = await check(t.app, { prospectId: PROSPECT, channel: 'postal_letter', purpose: 'prospecting', direction: 'outbound', at: AT }, { clock });
    expect(r.decision).toBe('BLOCK');
    expect(r.ruleIds).toEqual(['CG-99']);
    expect(r.reasons[0]).toMatch(/contexto/i);
    expect((await t.app.query(`select count(*)::int as n from compliance_decisions where id = $1`, [r.decisionId])).rows[0]?.n).toBe(1);
    await t.app.query(`insert into settings (key, value, updated_by) values ('cadences', $1, 'test')`, [JSON.stringify(saved)]);
  });
});
