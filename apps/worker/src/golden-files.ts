import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goldenEntrySchema } from '@turnosala/core';
import type { EvalCase, Snapshot } from './eval.js';

// Carga del conjunto dorado: `entries/<id>.json` (anotación humana, en el repositorio) y `snapshots/<id>.json` (texto ya minimizado de la web,
// local y fuera de git). El id del archivo, el de la entrada y el de la instantánea deben coincidir.

export const TEMPLATE_ENTRY = (id: string, website: string): unknown => ({
  id, website, annotated_by: '', annotated_at: '', notes: 'Rellena «expected» con TODO lo que dice la web (lo que no anotes cuenta como error del modelo) y completa annotated_by y annotated_at (AAAA-MM-DD).',
  expected: { fields: {}, signals: [], contact_points: [] },
});

export interface LoadError {
  file: string;
  message: string;
}
export interface Loaded {
  cases: EvalCase[];
  errors: LoadError[];
}

function readJson(path: string): { value?: unknown; error?: string } {
  try {
    const raw = readFileSync(path, 'utf8');
    return { value: JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) };
  } catch {
    return { error: 'no es JSON válido' };
  }
}

function loadOne(dir: string, file: string): { case?: EvalCase; error?: string } {
  const entry = readJson(join(dir, 'entries', file));
  if (entry.error) return { error: `JSON roto: ${entry.error}` };
  const parsed = goldenEntrySchema.safeParse(entry.value);
  if (!parsed.success) return { error: `sin anotar o inválida (annotated_by/annotated_at/expected): ${parsed.error.issues.map((i) => i.path.join('.') || i.message).slice(0, 4).join(', ')}` };
  const id = file.replace(/\.json$/, '');
  if (parsed.data.id !== id) return { error: `el id «${parsed.data.id}» no coincide con el nombre del archivo` };
  const snapPath = join(dir, 'snapshots', file);
  if (!existsSync(snapPath)) return { error: 'falta la instantánea (npm run golden:snapshot)' };
  const snap = readJson(snapPath);
  if (snap.error) return { error: `instantánea rota: ${snap.error}` };
  const s = snap.value as Snapshot;
  if (s.id !== id || !Array.isArray(s.pages) || s.pages.length === 0) return { error: 'instantánea no válida (id o páginas)' };
  return { case: { golden: parsed.data, snapshot: s } };
}

export function loadGolden(dir: string): Loaded {
  if (!existsSync(join(dir, 'entries'))) return { cases: [], errors: [{ file: dir, message: 'el directorio del conjunto dorado no existe' }] };
  const out: Loaded = { cases: [], errors: [] };
  for (const file of readdirSync(join(dir, 'entries')).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    const r = loadOne(dir, file);
    if (r.case) out.cases.push(r.case);
    else out.errors.push({ file, message: r.error ?? 'error desconocido' });
  }
  return out;
}
