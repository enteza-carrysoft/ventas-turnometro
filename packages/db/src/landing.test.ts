import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { landingFacts, landingSegment } from './landing.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
const productId = uuidv7();
const SEED = JSON.parse(readFileSync(new URL('../seeds/product-facts.v1.json', import.meta.url), 'utf8')) as { trials: Array<{ published: boolean }> } & Record<string, unknown>;
const facts = (over: Record<string, unknown> = {}): string => JSON.stringify({ ...SEED, ...over });

beforeAll(async () => {
  t = await createTestDb();
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,'clinicas','Clínicas privadas','approved','{}'), ($3,$2,'borrador','Borrador','draft','{}')`, [uuidv7(), productId, uuidv7()]);
}, 60_000);
afterAll(async () => { await t.drop(); });

describe('landingSegment', () => {
  it('devuelve el nombre de un segmento aprobado y null para uno en borrador o inexistente', async () => {
    expect(await landingSegment(t.app, 'clinicas')).toEqual({ slug: 'clinicas', name: 'Clínicas privadas' });
    expect(await landingSegment(t.app, 'borrador')).toBeNull();
    expect(await landingSegment(t.app, 'no-existe')).toBeNull();
    expect(await landingSegment(t.app, 'Mal Slug!')).toBeNull();
  });
});

describe('landingFacts: solo lo aprobado y publicado', () => {
  it('sin ninguna versión aprobada ⇒ null (la página no inventa nada)', async () => {
    expect(await landingFacts(t.app)).toBeNull();
    await t.admin.query(`insert into product_facts (id, product_id, version, facts, status) values ($1,$2,1,$3,'draft')`, [uuidv7(), productId, facts()]);
    expect(await landingFacts(t.app)).toBeNull();
  });

  it('con una versión aprobada devuelve el plan Profesional y solo la prueba PUBLICADA', async () => {
    await t.admin.query(`update product_facts set status = 'approved', approved_at = now(), approved_by = 'test' where product_id = $1`, [productId]);
    const got = await landingFacts(t.app);
    expect(got?.plan.includes.length).toBeGreaterThan(0);
    expect(got).toMatchObject({ plan: { name: 'Profesional', priceMonthExVat: 69 }, trialDays: 14 });
  });

  it('sin prueba publicada no promete ninguna', async () => {
    await t.admin.query(`update product_facts set facts = $2 where product_id = $1`, [productId, facts({ trials: SEED.trials.map((x) => ({ ...x, published: false })) })]);
    expect((await landingFacts(t.app))?.trialDays).toBeNull();
  });
});
