import type { LlmRequest, LlmResult } from '@turnosala/ai';
import type { CrawlResult } from '@turnosala/connectors';
import type { MarketAnalysis } from '@turnosala/core';
import { createTestDb, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeMarket, type AnalyzeDeps } from './analyze.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
const U1 = 'https://turnosala.com/';
const U2 = 'https://turnosala.com/clinicas';
const P1 = '00000000-0000-7000-8000-0000000000a1';
const P2 = '00000000-0000-7000-8000-0000000000a2';

beforeAll(async () => {
  t = await createTestDb();
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com'), ($2,'sinfacts','Sin hechos','https://sinfacts.example')`, [P1, P2]);
  await t.admin.query(`insert into product_facts (id, product_id, version, status, facts, approved_by, approved_at) values ('00000000-0000-7000-8000-0000000000b1',$1,1,'approved',$2,'admin',now())`, [P1, JSON.stringify({ plans: [{ id: 'starter', priceEurExVat: 24 }] })]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const page = (url: string, text: string) => ({ url, finalUrl: url, status: 200, title: '', text, links: [], category: 'home' as const, fetchedAt: AT });
const CRAWL: CrawlResult = { robots: 'allowed', skipped: [], pages: [page(U1, 'Gestión de turnos para clínicas y ópticas'), page(U2, 'Clínicas dentales con varias consultas')] };
const seg = (over: Record<string, unknown> = {}) => ({
  name: 'Clínicas dentales', vertical: 'salud', description: 'Clínicas con varias consultas', signals: ['varias_consultas'], decision_maker_role: 'Gerente', message: 'Menos esperas',
  best_demo: 'Pantalla en sala', fit_score: 80, fit_reasoning: 'Varias consultas simultáneas con sala de espera.', source_urls: [U2], osm_filters: [{ key: 'healthcare', value: 'dentist' }], ...over,
});
const ok = <T>(data: T): LlmResult<T> => ({ status: 'ok', data, provider: 'openrouter', requestedModel: 'm', servedModel: 'm', fallbackUsed: false, usage: { input: 1, output: 1, cachedInput: 0, costEur: 0.3, costSource: 'provider' } });
const fail = (reason: string): LlmResult<MarketAnalysis> => ({ status: 'error', reason: reason as never, provider: null, requestedModel: null, servedModel: null, fallbackUsed: false, usage: { input: 0, output: 0, cachedInput: 0, costEur: 0, costSource: 'unknown' } });

function setup(result: LlmResult<unknown>, crawl: CrawlResult = CRAWL) {
  const run = vi.fn((...a: [string, LlmRequest<unknown>]) => Promise.resolve(a.length ? result : result));
  const crawlFn = vi.fn(async () => crawl);
  const deps: AnalyzeDeps = { pool: t.app, gateway: { run: run as unknown as AnalyzeDeps['gateway']['run'] }, crawl: crawlFn, userAgent: 'TurnoSalaProspectorBot/1.0', actor: 'system:market.analyze' };
  return { deps, run, crawlFn };
}
const count = async (sql: string): Promise<number> => Number(((await t.app.query(sql)).rows[0] as { n: string }).n);

describe('analyzeMarket (REQ-MKT-02)', () => {
  it('rastrea la web del producto, pide segmentos al modelo con los hechos aprobados y los guarda en borrador', async () => {
    const { deps, run, crawlFn } = setup(ok({ segments: [seg()] }));
    const r = await analyzeMarket(deps, P1);
    expect(r).toMatchObject({ status: 'analyzed', created: 1, rejected: [], costEur: 0.3 });
    expect(crawlFn).toHaveBeenCalledWith('https://turnosala.com', expect.objectContaining({ userAgent: 'TurnoSalaProspectorBot/1.0' }));
    expect(run.mock.calls[0]?.[0]).toBe('market.analyze');
    expect(run.mock.calls[0]?.[1].messages[0]?.content).toContain('"priceEurExVat":24');
    expect((await t.app.query(`select status, definition from segments where slug = 'clinicas-dentales'`)).rows[0]).toMatchObject({ status: 'draft', definition: { fit: { provenance: 'inferred' } } });
  });

  it('el modelo cita una URL que no se consultó: el segmento se rechaza y no se guarda', async () => {
    const { deps } = setup(ok({ segments: [seg({ name: 'Ópticas', source_urls: ['https://inventada.es/'] })] }));
    const before = await count('select count(*) n from segments');
    expect(await analyzeMarket(deps, P1)).toMatchObject({ status: 'analyzed', created: 0, rejected: [{ name: 'Ópticas', reason: 'no_valid_source' }] });
    expect(await count('select count(*) n from segments')).toBe(before);
  });

  it('si el modelo falla (salida inválida, presupuesto...) no se crea ningún segmento', async () => {
    const before = await count('select count(*) n from segments');
    expect(await analyzeMarket(setup(fail('invalid_output')).deps, P1)).toMatchObject({ status: 'llm_failed', reason: 'invalid_output' });
    expect(await count('select count(*) n from segments')).toBe(before);
  });

  it('sin hechos aprobados del producto no se llama al modelo (no se afirman cosas sin respaldo)', async () => {
    const { deps, run } = setup(ok({ segments: [seg()] }));
    expect(await analyzeMarket(deps, P2)).toMatchObject({ status: 'no_approved_facts' });
    expect(run).not.toHaveBeenCalled();
  });

  it('producto inexistente o web no rastreable: se informa y no se llama al modelo', async () => {
    const a = setup(ok({ segments: [seg()] }));
    expect(await analyzeMarket(a.deps, '00000000-0000-7000-8000-0000000000ff')).toMatchObject({ status: 'not_found' });
    const b = setup(ok({ segments: [seg()] }), { robots: 'disallow_all', pages: [], skipped: [{ url: U1, reason: 'robots' }] });
    expect(await analyzeMarket(b.deps, P1)).toMatchObject({ status: 'no_pages' });
    expect(b.run).not.toHaveBeenCalled();
  });
});
