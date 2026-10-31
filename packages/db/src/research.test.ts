import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelJob, claimTask, createResearchJob, failTask, finishTask, getProgress, pauseJob, resumeJob } from './research.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
let segmentId: string;
const T0 = new Date('2026-11-10T10:00:00Z');
const plus = (s: number): Date => new Date(T0.getTime() + s * 1000);

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000),('41038','Dos Hermanas','Sevilla','Andalucía',135000),('41004','Alcalá','Sevilla','Andalucía',75000)`);
  await t.admin.query(`update allowed_sources set active = true where id in ('osm','corporate_web')`);
  const productId = uuidv7();
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
  segmentId = uuidv7();
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,'clinicas','Clínicas','approved','{}')`, [segmentId, productId]);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const job = (over: Partial<Parameters<typeof createResearchJob>[1]> = {}) =>
  createResearchJob(t.app, { segmentId, ineCodes: ['41091', '41038'], sourceIds: ['osm', 'corporate_web'], budgetEur: 10, createdBy: 'marketing@x.es', ...over });
const status = async (id: string): Promise<string> => ((await t.app.query('select status from research_jobs where id = $1', [id])).rows[0] as { status: string }).status;

describe('crear un trabajo (REQ-RES-01 CA1/CA2)', () => {
  it('crea una tarea por fuente × municipio, en cola, con lote 200 por defecto', async () => {
    const r = await job();
    expect(r.tasks).toBe(4);
    const j = (await t.app.query('select * from research_jobs where id = $1', [r.jobId])).rows[0] as Record<string, unknown>;
    expect(j).toMatchObject({ status: 'queued', max_candidates: 200, created_by: 'marketing@x.es' });
    expect(Number(j.budget_eur)).toBe(10);
  });

  it('una fuente inactiva se rechaza, no se crea nada y queda registrada (CA1)', async () => {
    const before = Number(((await t.app.query('select count(*) n from research_jobs')).rows[0] as { n: string }).n);
    await expect(job({ sourceIds: ['osm', 'google_places'] })).rejects.toThrow(/google_places/);
    expect(Number(((await t.app.query('select count(*) n from research_jobs')).rows[0] as { n: string }).n)).toBe(before);
    const log = (await t.app.query(`select actor, payload from audit_log where action = 'research.source_rejected'`)).rows[0] as { actor: string; payload: { source: string } };
    expect(log).toMatchObject({ actor: 'marketing@x.es', payload: { source: 'google_places' } });
  });

  it('el lote nunca pasa de 200, el presupuesto debe ser positivo y debe haber fuentes y municipios (CA2)', async () => {
    await expect(job({ maxCandidates: 201 })).rejects.toThrow(/200/);
    await expect(job({ maxCandidates: 0 })).rejects.toThrow();
    await expect(job({ budgetEur: 0 })).rejects.toThrow(/presupuesto/i);
    await expect(job({ sourceIds: [] })).rejects.toThrow();
    await expect(job({ ineCodes: [] })).rejects.toThrow();
  });
});

