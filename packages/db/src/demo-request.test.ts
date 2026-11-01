import { readFileSync } from 'node:fs';
import type { DemoRequestData } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentConsentTexts, type ConsentBox, type ConsentTextRow } from './consent-texts.js';
import { submitDemoRequest, type SubmitInput } from './demo-request.js';
import { ingestCandidate } from './ingest.js';
import { createPublicToken, resolvePublicToken } from './tokens.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';
import { applyOpposition } from './opposition.js';

let t: TestDb;
let texts: Record<ConsentBox, ConsentTextRow>;
const AT = new Date('2026-11-10T10:00:00Z');
const URL1 = 'https://go.example.test/demo/clinicas';
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  const productId = uuidv7();
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
  const facts = readFileSync(new URL('../seeds/product-facts.v1.json', import.meta.url), 'utf8');
  await t.admin.query(`insert into product_facts (id, product_id, version, status, facts, approved_by, approved_at) values ($1,$2,1,'approved',$3,'admin',now())`, [uuidv7(), productId, facts]);
  const r = await currentConsentTexts(t.app, { requireApproved: false });
  if (!r.ok) throw new Error('textos');
  texts = r.texts;
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const none = { email: false, human_call: false, ai_call: false, sms_whatsapp: false };
function word(k: number): string {
  let x = (k * 2654435761) % 4294967296;
  let w = '';
  for (let i = 0; i < 7; i++) { w += 'bcdfghjklmnpqrstvwxyz'.charAt(x % 21) + 'aeiou'.charAt((x >> 5) % 5); x = (x * 1103515245 + 12345) % 2147483648; }
  return w;
}
function form(over: Partial<DemoRequestData> = {}): DemoRequestData {
  n++;
  const company = `Clínica ${word(n + 1000)} ${word(n * 9 + 4)}`;
  return { name: 'Ana Pérez', email: `ana${n}@${word(n + 2000)}${n}.es`, phone: `+34955${String(900000 + n)}`, company, boxes: { ...none }, ...over };
}
const input = (f: DemoRequestData, over: Partial<SubmitInput> = {}): SubmitInput => ({ form: f, texts, sourceUrl: URL1, ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (prueba)', token: null, now: AT, ...over });
const q = async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> => (await t.app.query(sql, args)).rows as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await q<{ n: string }>(sql, args))[0]!.n);
const mkSales = async (id: string): Promise<void> => {
  await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ($1,$1,$1 || '@x.test',true) on conflict do nothing`, [id]);
  await t.app.query(`insert into app_user_roles (user_id, role) values ($1,'sales') on conflict do nothing`, [id]);
};

describe('submitDemoRequest: consentimientos (REQ-CNS-01 CA1)', () => {
  it('con las 4 casillas crea los 8 consentimientos exactos, cada uno con todos los campos exigidos', async () => {
    const f = form({ boxes: { email: true, human_call: true, ai_call: true, sms_whatsapp: true } });
    const r = await submitDemoRequest(t.app, input(f));
    expect(r.status).toBe('recorded');
    if (r.status !== 'recorded') return;
    const rows = await q<Record<string, unknown>>('select * from consents where prospect_id = $1 order by channel, purpose', [r.prospectId]);
    expect(rows.map((c) => `${c.channel}/${c.purpose}`)).toEqual([
      'ai_call/demo_followup', 'ai_call/prospecting', 'email/demo_followup', 'email/prospecting', 'human_call/demo_followup', 'human_call/prospecting', 'sms/demo_confirmation', 'whatsapp/demo_confirmation',
    ]);
    expect(rows).toHaveLength(r.consentIds.length);
    for (const c of rows) {
      expect(c).toMatchObject({ action: 'grant', source_url: URL1, user_agent: 'Mozilla/5.0 (prueba)', ip: '203.0.113.7', campaign_id: null });
      expect(c.created_at).toBeInstanceOf(Date);
      expect(String(c.text_version)).toMatch(/^borrador-1\+borrador-1$/);
      expect(c.channel === 'email' ? c.email : c.phone).toBe(c.channel === 'email' ? f.email : f.phone);
    }
    const email = rows.find((c) => c.channel === 'email')!;
    expect(email.text_snapshot).toContain(texts.email.text);
    expect(email.text_snapshot).toContain(texts.privacy.text); // lo que la persona vio, literal
    const ai = rows.find((c) => c.channel === 'ai_call')!;
    expect(ai.text_snapshot).toContain(texts.ai_call.text);
    expect(ai.text_snapshot).not.toContain(texts.email.text);
  });

  it('solo se crean los de las casillas marcadas; sin ninguna, la solicitud es válida pero no habilita ningún canal', async () => {
    const r = await submitDemoRequest(t.app, input(form({ boxes: { ...none, ai_call: true } })));
    if (r.status !== 'recorded') throw new Error('esperaba recorded');
    expect((await q('select channel from consents where prospect_id = $1', [r.prospectId])).map((c) => c.channel).sort()).toEqual(['ai_call', 'ai_call']);
    const r2 = await submitDemoRequest(t.app, input(form()));
    if (r2.status !== 'recorded') throw new Error('esperaba recorded');
    expect(r2.consentIds).toEqual([]);
    expect(await count('select count(*) n from consents where prospect_id = $1', [r2.prospectId])).toBe(0);
    expect(r2.dealId).toBeTruthy();
  });

  it('el consentimiento lleva la campaña del enlace personalizado y se reutiliza la ficha y la oportunidad', async () => {
    const f0 = form();
    const base = await submitDemoRequest(t.app, input(f0));
    if (base.status !== 'recorded') throw new Error('x');
    const seg = uuidv7();
    const camp = uuidv7();
    await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) select $1, id, $2, 'Seg', 'approved', '{}' from products limit 1`, [seg, `seg-${seg.slice(-6)}`]);
    await t.admin.query(`insert into campaigns (id, product_id, segment_id, name, wave, territory_filter, sequence, budget_eur, status, utm) select $1, id, $2, 'Camp', 'w1', '{}', '[]', 10, 'active', '{}' from products limit 1`, [camp, seg]);
    const { token } = await createPublicToken(t.app, { kind: 'landing', prospectId: base.prospectId, campaignId: camp });
    const resolved = await resolvePublicToken(t.app, 'landing', token);
    const r = await submitDemoRequest(t.app, input({ ...f0, boxes: { ...none, email: true } }, { token: resolved }));
    if (r.status !== 'recorded') throw new Error('x');
    expect(r.prospectId).toBe(base.prospectId);
    expect(await count('select count(*) n from consents where campaign_id = $1', [camp])).toBe(2);
    // la oportunidad ya abierta se reutiliza y conserva la atribución de su primer contacto
    expect(r.dealId).toBe(base.dealId);
  });
});

