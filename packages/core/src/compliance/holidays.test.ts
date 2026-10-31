import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate.js';
import { ctx, grant, input } from './fixtures.js';
import { COVERED_YEARS, holidaysAround, holidaysForYear, holidayWarning } from './holidays.js';

// Fechas copiadas literalmente de los anexos oficiales:
//  · 2026 → Decreto 101/2025, de 14 de mayo (BOJA núm. 93, 19/05/2025)
//  · 2027 → Decreto 84/2026, de 29 de abril (BOJA núm. 84, 05/05/2026)
const BOJA_2026 = ['2026-01-01', '2026-01-06', '2026-02-28', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-08-15', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25'];
const BOJA_2027 = ['2027-01-01', '2027-01-06', '2027-03-01', '2027-03-25', '2027-03-26', '2027-05-01',
  '2027-08-16', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08', '2027-12-25'];

describe('festivos de Andalucía (BOJA)', () => {
  it('2026 coincide exactamente con el Decreto 101/2025', () => {
    expect(holidaysForYear(2026)).toEqual(BOJA_2026);
  });
  it('2027 coincide exactamente con el Decreto 84/2026', () => {
    expect(holidaysForYear(2027)).toEqual(BOJA_2027);
  });
  it('los traslados por domingo están: 2-nov-2026 y 7-dic-2026 sí; 1-nov y 6-dic-2026 (domingos) no', () => {
    const h = holidaysForYear(2026);
    expect(h).toContain('2026-11-02');
    expect(h).toContain('2026-12-07');
    expect(h).not.toContain('2026-11-01');
    expect(h).not.toContain('2026-12-06');
  });
  it('2027: 28-feb y 15-ago (domingos) pasan a 1-mar y 16-ago', () => {
    const h = holidaysForYear(2027);
    expect(h).toContain('2027-03-01');
    expect(h).toContain('2027-08-16');
    expect(h).not.toContain('2027-02-28');
    expect(h).not.toContain('2027-08-15');
  });
  it('un año sin decreto cargado queda vacío y avisa (no se inventan fechas)', () => {
    expect(COVERED_YEARS).toEqual([2026, 2027]);
    expect(holidaysForYear(2028)).toEqual([]);
    expect(holidayWarning(new Date('2028-03-01T10:00:00Z'))).toMatch(/2028/);
    expect(holidayWarning(new Date('2026-11-10T10:00:00Z'))).toBeNull();
  });
  it('holidaysAround reúne el año anterior, el actual y el siguiente', () => {
    const h = holidaysAround(new Date('2026-12-30T10:00:00Z'));
    expect(h).toContain('2026-12-25');
    expect(h).toContain('2027-01-01');
  });
});

describe('CG-05 con los festivos reales', () => {
  const at = (iso: string) => {
    const when = new Date(iso);
    return evaluate(input('ai_call', 'prospecting', { at: when }),
      ctx({ now: when, holidays: holidaysAround(when), consents: [grant('ai_call', { createdAt: new Date('2026-06-01T00:00:00Z') })] }));
  };
  it('lunes 2-nov-2026 a las 11:00 (festivo trasladado) → BLOCK CG-05', () => {
    const r = at('2026-11-02T10:00:00Z');
    expect([r.decision, r.ruleIds[0], r.reasons[0]]).toEqual(['BLOCK', 'CG-05', 'festivo']);
  });
  it('lunes 7-dic-2026 → BLOCK; el lunes siguiente laborable pasa', () => {
    expect(at('2026-12-07T10:00:00Z').ruleIds[0]).toBe('CG-05');
    expect(at('2026-11-09T10:00:00Z').ruleIds[0]).toBe('CG-11');
  });
  it('lunes 1-mar-2027 (Día de Andalucía trasladado) → BLOCK', () => {
    expect(at('2027-03-01T10:00:00Z').ruleIds[0]).toBe('CG-05');
  });
});
