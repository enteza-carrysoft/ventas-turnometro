import { describe, expect, it, vi } from 'vitest';
import { createMemoryCache } from './cache.js';
import { createOsmAdapter, OSM_ATTRIBUTION, type OverpassResponse } from './osm.js';
import { withRetry, SourceError } from './retry.js';
import { isVetoedUrl } from './veto.js';

const UA = 'TurnoSalaProspectorBot/1.0 (+https://turnosala.com/bot)';
const TERRITORY = { name: 'Sevilla', province: 'Sevilla' };
const AT = new Date('2026-11-10T10:00:00Z');

// Fixture con la forma documentada de la respuesta de Overpass (out tags center). Sintética: no es una captura real.
const FIXTURE: OverpassResponse = {
  version: 0.6, generator: 'Overpass API',
  elements: [
    { type: 'node', id: 101, lat: 37.38, lon: -5.99, tags: { name: 'Clínica Dental Sol', healthcare: 'dentist', phone: '+34 954 12 34 56', website: 'https://www.clinicasol.es', 'addr:street': 'Calle Sierpes', 'addr:housenumber': '12', 'addr:postcode': '41004', 'addr:city': 'Sevilla', email: 'info@clinicasol.es' } },
    { type: 'way', id: 202, center: { lat: 37.39, lon: -5.98 }, tags: { name: 'Óptica Luna', shop: 'optician', 'contact:phone': '954 22 33 44', 'contact:website': 'http://opticaluna.es/', email: 'maria.gomez@opticaluna.es' } },
    { type: 'node', id: 303, lat: 37.4, lon: -5.97, tags: { healthcare: 'clinic' } }, // sin nombre
    { type: 'node', id: 404, lat: 37.4, lon: -5.97, tags: { name: 'Fisio Norte', healthcare: 'physiotherapist', website: 'https://www.linkedin.com/company/fisionorte', phone: '12345' } },
  ],
};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const FILTERS = [['healthcare', 'dentist'], ['shop', 'optician']] as Array<[string, string]>;

function adapter(fetchImpl: (u: string, i?: RequestInit) => Promise<Response>, extra: Partial<Parameters<typeof createOsmAdapter>[0]> = {}) {
  const sleeps: number[] = [];
  const a = createOsmAdapter({ userAgent: UA, filters: FILTERS, fetch: fetchImpl as unknown as typeof fetch, sleep: async (ms) => { sleeps.push(ms); }, now: () => AT, ...extra });
  return { a, sleeps };
}
const req = { sourceId: 'osm', ineCode: '41091', cursor: null, limit: 200, territory: TERRITORY };

describe('isVetoedUrl (P2.6, REQ-LLM-05 CA3)', () => {
  it.each(['https://www.linkedin.com/company/x', 'https://es.linkedin.com/in/y', 'http://LINKEDIN.com'])('%s está vetada', (u) => expect(isVetoedUrl(u)).toBe(true));
  it.each(['https://clinicasol.es', 'https://notlinkedin.com', 'https://linkedin.com.evil.es'])('%s no está vetada', (u) => expect(isVetoedUrl(u)).toBe(false));
  it('una URL inválida se considera vetada por precaución', () => expect(isVetoedUrl('no es url')).toBe(true));
});

