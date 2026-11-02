import { createTestDb, listRequests, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleLaunchResearch, handleRequestAnalysis, handleResearchControl } from './research-handlers.js';
import type { RouteDeps } from './http.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const SEG = '00000000-0000-7000-8000-0000000000b2';
const DRAFT = '00000000-0000-7000-8000-0000000000b3';
const PRODUCT = '00000000-0000-7000-8000-0000000000a1';
const users: Record<string, string | null> = { mkt: 'u-mkt', sales: 'u-sales' };
const deps = (who: keyof typeof users | null): RouteDeps => ({ pool: t.app, siteOrigin: ORIGIN, userId: async () => (who ? users[who] ?? null : null) });
const post = (body: unknown, origin: string | null = ORIGIN): Request =>
  new Request('http://x/api', { method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const valid = (over: Record<string, unknown> = {}) => ({ segmentId: SEG, ineCodes: ['41091'], sourceIds: ['osm'], maxCandidates: 50, budgetEur: 3, ...over });
const jobCount = async (): Promise<number> => Number(((await t.app.query('select count(*) n from research_jobs')).rows[0] as { n: string }).n);

beforeAll(async () => {
  t = await createTestDb();
  for (const id of ['u-mkt', 'u-sales']) await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true)`, [id]);
  await t.app.query(`insert into app_user_roles (user_id, role) values ('u-mkt','marketing'), ('u-sales','sales')`);
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000), ('41038','Dos Hermanas','Sevilla','Andalucía',135000)`);
  await t.admin.query(`update allowed_sources set active = true where id = 'osm'`);
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [PRODUCT]);
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$3,'c','C','approved','{}'), ($2,$3,'d','D','draft','{}')`, [SEG, DRAFT, PRODUCT]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

describe('handleLaunchResearch', () => {
  it('defensas: origen ⇒ 403, no JSON ⇒ 415, sin sesión ⇒ 401, rol sin permiso ⇒ 403; no se crea ningún trabajo', async () => {
    const before = await jobCount();
    expect((await handleLaunchResearch(post(valid(), 'https://evil.test'), deps('mkt'))).status).toBe(403);
    expect((await handleLaunchResearch(new Request('http://x/api', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' }), deps('mkt'))).status).toBe(415);
    expect((await handleLaunchResearch(post(valid()), deps(null))).status).toBe(401);
    expect((await handleLaunchResearch(post(valid()), deps('sales'))).status).toBe(403);
    expect(await jobCount()).toBe(before);
  });

  it('lanza el trabajo ⇒ 200 con su id y el número de tareas (fuente × municipio)', async () => {
    const res = await handleLaunchResearch(post(valid({ ineCodes: ['41091', '41038'], sourceIds: ['osm'] })), deps('mkt'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobId: string; tasks: number };
    expect(body.tasks).toBe(2);
    expect((await t.app.query('select created_by, max_candidates from research_jobs where id = $1', [body.jobId])).rows[0]).toMatchObject({ created_by: 'u-mkt', max_candidates: 50 });
  });

  it.each([
    ['lote > 200', { maxCandidates: 201 }], ['lote 0', { maxCandidates: 0 }], ['presupuesto 0', { budgetEur: 0 }], ['presupuesto absurdo', { budgetEur: 100000 }],
    ['sin municipios', { ineCodes: [] }], ['sin fuentes', { sourceIds: [] }], ['código INE no válido', { ineCodes: ['4109'] }], ['segmento no uuid', { segmentId: 'x' }],
  ])('datos inválidos (%s) ⇒ 422', async (_n, over) => {
    expect((await handleLaunchResearch(post(valid(over)), deps('mkt'))).status).toBe(422);
  });

  it('fuente inactiva o segmento en borrador ⇒ 422 con el motivo, y sin crear nada', async () => {
    const before = await jobCount();
    const inactive = await handleLaunchResearch(post(valid({ sourceIds: ['google_places'] })), deps('mkt'));
    expect(inactive.status).toBe(422);
    expect(((await inactive.json()) as { error: string }).error).toMatch(/google_places/);
    const draft = await handleLaunchResearch(post(valid({ segmentId: DRAFT })), deps('mkt'));
    expect(draft.status).toBe(422);
    expect(((await draft.json()) as { error: string }).error).toMatch(/aprobado/);
    expect(await jobCount()).toBe(before);
  });
});

describe('handleResearchControl', () => {
  it('pausar, reanudar y cancelar ⇒ 200; repetir un cambio imposible ⇒ 409; id inexistente ⇒ 404; sales ⇒ 403', async () => {
    const { jobId } = (await (await handleLaunchResearch(post(valid()), deps('mkt'))).json()) as { jobId: string };
    expect((await handleResearchControl(post({}), deps('mkt'), jobId, 'pause')).status).toBe(200);
    expect((await handleResearchControl(post({}), deps('mkt'), jobId, 'pause')).status).toBe(409);
    expect((await handleResearchControl(post({}), deps('sales'), jobId, 'resume')).status).toBe(403);
    expect((await handleResearchControl(post({}), deps('mkt'), jobId, 'resume')).status).toBe(200);
    expect((await handleResearchControl(post({}), deps('mkt'), jobId, 'cancel')).status).toBe(200);
    expect(((await t.app.query('select status from research_jobs where id = $1', [jobId])).rows[0] as { status: string }).status).toBe('cancelled');
    expect((await handleResearchControl(post({}), deps('mkt'), jobId, 'cancel')).status).toBe(409);
    expect((await handleResearchControl(post({}), deps('mkt'), 'no-uuid', 'cancel')).status).toBe(404);
    expect((await handleResearchControl(post({}), deps('mkt'), '00000000-0000-7000-8000-000000000999', 'cancel')).status).toBe(404);
  });
});

describe('handleRequestAnalysis', () => {
  it('encola el análisis de mercado ⇒ 200; mientras haya uno en curso ⇒ 409; sales ⇒ 403; sin origen ⇒ 403', async () => {
    expect((await handleRequestAnalysis(post({}), deps('sales'))).status).toBe(403);
    expect((await handleRequestAnalysis(post({}, 'https://evil.test'), deps('mkt'))).status).toBe(403);
    const ok = await handleRequestAnalysis(post({}), deps('mkt'));
    expect(ok.status).toBe(200);
    expect((await handleRequestAnalysis(post({}), deps('mkt'))).status).toBe(409);
    const [req] = await listRequests(t.app, 'market.analyze', 5);
    expect(req).toMatchObject({ status: 'queued', requestedBy: 'u-mkt' });
    expect(await t.app.query(`select payload from worker_requests where id = $1`, [req!.id]).then((r) => r.rows[0])).toMatchObject({ payload: { productId: PRODUCT } });
  });

  it('cuando el anterior termina se puede pedir otro', async () => {
    await t.admin.query(`update worker_requests set status = 'done'`);
    expect((await handleRequestAnalysis(post({}), deps('mkt'))).status).toBe(200);
  });

  it('los mercados sugeridos se normalizan y viajan en la carga del trabajo', async () => {
    await t.admin.query(`update worker_requests set status = 'done'`);
    expect((await handleRequestAnalysis(post({ hints: 'peluquerías, Peluquerías, barberías' }), deps('mkt'))).status).toBe(200);
    const row = (await t.app.query(`select payload from worker_requests where status = 'queued'`)).rows[0] as { payload: unknown };
    expect(row.payload).toEqual({ productId: PRODUCT, hints: ['peluquerías', 'barberías'] });
  });

  it('sin ningún producto dado de alta ⇒ 409 (y no se encola nada)', async () => {
    const empty = await createTestDb();
    try {
      await empty.app.query(`insert into "user" ("id","name","email","emailVerified") values ('u-mkt','u-mkt','m@x.test',true)`);
      await empty.app.query(`insert into app_user_roles (user_id, role) values ('u-mkt','marketing')`);
      const d: RouteDeps = { pool: empty.app, siteOrigin: ORIGIN, userId: async () => 'u-mkt' };
      expect((await handleRequestAnalysis(post({}), d)).status).toBe(409);
      expect(Number(((await empty.app.query('select count(*) n from worker_requests')).rows[0] as { n: string }).n)).toBe(0);
    } finally {
      await empty.drop();
    }
  });
});
