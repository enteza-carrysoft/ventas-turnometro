import { normalizeName, normalizePhone, registrableDomain } from '@turnosala/core';
import type pg from 'pg';
import { parseCsvWithLines, stripBom } from './csv.js';

export interface CustomerImportResult {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

interface CustomerRow {
  orgId: string;
  name: string;
  nameNorm: string;
  domain: string | null;
  phone: string | null;
}

function parseRow(line: number, rec: Record<string, string>): { row?: CustomerRow; error?: { line: number; message: string } } {
  const fail = (message: string) => ({ error: { line, message } });
  const orgId = rec.org_id ?? '';
  const name = rec.name ?? '';
  if (!orgId) return fail('falta org_id');
  if (!name) return fail('falta el nombre');
  let domain: string | null = null;
  if (rec.domain) {
    domain = registrableDomain(rec.domain);
    if (!domain) return fail(`dominio no válido: ${rec.domain}`);
  }
  let phone: string | null = null;
  if (rec.phone) {
    const p = normalizePhone(rec.phone);
    if (!p.e164) return fail(`teléfono no válido: ${rec.phone}`);
    phone = p.e164;
  }
  return { row: { orgId, name, nameNorm: normalizeName(name), domain, phone } };
}

/**
 * Carga la lista de clientes actuales de TurnoSala desde un CSV (`org_id,name[,domain,phone]`) — D-13, REQ-VER-02. Sirve para no
 * prospectar a quien ya es cliente. Todo o nada: si una fila es inválida no se importa ninguna y se dice en qué líneas.
 * Reimportar actualiza por `org_id`.
 */
export async function importTurnosalaCustomers(pool: pg.Pool, csv: string, opts: { at: Date }): Promise<CustomerImportResult> {
  const lines = parseCsvWithLines(csv);
  const header = stripBom(csv).split(/\r?\n/, 1)[0] ?? '';
  const cols = header.split(',').map((c) => c.trim().toLowerCase());
  if (!cols.includes('org_id') || !cols.includes('name')) throw new Error('La cabecera del CSV debe incluir org_id y name (domain y phone son opcionales)');
  const rows: CustomerRow[] = [];
  const errors: CustomerImportResult['errors'] = [];
  for (const l of lines) {
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
        `insert into turnosala_customers (org_id, name, name_norm, domain, phone_e164, refreshed_at) values ($1,$2,$3,$4,$5,$6)
         on conflict (org_id) do update set name = excluded.name, name_norm = excluded.name_norm, domain = excluded.domain,
           phone_e164 = excluded.phone_e164, refreshed_at = excluded.refreshed_at`,
        [r.orgId, r.name, r.nameNorm, r.domain, r.phone, opts.at],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { imported: rows.length, errors: [] };
}
