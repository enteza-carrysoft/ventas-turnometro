import { dayStartMadrid, registrableDomain } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Búsqueda de la web de las candidatas que no la tienen. Cola con reintentos muy espaciados (una web que no aparece hoy rara vez aparece mañana)
// y guardado con prueba: la web solo se asigna con la página y la cita literal que la verificó (inferida: la revisión humana la ve resaltada).

type Db = pg.Pool;
export const MAX_DISCOVER_ATTEMPTS = 2;
const DAY_PLUS = 26 * 3_600_000; // desde el inicio de un día local, +26 h siempre cae en el día siguiente (los días miden 23–25 h)

export interface Discoverable {
  id: string;
  name: string;
  municipality: string | null;
  phones: string[];
}

export async function claimDiscoverable(pool: Db, o: { limit: number; now?: Date | undefined }): Promise<Discoverable[]> {
  const now = o.now ?? new Date();
  const claimed = (await pool.query(
    `with c as (
       select id, discover_attempts from prospects
        where status = 'candidate' and website is null and discover_attempts < $3 and (discover_next_at is null or discover_next_at <= $1)
        order by created_at, id limit $2 for update skip locked)
     update prospects p set discover_attempts = c.discover_attempts + 1, discover_next_at = $1::timestamptz + interval '7 days'
       from c where p.id = c.id returning p.id, p.name, p.ine_code, p.address`, [now, o.limit, MAX_DISCOVER_ATTEMPTS])).rows as Array<{ id: string; name: string; ine_code: string | null; address: { municipality?: string } | null }>;
  const out: Discoverable[] = [];
  for (const p of claimed) {
    const town = p.ine_code ? ((await pool.query('select name from territories where ine_code = $1', [p.ine_code])).rows[0] as { name: string } | undefined)?.name : undefined;
    const phones = (await pool.query(`select value_norm from contact_points where prospect_id = $1 and type in ('switchboard_phone','mobile_phone') and valid is not false`, [p.id])).rows as Array<{ value_norm: string }>;
    out.push({ id: p.id, name: p.name, municipality: town ?? p.address?.municipality ?? null, phones: phones.map((x) => x.value_norm) });
  }
  return out;
}

/** Devuelve el intento de fichas que no se pudieron procesar por un fallo del sistema (p. ej. presupuesto agotado). */
export async function unclaimDiscoverable(pool: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(`update prospects set discover_attempts = greatest(discover_attempts - 1, 0), discover_next_at = null where id = any($1::uuid[]) and status = 'candidate'`, [ids]);
}

export async function recordDiscoverFailure(pool: Db, id: string, error: string): Promise<void> {
  await pool.query('update prospects set discover_error = left($2, 300) where id = $1', [id, error]);
}

export interface WebsiteEvidence {
  url: string;
  /** página que demostró la coincidencia */
  pageUrl: string;
  /** línea literal de esa página (≤ 300 caracteres) */
  quote: string;
  matchedBy: 'phone' | 'name_and_place';
  fetchedAt: Date;
}
export type AttachResult = { ok: true } | { ok: false; reason: 'invalid_url' | 'not_found' | 'not_candidate' | 'has_website' | 'domain_taken' };

const HOW: Record<WebsiteEvidence['matchedBy'], string> = {
  phone: 'el teléfono de la ficha aparece en la página',
  name_and_place: 'el nombre y la localidad de la ficha aparecen en la página',
};

export async function attachWebsite(pool: Db, id: string, w: WebsiteEvidence): Promise<AttachResult> {
  let domain: string | null = null;
  try {
    const u = new URL(w.url);
    domain = u.protocol === 'http:' || u.protocol === 'https:' ? registrableDomain(u.hostname) : null;
  } catch {
    domain = null;
  }
  if (!domain) return { ok: false, reason: 'invalid_url' };
  const c = await pool.connect();
  try {
    await c.query('begin');
    const p = (await c.query('select status, website from prospects where id = $1 for update', [id])).rows[0] as { status: string; website: string | null } | undefined;
    if (!p) { await c.query('rollback'); return { ok: false, reason: 'not_found' }; }
    if (p.status !== 'candidate') { await c.query('rollback'); return { ok: false, reason: 'not_candidate' }; }
    if (p.website) { await c.query('rollback'); return { ok: false, reason: 'has_website' }; }
    await c.query('update prospects set website = $2, domain = $3, updated_at = now() where id = $1', [id, w.url, domain]);
    await c.query(
      `insert into evidences (id, prospect_id, field, value, provenance, explanation, source_url, quote, fetched_at, extractor_version)
       values ($1,$2,'website',$3,'inferred',$4,$5,$6,$7,'discover-v1') on conflict do nothing`,
      [uuidv7(), id, w.url, `Web encontrada con la búsqueda del proveedor y verificada en código: ${HOW[w.matchedBy]}`, w.pageUrl, w.quote.slice(0, 300), w.fetchedAt]);
    await c.query('commit');
    return { ok: true };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'domain_taken' };
    throw e;
  } finally {
    c.release();
  }
}

/** Euros gastados hoy (día de Madrid) en una ruta de la pasarela. */
export async function spentTodayOnRoute(pool: Db, route: string, at: Date): Promise<number> {
  const start = dayStartMadrid(at);
  const end = dayStartMadrid(new Date(start.getTime() + DAY_PLUS));
  const r = await pool.query(`select coalesce(sum(cost_eur), 0) as spent from usage_costs where route = $1 and created_at >= $2 and created_at < $3`, [route, start, end]);
  return Number((r.rows[0] as { spent: string }).spent);
}

/** Presupuesto diario de búsqueda web (D-03: 2 €). */
export async function webSearchBudgetEur(pool: Db): Promise<number> {
  const v = (await pool.query(`select value from settings where key = 'budget_daily_eur'`)).rows[0] as { value: { web_search?: number } } | undefined;
  const n = v?.value.web_search;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Falta budget_daily_eur.web_search en los ajustes');
  return n;
}
