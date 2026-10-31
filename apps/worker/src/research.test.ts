import { claimTask, createResearchJob, createTestDb, getProgress, ingestCandidate, type TestDb } from '@turnosala/db';
import type { SourceCandidate } from '@turnosala/connectors';
import { SourceError } from '@turnosala/connectors';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { processOne, runUntilIdle, type ResearchDeps, type SourceAdapter } from './research.js';

let t: TestDb;
let segmentId: string;
const AT = new Date('2026-11-10T10:00:00Z');

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000),('41038','Dos Hermanas','Sevilla','Andalucía',135000)`);
  await t.admin.query(`update allowed_sources set active = true where id in ('osm')`);
  await t.admin.query(`insert into products (id, slug, name, website) values ('00000000-0000-7000-8000-000000000001','turnosala','TurnoSala','https://turnosala.com')`);
  segmentId = '00000000-0000-7000-8000-000000000002';
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,'00000000-0000-7000-8000-000000000001','c','C','approved','{}')`, [segmentId]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const WORDS = ['Alfa Dental','Bravo Optica','Cedro Fisio','Delta Clinica','Eco Podologia','Faro Centro','Gala Estetica','Hinojo Salud','Iris Vision','Jaral Medico'];
const cands = (prefix: string, n: number): SourceCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ name: `${WORDS[(prefix.charCodeAt(0) + i * 3) % WORDS.length]} ${prefix.toUpperCase()}${i}${'xyz'.repeat(i + 1)}`, website: `https://${prefix}${i}-clinica.es/`, sourceId: 'osm', externalId: `${prefix}${i}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 'osm-1', evidences: [] }));
const deps = (adapter: SourceAdapter): ResearchDeps => ({ pool: t.app, adapters: { osm: adapter }, workerId: 'w1', now: () => AT });
const prospects = async (): Promise<number> => Number(((await t.app.query('select count(*) n from prospects')).rows[0] as { n: string }).n);

describe('processOne / runUntilIdle (REQ-RES-01)', () => {
  it('reclama, consulta la fuente con el límite restante, ingesta los candidatos y cierra la tarea', async () => {
    const fetch = vi.fn(async () => ({ candidates: cands('a', 3), costEur: 0.1 }));
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    expect(await processOne(deps({ fetch }), jobId)).toBe('done');
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ ineCode: '41091', limit: 200 }));
    expect(await getProgress(t.app, jobId)).toMatchObject({ status: 'done', candidates: 3, costEur: 0.1 });
    expect(await processOne(deps({ fetch }), jobId)).toBe('idle');
  });

  it('pasa al adaptador el municipio (nombre y provincia) del código INE de la tarea', async () => {
    const fetch = vi.fn(async () => ({ candidates: [], costEur: 0 }));
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41038'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    await processOne(deps({ fetch }), jobId);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ ineCode: '41038', territory: { name: 'Dos Hermanas', province: 'Sevilla' } }));
  });

  it('pasa al adaptador los filtros de OpenStreetMap definidos en el segmento del trabajo', async () => {
    await t.admin.query(`update segments set definition = $2 where id = $1`, [segmentId, JSON.stringify({ osmFilters: [['healthcare', 'dentist'], ['shop', 'optician']] })]);
    const fetch = vi.fn(async () => ({ candidates: [], costEur: 0 }));
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    await processOne(deps({ fetch }), jobId);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ osmFilters: [['healthcare', 'dentist'], ['shop', 'optician']] }));
  });

  it('no ingesta más candidatos de los que caben en el lote aunque la fuente devuelva de más', async () => {
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, maxCandidates: 4, createdBy: 'm' });
    const before = await prospects();
    await runUntilIdle(deps({ fetch: async () => ({ candidates: cands('b', 10), costEur: 0 }) }), { jobId });
    expect(await prospects()).toBe(before + 4);
    expect(await getProgress(t.app, jobId)).toMatchObject({ candidates: 4, stopReason: 'batch_limit' });
  });

  it('los candidatos fusionados con fichas ya existentes no cuentan como nuevos', async () => {
    const same = cands('c', 2);
    await ingestCandidate(t.app, same[0]!);
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    await runUntilIdle(deps({ fetch: async () => ({ candidates: same, costEur: 0 }) }), { jobId });
    expect((await getProgress(t.app, jobId)).candidates).toBe(1);
  });

  it('corte a mitad: otro worker retoma la tarea y no duplica las fichas ya ingestadas', async () => {
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41038'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    const all = cands('d', 5);
    const dying = (await claimTask(t.app, { workerId: 'muere', now: AT, leaseSeconds: 60, jobId }))!;
    for (const c of all.slice(0, 2)) await ingestCandidate(t.app, c); // ingestó 2 y murió sin cerrar la tarea
    expect(dying.attempts).toBe(1);
    const before = await prospects();
    const later = { ...deps({ fetch: async () => ({ candidates: all, costEur: 0 }) }), now: () => new Date(AT.getTime() + 120_000) };
    expect(await processOne(later, jobId)).toBe('done');
    expect(await prospects()).toBe(before + 3); // solo las 3 que faltaban
    expect((await getProgress(t.app, jobId)).candidates).toBe(3);
  });

  it('un error de la fuente reintenta (hasta 3) y deja el error visible; el coste parcial cuenta', async () => {
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    const fetch = vi.fn(async () => { throw new Error('HTTP 429'); });
    expect(await runUntilIdle(deps({ fetch }), { jobId })).toMatchObject({ failed: 3, done: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await getProgress(t.app, jobId)).toMatchObject({ status: 'failed', errorsBySource: [{ sourceId: 'osm', failed: 1, lastError: 'HTTP 429' }] });
  });

  it('un error de fuente que el adaptador ya reintentó (SourceError) NO se vuelve a reintentar: una sola llamada y tarea fallida', async () => {
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    const fetch = vi.fn(async () => { throw new SourceError('rate_limited', 'Overpass: HTTP 429'); });
    expect(await runUntilIdle(deps({ fetch }), { jobId })).toMatchObject({ failed: 1, done: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await getProgress(t.app, jobId)).toMatchObject({ status: 'failed', errorsBySource: [{ sourceId: 'osm', failed: 1, lastError: 'Overpass: HTTP 429' }] });
  });

  it('sin adaptador para la fuente la tarea falla con un error claro y no se ingesta nada', async () => {
    await t.admin.query(`update allowed_sources set active = true where id = 'corporate_web'`);
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['corporate_web'], budgetEur: 5, createdBy: 'm' });
    await runUntilIdle(deps({ fetch: async () => ({ candidates: [], costEur: 0 }) }), { jobId });
    expect((await getProgress(t.app, jobId)).errorsBySource[0]?.lastError).toMatch(/adaptador/i);
  });

  it('un trabajo en pausa no se procesa', async () => {
    const { jobId } = await createResearchJob(t.app, { segmentId, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 5, createdBy: 'm' });
    await t.app.query(`update research_jobs set status = 'paused' where id = $1`, [jobId]);
    const fetch = vi.fn(async () => ({ candidates: [], costEur: 0 }));
    expect(await processOne(deps({ fetch }), jobId)).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });
});
