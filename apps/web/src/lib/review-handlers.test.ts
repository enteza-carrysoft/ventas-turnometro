import { createTestDb, ingestCandidate, saveEnrichment, saveSegmentDrafts, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAddContact, handleBulkApprove, handleCorrect, handleExport, handleReview, handleSegmentAction, type ReviewDeps } from './review-handlers.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;

const users: Record<string, string | null> = { mkt: 'u-mkt', sales: 'u-sales', voice: 'u-voice', none: 'u-none' };
const deps = (who: keyof typeof users | null): ReviewDeps => ({ pool: t.app, siteOrigin: ORIGIN, userId: async () => (who ? users[who] ?? null : null) });

beforeAll(async () => {
  t = await createTestDb();
  // Solo hacen falta los ids de usuario (la sesión se simula): filas mínimas en la tabla de Better Auth.
  for (const id of ['u-mkt', 'u-sales', 'u-voice', 'u-none']) {
    await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true)`, [id]);
  }
  await t.app.query(`insert into app_user_roles (user_id, role) values ('u-mkt','marketing'), ('u-sales','sales'), ('u-voice','voice')`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

async function prospect(): Promise<string> {
  n++;
  const r = await ingestCandidate(t.app, { name: `Empresa${String.fromCharCode(97 + n)}${'qwxz'.repeat(n)} S.L.`, website: `https://web-${n}.es/`, phone: `955 20${n} 00${n}`, sourceId: 'corporate_web', externalId: `x${n}`, sourceUrl: `https://web-${n}.es/`, fetchedAt: AT, extractorVersion: 't', evidences: [] });
  await saveEnrichment(t.app, r.prospectId, { fields: [], signals: [], contactPoints: [], legalForm: null, metrics: { accepted: 0, rejected: {} as never, personalEmailsDiscarded: 0, hallucinationRejected: 0 } }, { fetchedAt: AT, extractorVersion: 'x' });
  return r.prospectId;
}
const post = (body: unknown, over: { origin?: string | null; type?: string } = {}): Request =>
  new Request('http://x/api', { method: 'POST', headers: { ...(over.origin === null ? {} : { origin: over.origin ?? ORIGIN }), 'content-type': over.type ?? 'application/json' }, body: JSON.stringify(body) });
const status = async (id: string): Promise<string> => ((await t.app.query('select status from prospects where id = $1', [id])).rows[0] as { status: string }).status;

describe('comprobaciones comunes de las rutas de revisión', () => {
  it('origen distinto o ausente ⇒ 403 (CSRF); no JSON ⇒ 415; sin sesión ⇒ 401; sin rol de revisión ⇒ 403; nada cambia', async () => {
    const id = await prospect();
    expect((await handleReview(post({ action: 'approve' }, { origin: 'https://evil.test' }), deps('mkt'), id)).status).toBe(403);
    expect((await handleReview(post({ action: 'approve' }, { origin: null }), deps('mkt'), id)).status).toBe(403);
    expect((await handleReview(post({ action: 'approve' }, { type: 'text/plain' }), deps('mkt'), id)).status).toBe(415);
    expect((await handleReview(post({ action: 'approve' }), deps(null), id)).status).toBe(401);
    expect((await handleReview(post({ action: 'approve' }), deps('sales'), id)).status).toBe(403);
    expect((await handleReview(post({ action: 'approve' }), deps('none'), id)).status).toBe(403);
    expect(await status(id)).toBe('enriched');
  });

  it('un id que no es un uuid ⇒ 404 (no un 500)', async () => {
    expect((await handleReview(post({ action: 'approve' }), deps('mkt'), 'no-es-uuid')).status).toBe(404);
  });
});

describe('handleReview', () => {
  it('aprobar ⇒ 200 y estado nuevo; descartar sin motivo ⇒ 422; repetir ⇒ 409; inexistente ⇒ 404; cuerpo inválido ⇒ 422', async () => {
    const id = await prospect();
    const ok = await handleReview(post({ action: 'approve' }), deps('mkt'), id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'approved' });
    expect((await handleReview(post({ action: 'approve' }), deps('mkt'), id)).status).toBe(409);
    const other = await prospect();
    expect((await handleReview(post({ action: 'discard' }), deps('mkt'), other)).status).toBe(422);
    expect((await handleReview(post({ action: 'discard', reason: '  ' }), deps('mkt'), other)).status).toBe(422);
    expect((await handleReview(post({ action: 'borrar' }), deps('mkt'), other)).status).toBe(422);
    expect((await handleReview(post({ action: 'discard', reason: 'No encaja' }), deps('mkt'), other)).status).toBe(200);
    expect((await handleReview(post({ action: 'approve' }), deps('mkt'), '00000000-0000-7000-8000-000000000000')).status).toBe(404);
  });
});

