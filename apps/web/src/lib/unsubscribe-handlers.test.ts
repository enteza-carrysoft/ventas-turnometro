import { createPublicToken, createTestDb, ingestCandidate, type TestDb } from '@turnosala/db';
import { createTurnstileVerifier } from '@turnosala/connectors/turnstile';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublicDeps } from './public-handlers.js';
import { handleUnsubscribe } from './unsubscribe-handlers.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;
let ipSeq = 0;
const deps = (over: Partial<PublicDeps> = {}): PublicDeps => ({
  pool: t.app, siteOrigin: ORIGIN, mode: 'sandbox', turnstile: createTurnstileVerifier({ secret: 'x', sandboxTest: true }), secret: 'secreto-de-pruebas-NO-REAL-abcdefghijklmnop',
  clientIp: ((ip) => () => ip)(`198.18.0.${(++ipSeq % 250) + 1}`), ...over,
});
const post = (b: unknown, over: { origin?: string | null; type?: string } = {}): Request =>
  new Request('http://x/api/public/baja', { method: 'POST', headers: { ...(over.origin === null ? {} : { origin: over.origin ?? ORIGIN }), 'content-type': over.type ?? 'application/json' }, body: JSON.stringify(b) });

beforeAll(async () => { t = await createTestDb(); }, 60_000);
afterAll(async () => { await t.drop(); });

async function setup() {
  n++;
  const email = `luis${n}@bajaweb${n}clinica.es`;
  const e = await ingestCandidate(t.app, { name: `Clínica Baja Web ${'qwxz'.repeat(n)} S.L.`, website: `https://bajaweb${n}clinica.es/`, sourceId: 'osm', externalId: `bw${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  await t.admin.query(`update prospects set status = 'approved' where id = $1`, [e.prospectId]);
  const { token } = await createPublicToken(t.app, { kind: 'unsubscribe', prospectId: e.prospectId as string, contact: { email } });
  return { token, prospectId: e.prospectId as string, email };
}
const status = async (id: string): Promise<string> => ((await t.admin.query('select status from prospects where id = $1', [id])).rows[0] as { status: string }).status;

describe('POST baja', () => {
  it('con token válido y alcance «empresa» registra la oposición completa y responde 200 {ok:true}', async () => {
    const w = await setup();
    const r = await handleUnsubscribe(post({ token: w.token, scope: 'company' }), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await status(w.prospectId)).toBe('blocked');
  });

  it('alcance «contacto»: excluye el correo pero la ficha sigue', async () => {
    const w = await setup();
    expect((await handleUnsubscribe(post({ token: w.token, scope: 'contact' }), deps())).status).toBe(200);
    expect(await status(w.prospectId)).toBe('approved');
    expect(Number(((await t.admin.query(`select count(*) n from suppressions where kind = 'email' and value = $1`, [w.email])).rows[0] as { n: string }).n)).toBe(1);
  });

  it('repetir la baja sigue dando 200 (idempotente)', async () => {
    const w = await setup();
    await handleUnsubscribe(post({ token: w.token, scope: 'company' }), deps());
    expect((await handleUnsubscribe(post({ token: w.token, scope: 'company' }), deps())).status).toBe(200);
  });

  it('token inválido, alcance desconocido o cuerpo roto ⇒ 404 idéntico; nada cambia', async () => {
    const w = await setup();
    const bodies = [await (await handleUnsubscribe(post({ token: 'x'.repeat(22), scope: 'company' }), deps())).text()];
    for (const b of [{ token: 42, scope: 'company' }, { scope: 'company' }, { token: w.token, scope: 'todo' }, { token: w.token }, {}]) {
      const r = await handleUnsubscribe(post(b), deps());
      expect(r.status, JSON.stringify(b)).toBe(404);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1); // mismo cuerpo siempre: no se distingue el motivo
    expect(await status(w.prospectId)).toBe('approved');
  });

  it('origen ajeno o ausente ⇒ 403 (CSRF), no JSON ⇒ 415; nada cambia', async () => {
    const w = await setup();
    expect((await handleUnsubscribe(post({ token: w.token, scope: 'company' }, { origin: 'https://evil.test' }), deps())).status).toBe(403);
    expect((await handleUnsubscribe(post({ token: w.token, scope: 'company' }, { origin: null }), deps())).status).toBe(403);
    expect((await handleUnsubscribe(post({ token: w.token, scope: 'company' }, { type: 'text/plain' }), deps())).status).toBe(415);
    expect(await status(w.prospectId)).toBe('approved');
  });

  it('límite por IP: a la vigésima primera petición en una hora ⇒ 429', async () => {
    const d = deps({ clientIp: () => '198.19.0.1' });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await handleUnsubscribe(post({ token: 'x'.repeat(22), scope: 'company' }), d)).status);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes[20]).toBe(429);
  });
});
