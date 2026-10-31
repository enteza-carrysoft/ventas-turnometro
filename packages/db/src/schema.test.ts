import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveProductFacts } from './product-facts.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

async function rejects(p: Promise<unknown>, re: RegExp): Promise<void> {
  await expect(p).rejects.toThrow(re);
}

const FOUR = ['consents', 'suppressions', 'compliance_decisions', 'audit_log'] as const;

async function seedOne(pool: pg.Pool): Promise<void> {
  const id = uuidv7();
  await pool.query(
    `insert into consents (id, channel, purpose, action, email, text_version, text_snapshot, source_url)
     values ($1,'email','prospecting','grant','a@b.es','v1','Acepto','https://x.es/c/1')`,
    [id],
  );
  await pool.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'email','a@b.es','test','crm')`, [uuidv7()]);
  await pool.query(
    `insert into compliance_decisions (id, input, channel, direction, decision, rule_ids, reasons)
     values ($1,'{}','human_call','outbound','BLOCK','{CG-99}','{x}')`,
    [uuidv7()],
  );
  await pool.query(`insert into audit_log (actor, action, entity) values ('t','a','e')`);
}

describe('F0.3 esquema y solo inserción (P4, T-19)', () => {
  it('el rol app puede insertar en las 4 tablas P4', async () => {
    await seedOne(t.app);
  });

  for (const table of FOUR) {
    for (const [who, pool] of [['app', () => t.app], ['migrator', () => t.migrator], ['superusuario', () => t.admin]] as const) {
      it(`T-19 ${table}: UPDATE falla como ${who}`, async () => {
        await rejects(pool().query(`update ${table} set ${table === 'audit_log' ? 'actor' : table === 'consents' ? 'purpose' : table === 'suppressions' ? 'reason' : 'channel'} = 'z'`), /solo inserción|permission denied/);
      });
      it(`T-19 ${table}: DELETE falla como ${who}`, async () => {
        await rejects(pool().query(`delete from ${table}`), /solo inserción|permission denied/);
      });
      it(`T-19 ${table}: TRUNCATE falla como ${who}`, async () => {
        await rejects(pool().query(`truncate ${table} cascade`), /solo inserción|permission denied/);
      });
    }
  }

  it('el trigger (no solo el GRANT) protege al propietario: error de solo inserción', async () => {
    await rejects(t.migrator.query(`delete from consents`), /solo inserción/);
  });
});

describe('T-13 consentimiento sin texto ni versión (REQ-CNS-02)', () => {
  const base = (over: string): string =>
    `insert into consents (id, channel, purpose, action, email, text_version, text_snapshot, source_url) values (gen_random_uuid(),'email','p','grant','a@b.es',${over})`;
  it('SQL directo: versión vacía → error', async () => {
    await rejects(t.app.query(base(`'  ','Acepto','https://x.es'`)), /check/);
  });
  it('SQL directo: texto vacío → error', async () => {
    await rejects(t.app.query(base(`'v1','','https://x.es'`)), /check/);
  });
  it('SQL directo: origen vacío → error', async () => {
    await rejects(t.app.query(base(`'v1','Acepto',''`)), /check/);
  });
  it('SQL directo: sin teléfono ni email → error', async () => {
    await rejects(
      t.app.query(`insert into consents (id, channel, purpose, action, text_version, text_snapshot, source_url) values (gen_random_uuid(),'email','p','grant','v1','t','https://x.es')`),
      /check/,
    );
  });
});

describe('REQ-MKT-01 product_facts', () => {
  async function newFacts(version: number): Promise<string> {
    const p = await t.app.query(`select id from products where slug = 'turnosala'`);
    let productId = p.rows[0]?.id as string | undefined;
    if (!productId) {
      productId = uuidv7();
      await t.app.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
    }
    const id = uuidv7();
    await t.app.query(`insert into product_facts (id, product_id, version, status, facts) values ($1,$2,$3,'draft','{}')`, [id, productId, version]);
    return id;
  }

  it('CA1: no puede haber dos versiones approved a la vez (BD)', async () => {
    const a = await newFacts(1);
    const b = await newFacts(2);
    await t.app.query(`update product_facts set status='approved' where id=$1`, [a]);
    await rejects(t.app.query(`update product_facts set status='approved' where id=$1`, [b]), /one_approved_facts|duplicate/);
    await t.app.query(`update product_facts set status='retired' where id=$1`, [a]);
  });

  it('CA1: aprobar exige rol admin', async () => {
    const id = await newFacts(3);
    await rejects(approveProductFacts(t.app, { factsId: id, actor: 'u1', role: 'marketing' }), /admin/);
  });

  it('CA1: admin aprueba, retira la anterior y queda en audit_log', async () => {
    const id4 = await newFacts(4);
    const id5 = await newFacts(5);
    await approveProductFacts(t.app, { factsId: id4, actor: 'u1', role: 'admin' });
    await approveProductFacts(t.app, { factsId: id5, actor: 'u1', role: 'admin' });
    const r = await t.app.query(`select id, status from product_facts where id = any($1)`, [[id4, id5]]);
    const st = Object.fromEntries(r.rows.map((x) => [x.id as string, x.status as string]));
    expect(st[id4]).toBe('retired');
    expect(st[id5]).toBe('approved');
    const log = await t.app.query(`select actor, payload from audit_log where action='product_facts.approve' and entity_id=$1`, [id5]);
    expect(log.rowCount).toBe(1);
    expect(log.rows[0]?.actor).toBe('u1');
  });
});

describe('semilla de F0', () => {
  it('kill_switch off, app_mode sandbox y flags jurídicos en false', async () => {
    const r = await t.app.query(`select key, value from settings`);
    const s = Object.fromEntries(r.rows.map((x) => [x.key as string, x.value as unknown]));
    expect(s.kill_switch).toBe(false);
    expect(s.app_mode).toBe('sandbox');
    for (const k of ['b2b_human_calls_approved', 'postal_b2b_approved', 'lssi_customer_exception_approved', 'recording_enabled']) {
      expect(s[k], k).toBe(false);
    }
    expect(s.budget_monthly_total_eur).toBe(600);
  });

  it('todas las fuentes sembradas están inactivas (F0.4)', async () => {
    const r = await t.app.query(`select count(*)::int as n, count(*) filter (where active)::int as on_ from allowed_sources`);
    expect(r.rows[0]?.n).toBeGreaterThan(5);
    expect(r.rows[0]?.on_).toBe(0);
  });

  it('el rol app no es superusuario ni propietario del esquema', async () => {
    const r = await t.app.query(`select rolsuper from pg_roles where rolname = current_user`);
    expect(r.rows[0]?.rolsuper).toBe(false);
    await rejects(t.app.query(`create table x_hack (id int)`), /permission denied/);
  });
});
