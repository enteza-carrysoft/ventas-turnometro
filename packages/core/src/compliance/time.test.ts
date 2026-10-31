import { describe, expect, it } from 'vitest';
import { dayStartMadrid, localParts } from './time.js';

const iso = (d: Date): string => d.toISOString();

describe('dayStartMadrid: inicio (UTC) del día local de Europe/Madrid', () => {
  it('invierno (CET, UTC+1): el día empieza a las 23:00Z del día anterior', () => {
    expect(iso(dayStartMadrid(new Date('2026-11-10T10:00:00Z')))).toBe('2026-11-09T23:00:00.000Z');
  });
  it('verano (CEST, UTC+2): el día empieza a las 22:00Z del día anterior', () => {
    expect(iso(dayStartMadrid(new Date('2026-07-14T08:30:00Z')))).toBe('2026-07-13T22:00:00.000Z');
  });
  it('justo a medianoche local pertenece al día que empieza', () => {
    expect(iso(dayStartMadrid(new Date('2026-11-09T23:00:00Z')))).toBe('2026-11-09T23:00:00.000Z');
    expect(iso(dayStartMadrid(new Date('2026-11-09T22:59:59Z')))).toBe('2026-11-08T23:00:00.000Z');
  });
  it('día del cambio a horario de verano (29-mar-2026, 23 h): empieza a las 23:00Z del 28', () => {
    expect(iso(dayStartMadrid(new Date('2026-03-29T10:00:00Z')))).toBe('2026-03-28T23:00:00.000Z');
  });
  it('día del cambio a horario de invierno (25-oct-2026, 25 h): empieza a las 22:00Z del 24 (el método de restar horas fallaba aquí)', () => {
    expect(iso(dayStartMadrid(new Date('2026-10-25T10:00:00Z')))).toBe('2026-10-24T22:00:00.000Z');
  });
  it('el resultado siempre es una medianoche local y no hay un instante anterior del mismo día', () => {
    for (const s of ['2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T23:30:00Z', '2027-03-28T12:00:00Z']) {
      const start = dayStartMadrid(new Date(s));
      const p = localParts(start, 'Europe/Madrid');
      expect([p.date, p.minutes]).toEqual([localParts(new Date(s), 'Europe/Madrid').date, 0]);
      expect(localParts(new Date(start.getTime() - 60_000), 'Europe/Madrid').date).not.toBe(p.date);
    }
  });
});
