import { describe, expect, it } from 'vitest';
import { proposeSample, seededRng, toCsv } from './review.js';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`);

describe('proposeSample (REQ-REV-02 CA3)', () => {
  it.each([[1, 1], [9, 1], [10, 1], [11, 2], [20, 2], [21, 3], [100, 10], [101, 11], [200, 20]])('lote de %i ⇒ al menos %i fichas (≥ 10 %%, redondeo hacia arriba)', (n, expected) => {
    expect(proposeSample(ids(n), seededRng(1))).toHaveLength(expected);
  });

  it('un lote vacío no propone nada; la muestra son ids del lote, sin repetidos', () => {
    expect(proposeSample([], seededRng(1))).toEqual([]);
    const s = proposeSample(ids(50), seededRng(7));
    expect(new Set(s).size).toBe(s.length);
    expect(s.every((x) => ids(50).includes(x))).toBe(true);
  });

  it('es aleatoria pero reproducible con la misma semilla, y distinta con otra', () => {
    expect(proposeSample(ids(100), seededRng(3))).toEqual(proposeSample(ids(100), seededRng(3)));
    expect(proposeSample(ids(100), seededRng(3))).not.toEqual(proposeSample(ids(100), seededRng(4)));
  });

  it('con el generador real no siempre elige las primeras fichas (no es un recorte del principio)', () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 20; i++) firsts.add(proposeSample(ids(100)).slice().sort().join());
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('se puede pedir un porcentaje mayor', () => {
    expect(proposeSample(ids(100), seededRng(1), 0.25)).toHaveLength(25);
  });
});

describe('toCsv (REQ-REV-03)', () => {
  it('cabecera, comillas, comas, saltos de línea y comillas dobles escapadas; fin de línea CRLF', () => {
    expect(toCsv(['a', 'b'], [['x', 'hola, "mundo"'], ['l1\nl2', null]])).toBe('a,b\r\nx,"hola, ""mundo"""\r\n"l1\nl2",\r\n');
  });

  it.each(['=1+1', '+34954000000', '-2', '@SUM(A1)', '\t=cmd', '\r=cmd'])('neutraliza la inyección de fórmulas en Excel: %j', (v) => {
    const out = toCsv(['c'], [[v]]);
    expect(out.split('\r\n')[1]?.replace(/^"|"$/g, '')).toMatch(/^'/);
  });

  it('los números y booleanos se escriben tal cual; un texto normal no se toca', () => {
    expect(toCsv(['n', 't', 'b'], [[42, 'Clínica Sol', true]])).toBe('n,t,b\r\n42,Clínica Sol,true\r\n');
  });

  it('un número negativo es un número, no una fórmula', () => {
    expect(toCsv(['n'], [[-5]])).toBe('n\r\n-5\r\n');
  });
});
