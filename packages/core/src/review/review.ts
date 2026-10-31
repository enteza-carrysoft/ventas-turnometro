// Utilidades puras de la revisión humana (REQ-REV-02 CA3, REQ-REV-03).

/** Generador pseudoaleatorio reproducible (mulberry32), para poder probar el muestreo. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Muestreo de calidad: al menos el 10 % del lote (redondeado hacia arriba, mínimo 1 si hay fichas), al azar y sin repetir, aunque el
 * resto se apruebe en bloque.
 */
export function proposeSample(ids: readonly string[], rng: () => number = Math.random, ratio = 0.1): string[] {
  if (ids.length === 0) return [];
  const n = Math.min(ids.length, Math.max(1, Math.ceil(Math.round(ids.length * ratio * 1e9) / 1e9)));
  const pool = [...ids];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
  }
  return pool.slice(0, n);
}

export type CsvCell = string | number | boolean | null | undefined;

/** Un texto que empieza por = + - @ (o tabulador/retorno) lo interpretaría Excel como fórmula: se antepone una comilla simple. */
function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
