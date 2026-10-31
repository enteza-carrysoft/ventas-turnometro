import { registrableDomain } from '@turnosala/core';
import robotsModule from 'robots-parser';
import { extractVisible } from './html.js';

export { extractVisible } from './html.js';

// Rastreador propio (REQ-ENR-01, P2.6): robots.txt, 1 petición/s por dominio, User-Agent identificable, máx. 6 páginas, solo el sitio de
// la empresa, sin eludir bloqueos ni captchas. No guarda nada: devuelve las páginas y lo que se omitió con su motivo.

export type Category = 'home' | 'contact' | 'services' | 'centers' | 'booking' | 'team' | 'other';
export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  text: string;
  links: string[];
  category: Category;
  fetchedAt: Date;
}
export interface Skipped {
  url: string;
  reason: 'robots' | 'blocked' | 'timeout' | 'network' | 'not_html' | 'too_large' | 'redirect_offsite' | 'http_error' | 'limit';
}
export interface CrawlResult {
  pages: CrawledPage[];
  skipped: Skipped[];
  robots: 'allowed' | 'none' | 'disallow_all';
}
export interface CrawlOptions {
  userAgent: string;
  maxPages?: number | undefined;
  requestIntervalMs?: number | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
// robots-parser es CommonJS: su declaración de tipos no encaja con NodeNext, así que se tipa aquí lo único que se usa.
const robotsParser = robotsModule as unknown as (url: string, txt: string) => Robots;

const MAX_REDIRECTS = 3;
const BLOCKED = new Set([401, 403, 429, 503]);
const SKIP_PATH = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp[34]|css|js)$/i;
const SKIP_WORDS = /(login|acceso|admin|cuenta|carrito|checkout|aviso-legal|privacidad|cookies|politica)/i;
const RULES: Array<[Exclude<Category, 'home' | 'other'>, RegExp]> = [
  ['contact', /contact/], ['services', /servicios?|tratamientos?|especialidades|prestaciones/], ['centers', /centros?|sedes?|sucursales|donde-estamos|clinicas|delegaciones/],
  ['booking', /cita|reserva|reservar/], ['team', /equipo|profesionales|quienes-somos|nosotros|about/],
];

const unaccent = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function sameSite(a: string, b: string): boolean {
  const ua = new URL(a);
  const ub = new URL(b);
  const da = registrableDomain(ua.hostname);
  const db = registrableDomain(ub.hostname);
  return da !== null && db !== null ? da === db : ua.hostname === ub.hostname && ua.port === ub.port;
}

function categorize(url: string, text: string): Category {
  const key = unaccent(`${new URL(url).pathname} ${text}`).replace(/\s+/g, '-');
  return RULES.find(([, re]) => re.test(key))?.[0] ?? 'other';
}

/** Enlaces útiles de la portada, por orden de interés (el equipo, el último: es lo que más datos personales puede traer). */
function pickLinks(home: CrawledPage, anchors: Array<{ url: string; text: string }>, start: string): Array<{ url: string; category: Category }> {
  const order = RULES.map(([c]) => c);
  const out: Array<{ url: string; category: Category }> = [];
  for (const a of anchors) {
    const u = new URL(a.url);
    if (a.url === home.finalUrl || u.pathname === '/' || SKIP_PATH.test(u.pathname) || SKIP_WORDS.test(u.pathname) || !sameSite(start, a.url)) continue;
    const category = categorize(a.url, a.text);
    if (category !== 'other' && !out.some((o) => o.url === a.url)) out.push({ url: a.url, category });
  }
  return out.sort((x, y) => order.indexOf(x.category as never) - order.indexOf(y.category as never));
}

type Anchor = { url: string; text: string };
type Fetched = { page: CrawledPage; anchors: Anchor[] } | { skip: Skipped['reason'] };
type RobotsState = Robots | 'none' | 'disallow_all';

const isTimeout = (e: unknown): boolean => ['TimeoutError', 'AbortError'].includes((e as { name?: string }).name ?? '');

function parseStart(startUrl: string): URL {
  for (const candidate of [startUrl, `https://${startUrl}`]) {
    try {
      const u = new URL(candidate);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u;
    } catch {
      /* se prueba la siguiente */
    }
  }
  throw new Error(`URL inicial no válida: ${startUrl}`);
}

class Crawler {
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private interval: number;
  private readonly last = new Map<string, number>();
  private readonly robotsByOrigin = new Map<string, RobotsState>();
  private readonly token: string;
  readonly result: CrawlResult = { pages: [], skipped: [], robots: 'none' };