describe('handleCorrect, handleBulkApprove, handleExport', () => {
  it('corregir ⇒ 200; valor inválido ⇒ 422; campo desconocido ⇒ 422', async () => {
    const id = await prospect();
    expect((await handleCorrect(post({ field: 'sites_count', value: '4' }), deps('mkt'), id)).status).toBe(200);
    expect((await handleCorrect(post({ field: 'sites_count', value: 'x' }), deps('mkt'), id)).status).toBe(422);
    expect((await handleCorrect(post({ field: 'phone', value: '1' }), deps('mkt'), id)).status).toBe(422);
  });

  it('añadir contacto ⇒ 200; email personal ⇒ 422 personal_email; tipo desconocido ⇒ 422; ventas ⇒ 403', async () => {
    const id = await prospect();
    expect((await handleAddContact(post({ type: 'generic_email', value: 'info@nova-pelu.es', sourceUrl: 'https://nova-pelu.es/' }), deps('mkt'), id)).status).toBe(200);
    const personal = await handleAddContact(post({ type: 'generic_email', value: 'nova@gmail.com', sourceUrl: 'https://nova-pelu.es/' }), deps('mkt'), id);
    expect([personal.status, ((await personal.json()) as { error: string }).error]).toEqual([422, 'personal_email']);
    expect((await handleAddContact(post({ type: 'personal_email', value: 'a@b.es', sourceUrl: 'https://b.es/' }), deps('mkt'), id)).status).toBe(422);
    expect((await handleAddContact(post({ type: 'generic_email', value: 'info@nova-pelu.es', sourceUrl: 'https://nova-pelu.es/' }), deps('sales'), id)).status).toBe(403);
  });

  it('aprobación en bloque devuelve aprobadas y la muestra de calidad (≥ 10 %)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await prospect());
    const res = await handleBulkApprove(post({ ids }), deps('mkt'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approved: string[]; sample: string[] };
    expect(body.sample.length).toBeGreaterThanOrEqual(1);
    expect(body.approved.length + body.sample.length).toBe(10);
    expect((await handleBulkApprove(post({ ids: [] }), deps('mkt'))).status).toBe(422);
    expect((await handleBulkApprove(post({ ids: ['x'] }), deps('mkt'))).status).toBe(422);
    expect((await handleBulkApprove(post({ ids }), deps('sales'))).status).toBe(403);
  });

  it('exportar: GET con sesión de cualquier rol con acceso ⇒ CSV con cabeceras de descarga; sin sesión ⇒ 401; voz/sin rol ⇒ 403', async () => {
    const id = await prospect();
    await handleReview(post({ action: 'approve' }), deps('mkt'), id);
    const res = await handleExport(new Request('http://x/api/fichas/export'), deps('sales'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="fichas-aprobadas-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text.split('\r\n')[0]).toContain('id,nombre');
    expect(text).toContain(id);
    expect((await handleExport(new Request('http://x/api/fichas/export'), deps(null))).status).toBe(401);
    expect((await handleExport(new Request('http://x/api/fichas/export'), deps('none'))).status).toBe(403);
    expect((await handleExport(new Request('http://x/api/fichas/export'), deps('voice'))).status).toBe(403);
  });
});

describe('handleSegmentAction', () => {
  it('marketing aprueba y retira un segmento; sales ⇒ 403; origen malo ⇒ 403; ya aprobado ⇒ 409', async () => {
    const productId = '00000000-0000-7000-8000-0000000000c1';
    await t.admin.query(`insert into products (id, slug, name, website) values ($1,'p','P','https://p.es')`, [productId]);
    await saveSegmentDrafts(t.app, productId, [{ slug: 's1', name: 'S1', status: 'draft', definition: { vertical: 'v', description: 'd', signals: [], decisionMakerRole: 'g', message: 'm', bestDemo: 'b', fit: { score: 1, provenance: 'inferred', reasoning: 'razón larga' }, sourceUrls: ['https://p.es'], osmFilters: [] } }], { actor: 'x' });
    const sid = ((await t.app.query(`select id from segments where slug = 's1'`)).rows[0] as { id: string }).id;
    expect((await handleSegmentAction(post({}), deps('sales'), sid, 'approve')).status).toBe(403);
    expect((await handleSegmentAction(post({}, { origin: 'https://evil.test' }), deps('mkt'), sid, 'approve')).status).toBe(403);
    expect((await handleSegmentAction(post({}), deps('mkt'), sid, 'approve')).status).toBe(200);
    expect((await handleSegmentAction(post({}), deps('mkt'), sid, 'approve')).status).toBe(409);
    expect((await handleSegmentAction(post({}), deps('mkt'), sid, 'retire')).status).toBe(200);
  });
});
