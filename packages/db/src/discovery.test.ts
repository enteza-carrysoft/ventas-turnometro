import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachWebsite, claimDiscoverable, recordDiscoverFailure, spentTodayOnRoute, unclaimDiscoverable, webSearchBudgetEur } from './discovery.js';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
const T0 = new Date('2026-11-10T10:00:00Z');
const plusD = (d: number): Date => new Date(T0.getTime() + d * 86_400_000);
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000)`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

function word(k: number): string {
  let x = (k * 2654435761) % 4294967296;
  let w = '';
  for (let i = 0; i < 7; i++) { w += 'bcdfghjklmnpqrstvwxyz'.charAt(x % 21) + 'aeiou'.charAt((x >> 5) % 5); x = (x * 1103515245 + 12345) % 2147483648; }
  return w;
}
async function cand(over: { website?: string; municipality?: string; phone?: string } = {}): Promise<{ id: string; name: string }> {
  n++;
  const name = `${word(n + 900)} ${word(n * 7 + 5)} S.L.`;
  const r = await ingestCandidate(t.app, { name, ...(over.website ? { website: over.website } : {}), phone: over.phone ?? `955 6${String(n).padStart(2, '0')} 0${String(n).padStart(2, '0')}`, municipality: over.municipality ?? 'Sevilla', province: 'Sevilla', sourceId: 'osm', externalId: `d${n}`, sourceUrl: 'https://osm.example/', fetchedAt: T0, extractorVersion: 't', evidences: [] });
  return { id: r.prospectId as string, name };
}
const row = async (id: string) => (await t.app.query('select website, domain, discover_attempts, discover_next_at, discover_error from prospects where id = $1', [id])).rows[0] as { website: string | null; domain: string | null; discover_attempts: number; discover_next_at: Date | null; discover_error: string | null };

describe('claimDiscoverable', () => {
  it('reclama candidatas SIN web con su nombre, municipio y teléfonos; cuenta el intento y espera 7 días para el siguiente (máx. 2 intentos)', async () => {
    const c = await cand();
    const got = (await claimDiscoverable(t.app, { limit: 100, now: T0 })).find((x) => x.id === c.id)!;
    expect(got).toMatchObject({ id: c.id, name: c.name, municipality: 'Sevilla' });
    expect(got.phones[0]).toMatch(/^\+34955/);
    expect(await row(c.id)).toMatchObject({ discover_attempts: 1, discover_next_at: plusD(7) });
    expect((await claimDiscoverable(t.app, { limit: 100, now: plusD(3) })).map((x) => x.id)).not.toContain(c.id);
    expect((await claimDiscoverable(t.app, { limit: 100, now: plusD(7) })).map((x) => x.id)).toContain(c.id);
    expect(await row(c.id)).toMatchObject({ discover_attempts: 2 });
    expect((await claimDiscoverable(t.app, { limit: 100, now: plusD(400) })).map((x) => x.id)).not.toContain(c.id); // agotados
  });

  it('no reclama las que ya tienen web ni las que no son candidatas; respeta el límite', async () => {
    const withWeb = await cand({ website: `https://ya-tiene-${n + 1}.es/` });
    const blocked = await cand();
    await t.admin.query(`update prospects set status = 'blocked' where id = $1`, [blocked.id]);
    for (let i = 0; i < 4; i++) await cand();
    const got = await claimDiscoverable(t.app, { limit: 3, now: plusD(1000) });
    expect(got.length).toBeLessThanOrEqual(3);
    expect(got.map((x) => x.id)).not.toContain(withWeb.id);
    expect(got.map((x) => x.id)).not.toContain(blocked.id);
  });

  it('dos reclamos simultáneos no se llevan la misma ficha', async () => {
    for (let i = 0; i < 6; i++) await cand();
    const [a, b] = await Promise.all([claimDiscoverable(t.app, { limit: 3, now: plusD(2000) }), claimDiscoverable(t.app, { limit: 3, now: plusD(2000) })]);
    expect(a.map((x) => x.id).filter((id) => b.map((y) => y.id).includes(id))).toEqual([]);
  });

  it('unclaim devuelve el intento (fallo del sistema) y recordDiscoverFailure guarda el motivo recortado', async () => {
    const c = await cand();
    await claimDiscoverable(t.app, { limit: 500, now: plusD(3000) });
    await unclaimDiscoverable(t.app, [c.id]);
    expect(await row(c.id)).toMatchObject({ discover_attempts: 0, discover_next_at: null });
    await unclaimDiscoverable(t.app, []);
    await recordDiscoverFailure(t.app, c.id, 'x'.repeat(900));
    expect((await row(c.id)).discover_error).toHaveLength(300);
  });
});

