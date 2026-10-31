import { describe, expect, it } from 'vitest';
import type { VerifiedExtraction } from '../extraction/extraction.js';
import { aggregate, goldenEntrySchema, PRECISION_GATE, scoreEntry, type EntryScore, type GoldenEntry } from './golden.js';

const U = 'https://clinicasol.es/';
const golden = (over: Partial<GoldenEntry['expected']> = {}): GoldenEntry => ({
  id: 'clinica-sol', website: U, annotated_by: 'Ana', annotated_at: '2026-11-20',
  expected: { fields: { sites_count: '2', consultation_rooms: '3', name: 'Clínica Dental Sol' }, signals: ['varias_consultas', 'sala_espera'], contact_points: [{ type: 'switchboard_phone', value: '954 12 34 56' }, { type: 'generic_email', value: 'Info@ClinicaSol.es' }], legal_form: 'company', ...over },
});
const ver = (over: Partial<VerifiedExtraction> = {}): VerifiedExtraction => ({
  fields: [
    { key: 'sites_count', value: '2', provenance: 'observed', explanation: null, sourceUrl: U, quote: 'q' },
    { key: 'consultation_rooms', value: '3', provenance: 'observed', explanation: null, sourceUrl: U, quote: 'q' },
    { key: 'name', value: 'clínica dental sol ', provenance: 'observed', explanation: null, sourceUrl: U, quote: 'q' },
  ],
  signals: [{ key: 'varias_consultas', quote: 'q', sourceUrl: U }, { key: 'sala_espera', quote: 'q', sourceUrl: U }],
  contactPoints: [{ type: 'switchboard_phone', value: '+34954123456', sourceUrl: U, quote: 'q' }, { type: 'generic_email', value: 'info@clinicasol.es', sourceUrl: U, quote: 'q' }],
  legalForm: { value: 'company', sourceUrl: U, quote: 'q' },
  metrics: { accepted: 8, rejected: { unknown_url: 0, quote_not_found: 0, unknown_signal: 0, inferred_without_explanation: 0, invalid_value: 0, person_name: 0, value_not_in_quote: 0, invalid_contact: 0, link_not_in_page: 0 }, personalEmailsDiscarded: 0, hallucinationRejected: 0 },
  ...over,
});

describe('goldenEntrySchema', () => {
  it('acepta una entrada completa y rechaza anotaciones sin autor, sin fecha o con campos desconocidos', () => {
    expect(goldenEntrySchema.safeParse(golden()).success).toBe(true);
    expect(goldenEntrySchema.safeParse({ ...golden(), annotated_by: '' }).success).toBe(false);
    expect(goldenEntrySchema.safeParse({ ...golden(), annotated_at: 'ayer' }).success).toBe(false);
    expect(goldenEntrySchema.safeParse(golden({ fields: { telefono: '1' } as never })).success).toBe(false);
    expect(goldenEntrySchema.safeParse({ ...golden(), website: 'no es una url' }).success).toBe(false);
  });
});

describe('scoreEntry', () => {
  it('extracción perfecta ⇒ precisión y exhaustividad 100 % (normaliza mayúsculas, acentos y teléfonos)', () => {
    const s = scoreEntry(golden(), ver());
    expect(s.fields).toEqual({ returned: 3, correct: 3, expected: 3 });
    expect(s.signals).toEqual({ returned: 2, correct: 2, expected: 2 });
    expect(s.contacts).toEqual({ returned: 2, correct: 2, expected: 2 });
    expect(s.legalForm).toEqual({ returned: 1, correct: 1, expected: 1 });
  });

  it('un valor distinto, una señal de más y un contacto inventado bajan la precisión; lo que falta baja la exhaustividad', () => {
    const v = ver({
      fields: [{ key: 'sites_count', value: '5', provenance: 'observed', explanation: null, sourceUrl: U, quote: 'q' }],
      signals: [{ key: 'varias_consultas', quote: 'q', sourceUrl: U }, { key: 'tv_en_sala', quote: 'q', sourceUrl: U }],
      contactPoints: [{ type: 'switchboard_phone', value: '+34955999999', sourceUrl: U, quote: 'q' }],
      legalForm: { value: 'sole_trader', sourceUrl: U, quote: 'q' },
    });
    const s = scoreEntry(golden(), v);
    expect(s.fields).toEqual({ returned: 1, correct: 0, expected: 3 });
    expect(s.signals).toEqual({ returned: 2, correct: 1, expected: 2 });
    expect(s.contacts).toEqual({ returned: 1, correct: 0, expected: 2 });
    expect(s.legalForm).toEqual({ returned: 1, correct: 0, expected: 1 });
  });

  it('lo que la web dice y no se anotó cuenta como error: la anotación debe ser exhaustiva', () => {
    const s = scoreEntry(golden({ fields: { sites_count: '2' } }), ver());
    expect(s.fields).toEqual({ returned: 3, correct: 1, expected: 1 });
  });

  it('cuenta lo propuesto y lo rechazado por citas inventadas', () => {
    const s = scoreEntry(golden(), ver({ metrics: { ...ver().metrics, accepted: 8, hallucinationRejected: 2, rejected: { ...ver().metrics.rejected, quote_not_found: 2 } } }));
    expect(s.proposed).toBe(10);
    expect(s.hallucinationRejected).toBe(2);
  });
});

