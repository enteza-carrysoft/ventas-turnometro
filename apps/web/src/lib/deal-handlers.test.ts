import { createTestDb, ingestCandidate, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleDealAction } from './deal-handlers.js';
import type { RouteDeps } from './http.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;
const users = { admin: 'u-admin', s1: 'u-s1', s2: 'u-s2', mkt: 'u-mkt' } as const;
const deps = (who: keyof typeof users | null): RouteDeps => ({ pool: t.app, siteOrigin: ORIGIN, userId: async () => (who ? users[who] : null) });
const post = (body: unknown, over: { origin?: string | null; type?: string } = {}): Request =>
  new Request('http://x/api', { method: 'POST', headers: { ...(over.origin === null ? {} : { origin: over.origin ?? ORIGIN }), 'content-type': over.type ?? 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  t = await createTestDb();
  for (const id of Object.values(users)) await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true)`, [id]);
  await t.app.query(`insert into app_user_roles (user_id, role) values ('u-admin','admin'),('u-s1','sales'),('u-s2','sales'),('u-mkt','marketing')`);
}, 60_000);
afterAll(async () => { await t.drop(); });

async function deal(owner: string | null = 'u-s1'): Promise<string> {
  n++;
  const e = await ingestCandidate(t.app, { name: `Empresa Handler ${'qwxz'.repeat(n)} S.L.`, website: `https://handler${n}web.es/`, sourceId: 'osm', externalId: `dh${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const id = `018f2222-0000-7000-8000-${String(n).padStart(12, '0')}`;
  await t.admin.query(`insert into deals (id, prospect_id, stage_id, owner_user_id, created_by) values ($1,$2,'interested',$3,'t')`, [id, e.prospectId, owner]);
  return id;
}
const stage = async (id: string): Promise<string> => ((await t.admin.query('select stage_id from deals where id = $1', [id])).rows[0] as { stage_id: string }).stage_id;

describe('comprobaciones comunes', () => {
  it('origen ajeno o ausente ⇒ 403; no JSON ⇒ 415; sin sesión ⇒ 401; id que no es uuid ⇒ 404; nada cambia', async () => {
    const id = await deal();
    const b = { stage: 'trial' };
    expect((await handleDealAction(post(b, { origin: 'https://evil.test' }), deps('s1'), id, 'move')).status).toBe(403);
    expect((await handleDealAction(post(b, { origin: null }), deps('s1'), id, 'move')).status).toBe(403);
    expect((await handleDealAction(post(b, { type: 'text/plain' }), deps('s1'), id, 'move')).status).toBe(415);
    expect((await handleDealAction(post(b), deps(null), id, 'move')).status).toBe(401);
    expect((await handleDealAction(post(b), deps('s1'), 'no-es-uuid', 'move')).status).toBe(404);
    expect(await stage(id)).toBe('interested');
  });
});

describe('mover', () => {
  it('el comercial mueve la suya (200); la ajena ⇒ 403; marketing ⇒ 403; etapa rara ⇒ 422; ganar/perder por aquí ⇒ 422', async () => {
    const id = await deal('u-s1');
    expect((await handleDealAction(post({ stage: 'demo_booked' }), deps('s2'), id, 'move')).status).toBe(403);
    expect((await handleDealAction(post({ stage: 'demo_booked' }), deps('mkt'), id, 'move')).status).toBe(403);
    expect((await handleDealAction(post({ stage: 'inventada' }), deps('s1'), id, 'move')).status).toBe(422);
    expect((await handleDealAction(post({ stage: 'won' }), deps('s1'), id, 'move')).status).toBe(422);
    expect((await handleDealAction(post({ stage: 'lost' }), deps('s1'), id, 'move')).status).toBe(422);
    expect((await handleDealAction(post({}), deps('s1'), id, 'move')).status).toBe(422);
    expect((await handleDealAction(post({ stage: 7 }), deps('s1'), id, 'move')).status).toBe(422);
    expect(await stage(id)).toBe('interested');
    const ok = await handleDealAction(post({ stage: 'demo_booked' }), deps('s1'), id, 'move');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(await stage(id)).toBe('demo_booked');
  });

  it('oportunidad inexistente ⇒ 404', async () => {
    expect((await handleDealAction(post({ stage: 'trial' }), deps('admin'), '018f2222-0000-7000-8000-00000000dead', 'move')).status).toBe(404);
  });
});

describe('perder', () => {
  it('exige motivo (422 si falta o no existe); con motivo, 200 y queda perdida; repetir ⇒ 409', async () => {
    const id = await deal();
    expect((await handleDealAction(post({}), deps('s1'), id, 'lose')).status).toBe(422);
    expect((await handleDealAction(post({ reasonId: 'no_existe' }), deps('s1'), id, 'lose')).status).toBe(422);
    expect((await handleDealAction(post({ reasonId: 'no_interest', note: 'x'.repeat(5000) }), deps('s1'), id, 'lose')).status).toBe(200);
    expect(await stage(id)).toBe('lost');
    expect((await t.admin.query('select length(lost_note) n from deals where id = $1', [id])).rows[0].n).toBeLessThanOrEqual(1000);
    expect((await handleDealAction(post({ reasonId: 'other' }), deps('s1'), id, 'lose')).status).toBe(409);
  });

  it('«Oposición / no contactar» bloquea la ficha (T-14) también por la ruta', async () => {
    const id = await deal();
    expect((await handleDealAction(post({ reasonId: 'opposition' }), deps('s1'), id, 'lose')).status).toBe(200);
    const st = (await t.admin.query(`select p.status from prospects p join deals d on d.prospect_id = p.id where d.id = $1`, [id])).rows[0] as { status: string };
    expect(st.status).toBe('blocked');
  });
});

describe('ganar y reasignar (solo admin)', () => {
  it('el comercial no gana ni reasigna (403); el admin sí', async () => {
    const id = await deal('u-s1');
    expect((await handleDealAction(post({}), deps('s1'), id, 'win')).status).toBe(403);
    expect((await handleDealAction(post({ ownerUserId: 'u-s2' }), deps('s1'), id, 'assign')).status).toBe(403);
    expect((await handleDealAction(post({ ownerUserId: 'u-mkt' }), deps('admin'), id, 'assign')).status).toBe(422);
    expect((await handleDealAction(post({ ownerUserId: 'u-s2' }), deps('admin'), id, 'assign')).status).toBe(200);
    expect((await t.admin.query('select owner_user_id from deals where id = $1', [id])).rows[0].owner_user_id).toBe('u-s2');
    expect((await handleDealAction(post({ ownerUserId: 5 }), deps('admin'), id, 'assign')).status).toBe(422);
    expect((await handleDealAction(post({}), deps('admin'), id, 'win')).status).toBe(200);
    expect(await stage(id)).toBe('won');
  });
});
