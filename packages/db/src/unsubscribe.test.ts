import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { createPublicToken, revokePublicToken } from './tokens.js';
import { unsubscribeByToken } from './unsubscribe.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;

beforeAll(async () => { t = await createTestDb(); }, 60_000);
afterAll(async () => { await t.drop(); });

const count = async (sql: string, a: unknown[] = []): Promise<number> => Number(((await t.admin.query(sql, a)).rows[0] as { n: string }).n);

async function setup(over: { contact?: boolean; expiresAt?: Date } = {}) {
  n++;
  const email = `rosa${n}@baja${n}centro.es`;
  const e = await ingestCandidate(t.app, { name: `Centro Baja ${'qwxz'.repeat(n)} S.L.`, website: `https://baja${n}centro.es/`, sourceId: 'osm', externalId: `b${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const prospectId = e.prospectId as string;
  await t.admin.query(`update prospects set status = 'approved' where id = $1`, [prospectId]);
  const dealId = uuidv7();
  await t.admin.query(`insert into deals (id, prospect_id, stage_id, created_by) values ($1,$2,'interested','test')`, [dealId, prospectId]);
  const tok = await createPublicToken(t.app, { kind: 'unsubscribe', prospectId, ...(over.contact === false ? {} : { contact: { email } }), ...(over.expiresAt ? { expiresAt: over.expiresAt } : {}) });
  return { prospectId, dealId, email, ...tok };
}
const status = async (id: string): Promise<string> => ((await t.admin.query('select status from prospects where id = $1', [id])).rows[0] as { status: string }).status;
const stage = async (id: string): Promise<string> => ((await t.admin.query('select stage_id from deals where id = $1', [id])).rows[0] as { stage_id: string }).stage_id;

describe('unsubscribeByToken', () => {
  it('alcance «empresa»: oposición completa (ficha bloqueada, oportunidad perdida por oposición, correo y dominio excluidos)', async () => {
    const w = await setup();
    expect(await unsubscribeByToken(t.app, w.token, 'company')).toEqual({ status: 'done', scope: 'company' });
    expect(await status(w.prospectId)).toBe('blocked');
    expect(await stage(w.dealId)).toBe('lost');
    expect(await count(`select count(*) n from suppressions where kind = 'email' and value = $1 and origin = 'unsubscribe'`, [w.email])).toBe(1);
    expect(await count(`select count(*) n from suppressions where kind = 'prospect' and value = $1`, [w.prospectId])).toBe(1);
  });

  it('alcance «contacto»: solo se excluye ese correo; la ficha y la oportunidad siguen', async () => {
    const w = await setup();
    expect(await unsubscribeByToken(t.app, w.token, 'contact')).toEqual({ status: 'done', scope: 'contact' });
    expect(await count(`select count(*) n from suppressions where kind = 'email' and value = $1`, [w.email])).toBe(1);
    expect(await count(`select count(*) n from suppressions where kind in ('prospect','domain') and value = any($1)`, [[w.prospectId, `baja${n}centro.es`]])).toBe(0);
    expect(await status(w.prospectId)).toBe('approved');
    expect(await stage(w.dealId)).toBe('interested');
  });

  it('un token sin contacto no admite el alcance «contacto» (no se hace nada) pero sí «empresa»', async () => {
    const w = await setup({ contact: false });
    expect(await unsubscribeByToken(t.app, w.token, 'contact')).toEqual({ status: 'invalid' });
    expect(await status(w.prospectId)).toBe('approved');
    expect(await unsubscribeByToken(t.app, w.token, 'company')).toEqual({ status: 'done', scope: 'company' });
    expect(await status(w.prospectId)).toBe('blocked');
  });

  it('repetir el enlace es idempotente: sigue respondiendo «hecho» sin duplicar exclusiones', async () => {
    const w = await setup();
    await unsubscribeByToken(t.app, w.token, 'company');
    expect(await unsubscribeByToken(t.app, w.token, 'company')).toEqual({ status: 'done', scope: 'company' });
    expect(await count(`select count(*) n from suppressions where kind = 'email' and value = $1`, [w.email])).toBe(1);
  });

  it('token inventado, mal formado, caducado, revocado o de OTRO tipo (landing) ⇒ «invalid» indistinguible, sin cambios', async () => {
    const w = await setup();
    const expired = await setup({ expiresAt: new Date(Date.now() - 1000) });
    const revoked = await setup();
    await revokePublicToken(t.app, revoked.id);
    const landing = await createPublicToken(t.app, { kind: 'landing', prospectId: w.prospectId, contact: { email: w.email } });
    for (const token of ['x'.repeat(22), 'corto', '', expired.token, revoked.token, landing.token]) {
      expect(await unsubscribeByToken(t.app, token, 'company'), token.slice(0, 6)).toEqual({ status: 'invalid' });
    }
    for (const id of [w.prospectId, expired.prospectId, revoked.prospectId]) expect(await status(id)).toBe('approved');
  });

  it('un alcance desconocido se rechaza', async () => {
    const w = await setup();
    expect(await unsubscribeByToken(t.app, w.token, 'todo' as never)).toEqual({ status: 'invalid' });
    expect(await status(w.prospectId)).toBe('approved');
  });
});
