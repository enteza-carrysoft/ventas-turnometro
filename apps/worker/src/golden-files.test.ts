import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGolden, TEMPLATE_ENTRY } from './golden-files.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup(entries: Record<string, unknown>, snapshots: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'golden-'));
  dirs.push(root);
  mkdirSync(join(root, 'entries'));
  mkdirSync(join(root, 'snapshots'));
  for (const [f, v] of Object.entries(entries)) writeFileSync(join(root, 'entries', f), typeof v === 'string' ? v : JSON.stringify(v));
  for (const [f, v] of Object.entries(snapshots)) writeFileSync(join(root, 'snapshots', f), JSON.stringify(v));
  return root;
}
const entry = (id: string) => ({ id, website: 'https://x.es', annotated_by: 'Ana', annotated_at: '2026-11-20', expected: { fields: {}, signals: [], contact_points: [] } });
const snap = (id: string) => ({ id, website: 'https://x.es', takenAt: '2026-11-19T10:00:00Z', pages: [{ url: 'https://x.es/', finalUrl: 'https://x.es/', text: 'hola', links: [] }] });

describe('loadGolden', () => {
  it('carga las entradas válidas con su instantánea, ordenadas por id', () => {
    const r = loadGolden(setup({ 'b.json': entry('b'), 'a.json': entry('a') }, { 'a.json': snap('a'), 'b.json': snap('b') }));
    expect(r.errors).toEqual([]);
    expect(r.cases.map((c) => c.golden.id)).toEqual(['a', 'b']);
  });

  it('informa de las entradas sin anotar (la plantilla), con JSON roto, sin instantánea o con id distinto al nombre del archivo', () => {
    const r = loadGolden(setup(
      { 'plantilla.json': TEMPLATE_ENTRY('plantilla', 'https://x.es'), 'roto.json': '{ no es json', 'sin-snap.json': entry('sin-snap'), 'otro.json': entry('distinto'), 'ok.json': entry('ok') },
      { 'plantilla.json': snap('plantilla'), 'otro.json': snap('otro'), 'ok.json': snap('ok') },
    ));
    expect(r.cases.map((c) => c.golden.id)).toEqual(['ok']);
    const byFile = Object.fromEntries(r.errors.map((e) => [e.file, e.message]));
    expect(byFile['plantilla.json']).toMatch(/anotar|annotated/i);
    expect(byFile['roto.json']).toMatch(/JSON/);
    expect(byFile['sin-snap.json']).toMatch(/instantánea/);
    expect(byFile['otro.json']).toMatch(/id/);
  });

  it('un directorio inexistente da un error claro, no una excepción', () => {
    const r = loadGolden(join(tmpdir(), 'no-existe-golden-xyz'));
    expect(r.cases).toEqual([]);
    expect(r.errors[0]?.message).toMatch(/no existe/);
  });
});
