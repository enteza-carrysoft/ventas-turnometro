import { classifyEmail } from '@turnosala/core';
import { createMemoryCache, type QueryCache } from './cache.js';
import { SourceError, withRetry } from './retry.js';
import type { SourceAdapter, SourceCandidate, SourceRequest, SourceResult } from './types.js';
import { isVetoedUrl } from './veto.js';

// OpenStreetMap vía Overpass (REQ-RES-02). Condiciones (spec/research/fuentes.md §3): User-Agent identificable, un solo hilo, caché y
// atribución ODbL. El servidor público es solo para el piloto; para escalar hace falta uno propio o de pago (endpoint configurable).

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0';
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 24 * 3600 * 1000;
const EXTRACTOR_VERSION = 'osm-v1';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export interface OverpassResponse {
  version?: number;
  generator?: string;
  remark?: string;
  elements: OverpassElement[];
}

export interface OsmOptions {
  userAgent: string;
  /** pares clave=valor de OSM que definen el segmento, p. ej. ['healthcare','dentist'] */
  filters: Array<[string, string]>;
  endpoint?: string | undefined;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
  cache?: QueryCache | undefined;
  timeoutMs?: number | undefined;
}

const SAFE = /^[A-Za-z0-9:_\-./ ]+$/;
const q = (s: string): string => {
  if (!SAFE.test(s)) throw new Error(`Valor no permitido en el filtro de OSM: ${s}`);
  return `"${s}"`;
};

function buildQuery(ineCode: string, filters: Array<[string, string]>): string {
  const lines = filters.map(([k, v]) => `  nwr[${q(k)}=${q(v)}](area.a);`).join('\n');
  return `[out:json][timeout:60];\narea["ref:ine"=${q(ineCode)}]->.a;\n(\n${lines}\n);\nout tags center;`;
}

function addressOf(t: Record<string, string>): string | undefined {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  if (!street) return undefined;
  const place = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
  return place ? `${street}, ${place}` : street;
}

function toCandidate(el: OverpassElement, req: SourceRequest, at: Date): SourceCandidate | null {
  const t = el.tags ?? {};
  const name = t['name']?.trim();
  if (!name) return null;
  const site = t['website'] ?? t['contact:website'];
  const email = t['email'] ?? t['contact:email'];
  const phone = t['phone'] ?? t['contact:phone'];
  const address = addressOf(t);
  const sourceUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
  return {
    name, sourceId: 'osm', externalId: `${el.type}/${el.id}`, sourceUrl, fetchedAt: at, extractorVersion: EXTRACTOR_VERSION,
    ...(site && !isVetoedUrl(site) ? { website: site } : {}),
    ...(phone ? { phone } : {}),
    ...(email && classifyEmail(email) === 'generic_email' ? { email } : {}),
    ...(address ? { address } : {}),
    ...(req.territory ? { municipality: req.territory.name, province: req.territory.province } : {}),
    evidences: [{ field: 'osm_attribution', value: OSM_ATTRIBUTION, provenance: 'observed', sourceUrl: OSM_COPYRIGHT, fetchedAt: at }],
  };
}

async function call(o: OsmOptions, query: string): Promise<OverpassResponse> {
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(o.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST', headers: { 'user-agent': o.userAgent, 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
    });
  } catch (e) {
    const timeout = ['TimeoutError', 'AbortError'].includes((e as { name?: string }).name ?? '');
    throw new SourceError(timeout ? 'timeout' : 'network', timeout ? 'Overpass: tiempo agotado' : `Overpass: error de red (${(e as Error).message})`);
  }
  if (res.status === 429 || res.status === 406) throw new SourceError('rate_limited', `Overpass: HTTP ${res.status}`);
  if (res.status >= 500) throw new SourceError('http_5xx', `Overpass: HTTP ${res.status}`);
  if (res.status >= 400) throw new SourceError('forbidden', `Overpass: HTTP ${res.status}`);
  let body: OverpassResponse;
  try {
    body = JSON.parse(await res.text()) as OverpassResponse;
  } catch {
    throw new SourceError('bad_response', 'Overpass: la respuesta no es JSON');
  }
  if (body.remark && /timed out|out of memory|runtime error/i.test(body.remark)) throw new SourceError('timeout', `Overpass: ${body.remark}`);
  return body;
}

export function createOsmAdapter(o: OsmOptions): SourceAdapter {
  const cache = o.cache ?? createMemoryCache();
  const now = o.now ?? (() => new Date());
  let tail: Promise<unknown> = Promise.resolve(); // un solo hilo: las consultas se encadenan

  async function query(text: string): Promise<OverpassResponse> {
    const cached = (await cache.get(text)) as OverpassResponse | undefined;
    if (cached) return cached;
    const fresh = await withRetry(() => call(o, text), { sleep: o.sleep });
    await cache.set(text, fresh, CACHE_TTL_MS);
    return fresh;
  }

  return {
    async fetch(req: SourceRequest): Promise<SourceResult> {
      if (!req.ineCode) throw new Error('OSM necesita un municipio (código INE)');
      if (o.filters.length === 0) throw new Error('OSM necesita filtros de etiquetas (segmento sin definir)');
      const text = buildQuery(req.ineCode, o.filters);
      const run = tail.then(() => query(text));
      tail = run.catch(() => undefined);
      const body = await run;
      const at = now();
      const candidates = body.elements.map((el) => toCandidate(el, req, at)).filter((c): c is SourceCandidate => c !== null).slice(0, req.limit);
      return { candidates, costEur: 0 };
    },
  };
}
