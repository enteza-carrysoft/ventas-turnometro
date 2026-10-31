// Dimensionamiento (REQ-MKT-03): universo de empresas por municipio, separando lo CONTADO (recuento oficial) de lo ESTIMADO. El cálculo es
// código determinista: el modelo no pone cifras. Estimación: el total provincial menos lo contado se reparte entre los municipios sin
// recuento en proporción a su población (método del mayor resto, para que la suma sea exacta).

export const INE_SOURCE = {
  name: 'INE — Directorio Central de Empresas (DIRCE), INEbase',
  url: 'https://www.ine.es/dyngs/DataLab/manual.html',
  license: 'CC BY-SA 4.0 (pie de página de ine.es); aviso legal de reutilización pendiente de leer',
  licenseVerified: false,
  note: 'Solo recuentos agregados de empresas activas a 1 de enero; celdas con pocas empresas pueden venir suprimidas (secreto estadístico).',
} as const;

export interface SizeTerritory {
  ineCode: string;
  name: string;
  province: string;
  population: number | null;
}
export interface SizeInput {
  territories: readonly SizeTerritory[];
  /** recuentos oficiales por municipio (0 es un recuento; ausente = no hay dato o está suprimido) */
  counted: ReadonlyMap<string, number>;
  /** total oficial de la actividad por provincia */
  provincialTotals: ReadonlyMap<string, number>;
}
export interface MunicipalSize {
  ineCode: string;
  name: string;
  province: string;
  count: number | null;
  basis: 'counted' | 'estimated' | 'unknown';
}
export interface SizeResult {
  municipalities: MunicipalSize[];
  totals: { counted: number; estimated: number; total: number; unknown: number };
  warnings: string[];
  source: typeof INE_SOURCE;
}

/** Reparte `amount` en enteros proporcionales a `weights`; la suma es exactamente `amount`. */
function apportion(amount: number, items: Array<{ key: string; weight: number }>): Map<string, number> {
  const total = items.reduce((a, i) => a + i.weight, 0);
  const parts = items.map((i) => {
    const exact = (amount * i.weight) / total;
    return { key: i.key, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = amount - parts.reduce((a, p) => a + p.floor, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key))) {
    if (left <= 0) break;
    p.floor++;
    left--;
  }
  return new Map(parts.map((p) => [p.key, p.floor]));
}

function sizeProvince(province: string, ts: SizeTerritory[], input: SizeInput, warnings: string[]): MunicipalSize[] {
  const base = (t: SizeTerritory): Omit<MunicipalSize, 'count' | 'basis'> => ({ ineCode: t.ineCode, name: t.name, province });
  const counted = ts.filter((t) => input.counted.has(t.ineCode));
  const pending = ts.filter((t) => !input.counted.has(t.ineCode));
  const out: MunicipalSize[] = counted.map((t) => ({ ...base(t), count: input.counted.get(t.ineCode) as number, basis: 'counted' as const }));
  const total = input.provincialTotals.get(province);
  const unknown = (t: SizeTerritory): MunicipalSize => ({ ...base(t), count: null, basis: 'unknown' });
  if (total === undefined) return [...out, ...pending.map(unknown)];

  const sumCounted = out.reduce((a, m) => a + (m.count ?? 0), 0);
  if (sumCounted > total) warnings.push(`${province}: lo contado (${sumCounted}) supera el total provincial (${total})`);
  const rest = Math.max(0, total - sumCounted);
  const withPop = pending.filter((t) => (t.population ?? 0) > 0);
  for (const t of pending.filter((x) => !((x.population ?? 0) > 0))) warnings.push(`${t.name}: sin población, no se estima`);
  const shares = withPop.length ? apportion(rest, withPop.map((t) => ({ key: t.ineCode, weight: t.population as number }))) : new Map<string, number>();
  for (const t of pending) out.push(withPop.includes(t) ? { ...base(t), count: shares.get(t.ineCode) as number, basis: 'estimated' } : unknown(t));
  return out;
}

export function sizeMarket(input: SizeInput): SizeResult {
  const warnings: string[] = [];
  const byProvince = new Map<string, SizeTerritory[]>();
  for (const t of [...input.territories].sort((a, b) => a.ineCode.localeCompare(b.ineCode))) byProvince.set(t.province, [...(byProvince.get(t.province) ?? []), t]);
  const municipalities = [...byProvince.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([p, ts]) => sizeProvince(p, ts, input, warnings));
  const sum = (basis: MunicipalSize['basis']): number => municipalities.filter((m) => m.basis === basis).reduce((a, m) => a + (m.count ?? 0), 0);
  const totals = { counted: sum('counted'), estimated: sum('estimated'), total: sum('counted') + sum('estimated'), unknown: municipalities.filter((m) => m.basis === 'unknown').length };
  return { municipalities, totals, warnings, source: INE_SOURCE };
}
