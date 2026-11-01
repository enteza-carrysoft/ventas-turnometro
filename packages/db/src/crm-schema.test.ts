import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ('u-sales','Vera','vera@x.test',true), ('u-sales2','Pau','pau@x.test',true)`);
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
async function prospect(): Promise<string> {
  n++;
  const r = await ingestCandidate(t.app, { name: `${word(n + 70)} ${word(n * 5 + 2)} S.L.`, website: `https://crm-${n}.es/`, phone: `955 8${String(n).padStart(2, '0')} 0${String(n).padStart(2, '0')}`, sourceId: 'osm', externalId: `m${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
  return r.prospectId as string;
}
const deal = (prospectId: string, over: Record<string, unknown> = {}): Promise<unknown> => {
  const v = { id: uuidv7(), stage: 'new', closed: null as string | null, reason: null as string | null, owner: null as string | null, value: 828, ...over };
  return t.app.query(
    `insert into deals (id, prospect_id, stage_id, closed_at, lost_reason_id, owner_user_id, est_value_eur) values ($1,$2,$3,$4,$5,$6,$7)`,
    [v.id, prospectId, v.stage, v.closed, v.reason, v.owner, v.value]);
};
const fails = async (p: Promise<unknown>, re: RegExp): Promise<void> => {
  await expect(p).rejects.toThrow(re);
};

describe('F2.0 datos sembrados', () => {
  it('etapas por defecto (REQ-CRM-01 CA2): orden, probabilidad y cierres', async () => {
    const rows = (await t.app.query('select id, name, sort, probability, is_won, is_lost from deal_stages order by sort')).rows;
    expect(rows.map((r) => [r.id, r.name, r.probability, r.is_won, r.is_lost])).toEqual([
      ['new', 'Nuevo', 5, false, false], ['interested', 'Interesado', 15, false, false], ['demo_booked', 'Demo reservada', 30, false, false],
      ['demo_held', 'Demo realizada', 50, false, false], ['trial', 'Prueba activa', 70, false, false], ['won', 'Ganado', 100, true, false], ['lost', 'Perdido', 0, false, true],
    ]);
  });

  it('motivos de pérdida: solo «Oposición / no contactar» aplica la oposición (REQ-CRM-05)', async () => {
    const rows = (await t.app.query('select id, applies_opposition from lost_reasons order by id')).rows;
    expect(rows.map((r) => r.id)).toEqual(['competitor', 'no_budget', 'no_interest', 'no_response', 'not_target', 'opposition', 'other']);
    expect(rows.filter((r) => r.applies_opposition).map((r) => r.id)).toEqual(['opposition']);
  });

  it('una etapa no puede ser a la vez ganada y perdida, ni tener una probabilidad fuera de 0–100', async () => {
    await fails(t.app.query(`insert into deal_stages (id, name, sort, probability, is_won, is_lost) values ('x','X',99,10,true,true)`), /check/i);
    await fails(t.app.query(`insert into deal_stages (id, name, sort, probability) values ('y','Y',98,101)`), /check/i);
  });
});