const entry = (over: Partial<EntryScore> = {}): EntryScore => ({
  id: 'x', fields: { returned: 10, correct: 9, expected: 10 }, signals: { returned: 10, correct: 10, expected: 10 }, contacts: { returned: 5, correct: 5, expected: 5 }, legalForm: { returned: 1, correct: 1, expected: 1 },
  proposed: 27, hallucinationRejected: 1, costEur: 0.1, ...over,
});

describe('aggregate (puerta de F1.10)', () => {
  it('suma por conjunto (micro-promedio), no promedia porcentajes por ficha', () => {
    const a = aggregate([entry({ fields: { returned: 1, correct: 1, expected: 1 } }), entry({ fields: { returned: 99, correct: 50, expected: 99 } })]);
    expect(a.fieldPrecision).toBeCloseTo(51 / 100, 6);
  });

  it('precisión global ≥ 90 % supera la puerta; por debajo, no', () => {
    expect(PRECISION_GATE).toBe(0.9);
    const ok = aggregate([entry({ fields: { returned: 10, correct: 10, expected: 10 } })]);
    expect(ok.precision).toBe(1);
    expect(ok.passesGate).toBe(true);
    const exact = aggregate([entry({ fields: { returned: 10, correct: 9, expected: 10 }, signals: { returned: 10, correct: 9, expected: 10 }, contacts: { returned: 10, correct: 9, expected: 10 }, legalForm: { returned: 0, correct: 0, expected: 0 } })]);
    expect(exact.precision).toBe(0.9);
    expect(exact.passesGate).toBe(true);
    const bad = aggregate([entry({ fields: { returned: 10, correct: 5, expected: 10 } })]);
    expect(bad.passesGate).toBe(false);
  });

  it('tasa de rechazo literal y coste por ficha y total', () => {
    const a = aggregate([entry({ proposed: 20, hallucinationRejected: 1, costEur: 0.1 }), entry({ proposed: 20, hallucinationRejected: 3, costEur: 0.3 })]);
    expect(a.literalRejectionRate).toBeCloseTo(4 / 40, 6);
    expect(a.costPerEntryEur).toBeCloseTo(0.2, 6);
    expect(a.totalCostEur).toBeCloseTo(0.4, 6);
    expect(a.entries).toBe(2);
  });

  it('sin entradas o sin nada devuelto no divide por cero: la precisión no se puede evaluar y no pasa la puerta', () => {
    const none = aggregate([]);
    expect(none).toMatchObject({ entries: 0, precision: null, passesGate: false });
    const zero = aggregate([entry({ fields: { returned: 0, correct: 0, expected: 3 }, signals: { returned: 0, correct: 0, expected: 2 }, contacts: { returned: 0, correct: 0, expected: 1 }, legalForm: { returned: 0, correct: 0, expected: 1 }, proposed: 0, hallucinationRejected: 0 })]);
    expect(zero.precision).toBeNull();
    expect(zero.passesGate).toBe(false);
    expect(zero.literalRejectionRate).toBeNull();
  });
});
