import type { SizeResult } from '@turnosala/core';
import type pg from 'pg';
import { parseCsvWithLines, stripBom } from './csv.js';
import { uuidv7 } from './uuid.js';

// Municipios (INE) y dimensionamientos (F1.3, REQ-MKT-03). Los municipios se cargan desde un CSV del INE (nomenclátor + padrón) que aporta
// el promotor; no se inventan cifras: sin población, el municipio no recibe estimación.

export interface TerritoryImportResult {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}
export interface TerritoryRow {
  ineCode: string;
  name: string;
  province: string;
  region: string;
  population: number | null;
}

function parseRow(line: number, rec: Record<string, string>): { row?: TerritoryRow; error?: { line: number; message: string } } {
  const fail = (message: string) => ({ error: { line, message } });
  const code = (rec.ine_code ?? '').trim();
  if (!/^\d{5}$/.test(code)) return fail(`código INE no válido (deben ser 5 dígitos): «${code}»`);
  const name = (rec.name ?? '').trim();
  const province = (rec.province ?? '').trim();
  const region = (rec.region ?? '').trim();
  if (!name || !province || !region) return fail('faltan name, province o region');
  const raw = (rec.population ?? '').trim();
  if (raw === '') return { row: { ineCode: code, name, province, region, population: null } };
  const population = Number(raw);
  if (!Number.isInteger(population) || population < 0) return fail(`población no válida: «${raw}»`);
  return { row: { ineCode: code, name, province, region, population } };
}

/** Carga municipios desde un CSV `ine_code,name,province,region[,population]`. Todo o nada; reimportar actualiza por código INE. */
export async function importTerritories(pool: pg.Pool, csv: string): Promise<TerritoryImportResult> {
  const cols = (stripBom(csv).split(/\r?\n/, 1)[0] ?? '').split(',').map((c) => c.trim().toLowerCase());
  for (const need of ['ine_code', 'name', 'province', 'region']) {
    if (!cols.includes(need)) throw new Error('La cabecera del CSV debe incluir ine_code, name, province y region (population es opcional)');
  }
  const rows: TerritoryRow[] = [];
  const errors: TerritoryImportResult['errors'] = [];
  for (const l of parseCsvWithLines(csv)) {
    const r = parseRow(l.line, l.record);
    if (r.error) errors.push(r.error);
    else if (r.row) rows.push(r.row);
  }
  if (errors.length) return { imported: 0, errors };
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const r of rows) {
      await client.query(
        `insert into territories (ine_code, name, province, region, population) values ($1,$2,$3,$4,$5)
         on conflict (ine_code) do update set name = excluded.name, province = excluded.province, region = excluded.region, population = excluded.population`,
        [r.ineCode, r.name, r.province, r.region, r.population]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return { imported: rows.length, errors: [] };
}

export async function listTerritories(pool: pg.Pool, f: { province?: string; ineCodes?: string[] } = {}): Promise<TerritoryRow[]> {
  const r = await pool.query(
    `select ine_code, name, province, region, population from territories
      where ($1::text is null or province = $1) and ($2::text[] is null or ine_code = any($2)) order by ine_code`, [f.province ?? null, f.ineCodes ?? null]);
  return (r.rows as Array<{ ine_code: string; name: string; province: string; region: string; population: number | null }>).map((x) => ({
    ineCode: x.ine_code, name: x.name, province: x.province, region: x.region, population: x.population,
  }));
}

export interface SaveSizingInput {
  segmentId: string;
  territory: unknown;
  activity: string;
  result: SizeResult;
  createdBy: string;
}

export async function saveSizing(pool: pg.Pool, i: SaveSizingInput): Promise<string> {
  const id = uuidv7();
  await pool.query(`insert into market_sizings (id, segment_id, territory, activity, result, created_by) values ($1,$2,$3,$4,$5,$6)`,
    [id, i.segmentId, JSON.stringify(i.territory), i.activity, JSON.stringify(i.result), i.createdBy]);
  return id;
}