describe('F2.0 oportunidades (REQ-CRM-01 CA1)', () => {
  it('una ficha tiene como máximo UNA oportunidad abierta, aunque se intente a la vez', async () => {
    const p = await prospect();
    await deal(p);
    await fails(deal(p, { stage: 'interested' }), /duplicate|unique|one_open_deal/i);
    const p2 = await prospect();
    const results = await Promise.allSettled([deal(p2), deal(p2), deal(p2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('cerrada la anterior, la ficha puede tener otra oportunidad abierta', async () => {
    const p = await prospect();
    await deal(p, { stage: 'won', closed: AT.toISOString() });
    await deal(p);
    expect(Number(((await t.app.query('select count(*) n from deals where prospect_id = $1', [p])).rows[0] as { n: string }).n)).toBe(2);
  });

  it('coherencia del cierre: una etapa cerrada exige fecha de cierre y una abierta no puede tenerla', async () => {
    const p = await prospect();
    await fails(deal(p, { stage: 'won' }), /check/i);
    await fails(deal(p, { stage: 'new', closed: AT.toISOString() }), /check/i);
  });

  it('perdida exige motivo; el motivo y la etapa deben existir', async () => {
    const p = await prospect();
    await fails(deal(p, { stage: 'lost', closed: AT.toISOString() }), /check/i);
    await deal(p, { stage: 'lost', closed: AT.toISOString(), reason: 'no_interest' });
    const q = await prospect();
    await fails(deal(q, { stage: 'etapa_inventada' }), /foreign key|violates/i);
    await fails(deal(q, { stage: 'lost', closed: AT.toISOString(), reason: 'motivo_inventado' }), /foreign key|violates/i);
  });

  it('el propietario debe ser un usuario real; el importe no puede ser negativo', async () => {
    const p = await prospect();
    await fails(deal(p, { owner: 'nadie' }), /foreign key|violates/i);
    await fails(deal(p, { value: -1 }), /check/i);
    await deal(p, { owner: 'u-sales' });
  });
});

describe('F2.0 tareas y notas', () => {
  const task = (over: Record<string, unknown>): Promise<unknown> => {
    const v = { id: uuidv7(), prospect: null as string | null, deal: null as string | null, kind: 'call', assignee: 'u-sales', status: 'open', done: null as string | null, ...over };
    return t.app.query(
      `insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, status, done_at, created_by) values ($1,$2,$3,$4,'Llamar',$5,$6,$7,$8,'u-sales')`,
      [v.id, v.prospect, v.deal, v.kind, v.assignee, AT, v.status, v.done]);
  };

  it('una tarea cuelga de una ficha o de una oportunidad (al menos una)', async () => {
    const p = await prospect();
    await task({ prospect: p });
    await fails(task({}), /check/i);
  });

  it('tipo y estado válidos; «hecha» exige fecha de realización y las demás no la llevan', async () => {
    const p = await prospect();
    await fails(task({ prospect: p, kind: 'telepatia' }), /check/i);
    await fails(task({ prospect: p, status: 'done' }), /check/i);
    await fails(task({ prospect: p, status: 'open', done: AT.toISOString() }), /check/i);
    await task({ prospect: p, status: 'done', done: AT.toISOString() });
  });

  it('el responsable debe ser un usuario real', async () => {
    const p = await prospect();
    await fails(task({ prospect: p, assignee: 'fantasma' }), /foreign key|violates/i);
  });

  it('una nota no puede estar vacía ni pasar de 4000 caracteres, y exige ficha y autor real', async () => {
    const p = await prospect();
    const note = (body: string, author = 'u-sales') => t.app.query(`insert into notes (id, prospect_id, body, author_user_id) values ($1,$2,$3,$4)`, [uuidv7(), p, body, author]);
    await note('Habló con recepción; pide llamar el lunes.');
    await fails(note('   '), /check/i);
    await fails(note('x'.repeat(4001)), /check/i);
    await fails(note('ok', 'fantasma'), /foreign key|violates/i);
  });
});

describe('F2.0 demos ↔ oportunidades', () => {
  it('demos.deal_id es una clave foránea real (la FK que F0 dejó pendiente)', async () => {
    const p = await prospect();
    const dealId = uuidv7();
    await deal(p, { id: dealId });
    // horas distintas y fijas: la tabla impide solapar demos del mismo comercial
    const demo = (deal_id: string | null, hour: number) => t.app.query(
      `insert into demos (id, prospect_id, deal_id, host_user_id, starts_at, ends_at, booked_via, requester_name, requester_email, status, manage_token)
       values ($1,$2,$3,'u-sales',$4,$5,'form','Ana','ana@x.es','booked',$6)`,
      [uuidv7(), p, deal_id, new Date(AT.getTime() + hour * 3_600_000), new Date(AT.getTime() + hour * 3_600_000 + 20 * 60_000), uuidv7()]);
    await demo(dealId, 1);
    await demo(null, 2);
    await fails(demo(uuidv7(), 3), /foreign key|violates/i);
  });
});
