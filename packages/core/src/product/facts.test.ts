import { describe, expect, it } from 'vitest';
import { activePromotions, claimableTrialDays, productFactsSchema, type ProductFacts } from './facts.js';

const src = { url: 'https://turnosala.com', fetched_at: '2026-10-31T10:00:00Z' };

function facts(over: Partial<ProductFacts> = {}): ProductFacts {
  return {
    vat_rate: 0.21,
    prices_include_vat_on_web: true,
    plans: [
      { id: 'basic', name: 'Básico', price_month_ex_vat: 24, price_year_ex_vat: 240, quote_only: false, limits: { centers: 1 }, includes: ['Turnos sin cita'], source: src },
      { id: 'enterprise', name: 'Enterprise', price_month_ex_vat: null, price_year_ex_vat: null, quote_only: true, limits: {}, includes: ['SSO'], source: src },
    ],
    addons: [],
    trials: [
      { id: 'web', channel: 'self_service_web', days: 14, published: true, source: 'turnosala.com «Prueba 14 días gratis»' },
      { id: 'sales', channel: 'sales_trial', days: 30, published: false, source: 'PRP-017 (pendiente de aprobación)' },
    ],
    promotions: [],
    terms: { no_lock_in: true, cancel_anytime: true },
    urls: { web: 'https://turnosala.com', app: 'https://app.turnosala.com' },
    discrepancies: [],
    ...over,
  };
}

describe('productFactsSchema (REQ-MKT-01)', () => {
  it('acepta unos hechos completos', () => {
    expect(productFactsSchema.safeParse(facts()).success).toBe(true);
  });

  it('un plan con precio no puede ser «solo presupuesto» y viceversa', () => {
    const bad1 = facts({ plans: [{ ...facts().plans[0]!, quote_only: true }] });
    const bad2 = facts({ plans: [{ ...facts().plans[1]!, quote_only: false }] });
    expect(productFactsSchema.safeParse(bad1).success).toBe(false);
    expect(productFactsSchema.safeParse(bad2).success).toBe(false);
  });

  it('cada plan exige fuente con URL y fecha (P2.2)', () => {
    const noSource = { ...facts().plans[0]!, source: { url: '', fetched_at: '' } };
    expect(productFactsSchema.safeParse(facts({ plans: [noSource] })).success).toBe(false);
  });

  it('una promoción sin fecha de caducidad se rechaza (CA3)', () => {
    const promo = { code: 'X', description: 'x', published: true };
    expect(productFactsSchema.safeParse(facts({ promotions: [promo as never] })).success).toBe(false);
    const ok = { ...promo, until: '2026-12-31' };
    expect(productFactsSchema.safeParse(facts({ promotions: [ok] })).success).toBe(true);
  });

  it('un precio negativo o una duración de prueba no entera se rechazan', () => {
    expect(productFactsSchema.safeParse(facts({ plans: [{ ...facts().plans[0]!, price_month_ex_vat: -1 }] })).success).toBe(false);
    expect(productFactsSchema.safeParse(facts({ trials: [{ id: 't', channel: 'web', days: 14.5, published: true, source: 's' }] })).success).toBe(false);
  });
});

describe('qué se puede prometer en contenido nuevo', () => {
  it('solo las promociones publicadas y no caducadas (CA3)', () => {
    const f = facts({
      promotions: [
        { code: 'VIGENTE', description: 'a', until: '2026-12-31', published: true },
        { code: 'CADUCADA', description: 'b', until: '2026-10-01', published: true },
        { code: 'NO_PUBLICADA', description: 'c', until: '2026-12-31', published: false },
      ],
    });
    expect(activePromotions(f, new Date('2026-11-10T10:00:00Z')).map((p) => p.code)).toEqual(['VIGENTE']);
  });

  it('la fecha de caducidad es inclusiva en su último día (hora de Madrid)', () => {
    const f = facts({ promotions: [{ code: 'P', description: 'a', until: '2026-12-31', published: true }] });
    expect(activePromotions(f, new Date('2026-12-31T22:30:00Z')).length).toBe(1); // 23:30 en Madrid
    expect(activePromotions(f, new Date('2026-12-31T23:30:00Z')).length).toBe(0); // 00:30 del 1-ene en Madrid
  });

  it('solo se pueden prometer las pruebas publicadas: 14 días, no los 30 de la prueba comercial', () => {
    expect(claimableTrialDays(facts())).toEqual([14]);
  });
});
