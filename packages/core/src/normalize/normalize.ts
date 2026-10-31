import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { getDomain } from 'tldts';

// Normalización pura (REQ-VER-01): teléfono E.164, dominio registrable, nombre, dirección, código postal y municipio INE.

const unaccent = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string): string[] => s.split(/[^a-z0-9]+/).filter(Boolean);

// ───────────── Teléfono ─────────────
export interface PhoneResult {
  e164: string | null;
  valid: boolean;
  kind: 'fixed' | 'mobile' | 'other' | null;
  /** inválido o ni fijo ni móvil (902, 900…): no se usa como centralita ni se llama (REQ-VER-01 CA1) */
  notCallable: boolean;
}

export function normalizePhone(raw: string, defaultRegion: 'ES' = 'ES'): PhoneResult {
  const invalid: PhoneResult = { e164: null, valid: false, kind: null, notCallable: true };
  if (!raw?.trim()) return invalid;
  const p = parsePhoneNumberFromString(raw.trim(), defaultRegion);
  if (!p || !p.isValid()) return invalid;
  const type = p.getType();
  const kind = type === 'FIXED_LINE' ? 'fixed' : type === 'MOBILE' ? 'mobile' : 'other';
  return { e164: p.number, valid: true, kind, notCallable: kind === 'other' };
}

// ───────────── Dominio ─────────────
/** Redes sociales, directorios y acortadores: un dominio compartido por miles de empresas no identifica a ninguna. */
export const SHARED_DOMAINS: ReadonlySet<string> = new Set([
  'facebook.com', 'fb.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
  'google.com', 'goo.gl', 'g.page', 'wa.me', 'whatsapp.com', 'linktr.ee', 'doctoralia.es', 'doctoralia.com', 'paginasamarillas.es',
  'tripadvisor.es', 'tripadvisor.com', 'yelp.com',
]);

/** Dominio registrable en minúsculas y sin `www`; null si no es un dominio de empresa. Las plataformas (wixsite.com…) conservan el subdominio. */
export function registrableDomain(raw: string): string | null {
  const text = raw?.trim();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`).hostname;
  } catch {
    return null;
  }
  const domain = getDomain(host, { allowPrivateDomains: true })?.toLowerCase() ?? null;
  return domain && !SHARED_DOMAINS.has(domain) ? domain : null;
}

// ───────────── Nombre ─────────────
const LEGAL_SUFFIXES = new Set(['sl', 'slu', 'sa', 'sau', 'slp', 'sll', 'srl', 'sc', 'scp', 'cb', 'scoop']);

function tokens(name: string): string[] {
  return words(unaccent(name).toLowerCase().replace(/\./g, ''));
}

/** Nombre sin tildes, signos ni forma jurídica final. Una «SA» en medio del nombre no se toca. */
export function normalizeName(name: string): string {
  const t = tokens(name);
  const original = [...t];
  while (t.length > 1 && LEGAL_SUFFIXES.has(t[t.length - 1] as string)) t.pop();
  return (t.length ? t : original).join(' ');
}

// ───────────── Dirección y municipio ─────────────
const STREET_TYPES: Record<string, string> = {
  c: 'calle', cl: 'calle', avda: 'avenida', av: 'avenida', avd: 'avenida', pza: 'plaza', plz: 'plaza', pl: 'plaza',
  ctra: 'carretera', crta: 'carretera', pso: 'paseo', urb: 'urbanizacion', pol: 'poligono',
};

export function normalizeAddress(raw: string): string {
  const cleaned = unaccent(raw).toLowerCase().replace(/\bn[º°.]\s*/g, ' ').replace(/[ºª°]/g, '').replace(/\./g, '');
  const t = words(cleaned).filter((w) => w !== 'num' && w !== 'numero');
  if (t[0] && STREET_TYPES[t[0]]) t[0] = STREET_TYPES[t[0]] as string; // solo el primer término: «2º C» no es «calle»
  return t.join(' ');
}

/** Código postal español válido (provincias 01–52). */
export function postalCodeOf(address: string): string | null {
  return /\b(?:0[1-9]|[1-4]\d|5[0-2])\d{3}\b/.exec(address)?.[0] ?? null;
}

export interface Territory {
  ineCode: string;
  name: string;
  province: string;
}

/** Código INE del municipio por nombre; null si no existe o es ambiguo sin provincia (no se inventa). */
export function matchMunicipality(name: string, territories: readonly Territory[], province?: string): string | null {
  const key = (s: string): string => words(unaccent(s).toLowerCase()).join(' ');
  const wanted = key(name);
  const found = territories.filter((t) => key(t.name) === wanted && (province === undefined || key(t.province) === key(province)));
  return found.length === 1 ? (found[0] as Territory).ineCode : null;
}

// ───────────── Forma jurídica ─────────────
const PUBLIC_WORDS = new Set(['ayuntamiento', 'diputacion', 'consorcio', 'mancomunidad', 'consejeria', 'ministerio']);
const COMPANY_SUFFIXES = new Set(['sl', 'slu', 'sa', 'sau', 'slp', 'sll', 'srl', 'scoop']);
const SOLE_TRADER_SUFFIXES = new Set(['cb', 'sc', 'scp']);

export interface LegalFormResult {
  legalForm: 'company' | 'sole_trader' | 'public_body' | 'unknown';
  /** por qué se infiere; se guarda como evidencia `inferred` (REQ-VER-03) */
  explanation: string;
}

/** Forma jurídica inferida del nombre. `unknown` se trata como `sole_trader` a efectos de cumplimiento (CG-08). */
export function detectLegalForm(name: string): LegalFormResult {
  const t = tokens(name);
  const last = t[t.length - 1] ?? '';
  const hit = t.find((w) => PUBLIC_WORDS.has(w));
  if (hit) return { legalForm: 'public_body', explanation: `el nombre contiene «${hit}», propio de un organismo público` };
  if (COMPANY_SUFFIXES.has(last)) return { legalForm: 'company', explanation: `el nombre termina en «${last.toUpperCase()}», forma societaria` };
  if (SOLE_TRADER_SUFFIXES.has(last)) return { legalForm: 'sole_trader', explanation: `el nombre termina en «${last.toUpperCase()}» (sin personalidad jurídica propia): se trata como autónomo` };
  if (t.join(' ').includes('comunidad de bienes')) return { legalForm: 'sole_trader', explanation: 'comunidad de bienes: se trata como autónomo' };
  return { legalForm: 'unknown', explanation: 'sin forma jurídica reconocible en el nombre' };
}

// ───────────── Similitud (definición de pg_trgm) ─────────────
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(s.toLowerCase())) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** |A∩B| / |A∪B| sobre trigramas con relleno de 2 espacios delante y 1 detrás, igual que `similarity()` de pg_trgm. */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const g of A) if (B.has(g)) common++;
  return common / (A.size + B.size - common);
}