describe('reclamar tareas: sin duplicados y reanudable (CA3)', () => {
  it('cinco workers a la vez sobre 3 tareas obtienen 3 tareas distintas y 2 nulos', async () => {
    const r = await job({ ineCodes: ['41091', '41038', '41004'], sourceIds: ['osm'] });
    const got = await Promise.all([1, 2, 3, 4, 5].map((i) => claimTask(t.app, { workerId: `w${i}`, now: T0, jobId: r.jobId })));
    const ids = got.filter((g) => g !== null).map((g) => g!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(await status(r.jobId)).toBe('running');
  });

  it('corte: un worker muere con la tarea en curso; al caducar el arrendamiento otro la retoma sin duplicar', async () => {
    const r = await job({ ineCodes: ['41091'], sourceIds: ['osm'] });
    const a = await claimTask(t.app, { workerId: 'muere', now: T0, leaseSeconds: 60, jobId: r.jobId });
    expect(a).toMatchObject({ attempts: 1, ineCode: '41091' });
    expect(await claimTask(t.app, { workerId: 'otro', now: plus(30), jobId: r.jobId })).toBeNull(); // aún dentro del arrendamiento
    const b = await claimTask(t.app, { workerId: 'otro', now: plus(61), jobId: r.jobId });
    expect(b).toMatchObject({ id: a!.id, attempts: 2 });
    await finishTask(t.app, b!.id, { candidates: 3, costEur: 0.5 }, plus(70));
    expect(await status(r.jobId)).toBe('done');
    expect((await getProgress(t.app, r.jobId)).candidates).toBe(3);
  });

  it('una tarea que caduca 3 veces se da por fallida y el trabajo termina (no se reintenta eternamente)', async () => {
    const r = await job({ ineCodes: ['41091'], sourceIds: ['osm'] });
    for (let i = 0; i < 3; i++) expect(await claimTask(t.app, { workerId: 'w', now: plus(i * 1000), leaseSeconds: 10, jobId: r.jobId })).not.toBeNull();
    expect(await claimTask(t.app, { workerId: 'w', now: plus(5000), jobId: r.jobId })).toBeNull();
    expect(await status(r.jobId)).toBe('failed');
  });
});

describe('fallos y reintentos (REQ-RES-03)', () => {
  it('un fallo devuelve la tarea a la cola hasta 3 intentos; al tercero queda fallida con su error y el trabajo continúa con el resto', async () => {
    const r = await job({ ineCodes: ['41091', '41038'], sourceIds: ['osm'] });
    const first = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    for (let i = 1; i <= 3; i++) {
      const c = i === 1 ? first : (await claimTask(t.app, { workerId: 'w', now: plus(i), jobId: r.jobId, taskId: first.id }))!;
      expect(c.id).toBe(first.id);
      await failTask(t.app, c.id, `HTTP 429 (${i})`, plus(i));
    }
    const p = await getProgress(t.app, r.jobId);
    expect(p.tasks).toMatchObject({ failed: 1, pending: 1 });
    expect(p.errorsBySource).toEqual([{ sourceId: 'osm', failed: 1, lastError: 'HTTP 429 (3)' }]);
    const other = (await claimTask(t.app, { workerId: 'w', now: plus(10), jobId: r.jobId }))!;
    await finishTask(t.app, other.id, { candidates: 1, costEur: 0 }, plus(11));
    expect(await status(r.jobId)).toBe('done'); // una tarea hecha ⇒ done aunque otra fallara
  });
});

describe('pausa y cancelación (CA3)', () => {
  it('en pausa no se reclama nada; al reanudar, sí', async () => {
    const r = await job({ ineCodes: ['41091'], sourceIds: ['osm'] });
    await pauseJob(t.app, r.jobId, 'marketing@x.es');
    expect(await status(r.jobId)).toBe('paused');
    expect(await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId })).toBeNull();
    await resumeJob(t.app, r.jobId, 'marketing@x.es');
    expect(await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId })).not.toBeNull();
  });

  it('cancelar salta las tareas pendientes y una tarea en curso que termina después no resucita el trabajo', async () => {
    const r = await job({ ineCodes: ['41091', '41038'], sourceIds: ['osm'] });
    const running = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    await cancelJob(t.app, r.jobId, 'marketing@x.es');
    expect(await status(r.jobId)).toBe('cancelled');
    expect((await getProgress(t.app, r.jobId)).tasks).toMatchObject({ skipped: 1, running: 1 });
    await finishTask(t.app, running.id, { candidates: 2, costEur: 0.1 }, plus(5));
    expect(await status(r.jobId)).toBe('cancelled');
    expect(await claimTask(t.app, { workerId: 'w', now: plus(6), jobId: r.jobId })).toBeNull();
  });

  it('pausar/cancelar quedan en el registro de auditoría', async () => {
    const n = Number(((await t.app.query(`select count(*) n from audit_log where action in ('research.paused','research.resumed','research.cancelled')`)).rows[0] as { n: string }).n);
    expect(n).toBeGreaterThanOrEqual(3);
  });
});

describe('frenos de lote y presupuesto (CA2)', () => {
  it('al llegar al lote se saltan las tareas pendientes y el trabajo termina con motivo batch_limit', async () => {
    const r = await job({ ineCodes: ['41091', '41038', '41004'], sourceIds: ['osm'], maxCandidates: 5 });
    const a = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    expect(a.remainingBatch).toBe(5);
    await finishTask(t.app, a.id, { candidates: 3, costEur: 0 }, plus(1));
    const b = (await claimTask(t.app, { workerId: 'w', now: plus(2), jobId: r.jobId }))!;
    expect(b.remainingBatch).toBe(2);
    await finishTask(t.app, b.id, { candidates: 2, costEur: 0 }, plus(3));
    const p = await getProgress(t.app, r.jobId);
    expect(p).toMatchObject({ status: 'done', candidates: 5, stopReason: 'batch_limit' });
    expect(p.tasks).toMatchObject({ done: 2, skipped: 1 });
    expect(await claimTask(t.app, { workerId: 'w', now: plus(4), jobId: r.jobId })).toBeNull();
  });

  it('al agotar el presupuesto se frena con motivo budget', async () => {
    const r = await job({ ineCodes: ['41091', '41038'], sourceIds: ['osm'], budgetEur: 1 });
    const a = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    await finishTask(t.app, a.id, { candidates: 1, costEur: 1.2 }, plus(1));
    expect(await getProgress(t.app, r.jobId)).toMatchObject({ status: 'done', costEur: 1.2, stopReason: 'budget' });
  });

  it('el coste de una tarea fallida también cuenta contra el presupuesto', async () => {
    const r = await job({ ineCodes: ['41091', '41038'], sourceIds: ['osm'], budgetEur: 1 });
    const a = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    await failTask(t.app, a.id, 'timeout', plus(1), { costEur: 1.5 });
    expect(await getProgress(t.app, r.jobId)).toMatchObject({ costEur: 1.5, stopReason: 'budget' });
  });
});

describe('progreso para el panel (CA4)', () => {
  it('devuelve estado, tareas por estado, candidatos y coste', async () => {
    const r = await job({ ineCodes: ['41091', '41038'], sourceIds: ['osm', 'corporate_web'] });
    const a = (await claimTask(t.app, { workerId: 'w', now: T0, jobId: r.jobId }))!;
    await finishTask(t.app, a.id, { candidates: 4, costEur: 0.25 }, plus(1));
    expect(await getProgress(t.app, r.jobId)).toMatchObject({ status: 'running', tasks: { done: 1, pending: 3 }, candidates: 4, costEur: 0.25, maxCandidates: 200, budgetEur: 10 });
  });
});
