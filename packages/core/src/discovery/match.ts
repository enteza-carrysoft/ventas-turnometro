import { normalizeName } from '../normalize/normalize.js';

// ¿Es esta página la web del negocio? Lo decide el código sobre el texto real de la página (nunca el modelo, que solo sugiere candidatas).
// Coincide si aparece uno de sus teléfonos, o si aparecen TODAS las palabras de su nombre y su localidad. La prueba es una línea literal de
// la página (≤ 300 caracteres), que queda como evidencia.

export interface BusinessIdentity {
  name: string;
  municipality: string | null | undefined;
  /** teléfonos en E.164 o en cualquier formato; se comparan los 9 últimos dígitos */
  phones: readonly string[];
}
export interface MatchResult {
  matched: boolean;
  by: 'phone' | 'name_and_place' | null;
  quote: string | null;
}

const NO_MATCH: MatchResult = { matched: false, by: null, quote: null };
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'con', 'por', 'para']);
/** Palabras demasiado comunes en el sector para identificar a un negocio por sí solas. */
const GENERIC = new Set([
  'clinica', 'clinicas', 'centro', 'centros', 'dental', 'dentista', 'dentistas', 'optica', 'opticas', 'optico', 'fisioterapia', 'fisio', 'medico', 'medica', 'salud',
  'taller', 'talleres', 'consulta', 'consultas', 'gabinete', 'policlinica', 'estetica', 'podologia', 'veterinaria', 'veterinario', 'audiologia', 'sanitario',
]);

const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cut = (line: string): string => line.trim().slice(0, 300);

function phoneRegex(phone: string): RegExp | null {
  const nine = phone.replace(/\D/g, '').slice(-9);
  if (nine.length !== 9) return null;
  const body = nine.split('').join('[ .\\-]?');
  return new RegExp(`(?<!\\d)(?:(?:\\+|00)?34[ .\\-]?)?${body}(?!\\d)`);
}

function matchPhone(lines: string[], phones: readonly string[]): MatchResult | null {
  for (const phone of phones) {
    const re = phoneRegex(phone);
    const line = re ? lines.find((l) => re.test(l)) : undefined;
    if (line) return { matched: true, by: 'phone', quote: cut(line) };
  }
  return null;
}

const hasWord = (haystack: string, word: string): boolean => ` ${haystack} `.includes(` ${word} `);

function matchNameAndPlace(lines: string[], name: string, municipality: string | null | undefined): MatchResult | null {
  const place = municipality ? plain(municipality) : '';
  const tokens = normalizeName(name).split(' ').map(plain).filter((t) => t.length >= 3 && !STOP.has(t));
  const distinctive = tokens.filter((t) => !GENERIC.has(t));
  const first = distinctive[0];
  if (!place || !first || (tokens.length < 2 && first.length < 5)) return null;
  const page = lines.map(plain).join(' ');
  if (!tokens.every((t) => hasWord(page, t)) || !hasWord(page, place)) return null;
  const line = lines.find((l) => tokens.every((t) => hasWord(plain(l), t))) ?? lines.find((l) => hasWord(plain(l), first)) ?? '';
  return line ? { matched: true, by: 'name_and_place', quote: cut(line) } : null;
}

export function matchBusiness(pageText: string, id: BusinessIdentity): MatchResult {
  const lines = pageText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return NO_MATCH;
  return matchPhone(lines, id.phones) ?? matchNameAndPlace(lines, id.name, id.municipality) ?? NO_MATCH;
}