describe('attachWebsite (la web hallada se guarda con su prueba)', () => {
  const evidence = { pageUrl: 'https://clinica-hallada.es/', quote: 'Teléfono: 955 123 456', matchedBy: 'phone' as const, fetchedAt: T0 };

  it('guarda web y dominio y deja una evidencia INFERIDA con la cita literal, la página y cómo se verificó', async () => {
    const c = await cand();
    expect(await attachWebsite(t.app, c.id, { url: 'https://www.clinica-hallada.es/', ...evidence })).toEqual({ ok: true });
    expect(await row(c.id)).toMatchObject({ website: 'https://www.clinica-hallada.es/', domain: 'clinica-hallada.es' });
    const ev = (await t.app.query(`select field, value, provenance, explanation, source_url, quote, extractor_version from evidences where prospect_id = $1 and field = 'website'`, [c.id])).rows[0];
    expect(ev).toMatchObject({ value: 'https://www.clinica-hallada.es/', provenance: 'inferred', source_url: 'https://clinica-hallada.es/', quote: 'Teléfono: 955 123 456', extractor_version: 'discover-v1' });
    expect(ev.explanation).toMatch(/teléfono/i);
  });

  it('una web cuyo dominio ya es de otra ficha se rechaza (posible duplicado) y no cambia nada', async () => {
    const a = await cand({ website: 'https://ocupado-por-otra.es/' });
    const b = await cand();
    expect(a.id).not.toBe(b.id);
    expect(await attachWebsite(t.app, b.id, { url: 'https://ocupado-por-otra.es/', ...evidence })).toEqual({ ok: false, reason: 'domain_taken' });
    expect((await row(b.id)).website).toBeNull();
  });

  it('no sobrescribe una web existente, ni acepta dominios compartidos (redes sociales), ni fichas inexistentes o no candidatas', async () => {
    const has = await cand({ website: 'https://la-suya.es/' });
    expect(await attachWebsite(t.app, has.id, { url: 'https://otra-distinta.es/', ...evidence })).toEqual({ ok: false, reason: 'has_website' });
    const c = await cand();
    expect(await attachWebsite(t.app, c.id, { url: 'https://www.facebook.com/clinica', ...evidence })).toEqual({ ok: false, reason: 'invalid_url' });
    expect(await attachWebsite(t.app, c.id, { url: 'no es url', ...evidence })).toEqual({ ok: false, reason: 'invalid_url' });
    expect(await attachWebsite(t.app, '00000000-0000-7000-8000-000000000000', { url: 'https://x-y.es/', ...evidence })).toEqual({ ok: false, reason: 'not_found' });
    await t.admin.query(`update prospects set status = 'blocked' where id = $1`, [c.id]);
    expect(await attachWebsite(t.app, c.id, { url: 'https://bloqueada-x.es/', ...evidence })).toEqual({ ok: false, reason: 'not_candidate' });
    expect((await row(c.id)).website).toBeNull();
  });
});

describe('gasto de la ruta de búsqueda', () => {
  it('suma solo lo gastado hoy (hora de Madrid) en esa ruta', async () => {
    await t.admin.query(`insert into usage_costs (provider, route, units, cost_eur, created_at) values ('llm','discovery','{}',0.30,'2026-11-10T09:00:00Z'), ('llm','discovery','{}',0.20,'2026-11-10T11:00:00Z'), ('llm','discovery','{}',9,'2026-11-09T09:00:00Z'), ('llm','enrich.extract','{}',7,'2026-11-10T09:00:00Z')`);
    expect(await spentTodayOnRoute(t.app, 'discovery', T0)).toBeCloseTo(0.5, 6);
    expect(await spentTodayOnRoute(t.app, 'market.size', T0)).toBe(0);
  });

  it('el presupuesto diario de búsqueda sale de los ajustes (D-03: 2 €)', async () => {
    expect(await webSearchBudgetEur(t.app)).toBe(2);
  });
});

describe('ruta discovery tras la migración 0011', () => {
  it('solo exige búsqueda web (no salida estructurada) y tiene una respuesta corta', async () => {
    const v = (await t.app.query(`select value->'discovery' as d from settings where key = 'llm_routes'`)).rows[0] as { d: { requires: string[]; maxTokens: number } };
    expect(v.d.requires).toEqual(['web_search']);
    expect(v.d.maxTokens).toBe(1000);
  });
});
