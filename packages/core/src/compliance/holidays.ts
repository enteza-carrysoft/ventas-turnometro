// Festivos de la Comunidad Autónoma de Andalucía para las franjas de llamadas y visitas (CG-05).
//
// FUENTE (verificada el 31/10/2026 leyendo los anexos oficiales del BOJA):
//   · 2026 → Decreto 101/2025, de 14 de mayo (BOJA núm. 93, de 19/05/2025, pág. 6889).
//   · 2027 → Decreto 84/2026, de 29 de abril (BOJA núm. 84, de 05/05/2026, pág. 5812).
// Los traslados por caer en domingo ya vienen aplicados en esas listas (2026: 1-nov → 2-nov y 6-dic → 7-dic;
// 2027: 28-feb → 1-mar y 15-ago → 16-ago).
//
// LIMITACIONES (documentadas en spec/research/proveedores.md):
//   · Solo Andalucía. Para destinos de otras comunidades (oleadas 2-3 con otras comunidades) hay que cargar sus calendarios.
//   · No se cargan las dos fiestas locales de cada municipio (BOJA núm. 79 de 27/04/2026 las lista para 2026):
//     el comercial las respeta. Cargarlas por municipio INE es mejora de F4.
//   · Un año fuera de COVERED_YEARS queda sin festivos y `holidayWarning()` avisa: no se inventan fechas.
//     Cada año hay que añadir el decreto nuevo (se publica en abril-mayo del año anterior).

const ANDALUCIA: Readonly<Record<number, readonly string[]>> = {
  2026: [
    '2026-01-01', '2026-01-06', '2026-02-28', '2026-04-02', '2026-04-03', '2026-05-01',
    '2026-08-15', '2026-10-12', '2026-11-02', '2026-12-07', '2026-12-08', '2026-12-25',
  ],
  2027: [
    '2027-01-01', '2027-01-06', '2027-03-01', '2027-03-25', '2027-03-26', '2027-05-01',
    '2027-08-16', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08', '2027-12-25',
  ],
};

export const COVERED_YEARS: readonly number[] = Object.keys(ANDALUCIA).map(Number).sort();

export function holidaysForYear(year: number): string[] {
  return [...(ANDALUCIA[year] ?? [])];
}

export function holidaysAround(at: Date): string[] {
  const y = at.getUTCFullYear();
  return [...holidaysForYear(y - 1), ...holidaysForYear(y), ...holidaysForYear(y + 1)];
}

/** Aviso para el panel si el año de `at` no está cargado (no se inventan fechas). */
export function holidayWarning(at: Date): string | null {
  const y = at.getUTCFullYear();
  return COVERED_YEARS.includes(y) ? null : `Sin festivos cargados para ${y}: las franjas no excluyen festivos ese año.`;
}
