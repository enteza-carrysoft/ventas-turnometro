import { randomBytes } from 'node:crypto';

// Archivo de entorno local (deploy/.env.local, fuera de git). Lo crea y completa el script de despliegue local SIN pisar lo que la persona ya
// puso (sobre todo la clave de API) y sin imprimir nunca un valor.

export interface KeySpec {
  key: string;
  /** secreto que se genera si falta o está vacío */
  generate?: (() => string) | undefined;
  /** valor fijo si la clave no existe (puede ser vacío: p. ej. la clave de API, que pone la persona) */
  value?: string | undefined;
  comment?: string | undefined;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const randomSecret = (): string => randomBytes(24).toString('hex');

function stripQuotes(v: string): string {
  const t = v.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t;
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (KEY.test(key)) out.set(key, stripQuotes(line.slice(i + 1)));
  }
  return out;
}

export const getKey = (text: string, key: string): string | undefined => parseEnv(text).get(key);

export function setKey(text: string, key: string, value: string): string {
  if (!KEY.test(key)) throw new Error(`Clave de entorno no válida: ${key}`);
  if (/[\r\n]/.test(value)) throw new Error('El valor no puede tener saltos de línea');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`) || l.trim().startsWith(`${key} =`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
    return lines.join('\n');
  }
  const base = text.replace(/\r\n/g, '\n');
  return `${base}${base === '' || base.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
}

/** Añade las claves que faltan (y regenera los secretos vacíos). Devuelve el texto nuevo y las claves creadas; nunca pisa un valor existente. */
export function ensureKeys(text: string, spec: readonly KeySpec[]): { text: string; created: string[] } {
  let out = text;
  const created: string[] = [];
  for (const s of spec) {
    const current = getKey(out, s.key);
    const missing = current === undefined;
    const emptySecret = s.generate !== undefined && current === '';
    if (!missing && !emptySecret) continue;
    if (missing && s.comment) out = `${out}${out === '' || out.endsWith('\n') ? '' : '\n'}# ${s.comment}\n`;
    out = setKey(out, s.key, s.generate ? s.generate() : s.value ?? '');
    created.push(s.key);
  }
  return { text: out, created };
}
