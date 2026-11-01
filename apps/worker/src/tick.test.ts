import type { LlmRequest, LlmResult } from '@turnosala/ai';
import type { CrawlResult, SourceCandidate } from '@turnosala/connectors';
import type { ExtractionOutput, MarketAnalysis } from '@turnosala/core';
import { createResearchJob, createTestDb, getWorkerHeartbeat, ingestCandidate, requestWork, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { acquireSingleton, runLoop, tick, type TickDeps } from './tick.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
const P1 = '00000000-0000-7000-8000-0000000000a1';
const SEG = '00000000-0000-7000-8000-0000000000b2';
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000)`);
  await t.admin.query(`update allowed_sources set active = true where id = 'osm'`);
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [P1]);
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,'c','C','approved','{}')`, [SEG, P1]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

function word(k: number): string {
  let x = (k * 2654435761) % 4294967296;
  let w = '';
  for (let i = 0; i < 7; i++) { w += 'bcdfghjklmnpqrstvwxyz'.charAt(x % 21) + 'aeiou'.charAt((x >> 5) % 5); x = (x * 1103515245 + 12345) % 2147483648; }
  return w;
}
const cand = (): SourceCandidate => {
  n++;
  return { name: `${word(n + 500)} ${word(n * 13 + 1)} S.L.`, website: `https://tick-${n}.es/`, phone: `955 5${String(n).padStart(2, '0')} 0${String(n).padStart(2, '0')}`, sourceId: 'osm', externalId: `t${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] };
};
const page = (url: string, text: string) => ({ url, finalUrl: url, status: 200, title: '', text, links: [], category: 'home' as const, fetchedAt: AT });
const CRAWL = (url: string): CrawlResult => ({ robots: 'allowed', skipped: [], pages: [page(url, 'Tenemos 3 consultas')] });
const EXTRACT: (url: string) => ExtractionOutput = (url) => ({ fields: [], signals: [{ key: 'varias_consultas', source_url: url, quote: 'Tenemos 3 consultas' }], contact_points: [], legal_form: null });
const ok = <T>(data: T): LlmResult<T> => ({ status: 'ok', data, provider: 'openrouter', requestedModel: 'm', servedModel: 'm', fallbackUsed: false, usage: { input: 1, output: 1, cachedInput: 0, costEur: 0.1, costSource: 'provider' } });
const fail = (reason: string): LlmResult<never> => ({ status: 'error', reason: reason as never, provider: null, requestedModel: null, servedModel: null, fallbackUsed: false, usage: { input: 0, output: 0, cachedInput: 0, costEur: 0, costSource: 'unknown' } });

const discoveryReply = (urls: string[], costEur = 0.05): LlmResult<unknown> => ({
  status: 'ok', text: urls[0] ?? 'NINGUNA', citations: urls.map((url) => ({ url, title: '' })), webSearches: 1, provider: 'openrouter', requestedModel: 'm', servedModel: 'm', fallbackUsed: false,
  usage: { input: 1, output: 1, cachedInput: 0, costEur, costSource: 'provider' },
});

interface Setup { deps: TickDeps; run: ReturnType<typeof vi.fn>; crawl: ReturnType<typeof vi.fn> }
function setup(over: { llm?: boolean; discover?: boolean; gateway?: (route: string, req: LlmRequest<unknown>) => LlmResult<unknown>; crawl?: (u: string) => CrawlResult; candidates?: SourceCandidate[] } = {}): Setup {
  const run = vi.fn(async (route: string, req: LlmRequest<unknown>) => (over.gateway ? over.gateway(route, req) : route === 'discovery' ? discoveryReply([]) : route === 'enrich.extract' ? ok(EXTRACT((req.messages[0]!.content.match(/<pagina url="([^"]+)"/) ?? [])[1] ?? '')) : ok({ segments: [] as MarketAnalysis['segments'] })));
  const crawl = vi.fn(async (u: string) => (over.crawl ? over.crawl(u) : CRAWL(u)));
  const fetch = vi.fn(async () => ({ candidates: over.candidates ?? [], costEur: 0 }));
  const gateway = { run: run as unknown as TickDeps['gateway']['run'] };
  return {
    run, crawl,
    deps: { pool: t.app, workerId: 'w1', adapters: { osm: { fetch } }, gateway, crawl, userAgent: 'TurnoSalaProspectorBot/1.0', llmEnabled: over.llm ?? true, discoverEnabled: over.discover ?? false, limits: { researchTasks: 10, enrich: 10, discover: 10 }, now: () => AT },
  };
}
const row = async (id: string) => (await t.app.query('select status, enrich_attempts, enrich_error from prospects where id = $1', [id])).rows[0] as { status: string; enrich_attempts: number; enrich_error: string | null };
async function lone(c: SourceCandidate): Promise<string> {
  return (await ingestCandidate(t.app, c)).prospectId as string;
}
/** Aísla cada prueba: solo quedan pendientes las candidatas que ella crea. */
const clean = (): Promise<unknown> => t.admin.query(`update prospects set status = 'archived' where status = 'candidate'`);

describe('tick: investiga y enriquece', () => {
  it('ejecuta el trabajo de investigación y enriquece las candidatas nuevas en el mismo ciclo', async () => {
    await clean();
    const s = setup({ candidates: [cand(), cand()] });
    const { jobId } = await createResearchJob(t.app, { segmentId: SEG, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    const stats = await tick(s.deps);
    expect(stats.research).toMatchObject({ done: 1, failed: 0 });
    expect(stats.enriched).toBe(2);
    expect(((await t.app.query(`select status from research_jobs where id = $1`, [jobId])).rows[0] as { status: string }).status).toBe('done');
    const rows = (await t.app.query(`select status, score from prospects where id in (select prospect_id from prospect_sources where external_id like 't%') and status = 'enriched'`)).rows as Array<{ score: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.score === 25)).toBe(true); // varias_consultas = 25
  });

  it('con el LLM desactivado investiga (sin gasto) pero no enriquece ni atiende análisis, y no llama al modelo ni rastrea', async () => {
    await clean();
    const id = await lone(cand());
    await requestWork(t.app, 'market.analyze', { productId: P1 }, 'm');
    const s = setup({ llm: false, candidates: [cand()] });
    await createResearchJob(t.app, { segmentId: SEG, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    const stats = await tick(s.deps);
    expect(stats.research.done).toBe(1);
    expect(stats.enriched).toBe(0);
    expect(stats.requests).toBe(0);
    expect(s.run).not.toHaveBeenCalled();
    expect(s.crawl).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ status: 'candidate', enrich_attempts: 0 });
  });

  it('una web que no se puede rastrear cuenta un intento y deja el motivo; la ficha sigue candidata para reintentar más tarde', async () => {
    await clean();
    const id = await lone(cand());
    const s = setup({ crawl: () => ({ robots: 'disallow_all', pages: [], skipped: [{ url: 'x', reason: 'robots' }] }) });
    const stats = await tick(s.deps);
    expect(stats.enrichFailed).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'candidate', enrich_attempts: 1, enrich_error: expect.stringContaining('robots') });
  });

  it('fallo del sistema (presupuesto agotado): se para el lote y se DEVUELVEN los intentos; no se queman los reintentos de las fichas', async () => {
    await clean();
    const ids = [await lone(cand()), await lone(cand()), await lone(cand())];
    const s = setup({ gateway: () => fail('budget') as LlmResult<unknown> });
    const stats = await tick(s.deps);
    expect(stats.enriched).toBe(0);
    expect(stats.stoppedBy).toBe('budget');
    expect(s.run).toHaveBeenCalledTimes(1); // no insiste con el resto
    for (const id of ids) expect(await row(id)).toMatchObject({ status: 'candidate', enrich_attempts: 0 });
  });

  it('un fallo propio de la ficha (salida inválida) cuenta el intento y sigue con las demás', async () => {
    await clean();
    const a = await lone(cand());
    const b = await lone(cand());
    let first = true;
    const s = setup({ gateway: (route, req) => { if (first) { first = false; return fail('invalid_output') as LlmResult<unknown>; } return ok(EXTRACT((req.messages[0]!.content.match(/<pagina url="([^"]+)"/) ?? [])[1] ?? '')); } });
    const stats = await tick(s.deps);
    expect(stats.enriched).toBe(1);
    expect(stats.enrichFailed).toBe(1);
    const states = [await row(a), await row(b)];
    expect(states.filter((r) => r.status === 'enriched')).toHaveLength(1);
    expect(states.find((r) => r.status === 'candidate')).toMatchObject({ enrich_attempts: 1, enrich_error: expect.stringContaining('invalid_output') });
  });

  it('cada ciclo marca el latido del worker (para que el panel sepa que está en marcha), incluso con el LLM apagado', async () => {
    await clean();
    await tick(setup({ llm: false }).deps);
    expect(await getWorkerHeartbeat(t.app)).toEqual({ workerId: 'w1', llmEnabled: false, at: AT });
    await tick(setup({ llm: true }).deps);
    expect(await getWorkerHeartbeat(t.app)).toMatchObject({ llmEnabled: true });
  });

  it('respeta el límite de enriquecimientos por ciclo', async () => {
    await clean();
    for (let i = 0; i < 4; i++) await lone(cand());
    const s = setup();
    s.deps.limits.enrich = 2;
    expect((await tick(s.deps)).enriched).toBe(2);
  });

  it('no enriquece fichas bloqueadas ni sin web', async () => {
    await clean();
    const blocked = await lone(cand());
    await t.admin.query(`update prospects set status = 'blocked' where id = $1`, [blocked]);
    const s = setup();
    expect((await tick(s.deps)).enriched).toBe(0);
    expect(s.crawl).not.toHaveBeenCalled();
  });
});

describe('tick: búsqueda de la web de las candidatas (F1.5)', () => {
  const noWeb = async (): Promise<{ id: string; phone: string }> => {
    const c = cand();
    const id = await lone({ ...c, website: undefined });
    return { id, phone: c.phone ?? '' };
  };
  const dRow = async (id: string) => (await t.app.query('select website, discover_attempts, discover_error from prospects where id = $1', [id])).rows[0] as { website: string | null; discover_attempts: number; discover_error: string | null };

  it('encuentra la web, la verifica en código y la candidata se enriquece en el MISMO ciclo', async () => {
    await clean();
    const { id, phone } = await noWeb();
    const site = 'https://hallada-' + id.slice(-6) + '.es/';
    const s = setup({
      discover: true,
      gateway: (route, req) => (route === 'discovery' ? discoveryReply([site]) : ok(EXTRACT((req.messages[0]!.content.match(/<pagina url="([^"]+)"/) ?? [])[1] ?? ''))),
      crawl: (u) => ({ robots: 'allowed', skipped: [], pages: [page(u, 'Tenemos 3 consultas\nLlámanos: ' + phone)] }),
    });
    const stats = await tick(s.deps);
    expect(stats).toMatchObject({ discovered: 1, enriched: 1 });
    expect((await dRow(id)).website).toBe(site);
    expect(((await t.app.query('select status from prospects where id = $1', [id])).rows[0] as { status: string }).status).toBe('enriched');
  });

  it('apagada por defecto: sin DISCOVER_ENABLED no se busca ni se gasta aunque la IA esté encendida', async () => {
    await clean();
    const { id } = await noWeb();
    const s = setup({ discover: false });
    const stats = await tick(s.deps);
    expect(stats.discovered).toBe(0);
    expect(s.run.mock.calls.filter((c) => c[0] === 'discovery')).toHaveLength(0);
    expect((await dRow(id)).discover_attempts).toBe(0);
  });

  it('si no encuentra una web que corresponda, anota el motivo y la deja para reintentar mucho más tarde', async () => {
    await clean();
    const { id } = await noWeb();
    const s = setup({ discover: true, gateway: (route) => (route === 'discovery' ? discoveryReply(['https://otra-cosa.es/']) : ok({})), crawl: (u) => ({ robots: 'allowed', skipped: [], pages: [page(u, 'Fontanería, Madrid')] }) });
    const stats = await tick(s.deps);
    expect(stats).toMatchObject({ discovered: 0, notFound: 1 });
    expect(await dRow(id)).toMatchObject({ website: null, discover_attempts: 1, discover_error: expect.stringContaining('no_match') });
  });

  it('presupuesto diario de búsqueda agotado (D-03: 2 €): ni siquiera reclama fichas, y lo dice', async () => {
    await clean();
    const { id } = await noWeb();
    await t.admin.query("insert into usage_costs (provider, route, units, cost_eur, created_at) values ('llm','discovery','{}',2.5,$1)", [AT]);
    const s = setup({ discover: true });
    const stats = await tick(s.deps);
    expect(stats.stoppedBy).toBe('search_budget');
    expect(s.run.mock.calls.filter((c) => c[0] === 'discovery')).toHaveLength(0);
    expect((await dRow(id)).discover_attempts).toBe(0);
    await t.admin.query("delete from usage_costs where route = 'discovery'");
  });

  it('el gasto de las búsquedas de este ciclo cuenta: al alcanzar el tope se para y se DEVUELVEN los intentos de las fichas sin procesar', async () => {
    await clean();
    const a = await noWeb();
    const b = await noWeb();
    const c = await noWeb();
    const s = setup({ discover: true, gateway: (route) => (route === 'discovery' ? discoveryReply([], 2.5) : ok({})) });
    const stats = await tick(s.deps);
    expect(stats.stoppedBy).toBe('search_budget');
    expect(s.run.mock.calls.filter((x) => x[0] === 'discovery')).toHaveLength(1);
    const attempts = (await Promise.all([a, b, c].map((x) => dRow(x.id)))).map((r) => r.discover_attempts).sort();
    expect(attempts).toEqual([0, 0, 1]);
    await t.admin.query("delete from usage_costs where route = 'discovery'");
  });

  it('fallo del sistema (proveedor deshabilitado): se para y se devuelven los intentos', async () => {
    await clean();
    const { id } = await noWeb();
    const s = setup({ discover: true, gateway: (route) => (route === 'discovery' ? (fail('provider_disabled') as LlmResult<unknown>) : ok({})) });
    const stats = await tick(s.deps);
    expect(stats.stoppedBy).toBe('provider_disabled');
    expect((await dRow(id)).discover_attempts).toBe(0);
  });

  it('respeta el límite de búsquedas por ciclo', async () => {
    await clean();
    for (let i = 0; i < 4; i++) await noWeb();
    const s = setup({ discover: true });
    s.deps.limits.discover = 2;
    await tick(s.deps);
    expect(s.run.mock.calls.filter((x) => x[0] === 'discovery')).toHaveLength(2);
  });
});

describe('tick: peticiones del panel (market.analyze)', () => {
  it('atiende un análisis: si el modelo propone segmentos, la petición queda hecha con el resultado', async () => {
    await clean();
    await t.admin.query(`insert into product_facts (id, product_id, version, status, facts, approved_by, approved_at) values ('00000000-0000-7000-8000-0000000000c1',$1,1,'approved','{"plans":[]}','admin',now()) on conflict do nothing`, [P1]);
    const analysis: MarketAnalysis = { segments: [{ name: 'Clínicas test', vertical: 'salud', description: 'd'.repeat(5), signals: ['varias_consultas'], decision_maker_role: 'Gerente', message: 'm'.repeat(5), best_demo: 'b'.repeat(5), fit_score: 80, fit_reasoning: 'razón suficientemente larga', source_urls: ['https://turnosala.com'], osm_filters: [['healthcare', 'dentist']] }] };
    const s = setup({ gateway: () => ok(analysis) as LlmResult<unknown>, crawl: (u) => CRAWL(u) });
    const id = await requestWork(t.app, 'market.analyze', { productId: P1 }, 'marketing@x.es');
    const stats = await tick(s.deps);
    expect(stats.requests).toBe(1);
    const r = (await t.app.query('select status, result from worker_requests where id = $1', [id])).rows[0] as { status: string; result: { created: number } };
    expect(r).toMatchObject({ status: 'done', result: { created: 1 } });
    expect((await t.app.query(`select status from segments where slug = 'clinicas-test'`)).rows[0]).toMatchObject({ status: 'draft' });
  });

  it('un análisis que no se puede hacer (producto inexistente) queda como fallido con el motivo, no se reintenta en bucle', async () => {
    const s = setup();
    const id = await requestWork(t.app, 'market.analyze', { productId: '00000000-0000-7000-8000-0000000000ff' }, 'm');
    await tick(s.deps);
    expect((await t.app.query('select status, error from worker_requests where id = $1', [id])).rows[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('not_found') });
  });

  it('una petición con carga inválida falla con un error claro', async () => {
    const id = await requestWork(t.app, 'market.analyze', { sinProducto: true }, 'm');
    await tick(setup().deps);
    expect((await t.app.query('select status, error from worker_requests where id = $1', [id])).rows[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('productId') });
  });
});

describe('acquireSingleton y runLoop', () => {
  it('solo una instancia del worker a la vez; al liberar, otra puede tomarlo', async () => {
    const a = await acquireSingleton(t.app);
    expect(a).not.toBeNull();
    expect(await acquireSingleton(t.app)).toBeNull();
    await a!.release();
    const b = await acquireSingleton(t.app);
    expect(b).not.toBeNull();
    await b!.release();
  });

  it('el bucle hace ciclos hasta que se le pide parar y no revienta si un ciclo falla', async () => {
    const ac = new AbortController();
    let calls = 0;
    const errors: string[] = [];
    await runLoop(async () => { calls++; if (calls === 1) throw new Error('boom'); if (calls >= 3) ac.abort(); }, { intervalMs: 1, signal: ac.signal, onError: (e) => errors.push((e as Error).message) });
    expect(calls).toBe(3);
    expect(errors).toEqual(['boom']);
  });
});