  constructor(private readonly start: URL, private readonly opts: CrawlOptions) {
    this.doFetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.maxBytes = opts.maxBytes ?? 2_000_000;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.interval = opts.requestIntervalMs ?? 1000;
    this.token = opts.userAgent.split('/')[0] as string;
  }

  /** Una petición como máximo por intervalo y dominio, siempre con el User-Agent identificable. */
  private async throttled(url: string, init: RequestInit): Promise<Response> {
    const host = new URL(url).host;
    const prev = this.last.get(host);
    const wait = prev === undefined ? 0 : Math.max(0, prev + this.interval - this.now());
    if (wait > 0) await this.sleep(wait);
    this.last.set(host, this.now());
    const headers = { 'user-agent': this.opts.userAgent, accept: 'text/html,application/xhtml+xml' };
    return this.doFetch(url, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  private async robotsFor(url: string): Promise<RobotsState> {
    const origin = new URL(url).origin;
    const cached = this.robotsByOrigin.get(origin);
    if (cached) return cached;
    let state: RobotsState;
    try {
      const res = await this.throttled(`${origin}/robots.txt`, { redirect: 'follow' });
      if (res.status === 200) {
        const parsed = robotsParser(`${origin}/robots.txt`, await res.text());
        const delay = parsed.getCrawlDelay(this.token);
        if (delay) this.interval = Math.max(this.interval, Math.min(delay * 1000, 10_000));
        state = parsed;
      } else state = res.status >= 500 ? 'disallow_all' : 'none';
    } catch {
      state = 'disallow_all'; // sin poder leer robots.txt no se rastrea (RFC 9309)
    }
    this.robotsByOrigin.set(origin, state);
    if (origin === this.start.origin) this.result.robots = typeof state === 'string' ? state : 'allowed';
    return state;
  }

  private async readBody(res: Response): Promise<string | 'too_large'> {
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > this.maxBytes) { await res.body?.cancel(); return 'too_large'; }
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) { await reader.cancel(); return 'too_large'; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Motivo de omisión de una respuesta que no es redirección, o `null` si hay que leerla. */
  private async rejectResponse(res: Response): Promise<Skipped['reason'] | null> {
    const reason = BLOCKED.has(res.status) ? 'blocked' : res.status >= 400 ? 'http_error' : /html/i.test(res.headers.get('content-type') ?? '') ? null : 'not_html';
    if (reason) await res.body?.cancel();
    return reason;
  }

  private async fetchPage(url: string, category: Category): Promise<Fetched> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const robots = await this.robotsFor(current);
      if (robots === 'disallow_all' || (robots !== 'none' && !robots.isAllowed(current, this.token))) return { skip: 'robots' };
      let res: Response;
      try {
        res = await this.throttled(current, { redirect: 'manual' });
      } catch (e) {
        return { skip: isTimeout(e) ? 'timeout' : 'network' };
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        const next = new URL(location, current).toString();
        if (!sameSite(this.start.toString(), next)) return { skip: 'redirect_offsite' };
        current = next;
        continue;
      }
      const reason = await this.rejectResponse(res);
      if (reason) return { skip: reason };
      return this.toPage(res, url, current, category);
    }
    return { skip: 'http_error' };
  }

  private async toPage(res: Response, url: string, finalUrl: string, category: Category): Promise<Fetched> {
    let body: string | 'too_large';
    try {
      body = await this.readBody(res);
    } catch (e) {
      return { skip: isTimeout(e) ? 'timeout' : 'network' };
    }
    if (body === 'too_large') return { skip: 'too_large' };
    const v = extractVisible(body, finalUrl);
    return { page: { url, finalUrl, status: res.status, title: v.title, text: v.text, links: v.links, category, fetchedAt: new Date(this.now()) }, anchors: v.anchors };
  }

  async run(): Promise<CrawlResult> {
    const maxPages = this.opts.maxPages ?? 6;
    const home = await this.fetchPage(this.start.toString(), 'home');
    if ('skip' in home) {
      this.result.skipped.push({ url: this.start.toString(), reason: home.skip });
      return this.result;
    }
    this.result.pages.push(home.page);
    for (const target of pickLinks(home.page, home.anchors, this.start.toString())) {
      if (this.result.pages.length >= maxPages) {
        this.result.skipped.push({ url: target.url, reason: 'limit' });
        continue;
      }
      const r = await this.fetchPage(target.url, target.category);
      if ('skip' in r) this.result.skipped.push({ url: target.url, reason: r.skip });
      else this.result.pages.push(r.page);
    }
    return this.result;
  }
}

export async function crawlSite(startUrl: string, opts: CrawlOptions): Promise<CrawlResult> {
  return new Crawler(parseStart(startUrl), opts).run();
}
