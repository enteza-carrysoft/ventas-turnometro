import { createTestDb, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleConsentText } from './consent-handlers.js';
import type { RouteDeps } from './http.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const users: Record<string, string> = { admin: 'u-admin', mkt: 'u-mkt', sales: 'u-sales' };
const deps = (who: keyof typeof users | null): RouteDeps => ({ pool: t.app, siteOrigin: ORIGIN, userId: async () => (who ? users[who] ?? null : null) });
const post = (body: unknown, over: { origin?: string | null; type?: string } = {}): Request =>
  new Request('http://x/api', { method: 'POST', headers: { ...(over.origin === null ? {} : { origin: over.origin ?? ORIGIN }), 'content-type': over.type ?? 'application/json' }, body: JSON.stringify(body) });
const count = async (sql: string, a: unknown[] = []): Promise<number> => Number(((await t.admin.query(sql, a)).rows[0] as { n: string }).n);

beforeAll(async () => {
  t = await createTestDb();
  for (const id of Object.values(users)) await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true)`, [id]);
  await t.app.query(`insert into app_user_roles (user_id, role) values ('u-admin','admin'), ('u-mkt','marketing'), ('u-sales','sales')`);
}, 60_000);
afterAll(async () => { await t.drop(); });

const draft = { box: 'email', version: 'v2-asesor', text: 'Acepto recibir correos comerciales de TurnoSala.' };

describe('textos de consentimiento: crear versión', () => {
  it('el admin crea una versión en borrador, queda en la auditoría y NO es la vigente hasta aprobarla', async () => {
    const r = await handleConsentText(post(draft), deps('admin'), 'create');
    expect(r.status).toBe(200);
    expect(await count(`select count(*) n from consent_texts where box = 'email' and version = 'v2-asesor' and status = 'draft'`)).toBe(1);
    expect(await count(`select count(*) n from audit_log where action = 'consent_text.created' and actor = 'u-admin'`)).toBe(1);
  });

  it('marketing y comercial NO pueden (403, aunque marketing revise fichas); sin sesión 401; origen ajeno 403; no JSON 415', async () => {
    const before = await count('select count(*) n from consent_texts');
    expect((await handleConsentText(post({ ...draft, version: 'x1' }), deps('mkt'), 'create')).status).toBe(403);
    expect((await handleConsentText(post({ ...draft, version: 'x2' }), deps('sales'), 'create')).status).toBe(403);
    expect((await handleConsentText(post({ ...draft, version: 'x3' }), deps(null), 'create')).status).toBe(401);
    expect((await handleConsentText(post({ ...draft, version: 'x4' }, { origin: 'https://evil.test' }), deps('admin'), 'create')).status).toBe(403);
    expect((await handleConsentText(post({ ...draft, version: 'x5' }, { type: 'text/plain' }), deps('admin'), 'create')).status).toBe(415);
    expect(await count('select count(*) n from consent_texts')).toBe(before);
  });

  it('versión repetida ⇒ 409; caja desconocida, versión mal formada o texto vacío ⇒ 422', async () => {
    expect((await handleConsentText(post(draft), deps('admin'), 'create')).status).toBe(409);
    for (const bad of [{ ...draft, box: 'otra', version: 'v9' }, { ...draft, version: 'con espacios' }, { ...draft, version: 'v10', text: '   ' }, { box: 'email' }, { ...draft, version: 'v11', text: 42 }]) {
      expect((await handleConsentText(post(bad), deps('admin'), 'create')).status, JSON.stringify(bad)).toBe(422);
    }
  });
});

describe('textos de consentimiento: aprobar versión', () => {
  const idOf = async (version: string): Promise<string> => ((await t.admin.query('select id from consent_texts where version = $1', [version])).rows[0] as { id: string }).id;

  it('solo el admin aprueba; tras aprobarla, la versión pasa a ser la vigente y queda en la auditoría', async () => {
    const id = await idOf('v2-asesor');
    expect((await handleConsentText(post({ id }), deps('mkt'), 'approve')).status).toBe(403);
    expect(await count(`select count(*) n from consent_texts where id = $1 and status = 'approved'`, [id])).toBe(0);
    expect((await handleConsentText(post({ id }), deps('admin'), 'approve')).status).toBe(200);
    expect(await count(`select count(*) n from consent_texts where id = $1 and status = 'approved' and approved_by = 'u-admin'`, [id])).toBe(1);
    expect(await count(`select count(*) n from audit_log where action = 'consent_text.approved' and entity_id = $1`, [id])).toBe(1);
  });

  it('aprobar de nuevo ⇒ 409; id inexistente ⇒ 404; id que no es uuid ⇒ 404', async () => {
    expect((await handleConsentText(post({ id: await idOf('v2-asesor') }), deps('admin'), 'approve')).status).toBe(409);
    expect((await handleConsentText(post({ id: '018f0000-0000-7000-8000-00000000dead' }), deps('admin'), 'approve')).status).toBe(404);
    expect((await handleConsentText(post({ id: 'no-es-uuid' }), deps('admin'), 'approve')).status).toBe(404);
    expect((await handleConsentText(post({}), deps('admin'), 'approve')).status).toBe(404);
  });

  it('un texto aprobado no se puede editar ni borrar (inmutable en la base de datos)', async () => {
    const id = await idOf('v2-asesor');
    await expect(t.admin.query(`update consent_texts set text = 'otro' where id = $1`, [id])).rejects.toThrow();
    await expect(t.admin.query('delete from consent_texts where id = $1', [id])).rejects.toThrow();
  });
});
