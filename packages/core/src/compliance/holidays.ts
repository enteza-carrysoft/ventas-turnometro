// Festivos conocidos para las franjas de llamadas y visitas (CG-05).
//
// ESTADO: NO verificado contra el BOE/BOJA (los intentos de consulta del 31/10/2026 fallaron). Solo se cargan
//   · fechas fijas por ley (nacionales y el 28-feb de Andalucía), y
//   · Jueves y Viernes Santo, calculados a partir de la Pascua (algoritmo gregoriano).
// NO se cargan los traslados por caer en domingo (p. ej. 1-nov-2026 → lunes 2-nov en Andalucía): están pendientes
// de verificar contra el BOE/BOJA (tarea F0.9 / puerta G0). Los festivos locales de cada municipio tampoco se
// cargan: el comercial los respeta. Un año fuera de COVERED_YEARS queda sin festivos y `holidayWarning()` avisa.

export const COVERED_YEARS = [2026, 2027] as const;

const FIXED_MM_DD = [
  '01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25', // nacionales
  '02-28', // Día de Andalucía
] as const;

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function holidaysForYear(year: number): string[] {
  if (!(COVERED_YEARS as readonly number[]).includes(year)) return [];
  const easter = easterSunday(year).getTime();
  const day = 86_400_000;
  return [...FIXED_MM_DD.map((md) => `${year}-${md}`), iso(new Date(easter - 3 * day)), iso(new Date(easter - 2 * day))].sort();
}

export function holidaysAround(at: Date): string[] {
  const y = at.getUTCFullYear();
  return [...holidaysForYear(y - 1), ...holidaysForYear(y), ...holidaysForYear(y + 1)];
}

/** Aviso para el panel si el año de `at` no está cargado (no se inventan fechas). */
export function holidayWarning(at: Date): string | null {
  const y = at.getUTCFullYear();
  return (COVERED_YEARS as readonly number[]).includes(y)
    ? null
    : `Sin festivos cargados para ${y}: las franjas no excluyen festivos ese año.`;
}
