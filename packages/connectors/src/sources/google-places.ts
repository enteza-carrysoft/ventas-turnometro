import { containsPersonName, matchBusiness, redactPersonalData, registrableDomain } from '@turnosala/core';
import type { CrawlOptions, CrawlResult } from '../crawler/crawler.js';
import { SourceError, withRetry } from './retry.js';
import type { SourceAdapter, SourceCandidate, SourceRequest, SourceResult } from './types.js';
import { isVetoedUrl } from './veto.js';

// Google Places API (New), Text Search (REQ-RES-02). Documentación y precios consultados el 02/11/2026 (spec/research/fuentes.md §6):
// - De Google solo se ALMACENA el `place_id` (exento de las restricciones de caché; CA1). El nombre y la web que devuelve son solo una pista:
//   se abre la web de la empresa con el rastreador educado y la candidata se acepta únicamente si su nombre aparece allí, con esa línea
//   literal como evidencia (la misma regla que la búsqueda de webs). Lo que no se confirma no se guarda.
// - Máscara mínima: id, nombre y web (nivel Enterprise por `websiteUri`). Sin teléfono, dirección, valoraciones ni reseñas.

export const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
export const PLACES_FIELD_MASK = 'places.id,places.displayName,places.websiteUri,nextPageToken';
const MAX_PAGES = 3; // Text Search devuelve como mucho 60 resultados (3 páginas de 20)
/** Coste estimado por petición: Text Search Enterprise, 35 $/1.000 (sin descontar las 1.000 gratuitas al mes): estimación prudente. */
export const PLACES_COST_PER_REQUEST_EUR = 0.035;
const EXTRACTOR_VERSION = 'google_places@1';

export interface GooglePlacesOptions {
  apiKey: string;
  userAgent: string;
  crawl: (url: string, opts: CrawlOptions) => Promise<CrawlResult>;
  fetch?: typeof fetch | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
}

interface Place { id?: unknown; displayName?: { text?: unknown }; websiteUri?: unknown }
interface SearchPage { places: Place[]; next: string | null }

async function search(o: GooglePlacesOptions, body: Record<string, unknown>): Promise<SearchPage> {
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(PLACES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey, 'x-goog-fieldmask': PLACES_FIELD_MASK },
      body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const timeout = ['TimeoutError', 'AbortError'].includes((e as { name?: string }).name ?? '');
    throw new SourceError(timeout ? 'timeout' : 'network', timeout ? 'Google Places: tiempo agotado' : 'Google Places: error de red');
  }
  const json = (await res.json().catch(() => ({}))) as { places?: unknown; nextPageToken?: unknown; error?: { message?: unknown } };
  if (res.status !== 200) {
    // El mensaje de error de Google no incluye la clave; aun así se quita por si acaso (P5.1).
    const msg = typeof json.error?.message === 'string' ? json.error.message.split(o.apiKey).join('***').slice(0, 300) : '';
    const text = `Google Places: HTTP ${res.status}${msg ? ` — ${msg}` : ''}`;
    if (res.status === 429) throw new SourceError('rate_limited', text);
    if (res.status >= 500) throw new SourceError('http_5xx', text);
    throw new SourceError('forbidden', text);
  }
  return { places: Array.isArray(json.places) ? (json.places as Place[]) : [], next: typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null };
}

/** Web aceptable como «la de la empresa»: http(s), no vetada, no red social ni directorio. Devuelve su origen. */
function websiteOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || isVetoedUrl(u.href) || !registrableDomain(u.hostname)) return null;
    return `${u.origin}/`;
  } catch {
    return null;
  }
}

async function confirm(o: GooglePlacesOptions, place: Place, req: SourceRequest & { territory: { name: string; province: string } }, at: Date): Promise<SourceCandidate | null> {
  const placeId = typeof place.id === 'string' ? place.id : null;
  const name = typeof place.displayName?.text === 'string' ? place.displayName.text.trim() : '';
  const site = websiteOf(place.websiteUri);
  if (!placeId || !name || !site || containsPersonName(name)) return null;
  const crawled = await o.crawl(site, { userAgent: o.userAgent, maxPages: 1 });
  const home = crawled.pages[0];
  if (!home) return null;
  const m = matchBusiness(redactPersonalData(home.text), { name, municipality: req.territory.name, phones: [] });
  if (!m.matched || !m.quote) return null;
  return {
    name, website: site, sourceId: 'google_places', externalId: placeId, sourceUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
    fetchedAt: at, extractorVersion: EXTRACTOR_VERSION, municipality: req.territory.name, province: req.territory.province,
    evidences: [{ field: 'name', value: name, provenance: 'observed', sourceUrl: home.finalUrl, quote: m.quote, fetchedAt: at,
      explanation: 'Sugerida por Google Maps; nombre y web confirmados en la propia web de la empresa' }],
  };
}

export function createGooglePlacesAdapter(o: GooglePlacesOptions): SourceAdapter {
  if (!o.apiKey?.trim()) throw new Error('Falta la clave de Google Maps (variable de entorno GOOGLE_MAPS_API_KEY)');
  const now = o.now ?? (() => new Date());
  return {
    async fetch(req: SourceRequest): Promise<SourceResult> {
      const territory = req.territory;
      if (!territory) throw new Error('Google Places necesita un municipio');
      if (!req.searchQuery?.trim()) throw new Error('Google Places necesita la búsqueda del segmento');
      const base = { textQuery: `${req.searchQuery.trim()} en ${territory.name}, ${territory.province}`, languageCode: 'es', regionCode: 'ES', pageSize: 20 };
      const candidates: SourceCandidate[] = [];
      const seen = new Set<string>();
      let costEur = 0;
      let token: string | null = null;
      for (let p = 0; p < MAX_PAGES && candidates.length < req.limit; p++) {
        const body: Record<string, unknown> = token ? { ...base, pageToken: token } : base;
        const res: SearchPage = await withRetry(() => search(o, body), { sleep: o.sleep });
        costEur += PLACES_COST_PER_REQUEST_EUR;
        for (const place of res.places) {
          if (candidates.length >= req.limit) break;
          if (typeof place.id === 'string' && seen.has(place.id)) continue;
          if (typeof place.id === 'string') seen.add(place.id);
          const c = await confirm(o, place, { ...req, territory }, now());
          if (c) candidates.push(c);
        }
        token = res.next;
        if (!token) break;
      }
      return { candidates, costEur };
    },
  };
}
