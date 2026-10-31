import { activePromotions, claimableTrialDays, productFactsSchema } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveProductFacts } from './product-facts.js';
import { seedProductFactsDraft } from './seed-product-facts.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const row = async () =>
  (await t.app.query(`select f.id, f.version, f.status, f.facts, f.approved_by, p.slug from product_facts f join products p on p.id = f.product_id`)).rows;

describe('F0.10 product_facts v1 de TurnoSala', () => {
  it('siembra el producto y una versión 1 en borrador, sin aprobar', async () => {
    const r = await seedProductFactsDraft(t.app, { actor: 'agente-f0' });
    expect(r.created).toBe(true);
    const rows = await row();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'turnosala', version: 1, status: 'draft', approved_by: null });
  });

  it('es idempotente: repetirla no crea otra versión ni otra fila de auditoría', async () => {
    const r = await seedProductFactsDraft(t.app, { actor: 'agente-f0' });
    expect(r.created).toBe(false);
    expect(await row()).toHaveLength(1);
    expect((await t.app.query(`select count(*)::int as n from audit_log where action = 'product_facts.seed'`)).rows[0]?.n).toBe(1);
  });

  it('lo guardado cumple el esquema de REQ-MKT-01', async () => {
    expect(productFactsSchema.safeParse((await row())[0]?.facts).success).toBe(true);
  });

  it('los precios sin IVA reproducen EXACTAMENTE los publicados con IVA el 31/10/2026', async () => {
    const f = productFactsSchema.parse((await row())[0]?.facts);
    const cents = (n: number): number => Math.round(n * (1 + f.vat_rate) * 100) / 100;
    const byId = Object.fromEntries(f.plans.map((p) => [p.id, p]));
    // Literales de turnosala.com: mensual 29,04 · 83,49 · 180,29; anual 290,40 · 834,90 · 1.802,90 (IVA incluido)
    expect(cents(byId.basic!.price_month_ex_vat!)).toBe(29.04);
    expect(cents(byId.pro!.price_month_ex_vat!)).toBe(83.49);
    expect(cents(byId.business!.price_month_ex_vat!)).toBe(180.29);
    expect(cents(byId.basic!.price_year_ex_vat!)).toBe(290.4);
    expect(cents(byId.pro!.price_year_ex_vat!)).toBe(834.9);
    expect(cents(byId.business!.price_year_ex_vat!)).toBe(1802.9);
    expect(byId.enterprise).toMatchObject({ quote_only: true, price_month_ex_vat: null });
  });

  it('solo se puede prometer la prueba PUBLICADA (14 días), no los 30 de la prueba comercial', async () => {
    const f = productFactsSchema.parse((await row())[0]?.facts);
    expect(claimableTrialDays(f)).toEqual([14]);
    expect(f.trials.find((x) => x.channel === 'sales_trial')).toMatchObject({ days: 30, published: false });
  });

  it('no hay promociones citables: TURNOSALA50 no está publicada (CA3)', async () => {
    const f = productFactsSchema.parse((await row())[0]?.facts);
    expect(activePromotions(f, new Date('2026-11-10T10:00:00Z'))).toEqual([]);
  });

  it('las discrepancias entre fuentes quedan señaladas para el promotor (D-02, D-17)', async () => {
    const f = productFactsSchema.parse((await row())[0]?.facts);
    const fields = f.discrepancies.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['plans.price_month_ex_vat', 'trials.days', 'promotions.TURNOSALA50']));
  });

  it('aprobarla exige admin: marketing no puede; admin sí, y queda en audit_log (CA1)', async () => {
    const id = (await row())[0]?.id as string;
    await expect(approveProductFacts(t.app, { factsId: id, actor: 'u-mkt', role: 'marketing' })).rejects.toThrow(/admin/);
    expect((await row())[0]?.status).toBe('draft');
    await approveProductFacts(t.app, { factsId: id, actor: 'u-admin', role: 'admin' });
    expect((await row())[0]).toMatchObject({ status: 'approved', approved_by: 'u-admin' });
  });
});
