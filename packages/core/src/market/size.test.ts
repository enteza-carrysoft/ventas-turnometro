import { describe, expect, it } from 'vitest';
import { INE_SOURCE, sizeMarket, type SizeInput } from './size.js';

const T = (ineCode: string, name: string, population: number | null, province = 'Sevilla') => ({ ineCode, name, province, population });
const base = (): SizeInput => ({
  territories: [T('41091', 'Sevilla', 680000), T('41038', 'Dos Hermanas', 135000), T('41004', 'Alcalá', 75000), T('41099', 'Pueblo', 5000)],
  counted: new Map([['41091', 400]]),
  provincialTotals: new Map([['Sevilla', 700]]),
});

describe('sizeMarket (REQ-MKT-03): contado frente a estimado', () => {
  it('lo contado se respeta tal cual y el resto del total provincial se reparte por población entre los municipios sin recuento', () => {
    const r = sizeMarket(base());
    const by = Object.fromEntries(r.municipalities.map((m) => [m.ineCode, m]));
    expect(by['41091']).toMatchObject({ count: 400, basis: 'counted' });
    // resto = 700 − 400 = 300 entre 135000 + 75000 + 5000 = 215000
    expect(by['41038']).toMatchObject({ basis: 'estimated', count: 188 }); // 300 · 135/215 = 188,37
    expect(by['41004']).toMatchObject({ basis: 'estimated', count: 105 }); // 104,65
    expect(by['41099']).toMatchObject({ basis: 'estimated', count: 7 }); // 6,98
    expect(r.totals).toEqual({ counted: 400, estimated: 300, total: 700, unknown: 0 });
  });

  it('el reparto siempre suma exactamente el resto (método del mayor resto)', () => {
    for (const rest of [1, 2, 7, 99, 301]) {
      const r = sizeMarket({ ...base(), counted: new Map(), provincialTotals: new Map([['Sevilla', rest]]) });
      expect(r.totals.estimated).toBe(rest);
      expect(r.municipalities.reduce((a, m) => a + (m.count ?? 0), 0)).toBe(rest);
    }
  });

  it('si lo contado supera el total provincial no se inventan negativos: lo estimado es 0 y se avisa', () => {
    const r = sizeMarket({ ...base(), counted: new Map([['41091', 900]]) });
    expect(r.municipalities.filter((m) => m.basis === 'estimated').every((m) => m.count === 0)).toBe(true);
    expect(r.warnings).toContain('Sevilla: lo contado (900) supera el total provincial (700)');
  });

  it('sin total provincial los municipios sin recuento quedan «unknown» (sin cifra) y no suman', () => {
    const r = sizeMarket({ ...base(), provincialTotals: new Map() });
    expect(r.municipalities.find((m) => m.ineCode === '41038')).toMatchObject({ basis: 'unknown', count: null });
    expect(r.totals).toEqual({ counted: 400, estimated: 0, total: 400, unknown: 3 });
  });

  it('sin población en un municipio sin recuento no se le reparte nada y se avisa; no se divide por cero', () => {
    const r = sizeMarket({ ...base(), territories: [T('41091', 'Sevilla', 680000), T('41038', 'Dos Hermanas', null)], provincialTotals: new Map([['Sevilla', 500]]) });
    expect(r.municipalities.find((m) => m.ineCode === '41038')).toMatchObject({ basis: 'unknown', count: null });
    expect(r.warnings.some((w) => /sin población/i.test(w))).toBe(true);
  });

  it('cada provincia se reparte por separado', () => {
    const r = sizeMarket({
      territories: [T('41038', 'Dos Hermanas', 100), T('11012', 'Cádiz', 300, 'Cádiz'), T('11020', 'Jerez', 100, 'Cádiz')],
      counted: new Map(), provincialTotals: new Map([['Sevilla', 10], ['Cádiz', 40]]),
    });
    const by = Object.fromEntries(r.municipalities.map((m) => [m.ineCode, m.count]));
    expect(by).toEqual({ '41038': 10, '11012': 30, '11020': 10 });
  });

  it('un recuento cero es un recuento (contado), no un dato ausente', () => {
    const r = sizeMarket({ ...base(), counted: new Map([['41091', 0]]), provincialTotals: new Map([['Sevilla', 0]]) });
    expect(r.municipalities.find((m) => m.ineCode === '41091')).toMatchObject({ count: 0, basis: 'counted' });
    expect(r.totals.total).toBe(0);
  });

  it('el resultado anota la fuente y su licencia', () => {
    const r = sizeMarket(base());
    expect(r.source).toEqual(INE_SOURCE);
    expect(INE_SOURCE).toMatchObject({ name: expect.stringMatching(/INE/), license: expect.stringMatching(/CC BY-SA 4\.0/), licenseVerified: false });
  });

  it('es determinista: mismo input, mismo resultado, con independencia del orden de los territorios', () => {
    const a = sizeMarket(base());
    const b = sizeMarket({ ...base(), territories: [...base().territories].reverse() });
    expect([...a.municipalities].sort((x, y) => x.ineCode.localeCompare(y.ineCode))).toEqual([...b.municipalities].sort((x, y) => x.ineCode.localeCompare(y.ineCode)));
  });
});
