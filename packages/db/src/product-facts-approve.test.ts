import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveProductFactsByEmail } from './product-facts.js';
import { seedProductFactsDraft } from './seed-product-facts.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedProductFactsDraft(t.app, { actor: 'test' });
  for (const [id, email, role] of [['u-admin', 'admin@e2e.test', 'admin'], ['u-mkt', 'mkt@e2e.test', 'marketing']] as const) {
    await t.app.query(`insert into "user" (id, name, email, "emailVerified") values ($1, $1, $2, true)`, [id, email]);
    await t.app.query(`insert into app_user_roles (user_id, role) values ($1, $2)`, [id, role]);
  }
  await t.app.query(`insert into "user" (id, name, email, "emailVerified") values ('u-sin-rol', 'x', 'sinrol@e2e.test', true)`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const status = async (): Promise<string> => (await t.app.query(`select status from product_facts where version = 1`)).rows[0]?.status as string;

describe('aprobar product_facts por correo del admin (REQ-MKT-01 CA1)', () => {
  it('un correo que no existe → error y sigue en borrador', async () => {
    await expect(approveProductFactsByEmail(t.app, { email: 'nadie@e2e.test' })).rejects.toThrow(/usuario/i);
    expect(await status()).toBe('draft');
  });

  it('un usuario sin rol o con rol distinto de admin → error y sigue en borrador', async () => {
    await expect(approveProductFactsByEmail(t.app, { email: 'sinrol@e2e.test' })).rejects.toThrow(/admin/);
    await expect(approveProductFactsByEmail(t.app, { email: 'mkt@e2e.test' })).rejects.toThrow(/admin/);
    expect(await status()).toBe('draft');
  });

  it('una versión que no existe → error', async () => {
    await expect(approveProductFactsByEmail(t.app, { email: 'admin@e2e.test', version: 9 })).rejects.toThrow(/versión/);
  });

  it('el admin la aprueba: queda approved, con su id como autor y en audit_log', async () => {
    const r = await approveProductFactsByEmail(t.app, { email: 'ADMIN@e2e.test' }); // el correo no distingue mayúsculas
    expect(r).toMatchObject({ approved: true, alreadyApproved: false, approvedBy: 'u-admin' });
    expect(await status()).toBe('approved');
    const log = await t.app.query(`select actor from audit_log where action = 'product_facts.approve'`);
    expect(log.rows).toEqual([{ actor: 'u-admin' }]);
  });

  it('repetirla es inocua: no duplica la auditoría', async () => {
    const r = await approveProductFactsByEmail(t.app, { email: 'admin@e2e.test' });
    expect(r).toMatchObject({ approved: true, alreadyApproved: true });
    expect((await t.app.query(`select count(*)::int as n from audit_log where action = 'product_facts.approve'`)).rows[0]?.n).toBe(1);
  });
});