describe('submitDemoRequest: ficha y puntuación (REQ-CNS-01 CA2)', () => {
  it('crea la ficha pendiente de revisión con la fuente del formulario, y marca inbound_interest (+5 puntos) con su evidencia', async () => {
    const f = form();
    const r = await submitDemoRequest(t.app, input(f));
    if (r.status !== 'recorded') throw new Error('x');
    const p = (await q<Record<string, unknown>>('select name, status, score, tier from prospects where id = $1', [r.prospectId]))[0]!;
    expect(p).toMatchObject({ name: f.company, status: 'pending_review', score: 5, tier: 'nurture' });
    expect(await count(`select count(*) n from prospect_sources where prospect_id = $1 and source_id = 'inbound_form'`, [r.prospectId])).toBe(1);
    const ev = (await q<Record<string, unknown>>(`select provenance, source_url from evidences where prospect_id = $1 and field = 'signal:inbound_interest'`, [r.prospectId]))[0]!;
    expect(ev).toMatchObject({ provenance: 'observed', source_url: URL1 });
  });

  it('enlaza con una ficha existente (misma empresa) en vez de duplicarla, y no cambia su estado', async () => {
    const existing = await ingestCandidate(t.app, { name: 'Óptica Doble Vista S.L.', website: 'https://dobleVista.es/', sourceId: 'osm', externalId: 'dv', sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
    await t.admin.query(`update prospects set status = 'approved' where id = $1`, [existing.prospectId]);
    const before = await count('select count(*) n from prospects');
    const r = await submitDemoRequest(t.app, input(form({ company: 'Óptica Doble Vista', email: 'ana@doblevista.es' })));
    if (r.status !== 'recorded') throw new Error('x');
    expect(r.prospectId).toBe(existing.prospectId);
    expect(await count('select count(*) n from prospects')).toBe(before);
    expect((await q<{ status: string }>('select status from prospects where id = $1', [r.prospectId]))[0]!.status).toBe('approved');
  });

  it('el dominio de un correo personal (gmail…) no se toma como la web de la empresa', async () => {
    const r = await submitDemoRequest(t.app, input(form({ email: 'ana.perez@gmail.com' })));
    if (r.status !== 'recorded') throw new Error('x');
    expect((await q<{ website: string | null; domain: string | null }>('select website, domain from prospects where id = $1', [r.prospectId]))[0]).toEqual({ website: null, domain: null });
  });

  it('con un correo de empresa, su dominio sirve para enlazar y se guarda como web', async () => {
    const r = await submitDemoRequest(t.app, input(form({ email: 'ana@nuevaclinica-xyz.es' })));
    if (r.status !== 'recorded') throw new Error('x');
    expect((await q<{ domain: string }>('select domain from prospects where id = $1', [r.prospectId]))[0]!.domain).toBe('nuevaclinica-xyz.es');
  });

  it('guarda quién pidió la demo y por qué vía, para que el comercial pueda contactar', async () => {
    const f = form();
    const r = await submitDemoRequest(t.app, input(f, { utm: { utm_source: 'carta', utm_campaign: 'sevilla-1' } }));
    if (r.status !== 'recorded') throw new Error('x');
    const d = (await q<Record<string, unknown>>('select * from demo_requests where id = $1', [r.requestId]))[0]!;
    expect(d).toMatchObject({ prospect_id: r.prospectId, deal_id: r.dealId, requester_name: 'Ana Pérez', requester_email: f.email, requester_phone: f.phone, company: f.company, source_url: URL1 });
    expect((await q<{ utm: unknown }>('select utm from deals where id = $1', [r.dealId]))[0]!.utm).toEqual({ utm_source: 'carta', utm_campaign: 'sevilla-1' });
  });

  it('de los parámetros UTM solo se guardan los utm_* cortos: nada de claves ajenas, con marcado o valores enormes', async () => {
    const r = await submitDemoRequest(t.app, input(form(), { utm: { utm_source: 'carta', rol: 'admin', 'utm_<script>': 'x', utm_largo: 'x'.repeat(101), utm_medium: 'qr' } }));
    if (r.status !== 'recorded') throw new Error('x');
    expect((await q<{ utm: unknown }>('select utm from deals where id = $1', [r.dealId]))[0]!.utm).toEqual({ utm_source: 'carta', utm_medium: 'qr' });
  });
});

describe('submitDemoRequest: exclusiones (la oposición manda, REQ-CNS-03)', () => {
  it.each([
    ['el email del solicitante está excluido', (f: DemoRequestData) => t.app.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'email',$2,'oposición','email_reply')`, [uuidv7(), f.email])],
    ['el teléfono del solicitante está excluido', (f: DemoRequestData) => t.app.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'phone',$2,'oposición','call')`, [uuidv7(), f.phone])],
    ['el dominio de su correo está excluido', async (f: DemoRequestData) => t.app.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'domain',$2,'oposición','crm')`, [uuidv7(), f.email!.split('@')[1]])],
  ])('%s: se registra el aviso, pero no hay consentimientos, ni oposición reabierta, ni oportunidad', async (_n, exclude) => {
    const f = form({ boxes: { email: true, human_call: true, ai_call: false, sms_whatsapp: false } });
    await exclude(f);
    const deals = await count('select count(*) n from deals');
    const consents = await count('select count(*) n from consents');
    const r = await submitDemoRequest(t.app, input(f));
    expect(r).toMatchObject({ status: 'excluded' });
    expect(await count('select count(*) n from deals')).toBe(deals);
    expect(await count('select count(*) n from consents')).toBe(consents);
    const log = (await q<{ payload: Record<string, unknown> }>(`select payload from audit_log where action = 'inbound.excluded_request' order by id desc limit 1`))[0]!;
    expect(log.payload).toMatchObject({ email: f.email, phone: f.phone, company: f.company });
  });

  it('una ficha que ya se opuso (bloqueada por oposición) no se reabre: sin oportunidad ni consentimientos', async () => {
    const e = await ingestCandidate(t.app, { name: 'Dental Opuesta Norte S.L.', website: 'https://opuestanorte.es/', sourceId: 'osm', externalId: 'op1', sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
    await applyOpposition(t.app, { actor: 'test', origin: 'email_reply', reason: 'no molestar', prospectId: e.prospectId });
    const r = await submitDemoRequest(t.app, input(form({ company: 'Dental Opuesta Norte', email: 'ana@opuestanorte.es', boxes: { ...none, email: true } })));
    expect(r.status).toBe('excluded');
    expect((await q<{ status: string }>('select status from prospects where id = $1', [e.prospectId]))[0]!.status).toBe('blocked');
    expect(await count('select count(*) n from deals where prospect_id = $1', [e.prospectId])).toBe(0);
  });

  it('un cliente actual de TurnoSala tampoco recibe oportunidad de prospección', async () => {
    await t.app.query(`insert into turnosala_customers (org_id, name, name_norm, domain, refreshed_at) values ('o1','Cliente Dental Sur','cliente dental sur','clientedentalsur.es',now())`);
    const r = await submitDemoRequest(t.app, input(form({ company: 'Cliente Dental Sur', email: 'ana@clientedentalsur.es' })));
    expect(r.status).toBe('excluded');
  });

  it('el aviso a los comerciales: si hay alguien a quien asignar, se le crea una tarea de revisión humana', async () => {
    await mkSales('s-excl');
    const f = form();
    await t.app.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'email',$2,'oposición','email_reply')`, [uuidv7(), f.email]);
    const r = await submitDemoRequest(t.app, input(f));
    expect(r.status).toBe('excluded');
    expect(await count(`select count(*) n from tasks where title like 'Revisar solicitud%' and status = 'open'`)).toBeGreaterThanOrEqual(1);
  });
});

