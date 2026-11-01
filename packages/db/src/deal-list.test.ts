import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clampLimit, dealTotals, listDeals, type DealFilters } from './deal-list.js';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

// F2.4a — consulta del pipeline: filtros (comercial, etapa, segmento, provincia, campaña, siguiente tarea) y totales por etapa.
let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;
const productId = uuidv7();
const seg = { a: uuidv7(), b: uuidv7() };
const camp = uuidv7();
const V = (userId: string) => ({ userId });

beforeAll(async () => {
  t = await createTestDb();
  for (const id of ['u-admin', 'u-s1', 'u-s2', 'u-mkt', 'u-aud', 'u-voice', 'u-none']) await t.admin.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$2,$1 || '@x.test',true)`, [id, `Nombre ${id}`]);
  await t.admin.query(`insert into app_user_roles (user_id, role) values ('u-admin','admin'),('u-s1','sales'),('u-s2','sales'),('u-mkt','marketing'),('u-aud','auditor'),('u-voice','voice')`);
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$3,'clinicas','Clínicas','approved','{}'),($2,$3,'gestorias','Gestorías','approved','{}')`, [seg.a, seg.b, productId]);
  await t.admin.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000),('29067','Málaga','Málaga','Andalucía',580000)`);
  await t.admin.query(`insert into campaigns (id, product_id, segment_id, name, wave, territory_filter, sequence, budget_eur, status, utm) values ($1,$2,$3,'Carta Sevilla 1','w1','{}','[]',100,'draft','{}')`, [camp, productId, seg.a]);
}, 60_000);
afterAll(async () => { await t.drop(); });

interface Spec { owner?: string | null; stage?: string; segment?: string; ine?: string; campaign?: string; est?: number; score?: number; taskDays?: number; name?: string }
async function deal(s: Spec = {}) {
  n++;
  const e = await ingestCandidate(t.app, { name: s.name ?? `Empresa Lista ${'qwxz'.repeat(n)} S.L.`, website: `https://lista${n}web.es/`, sourceId: 'osm', externalId: `dl${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const pid = e.prospectId as string;
  await t.admin.query(`update prospects set status = 'approved', segment_id = $2, ine_code = $3, score = $4, tier = 'warm' where id = $1`, [pid, s.segment ?? seg.a, s.ine ?? '41091', s.score ?? 50]);
  const id = uuidv7();
  const stage = s.stage ?? 'interested';
  const closed = stage === 'won' || stage === 'lost';
  await t.admin.query(
    `insert into deals (id, prospect_id, stage_id, owner_user_id, campaign_id, est_value_eur, created_by, closed_at, lost_reason_id) values ($1,$2,$3,$4,$5,$6,'t',$7,$8)`,
    [id, pid, stage, s.owner === undefined ? 'u-s1' : s.owner, s.campaign ?? null, s.est ?? 828, closed ? AT : null, stage === 'lost' ? 'no_interest' : null]);
  if (s.taskDays !== undefined) {
    await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'call','Llamar','u-s1',$4,'t')`, [uuidv7(), pid, id, new Date(AT.getTime() + s.taskDays * 86400_000)]);
  }
  return { id, pid, name: s.name };
}
const ids = async (f: DealFilters = {}, viewer = 'u-admin'): Promise<string[]> => {
  const r = await listDeals(t.app, V(viewer), f);
  if (!r) throw new Error('prohibido');
  return r.map((d) => d.id);
};

describe('listDeals: quién puede ver el pipeline', () => {
  it('admin, comercial, marketing y auditor lo ven; voz y sin rol, no (null)', async () => {
    await deal();
    for (const u of ['u-admin', 'u-s1', 'u-mkt', 'u-aud']) expect(await listDeals(t.app, V(u), {}), u).not.toBeNull();
    for (const u of ['u-voice', 'u-none', 'u-inexistente']) expect(await listDeals(t.app, V(u), {}), u).toBeNull();
    expect(await dealTotals(t.app, V('u-voice'), {})).toBeNull();
  });
});

describe('listDeals: contenido', () => {
  it('trae ficha, municipio, provincia, segmento, campaña, comercial, importe, probabilidad de la etapa y la SIGUIENTE tarea abierta', async () => {
    const d = await deal({ owner: 'u-s1', campaign: camp, est: 828, score: 77, taskDays: 3, name: 'Clínica Contenido Única S.L.' });
    await t.admin.query(`insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'email','Más tarde','u-s1',$4,'t'), ($5,$2,$3,'call','Cancelada','u-s1',$6,'t')`, [uuidv7(), d.pid, d.id, new Date(AT.getTime() + 9 * 86400_000), uuidv7(), new Date(AT.getTime() + 1 * 86400_000)]);
    await t.admin.query(`update tasks set status = 'cancelled' where title = 'Cancelada'`);
    const row = (await listDeals(t.app, V('u-admin'), { search: 'Contenido Única' }))!.find((x) => x.id === d.id)!;
    expect(row).toMatchObject({
      prospectName: 'Clínica Contenido Única S.L.', municipality: 'Sevilla', province: 'Sevilla', segmentName: 'Clínicas', campaignName: 'Carta Sevilla 1',
      stageId: 'interested', stageName: 'Interesado', probability: 15, ownerUserId: 'u-s1', ownerName: 'Nombre u-s1', estValueEur: 828, score: 77, nextTaskTitle: 'Llamar',
    });
    expect(row.nextTaskDueAt).toEqual(new Date(AT.getTime() + 3 * 86400_000)); // la más próxima abierta: ni la lejana ni la cancelada
  });
});

describe('listDeals: filtros', () => {
  it('por defecto solo abiertas; «closed» y «all» amplían', async () => {
    const open = await deal({ name: 'Abierta Filtro Estado S.L.' });
    const won = await deal({ stage: 'won', name: 'Ganada Filtro Estado S.L.' });
    const lost = await deal({ stage: 'lost', name: 'Perdida Filtro Estado S.L.' });
    const mine = (r: string[]) => [open.id, won.id, lost.id].filter((x) => r.includes(x));
    expect(mine(await ids({ search: 'Filtro Estado' }))).toEqual([open.id]);
    expect(mine(await ids({ search: 'Filtro Estado', status: 'closed' })).sort()).toEqual([won.id, lost.id].sort());
    expect(mine(await ids({ search: 'Filtro Estado', status: 'all' })).sort()).toEqual([open.id, won.id, lost.id].sort());
  });

  it('por comercial: «me», «unassigned» y un usuario concreto', async () => {
    const a = await deal({ owner: 'u-s2', name: 'De Dos Filtro Comercial S.L.' });
    const b = await deal({ owner: null, name: 'Sin Dueño Filtro Comercial S.L.' });
    const c = await deal({ owner: 'u-s1', name: 'De Uno Filtro Comercial S.L.' });
    const base = { search: 'Filtro Comercial' };
    expect((await ids({ ...base, owner: 'me' }, 'u-s2'))).toEqual([a.id]);
    expect((await ids({ ...base, owner: 'unassigned' }))).toEqual([b.id]);
    expect((await ids({ ...base, owner: 'u-s1' }))).toEqual([c.id]);
    expect((await ids(base)).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('por etapa, segmento, provincia y campaña', async () => {
    const a = await deal({ stage: 'trial', segment: seg.b, ine: '29067', campaign: camp, name: 'Combinada Filtro Mixto S.L.' });
    const b = await deal({ stage: 'new', segment: seg.a, ine: '41091', name: 'Otra Filtro Mixto S.L.' });
    const base = { search: 'Filtro Mixto' };
    expect(await ids({ ...base, stage: 'trial' })).toEqual([a.id]);
    expect(await ids({ ...base, segmentId: seg.b })).toEqual([a.id]);
    expect(await ids({ ...base, province: 'Málaga' })).toEqual([a.id]);
    expect(await ids({ ...base, campaignId: camp })).toEqual([a.id]);
    expect(await ids({ ...base, province: 'Sevilla' })).toEqual([b.id]);
    expect(await ids({ ...base, stage: 'trial', province: 'Sevilla' })).toEqual([]);
  });

  it('por fecha de la siguiente tarea (desde/hasta) y «sin tarea»', async () => {
    const soon = await deal({ taskDays: 1, name: 'Pronto Filtro Tarea S.L.' });
    const later = await deal({ taskDays: 20, name: 'Tarde Filtro Tarea S.L.' });
    const none = await deal({ name: 'Nada Filtro Tarea S.L.' });
    const base = { search: 'Filtro Tarea' };
    expect(await ids({ ...base, nextTaskTo: new Date(AT.getTime() + 5 * 86400_000) })).toEqual([soon.id]);
    expect(await ids({ ...base, nextTaskFrom: new Date(AT.getTime() + 10 * 86400_000) })).toEqual([later.id]);
    expect(await ids({ ...base, noTask: true })).toEqual([none.id]);
  });

  it('la búsqueda por nombre no admite inyección ni comodines', async () => {
    await deal({ name: 'Segura Filtro Búsqueda S.L.' });
    expect(await ids({ search: "'; drop table deals;--" })).toEqual([]);
    expect((await ids({ search: '%' })).length).toBe(0); // «%» es un carácter literal, no un comodín
    expect((await t.admin.query('select count(*)::int n from deals')).rows[0].n).toBeGreaterThan(0);
  });

  it('un filtro con un identificador mal formado no rompe la consulta: no devuelve nada', async () => {
    await deal();
    expect(await ids({ segmentId: 'no-es-uuid' })).toEqual([]);
    expect(await ids({ campaignId: 'no-es-uuid' })).toEqual([]);
    expect(await ids({ stage: 'inventada' })).toEqual([]);
  });

  it('respeta el límite pedido y nunca devuelve más de 500', async () => {
    await deal(); await deal(); await deal();
    expect((await ids({ limit: 2 })).length).toBe(2);
    expect((await ids({ limit: 100000 })).length).toBeLessThanOrEqual(500);
  });
});

describe('clampLimit', () => {
  it('por defecto 300; nunca menos de 1 ni más de 500; lo que no es un número usa el valor por defecto', () => {
    expect(clampLimit(undefined)).toBe(300);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(500)).toBe(500);
    expect(clampLimit(501)).toBe(500);
    expect(clampLimit(1_000_000)).toBe(500);
    expect(clampLimit(0)).toBe(300);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(Number.NaN)).toBe(300);
    expect(clampLimit(12.9)).toBe(12);
  });
});

describe('dealTotals', () => {
  it('por etapa: nº, importe y ponderado por probabilidad; las etapas sin nada salen a cero y en orden', async () => {
    const x = 'Totales Filtro Suma S.L.';
    await deal({ stage: 'interested', est: 1000, name: `A ${x}` });
    await deal({ stage: 'interested', est: 500, name: `B ${x}` });
    await deal({ stage: 'trial', est: 1000, name: `C ${x}` });
    await deal({ stage: 'trial', est: 0, name: `D ${x}` });
    const tot = (await dealTotals(t.app, V('u-admin'), { search: 'Totales Filtro Suma' }))!;
    expect(tot.map((r) => r.stageId)).toEqual(['new', 'interested', 'demo_booked', 'demo_held', 'trial', 'won', 'lost']);
    const by = Object.fromEntries(tot.map((r) => [r.stageId, r]));
    expect(by.interested).toMatchObject({ count: 2, valueEur: 1500, weightedEur: 225 }); // 1500 × 15 %
    expect(by.trial).toMatchObject({ count: 2, valueEur: 1000, weightedEur: 700 }); // 1000 × 70 %
    expect(by.new).toMatchObject({ count: 0, valueEur: 0, weightedEur: 0 });
    expect(by.won!.count + by.lost!.count).toBe(0); // por defecto solo abiertas
  });

  it('los totales respetan los mismos filtros que la lista, salvo el de etapa', async () => {
    await deal({ owner: 'u-s2', stage: 'new', name: 'Z1 Totales Filtro Dueño S.L.' });
    await deal({ owner: 'u-s1', stage: 'trial', name: 'Z2 Totales Filtro Dueño S.L.' });
    const tot = (await dealTotals(t.app, V('u-admin'), { search: 'Totales Filtro Dueño', owner: 'u-s2', stage: 'trial' }))!;
    const by = Object.fromEntries(tot.map((r) => [r.stageId, r.count]));
    expect(by.new).toBe(1);
    expect(by.trial).toBe(0);
  });
});
