/** Quita la marca de orden de bytes (BOM) que Excel añade al guardar CSV en UTF-8. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface CsvRow {
  /** número de línea del archivo (la cabecera es la 1) */
  line: number;
  record: Record<string, string>;
}

/** Lector de CSV mínimo: cabecera, comillas dobles, comas y saltos de línea dentro de comillas, CRLF y BOM. Ignora líneas vacías. */
export function parseCsvWithLines(text: string): CsvRow[] {
  const src = stripBom(text);
  const rows: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endCell = (): void => { cells.push(cell); cell = ''; };
  const endRow = (): void => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') endCell();
    else if (ch === '\r') continue;
    else if (ch === '\n') { endRow(); line++; rowLine = line; } else cell += ch;
  }
  if (cell !== '' || cells.length) endRow();
  const [header, ...data] = rows;
  if (!header) return [];
  const keys = header.cells.map((h) => h.trim());
  return data.map((r) => ({ line: r.line, record: Object.fromEntries(keys.map((k, idx) => [k, (r.cells[idx] ?? '').trim()])) }));
}

export function parseCsv(text: string): Array<Record<string, string>> {
  return parseCsvWithLines(text).map((r) => r.record);
}
