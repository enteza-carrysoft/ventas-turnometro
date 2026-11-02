import { describe, expect, it, vi } from 'vitest';
import type { CrawlResult } from '../crawler/crawler.js';
import { createGooglePlacesAdapter, PLACES_FIELD_MASK, type GooglePlacesOptions } from './google-places.js';
import type { SourceRequest } from './types.js';

const AT = new Date('2026-11-02T10:00:00Z');
const REQ: SourceRequest = { sourceId: 'google_places', ineCode: '41038', cursor: null, limit: 50, territory: { name: 'Dos Hermanas', province: 'Sevilla' }, searchQuery: 'Peluquerías' };

type Place = { id: string; displayName?: { text: string }; websiteUri?: string };
const page = (places: Place[], next?: string) => ({ status: 200, body: { places, ...(next ? { nextPageToken: next } : {}) } });
const home = (url: string, text: string): CrawlResult => ({ robots: 'allowed', skipped: [], pages: [{ url, finalUrl: url, status: 200, title: '', text, links: [], category: 'home', fetchedAt: AT }] });

function setup(responses: Array<{ status: number; body: unknown }>, sites: Record<string, string> = {}, over: Partial<GooglePlacesOptions> = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  let i = 0;
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  const crawl = vi.fn(async (url: string) => (sites[url] !== undefined ? home(url, sites[url]!) : { robots: 'allowed' as const, skipped: [], pages: [] }));
  const adapter = createGooglePlacesAdapter({ apiKey: 'AIza-test', userAgent: 'TurnoSalaProspectorBot/1.0', fetch: fetchFn as unknown as typeof fetch, crawl, now: () => AT, sleep: async () => undefined, ...over });
  return { adapter, calls, crawl };
}

describe('adaptador Google Places (REQ-RES-02 CA1: de Google solo se guarda place_id)', () => {
  it('llama a Text Search (New) con la clave en cabecera, la máscara de campos mínima y la búsqueda «segmento en municipio, provincia»', async () => {
    const { adapter, calls } = setup([page([])]);
    await adapter.fetch(REQ);
    expect(calls[0]!.url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calls[0]!.headers).toMatchObject({ 'x-goog-api-key': 'AIza-test', 'x-goog-fieldmask': PLACES_FIELD_MASK });
    expect(PLACES_FIELD_MASK).toBe('places.id,places.displayName,places.websiteUri,nextPageToken'); // ni teléfono, ni dirección, ni reseñas
    expect(calls[0]!.body).toEqual({ textQuery: 'Peluquerías en Dos Hermanas, Sevilla', languageCode: 'es', regionCode: 'ES', pageSize: 20 });
  });

  it('el nombre solo se acepta si aparece en la web de la empresa: la ficha lleva el place_id, la web verificada y la cita como evidencia', async () => {
    const { adapter } = setup([page([{ id: 'ChIJ1', displayName: { text: 'Peluquería Arcoíris' }, websiteUri: 'https://arcoiris.es/' }])],
      { 'https://arcoiris.es/': 'Bienvenidos\nPeluquería Arcoíris en Dos Hermanas, calle Real 3' });
    const r = await adapter.fetch(REQ);
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ name: 'Peluquería Arcoíris', website: 'https://arcoiris.es/', sourceId: 'google_places', externalId: 'ChIJ1', municipality: 'Dos Hermanas', province: 'Sevilla' });
    expect(c.sourceUrl).toBe('https://www.google.com/maps/place/?q=place_id:ChIJ1');
    expect(c).not.toHaveProperty('phone');
    expect(c).not.toHaveProperty('address');
    expect(c.evidences).toContainEqual(expect.objectContaining({ field: 'name', provenance: 'observed', sourceUrl: 'https://arcoiris.es/', quote: 'Peluquería Arcoíris en Dos Hermanas, calle Real 3' }));
  });

  it('sin web, con web vetada, con nombre de persona o si la web no lo confirma, no devuelve nada (no se guarda contenido de Google)', async () => {
    const { adapter, crawl } = setup([page([
      { id: 'A', displayName: { text: 'Barbería Sin Web' } },
      { id: 'B', displayName: { text: 'Peluquería Facebook' }, websiteUri: 'https://www.facebook.com/pelu' },
      { id: 'C', displayName: { text: 'Estética Dra. María García' }, websiteUri: 'https://mariagarcia.es/' },
      { id: 'D', displayName: { text: 'Estilistas Nova' }, websiteUri: 'https://otra-cosa.es/' },
    ])], { 'https://mariagarcia.es/': 'Estética Dra. María García Dos Hermanas', 'https://otra-cosa.es/': 'Venta de muebles en Sevilla' });
    expect((await adapter.fetch(REQ)).candidates).toEqual([]);
    expect(crawl).toHaveBeenCalledTimes(1); // solo se visita la que podía valer (D); A sin web, B vetada, C con nombre de persona
  });

  it('recorre las páginas con nextPageToken (máx. 3) y para al llenar el lote', async () => {
    const mk = (n: number): Place => ({ id: `P${n}`, displayName: { text: `Salón Nova${n}` }, websiteUri: `https://nova${n}.es/` });
    const sites = Object.fromEntries([1, 2, 3, 4].map((n) => [`https://nova${n}.es/`, `Salón Nova${n} · Dos Hermanas`]));
    const three = setup([page([mk(1)], 't2'), page([mk(2)], 't3'), page([mk(3)], 't4'), page([mk(4)])], sites);
    const r = await three.adapter.fetch(REQ);
    expect(three.calls).toHaveLength(3);
    expect(three.calls[1]!.body).toMatchObject({ pageToken: 't2', textQuery: 'Peluquerías en Dos Hermanas, Sevilla' });
    expect(r.candidates.map((c) => c.externalId)).toEqual(['P1', 'P2', 'P3']);
    expect(r.costEur).toBeCloseTo(3 * 0.035, 6); // estimación prudente (Text Search Enterprise, sin contar la franja gratuita)

    const one = setup([page([mk(1), mk(2)], 't2')], sites);
    expect((await one.adapter.fetch({ ...REQ, limit: 1 })).candidates).toHaveLength(1);
    expect(one.calls).toHaveLength(1);
  });

  it('errores: 429 y 5xx se reintentan; 403 no, y el mensaje de Google llega sin la clave', async () => {
    const busy = setup([{ status: 503, body: {} }, page([])]);
    await expect(busy.adapter.fetch(REQ)).resolves.toMatchObject({ candidates: [] });
    expect(busy.calls).toHaveLength(2);

    const denied = setup([{ status: 403, body: { error: { message: 'Places API (New) has not been used in project 123' } } }]);
    const err = await denied.adapter.fetch(REQ).catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'forbidden' });
    expect(String((err as Error).message)).toContain('Places API (New) has not been used');
    expect(String((err as Error).message)).not.toContain('AIza-test');
    expect(denied.calls).toHaveLength(1);
  });

  it('sin municipio o sin búsqueda del segmento no llama a Google', async () => {
    const { adapter, calls } = setup([page([])]);
    await expect(adapter.fetch({ ...REQ, territory: undefined })).rejects.toThrow(/municipio/);
    await expect(adapter.fetch({ ...REQ, searchQuery: undefined })).rejects.toThrow(/segmento/);
    expect(calls).toHaveLength(0);
  });

  it('sin clave no se puede crear', () => {
    expect(() => createGooglePlacesAdapter({ apiKey: ' ', userAgent: 'x', crawl: vi.fn() })).toThrow(/GOOGLE_MAPS_API_KEY/);
  });
});