describe('submitDemoRequest: oportunidad (REQ-CRM-01)', () => {
  it('abre una oportunidad en «Interesado» con importe = plan Profesional × 12 = 828 €, origen y la tarea de atenderla', async () => {
    await mkSales('s1');
    const f = form();
    const r = await submitDemoRequest(t.app, input(f));
    if (r.status !== 'recorded') throw new Error('x');
    const d = (await q<Record<string, unknown>>('select stage_id, est_value_eur, proposed_plan, source_channel, owner_user_id, closed_at from deals where id = $1', [r.dealId]))[0]!;
    expect(d).toMatchObject({ stage_id: 'interested', proposed_plan: 'pro', source_channel: 'landing_sector', closed_at: null });
    expect(Number(d.est_value_eur)).toBe(828);
    expect(r.assignedTo).toBe(d.owner_user_id);
    const task = (await q<Record<string, unknown>>(`select kind, assignee_user_id, status, title from tasks where deal_id = $1`, [r.dealId]))[0]!;
    expect(task).toMatchObject({ kind: 'follow_up', status: 'open', title: 'Atender la demo solicitada' });
    expect(task.assignee_user_id).toBe(r.assignedTo);
  });

  it('una ficha tiene UNA oportunidad abierta: repetir la solicitud la reutiliza y no la hace retroceder de etapa', async () => {
    const f = form();
    const a = await submitDemoRequest(t.app, input(f));
    if (a.status !== 'recorded') throw new Error('x');
    await t.app.query(`update deals set stage_id = 'demo_booked' where id = $1`, [a.dealId]);
    const b = await submitDemoRequest(t.app, input(f));
    if (b.status !== 'recorded') throw new Error('x');
    expect(b.dealId).toBe(a.dealId);
    expect((await q<{ stage_id: string }>('select stage_id from deals where id = $1', [a.dealId]))[0]!.stage_id).toBe('demo_booked');
    expect(await count('select count(*) n from demo_requests where prospect_id = $1', [a.prospectId])).toBe(2);
    expect(await count(`select count(*) n from tasks where deal_id = $1 and title = 'Atender la demo solicitada' and status = 'open'`, [a.dealId])).toBe(1); // sin tareas duplicadas
  });

  it('una oportunidad en «Nuevo» sube a «Interesado» con la solicitud', async () => {
    const f = form();
    const a = await submitDemoRequest(t.app, input(f));
    if (a.status !== 'recorded') throw new Error('x');
    await t.app.query(`update deals set stage_id = 'new' where id = $1`, [a.dealId]);
    await submitDemoRequest(t.app, input(f));
    expect((await q<{ stage_id: string }>('select stage_id from deals where id = $1', [a.dealId]))[0]!.stage_id).toBe('interested');
  });

  it('solicitudes simultáneas de una persona NUEVA (compiten por crear) no duplican la oportunidad ni fallan', async () => {
    const f = form();
    const results = await Promise.all([1, 2, 3, 4].map(() => submitDemoRequest(t.app, input(f))));
    const recorded = results.filter((r): r is Extract<typeof r, { status: 'recorded' }> => r.status === 'recorded');
    expect(recorded).toHaveLength(4);
    expect(new Set(recorded.map((r) => r.prospectId)).size).toBe(1);
    expect(new Set(recorded.map((r) => r.dealId)).size).toBe(1);
    expect(await count('select count(*) n from deals where prospect_id = $1', [recorded[0]!.prospectId])).toBe(1);
    expect(await count(`select count(*) n from tasks where deal_id = $1 and title = 'Atender la demo solicitada'`, [recorded[0]!.dealId])).toBeLessThanOrEqual(1);
  });

  it('solicitudes simultáneas sobre una ficha YA aprobada (sin otra fila que las serialice) tampoco duplican la oportunidad', async () => {
    const e = await ingestCandidate(t.app, { name: 'Clínica Concurrente Oeste S.L.', website: 'https://concurrenteoeste.es/', sourceId: 'osm', externalId: 'cc1', sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
    await t.admin.query(`update prospects set status = 'approved' where id = $1`, [e.prospectId]);
    const { token } = await createPublicToken(t.app, { kind: 'landing', prospectId: e.prospectId as string });
    const resolved = await resolvePublicToken(t.app, 'landing', token);
    const f = form();
    // cada envío llega desde una URL distinta: así el índice único de evidencias no serializa por su cuenta y se prueba el bloqueo de la ficha
    const results = await Promise.all([1, 2, 3, 4, 5].map((k) => submitDemoRequest(t.app, input(f, { token: resolved, sourceUrl: `${URL1}?origen=${k}` }))));
    expect(results.every((r) => r.status === 'recorded')).toBe(true);
    expect(await count('select count(*) n from deals where prospect_id = $1', [e.prospectId])).toBe(1);
  });

  it('el reparto va por turnos: cada oportunidad nueva va al comercial con menos abiertas', async () => {
    await mkSales('s2');
    await t.admin.query(`update deals set closed_at = now(), stage_id = 'lost', lost_reason_id = 'other' where closed_at is null`);
    const owners: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await submitDemoRequest(t.app, input(form()));
      if (r.status !== 'recorded') throw new Error('x');
      owners.push(r.assignedTo as string);
    }
    const salesCount = (await q<{ user_id: string }>(`select user_id from app_user_roles where role = 'sales'`)).length;
    expect(salesCount).toBe(3);
    const perOwner = new Map<string, number>();
    for (const o of owners) perOwner.set(o, (perOwner.get(o) ?? 0) + 1);
    expect([...perOwner.values()]).toEqual([2, 2, 2]); // 6 oportunidades entre 3 comerciales: dos cada uno
  });

  it('sin comerciales dados de alta, la oportunidad queda sin asignar y no se inventa ninguna tarea', async () => {
    await t.admin.query(`delete from tasks`);
    await t.admin.query(`update deals set owner_user_id = null`);
    await t.admin.query(`delete from app_user_roles where role = 'sales'`);
    const r = await submitDemoRequest(t.app, input(form()));
    if (r.status !== 'recorded') throw new Error('x');
    expect(r.assignedTo).toBeNull();
    expect(await count('select count(*) n from tasks where deal_id = $1', [r.dealId])).toBe(0);
  });
});

describe('tabla demo_requests (migración 0014)', () => {
  it('exige un nombre y al menos un medio de contacto', async () => {
    const r = await submitDemoRequest(t.app, input(form()));
    if (r.status !== 'recorded') throw new Error('x');
    const ins = (name: string, email: string | null, phone: string | null) => t.app.query(
      `insert into demo_requests (id, prospect_id, requester_name, requester_email, requester_phone, source_url) values ($1,$2,$3,$4,$5,'https://x.es/')`, [uuidv7(), r.prospectId, name, email, phone]);
    await expect(ins('Ana', null, null)).rejects.toThrow(/check/i);
    await expect(ins('  ', 'a@b.es', null)).rejects.toThrow(/check/i);
    await ins('Ana', 'a@b.es', null);
  });
});

describe('submitDemoRequest: atomicidad', () => {
  it('si algo falla a mitad (IP inválida), no queda solicitud, ni consentimientos, ni oportunidad a medias', async () => {
    const f = form({ boxes: { ...none, email: true } });
    const reqs = await count('select count(*) n from demo_requests');
    const consents = await count('select count(*) n from consents');
    const deals = await count('select count(*) n from deals');
    await expect(submitDemoRequest(t.app, input(f, { ip: 'esto-no-es-una-ip' }))).rejects.toThrow();
    expect(await count('select count(*) n from demo_requests')).toBe(reqs);
    expect(await count('select count(*) n from consents')).toBe(consents);
    expect(await count('select count(*) n from deals')).toBe(deals);
  });

  it('una casilla sin el dato al que se aplica se rechaza también aquí (defensa en profundidad)', async () => {
    await expect(submitDemoRequest(t.app, input(form({ email: null, boxes: { ...none, email: true } })))).rejects.toThrow(/correo/i);
    await expect(submitDemoRequest(t.app, input(form({ phone: null, boxes: { ...none, ai_call: true } })))).rejects.toThrow(/teléfono/i);
  });
});