describe('withRetry (REQ-RES-03)', () => {
  it('máx. 3 intentos con espera exponencial ante 5xx y red; devuelve el resultado en cuanto hay éxito', async () => {
    const sleeps: number[] = [];
    const op = vi.fn().mockRejectedValueOnce(new SourceError('http_5xx', 'HTTP 503')).mockRejectedValueOnce(new SourceError('network', 'caído')).mockResolvedValue('ok');
    expect(await withRetry(op, { sleep: async (ms) => { sleeps.push(ms); } })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([15_000, 30_000]); // 02/11/2026: con 2 s y 4 s un Overpass saturado (502 a ratos) tumbaba el trabajo
  });

  it('tras 3 fallos lanza el último error; 429/406 esperan 30 s', async () => {
    const sleeps: number[] = [];
    const op = vi.fn().mockRejectedValue(new SourceError('rate_limited', 'HTTP 429'));
    await expect(withRetry(op, { sleep: async (ms) => { sleeps.push(ms); } })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it('un error que no es reintentable (403, prohibido) no se reintenta', async () => {
    const op = vi.fn().mockRejectedValue(new SourceError('forbidden', 'HTTP 403'));
    await expect(withRetry(op, { sleep: async () => undefined })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('adaptador OSM / Overpass (REQ-RES-02)', () => {
  it('consulta el área por el código INE (etiqueta «ine:municipio», verificada contra Overpass el 31/10/2026; «ref:ine» como alternativa) con los filtros del segmento, con User-Agent identificable, por POST', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    await adapter(f).a.fetch(req);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/.*\/api\/interpreter$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['user-agent']).toBe(UA);
    const q = decodeURIComponent(String(init.body)).replace(/\+/g, ' ');
    expect(q).toContain('area["ine:municipio"="41091"]');
    expect(q).toContain('area["ref:ine"="41091"]');
    expect(q).toContain(')->.a;'); // unión de ambas etiquetas
    expect(q).toContain('["healthcare"="dentist"]');
    expect(q).toContain('["shop"="optician"]');
    expect(q).toMatch(/\[timeout:\d+\]/);
    expect(q).toContain('out tags center');
  });

  it('los filtros de la petición (los del segmento) mandan sobre los de la configuración', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    await adapter(f).a.fetch({ ...req, osmFilters: [['amenity', 'physiotherapist']] });
    const q = decodeURIComponent(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(q).toContain('["amenity"="physiotherapist"]');
    expect(q).not.toContain('dentist');
  });

  it('convierte elementos en candidatos con fuente, teléfono, web, dirección y atribución ODbL', async () => {
    const r = await adapter(async () => json(FIXTURE)).a.fetch(req);
    expect(r.costEur).toBe(0);
    const sol = r.candidates.find((c) => c.externalId === 'node/101')!;
    expect(sol).toMatchObject({
      name: 'Clínica Dental Sol', sourceId: 'osm', sourceUrl: 'https://www.openstreetmap.org/node/101', phone: '+34 954 12 34 56', website: 'https://www.clinicasol.es',
      email: 'info@clinicasol.es', municipality: 'Sevilla', province: 'Sevilla', fetchedAt: AT,
    });
    expect(sol.address).toBe('Calle Sierpes 12, 41004 Sevilla');
    expect(sol.evidences).toContainEqual(expect.objectContaining({ field: 'osm_attribution', value: OSM_ATTRIBUTION, sourceUrl: 'https://www.openstreetmap.org/copyright', provenance: 'observed' }));
    expect(r.candidates.find((c) => c.externalId === 'way/202')).toMatchObject({ phone: '954 22 33 44', website: 'http://opticaluna.es/' });
  });

  it('descarta elementos sin nombre, el email personal y las web vetadas (linkedin); el teléfono basura lo filtrará la ingesta', async () => {
    const r = await adapter(async () => json(FIXTURE)).a.fetch(req);
    expect(r.candidates.map((c) => c.externalId)).toEqual(['node/101', 'way/202', 'node/404']);
    expect(r.candidates.find((c) => c.externalId === 'way/202')?.email).toBeUndefined();
    const fisio = r.candidates.find((c) => c.externalId === 'node/404')!;
    expect(fisio.website).toBeUndefined();
  });

  it('respeta el límite pedido y no guarda coordenadas', async () => {
    const r = await adapter(async () => json(FIXTURE)).a.fetch({ ...req, limit: 2 });
    expect(r.candidates).toHaveLength(2);
    expect(JSON.stringify(r.candidates)).not.toMatch(/37\.38|-5\.99/);
  });

  it('una respuesta repetida sale de la caché y no vuelve a consultar', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    const { a } = adapter(f, { cache: createMemoryCache(() => AT.getTime()) });
    await a.fetch(req);
    await a.fetch(req);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('429 espera 30 s y reintenta; 5xx espera exponencial; el error final conserva el motivo', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}, 503)).mockResolvedValue(json(FIXTURE));
    const { a, sleeps } = adapter(f);
    expect((await a.fetch(req)).candidates.length).toBe(3);
    expect(sleeps).toEqual([30_000, 30_000]);
    const always = adapter(async () => json({}, 429));
    await expect(always.a.fetch(req)).rejects.toThrow(/429/);
  });

  it('un 406 o 403 / respuesta no JSON / remark de Overpass se tratan como error claro', async () => {
    await expect(adapter(async () => json({}, 403)).a.fetch(req)).rejects.toThrow(/403/);
    await expect(adapter(async () => new Response('<html>busy</html>', { status: 200 })).a.fetch(req)).rejects.toThrow(/JSON/);
    await expect(adapter(async () => json({ ...FIXTURE, remark: 'runtime error: Query timed out' })).a.fetch(req)).rejects.toThrow(/timed out/);
  });

  it('un solo hilo: dos peticiones simultáneas nunca se solapan', async () => {
    let active = 0;
    let max = 0;
    const f = async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 20)); active--; return json(FIXTURE); };
    const { a } = adapter(f);
    await Promise.all([a.fetch(req), a.fetch({ ...req, ineCode: '41038' }), a.fetch({ ...req, ineCode: '41004' })]);
    expect(max).toBe(1);
  });

  it('sin municipio (ineCode nulo) o sin filtros no consulta', async () => {
    const f = vi.fn(async () => json(FIXTURE));
    await expect(adapter(f).a.fetch({ ...req, ineCode: null })).rejects.toThrow(/municipio/);
    await expect(adapter(f, { filters: [] }).a.fetch(req)).rejects.toThrow(/filtros/);
    expect(f).not.toHaveBeenCalled();
  });
});
