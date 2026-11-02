import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setSourceActive } from './sources.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const active = async (id: string): Promise<boolean> => ((await t.app.query('select active from allowed_sources where id = $1', [id])).rows[0] as { active: boolean }).active;
const audits = async () => (await t.app.query(`select actor, entity_id, payload from audit_log where action = 'source.set_active' order by id`)).rows as Array<{ actor: string; entity_id: string; payload: Record<string, unknown> }>;

describe('setSourceActive', () => {
  it('activa una fuente conocida y lo deja en la auditoría con quién y por qué; desactivar también', async () => {
    expect(await active('osm')).toBe(false);
    expect(await setSourceActive(t.app, 'osm', true, { actor: 'script:local', reason: 'pruebas locales en sandbox' })).toEqual({ ok: true, changed: true });
    expect(await active('osm')).toBe(true);
    expect(await setSourceActive(t.app, 'osm', false, { actor: 'script:local', reason: 'fin de pruebas' })).toEqual({ ok: true, changed: true });
    expect(await active('osm')).toBe(false);
    expect((await audits()).map((a) => [a.actor, a.entity_id, a.payload.active, a.payload.reason])).toEqual([
      ['script:local', 'osm', true, 'pruebas locales en sandbox'], ['script:local', 'osm', false, 'fin de pruebas'],
    ]);
  });

  it('repetir el mismo estado no cambia nada ni ensucia la auditoría', async () => {
    const before = (await audits()).length;
    await setSourceActive(t.app, 'osm', true, { actor: 'a', reason: 'r' });
    expect(await setSourceActive(t.app, 'osm', true, { actor: 'a', reason: 'r' })).toEqual({ ok: true, changed: false });
    expect((await audits()).length).toBe(before + 1);
  });

  it('una fuente desconocida se rechaza; el motivo y el actor son obligatorios', async () => {
    expect(await setSourceActive(t.app, 'no_existe', true, { actor: 'a', reason: 'r' })).toEqual({ ok: false, reason: 'not_found' });
    expect(await setSourceActive(t.app, 'osm', true, { actor: 'a', reason: '  ' })).toEqual({ ok: false, reason: 'reason_required' });
    expect(await setSourceActive(t.app, 'osm', true, { actor: '', reason: 'r' })).toEqual({ ok: false, reason: 'reason_required' });
  });
});

describe('google_places tras la migración 0017 (REQ-RES-02 CA1)', () => {
  it('sigue inactiva por defecto, solo admite almacenar place_id y anota las condiciones comprobadas con fecha', async () => {
    const r = (await t.app.query(`select active, storable_fields, license, terms_url, verified_at, notes from allowed_sources where id = 'google_places'`)).rows[0] as Record<string, unknown>;
    expect(r).toMatchObject({ active: false, storable_fields: ['place_id'], terms_url: 'https://developers.google.com/maps/documentation/places/web-service/policies' });
    expect(String(r.license)).toMatch(/place_id/);
    expect(String(r.notes)).toMatch(/web de la empresa/);
    expect(r.verified_at).toBeInstanceOf(Date);
  });
});
