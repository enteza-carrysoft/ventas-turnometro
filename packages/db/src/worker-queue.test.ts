import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCandidate } from './ingest.js';
import { claimEnrichable, claimRequest, enrichBacklog, failRequest, finishRequest, listRequests, recordEnrichFailure, requestWork, unclaimEnrichable } from './worker-queue.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
const T0 = new Date('2026-11-10T10:00:00Z');
const plusH = (h: number): Date => new Date(T0.getTime() + h * 3600_000);
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
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
async function candidate(website: string | null = 'auto'): Promise<string> {
  n++;
  const r = await ingestCandidate(t.app, { name: `${word(n)} ${word(n * 17 + 3)} S.L.`, ...(website ? { website: website === 'auto' ? `https://cand-${n}.es/` : website } : {}), phone: `955 4${String(n).padStart(2, '0')} 0${String(n).padStart(2, '0')}`, sourceId: 'osm', externalId: `c${n}`, sourceUrl: 'https://osm.example/', fetchedAt: T0, extractorVersion: 't', evidences: [] });
  return r.prospectId as string;
}
const row = async (id: string) => (await t.app.query('select status, enrich_attempts, enrich_next_at, enrich_error from prospects where id = $1', [id])).rows[0] as { status: string; enrich_attempts: number; enrich_next_at: Date | null; enrich_error: string | null };

describe('claimEnrichable (cola de enriquecimiento)', () => {
  it('reclama candidatas con web, cuenta el intento y programa el siguiente con espera creciente (1 h, 6 h, 24 h)', async () => {
    const id = await candidate();
    expect(await claimEnrichable(t.app, { limit: 50, now: T0 })).toContain(id);
    expect(await row(id)).toMatchObject({ enrich_attempts: 1, enrich_next_at: plusH(1) });
    expect(await claimEnrichable(t.app, { limit: 50, now: plusH(0.5) })).not.toContain(id); // aún no toca
    expect(await claimEnrichable(t.app, { limit: 50, now: plusH(1) })).toContain(id);
    expect(await row(id)).toMatchObject({ enrich_attempts: 2, enrich_next_at: plusH(7) });
    expect(await claimEnrichable(t.app, { limit: 50, now: plusH(7) })).toContain(id);
    expect(await row(id)).toMatchObject({ enrich_attempts: 3, enrich_next_at: plusH(31) });
  });

  it('tras 3 intentos no se reclama más (queda como fallida para el panel)', async () => {
    const id = await candidate();
    for (const h of [0, 1, 7]) await claimEnrichable(t.app, { limit: 500, now: plusH(h) });
    expect(await claimEnrichable(t.app, { limit: 500, now: plusH(500) })).not.toContain(id);
    expect((await enrichBacklog(t.app)).failed).toBeGreaterThanOrEqual(1);
  });

  it('no reclama sin web, ni fichas que ya no son candidatas (enriquecidas, bloqueadas, descartadas)', async () => {
    const noWeb = await candidate(null);
    const enriched = await candidate();
    const blocked = await candidate();
    await t.admin.query(`update prospects set status = 'enriched' where id = $1`, [enriched]);
    await t.admin.query(`update prospects set status = 'blocked' where id = $1`, [blocked]);
    const got = await claimEnrichable(t.app, { limit: 500, now: plusH(1000) });
    for (const id of [noWeb, enriched, blocked]) expect(got).not.toContain(id);
  });

  it('respeta el límite y dos reclamos simultáneos no se llevan la misma ficha', async () => {
    for (let i = 0; i < 6; i++) await candidate();
    const [a, b] = await Promise.all([claimEnrichable(t.app, { limit: 3, now: plusH(2000) }), claimEnrichable(t.app, { limit: 3, now: plusH(2000) })]);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(b.length).toBeLessThanOrEqual(3);
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });

  it('unclaimEnrichable devuelve el intento (fallo del sistema, no de la ficha) y la deja disponible al instante', async () => {
    const id = await candidate();
    await claimEnrichable(t.app, { limit: 500, now: plusH(3000) });
    expect(await row(id)).toMatchObject({ enrich_attempts: 1 });
    await unclaimEnrichable(t.app, [id]);
    expect(await row(id)).toMatchObject({ enrich_attempts: 0, enrich_next_at: null });
    expect(await claimEnrichable(t.app, { limit: 500, now: plusH(3000) })).toContain(id);
    await unclaimEnrichable(t.app, []); // sin ids no hace nada
  });

  it('recordEnrichFailure guarda el motivo (recortado) para mostrarlo', async () => {
    const id = await candidate();
    await recordEnrichFailure(t.app, id, 'x'.repeat(900));
    expect((await row(id)).enrich_error).toHaveLength(300);
  });
});

describe('peticiones al worker', () => {
  it('se encolan, se reclaman una a una por orden y se cierran con resultado', async () => {
    const a = await requestWork(t.app, 'market.analyze', { productId: 'p1' }, 'marketing@x.es');
    const b = await requestWork(t.app, 'market.analyze', { productId: 'p2' }, 'marketing@x.es');
    const c1 = (await claimRequest(t.app, { now: T0 }))!;
    expect(c1).toMatchObject({ id: a, kind: 'market.analyze', payload: { productId: 'p1' }, attempts: 1 });
    expect((await claimRequest(t.app, { now: T0 }))!.id).toBe(b);
    expect(await claimRequest(t.app, { now: T0 })).toBeNull();
    await finishRequest(t.app, a, { created: 2 }, T0);
    await finishRequest(t.app, b, {}, T0);
    expect((await listRequests(t.app, 'market.analyze', 10)).find((r) => r.id === a)).toMatchObject({ status: 'done', result: { created: 2 }, requestedBy: 'marketing@x.es' });
  });

  it('si el worker muere, la petición se retoma al caducar el arrendamiento; tras 3 intentos se da por fallida', async () => {
    const id = await requestWork(t.app, 'market.analyze', {}, 'm');
    const at = (s: number): Date => new Date(T0.getTime() + s * 1000);
    expect((await claimRequest(t.app, { now: at(0), leaseSeconds: 60 }))!.id).toBe(id);
    expect(await claimRequest(t.app, { now: at(30), leaseSeconds: 60 })).toBeNull(); // aún dentro del arrendamiento
    expect(await claimRequest(t.app, { now: at(61), leaseSeconds: 60 })).toMatchObject({ id, attempts: 2 });
    expect(await claimRequest(t.app, { now: at(200), leaseSeconds: 60 })).toMatchObject({ id, attempts: 3 });
    expect(await claimRequest(t.app, { now: at(400), leaseSeconds: 60 })).toBeNull();
    expect((await t.app.query('select status, attempts from worker_requests where id = $1', [id])).rows[0]).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('failRequest guarda el error y finishRequest no resucita una petición que ya no está en curso', async () => {
    const id = await requestWork(t.app, 'market.analyze', {}, 'm');
    await claimRequest(t.app, { now: T0 });
    await failRequest(t.app, id, 'sin hechos aprobados', T0);
    expect((await listRequests(t.app, 'market.analyze', 50)).find((r) => r.id === id)).toMatchObject({ status: 'failed', error: 'sin hechos aprobados' });
    expect(await finishRequest(t.app, id, { x: 1 }, T0)).toEqual({ applied: false });
  });

  it('solo se aceptan tipos conocidos', async () => {
    await expect(requestWork(t.app, 'otra.cosa' as never, {}, 'm')).rejects.toThrow();
  });
});
