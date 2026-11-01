import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseDemoRequest } from '@turnosala/core';
import type { TurnstileVerifier } from '@turnosala/connectors/turnstile';
import { checkFormRate, currentConsentTexts, resolvePublicToken, submitDemoRequest, type ResolvedToken } from '@turnosala/db/web';
import type pg from 'pg';
import { json } from './http.js';

// Rutas PÚBLICAS (sin sesión): el formulario de demo de las landings. Defensas: origen exacto, límite por IP (HMAC), campo trampa, tiempo mínimo firmado, captcha,
// y respuestas idénticas con o sin ficha previa o exclusión (no revelan si alguien está en la base). Nada de lo recibido se trata como instrucción.

export interface PublicDeps {
  pool: pg.Pool;
  siteOrigin: string;
  mode: 'sandbox' | 'production';
  turnstile: TurnstileVerifier;
  /** secreto del servidor: firma la marca de tiempo del formulario y hace el HMAC de las IP */
  secret: string;
  now?: () => Date;
  /** IP del visitante (detrás del proxy inverso, que debe SOBRESCRIBIR x-forwarded-for) */
  clientIp?: (req: Request) => string | null;
  minFillMs?: number;
  ratePerHour?: number;
}

const MIN_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 2 * 3600_000;
const HOUR = 3600_000;

const hmac = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('hex');

/** Marca de tiempo firmada que el servidor incrusta al mostrar el formulario: el cliente no puede falsificar cuánto tardó. */
export function issueFormStamp(secret: string, at: Date): string {
  const ms = String(at.getTime());
  return `${ms}.${hmac(secret, `stamp:${ms}`)}`;
}

function checkStamp(secret: string, stamp: unknown, now: Date, minMs: number): 'ok' | 'too_fast' | 'invalid' {
  if (typeof stamp !== 'string') return 'invalid';
  const m = /^(\d{10,15})\.([0-9a-f]{64})$/.exec(stamp);
  if (!m) return 'invalid';
  const expected = Buffer.from(hmac(secret, `stamp:${m[1]}`), 'hex');
  const given = Buffer.from(m[2]!, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  const age = now.getTime() - Number(m[1]);
  if (age > MAX_FORM_AGE_MS || age < 0) return 'invalid';
  return age < minMs ? 'too_fast' : 'ok';
}

const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4 = new RegExp('^' + OCTET + '(\\.' + OCTET + '){3}$');

/**
 * ¿Es una dirección IPv4 o IPv6 bien formada? Sin sockets: `node:net` está vetado fuera de connectors y contact por T-ARQ, y esto solo valida texto.
 * IPv6 se valida con el analizador de URL.
 */
export function isIpAddress(v: string): boolean {
  if (IPV4.test(v)) return true;
  if (!/^[0-9a-fA-F:.]{2,45}$/.test(v)) return false; // el tope (ninguna IPv6 válida pasa de 45) evita analizar basura larga
  try {
    new URL(`http://[${v}]/`);
    return true;
  } catch {
    return false;
  }
}

export function defaultClientIp(req: Request): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && isIpAddress(first) ? first : null;
}

type Landing = { sourceUrl: string; sector: string | null; token: ResolvedToken | null };

/** La landing sale de un sector (segmento APROBADO) o de un token personalizado vigente; si no, 404 sin más detalle. */
async function resolveLanding(deps: PublicDeps, raw: unknown, now: Date): Promise<Landing | null> {
  if (!raw || typeof raw !== 'object') return null;
  const { sector, token } = raw as { sector?: unknown; token?: unknown };
  if (typeof token === 'string') {
    const resolved = await resolvePublicToken(deps.pool, 'landing', token, now);
    // el token nunca se guarda en claro (solo su hash): la URL de origen lleva un marcador, no el token
    return resolved ? { sourceUrl: `${deps.siteOrigin}/c/[enlace-personalizado]`, sector: null, token: resolved } : null;
  }
  if (typeof sector === 'string' && /^[a-z0-9-]{1,60}$/.test(sector)) {
    const ok = (await deps.pool.query(`select 1 from segments where slug = $1 and status = 'approved' limit 1`, [sector])).rowCount;
    return ok ? { sourceUrl: `${deps.siteOrigin}/demo/${sector}`, sector, token: null } : null;
  }
  return null;
}

function utmOf(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

async function readBody(req: Request, siteOrigin: string): Promise<Record<string, unknown> | Response> {
  if (req.headers.get('origin') !== siteOrigin) return json(403, { error: 'origen no permitido' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'se esperaba JSON' });
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : json(400, { error: 'solicitud no válida' });
}

export async function handleDemoRequest(req: Request, deps: PublicDeps): Promise<Response> {
  const body = await readBody(req, deps.siteOrigin);
  if (body instanceof Response) return body;
  const now = (deps.now ?? (() => new Date()))();
  const ip = (deps.clientIp ?? defaultClientIp)(req);
  const rate = await checkFormRate(deps.pool, { ipHmac: hmac(deps.secret, `ip:${ip ?? 'desconocida'}`), kind: 'demo_request', limit: deps.ratePerHour ?? 5, windowMs: HOUR, now });
  if (!rate.allowed) return json(429, { error: 'demasiadas_solicitudes' });
  const landing = await resolveLanding(deps, body.landing, now);
  if (!landing) return json(404, { error: 'no_encontrado' });
  const parsed = parseDemoRequest(body, { hasToken: landing.token !== null });
  if (!parsed.ok && parsed.bot) return json(200, { ok: true }); // el campo trampa lo rellenó un robot: respuesta normal, nada se registra
  if (!parsed.ok) return json(422, { error: 'datos_no_validos', errors: parsed.errors });
  const stamp = checkStamp(deps.secret, body.stamp, now, deps.minFillMs ?? MIN_FILL_MS);
  if (stamp !== 'ok') return json(422, { error: stamp === 'too_fast' ? 'demasiado_rapido' : 'formulario_caducado' });
  // el captcha se comprueba DESPUÉS de validar los datos: un error de formulario no gasta el token (de un solo uso)
  if (!(await deps.turnstile.verify(body['cf-turnstile-response'], ip)).ok) return json(400, { error: 'captcha' });
  const texts = await currentConsentTexts(deps.pool, { requireApproved: deps.mode === 'production' });
  if (!texts.ok) return json(503, { error: 'formulario_no_disponible' }); // G2: sin textos aprobados por el asesor no se recoge nada en producción
  await submitDemoRequest(deps.pool, {
    form: parsed.data, texts: texts.texts, sourceUrl: landing.sourceUrl, ip, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    token: landing.token, sector: landing.sector, utm: utmOf(body.utm), now,
  });
  return json(200, { ok: true }); // idéntica con ficha nueva, existente o excluida
}
