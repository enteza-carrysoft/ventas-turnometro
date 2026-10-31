import type { TimeRange } from './types.js';

export interface LocalParts {
  /** 'YYYY-MM-DD' en la zona indicada */
  date: string;
  /** 1 = lunes … 7 = domingo */
  weekday: number;
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(at: Date, timeZone: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(at)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 0,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inRanges(minutes: number, ranges: readonly TimeRange[]): boolean {
  return ranges.some(([s, e]) => minutes >= toMinutes(s) && minutes < toMinutes(e));
}

export function isWeekend(weekday: number): boolean {
  return weekday >= 6;
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Primer instante (UTC) del día local de `timeZone` que contiene `at`. Busca por bisección en lugar de restar horas de
 * reloj: los días del cambio de hora duran 23 o 25 horas y restar daba una hora de error.
 */
export function dayStartMadrid(at: Date, timeZone: string = 'Europe/Madrid'): Date {
  const day = localParts(at, timeZone).date;
  let lo = at.getTime() - 26 * HOUR_MS; // seguro: ningún día local dura más de 25 h
  let hi = at.getTime();
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localParts(new Date(mid), timeZone).date === day) hi = mid;
    else lo = mid;
  }
  // La medianoche local cae siempre en un minuto exacto y `hi` está a menos de 1 s de ella: se trunca al minuto.
  return new Date(Math.floor(hi / 60_000) * 60_000);
}
