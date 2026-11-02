import { seededRng } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addContactPoint, bulkApprove, correctField, exportApprovedCsv, getCard, listQueue, reviewProspect } from './review.js';
import { ingestCandidate } from './ingest.js';
import { saveEnrichment } from './enrichment.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
const MKT = { userId: 'u-mkt', role: 'marketing' as const };
const ADMIN = { userId: 'u-adm', role: 'admin' as const };
let n = 0;

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values ('41091','Sevilla','Sevilla','Andalucía',680000)`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

/** Palabra pseudoaleatoria y distinta para cada n: la deduplicación por similitud fusionaría nombres parecidos. */
function word(k: number): string {
  let x = (k * 2654435761) % 4294967296;
  let w = '';
  for (let i = 0; i < 7; i++) { w += 'bcdfghjklmnpqrstvwxyz'.charAt(x % 21) + 'aeiou'.charAt((x >> 5) % 5); x = (x * 1103515245 + 12345) % 2147483648; }
  return w[0]!.toUpperCase() + w.slice(1);
}

/** Ficha enriquecida lista para revisar. */
async function prospect(over: { name?: string; legal?: string; status?: string; score?: boolean } = {}): Promise<string> {
  n++;
  const name = over.name ?? `${word(n)} ${word(n * 31 + 7)} S.L.`;
  const r = await ingestCandidate(t.app, { name, website: `https://empresa-${n}-${over.name ? 'n' : 'g'}.es/`, phone: `955 ${String(100000 + n).slice(1, 4)} ${String(100000 + n).slice(4)}`, municipality: 'Sevilla', province: 'Sevilla', sourceId: 'corporate_web', externalId: `e${n}`, sourceUrl: `https://empresa-${n}.es/`, fetchedAt: AT, extractorVersion: 't', evidences: [] });
  const id = r.prospectId as string;
  if (over.score !== false) {
    await saveEnrichment(t.app, id, {
      fields: [{ key: 'sites_count', value: '2', provenance: 'inferred', explanation: 'se deduce de «dos centros»', sourceUrl: `https://empresa-${n}.es/`, quote: 'dos centros' }], signals: [{ key: 'varias_consultas', quote: 'tres consultas', sourceUrl: `https://empresa-${n}.es/` }],
      contactPoints: [{ type: 'switchboard_phone', value: '+34954123456', sourceUrl: `https://empresa-${n}.es/c`, quote: 'llámanos 954 12 34 56' }], legalForm: null,
      metrics: { accepted: 3, rejected: {} as never, personalEmailsDiscarded: 0, hallucinationRejected: 0 },
    }, { fetchedAt: AT, extractorVersion: 'extract-v1' });
  }
  if (over.legal) await t.admin.query('update prospects set legal_form = $2 where id = $1', [id, over.legal]);
  if (over.status) await t.admin.query('update prospects set status = $2 where id = $1', [id, over.status]);
  return id;
}
const status = async (id: string): Promise<string> => ((await t.app.query('select status from prospects where id = $1', [id])).rows[0] as { status: string }).status;
const audits = async (action: string, id: string) => (await t.app.query(`select actor, payload from audit_log where action = $1 and entity_id = $2`, [action, id])).rows as Array<{ actor: string; payload: Record<string, unknown> }>;
const sideEffects = async (): Promise<number[]> => Promise.all(['contact_attempts', 'consents', 'compliance_decisions', 'suppressions'].map(async (tb) => Number(((await t.app.query(`select count(*) n from ${tb}`)).rows[0] as { n: string }).n)));

describe('listQueue / getCard (REQ-REV-01)', () => {
  it('la cola trae las fichas por revisar, de más a menos puntuación, con el nº de campos inferidos', async () => {
    const a = await prospect();
    await t.admin.query('update prospects set score = 90 where id = $1', [a]);
    const b = await prospect();
    await t.admin.query('update prospects set score = 30 where id = $1', [b]);
    const q = await listQueue(t.app, { limit: 500 });
    const ids = q.map((x) => x.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
    expect(q.find((x) => x.id === a)).toMatchObject({ status: 'enriched', score: 90 });
    expect(q.find((x) => x.id === a)!.inferredCount).toBeGreaterThanOrEqual(1); // sedes inferidas (+ forma jurídica inferida por la ingesta)
    await prospect({ status: 'approved' });
    expect((await listQueue(t.app, { limit: 500 })).every((x) => ['enriched', 'pending_review'].includes(x.status))).toBe(true);
  });

  it('la ficha trae datos, evidencias con fuente y cita (marcando las inferidas), contactos, desglose e historial', async () => {
    const id = await prospect();
    await reviewProspect(t.app, id, MKT, { action: 'approve' });
    const c = (await getCard(t.app, id))!;
    expect(c.prospect).toMatchObject({ id, status: 'approved', score: expect.any(Number), tier: expect.any(String) });
    expect(c.prospect.scoreBreakdown).toBeTruthy();
    expect(c.evidences.find((e) => e.field === 'sites_count')).toMatchObject({ provenance: 'inferred', explanation: expect.stringContaining('dos centros'), quote: 'dos centros' });
    expect(c.evidences.find((e) => e.field === 'signal:varias_consultas')).toMatchObject({ provenance: 'observed', sourceUrl: expect.stringContaining('empresa-') });
    expect(c.contactPoints).toContainEqual(expect.objectContaining({ type: 'switchboard_phone', value: '+34954123456' }));
    expect(c.history.map((h) => h.action)).toContain('prospect.approved');
    expect(await getCard(t.app, '00000000-0000-7000-8000-000000000000')).toBeUndefined();
  });
});

describe('reviewProspect (REQ-REV-02 CA1)', () => {
  it('aprobar pasa la ficha a «approved», la audita y NO crea ningún contacto, consentimiento ni decisión', async () => {
    const id = await prospect();
    const before = await sideEffects();
    expect(await reviewProspect(t.app, id, MKT, { action: 'approve' })).toEqual({ ok: true, status: 'approved' });
    expect(await status(id)).toBe('approved');
    expect(await sideEffects()).toEqual(before);
    expect((await audits('prospect.approved', id))[0]).toMatchObject({ actor: 'u-mkt' });
    expect(((await t.app.query('select reviewed_by from prospects where id = $1', [id])).rows[0] as { reviewed_by: string }).reviewed_by).toBe('u-mkt');
  });

  it('descartar y bloquear exigen un motivo y lo guardan; bloquear no deja la ficha en ninguna cola', async () => {
    const d = await prospect();
    const b = await prospect();
    expect(await reviewProspect(t.app, d, MKT, { action: 'discard', reason: '  ' })).toEqual({ ok: false, reason: 'reason_required' });
    expect(await reviewProspect(t.app, d, MKT, { action: 'discard', reason: 'Fuera del segmento' })).toEqual({ ok: true, status: 'discarded' });
    expect(await reviewProspect(t.app, b, ADMIN, { action: 'block', reason: 'Pidió no ser contactada' })).toEqual({ ok: true, status: 'blocked' });
    expect((await audits('prospect.discarded', d))[0]?.payload).toMatchObject({ reason: 'Fuera del segmento' });
    expect(((await t.app.query('select block_reason from prospects where id = $1', [b])).rows[0] as { block_reason: string }).block_reason).toContain('Pidió no ser contactada');
    const ids = (await listQueue(t.app, { limit: 500 })).map((x) => x.id);
    expect(ids).not.toContain(d);
    expect(ids).not.toContain(b);
  });

  it('solo marketing y admin revisan; sales, auditor y voz no, ni sin rol', async () => {
    const id = await prospect();
    for (const role of ['sales', 'auditor', 'voice', null] as const) {
      expect(await reviewProspect(t.app, id, { userId: 'u', role }, { action: 'approve' })).toEqual({ ok: false, reason: 'forbidden' });
    }
    expect(await status(id)).toBe('enriched');
  });

  it('no se aprueba lo que no está pendiente de revisión (candidata, ya aprobada, bloqueada, descartada) ni lo inexistente', async () => {
    const cand = await prospect({ score: false });
    expect(await reviewProspect(t.app, cand, MKT, { action: 'approve' })).toEqual({ ok: false, reason: 'not_reviewable' });
    for (const st of ['approved', 'blocked', 'discarded', 'archived']) {
      const id = await prospect({ status: st });
      expect(await reviewProspect(t.app, id, MKT, { action: 'approve' })).toEqual({ ok: false, reason: 'not_reviewable' });
    }
    expect(await reviewProspect(t.app, '00000000-0000-7000-8000-000000000000', MKT, { action: 'approve' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('una ficha aprobada todavía se puede bloquear (seguridad), pero una bloqueada no se reabre', async () => {
    const id = await prospect();
    await reviewProspect(t.app, id, MKT, { action: 'approve' });
    expect(await reviewProspect(t.app, id, MKT, { action: 'block', reason: 'error de datos' })).toEqual({ ok: true, status: 'blocked' });
    expect(await reviewProspect(t.app, id, MKT, { action: 'discard', reason: 'x' })).toEqual({ ok: false, reason: 'not_reviewable' });
  });
});

describe('addContactPoint (REQ-REV-02, REQ-ENR-03): el revisor añade un canal que la IA no encontró', () => {
  const contacts = async (id: string) => (await t.app.query(
    `select c.type, c.value, e.provenance, e.extractor_version, e.source_url from contact_points c join evidences e on e.id = c.evidence_id where c.prospect_id = $1 and e.extractor_version = 'manual-review' order by c.type`, [id])).rows;

  it('email genérico, teléfono normalizado a E.164 y formulario: con evidencia «observed» de la página indicada y auditoría', async () => {
    const id = await prospect();
    expect(await addContactPoint(t.app, id, MKT, { type: 'generic_email', value: ' Info@Pelu-Nova.es ', sourceUrl: 'https://pelu-nova.es/contacto' })).toEqual({ ok: true });
    expect(await addContactPoint(t.app, id, MKT, { type: 'switchboard_phone', value: '955 66 77 88', sourceUrl: 'https://pelu-nova.es/contacto' })).toEqual({ ok: true });
    expect(await addContactPoint(t.app, id, MKT, { type: 'web_form', value: 'https://pelu-nova.es/contacto#form', sourceUrl: 'https://pelu-nova.es/contacto' })).toEqual({ ok: true });
    expect(await contacts(id)).toEqual([
      { type: 'generic_email', value: 'info@pelu-nova.es', provenance: 'observed', extractor_version: 'manual-review', source_url: 'https://pelu-nova.es/contacto' },
      { type: 'switchboard_phone', value: '+34955667788', provenance: 'observed', extractor_version: 'manual-review', source_url: 'https://pelu-nova.es/contacto' },
      { type: 'web_form', value: 'https://pelu-nova.es/contacto#form', provenance: 'observed', extractor_version: 'manual-review', source_url: 'https://pelu-nova.es/contacto' },
    ]);
    expect((await audits('prospect.contact_added', id)).map((a) => [a.actor, a.payload.type]).sort()).toEqual([['u-mkt', 'generic_email'], ['u-mkt', 'switchboard_phone'], ['u-mkt', 'web_form']]);
  });

  it('un móvil se guarda como mobile_phone aunque se elija «teléfono» (la clasificación no la decide el revisor)', async () => {
    const id = await prospect();
    expect(await addContactPoint(t.app, id, MKT, { type: 'switchboard_phone', value: '612 345 678', sourceUrl: 'https://x.es/' })).toEqual({ ok: true });
    expect((await contacts(id)).map((c) => c.type)).toEqual(['mobile_phone']);
  });

  it('un email personal (nombre de persona o webmail) no se guarda: REQ-ENR-03 lo descarta también a mano', async () => {
    const id = await prospect();
    for (const value of ['maria.garcia@pelu-nova.es', 'pelunova@gmail.com'])
      expect(await addContactPoint(t.app, id, MKT, { type: 'generic_email', value, sourceUrl: 'https://pelu-nova.es/' })).toEqual({ ok: false, reason: 'personal_email' });
    expect(await contacts(id)).toEqual([]);
  });

  it('valores inválidos, sin página de origen, rol sin permiso, tipo desconocido, ficha no revisable o repetido se rechazan', async () => {
    const id = await prospect();
    const before = await sideEffects();
    const ok = { type: 'generic_email' as const, value: 'info@pelu-nova.es', sourceUrl: 'https://pelu-nova.es/' };
    expect(await addContactPoint(t.app, id, MKT, { ...ok, value: 'no-es-email' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await addContactPoint(t.app, id, MKT, { type: 'switchboard_phone', value: '12', sourceUrl: ok.sourceUrl })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await addContactPoint(t.app, id, MKT, { type: 'booking_url', value: 'javascript:alert(1)', sourceUrl: ok.sourceUrl })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await addContactPoint(t.app, id, MKT, { type: 'postal_address', value: 'Dr. Juan Pérez, calle Real 3', sourceUrl: ok.sourceUrl })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await addContactPoint(t.app, id, MKT, { ...ok, sourceUrl: 'lo vi en internet' })).toEqual({ ok: false, reason: 'invalid_source' });
    expect(await addContactPoint(t.app, id, { userId: 'u', role: 'sales' }, ok)).toEqual({ ok: false, reason: 'forbidden' });
    expect(await addContactPoint(t.app, id, MKT, { ...ok, type: 'personal_email' as never })).toEqual({ ok: false, reason: 'invalid_field' });
    const blocked = await prospect({ status: 'blocked' });
    expect(await addContactPoint(t.app, blocked, MKT, ok)).toEqual({ ok: false, reason: 'not_reviewable' });
    expect(await addContactPoint(t.app, id, MKT, ok)).toEqual({ ok: true });
    expect(await addContactPoint(t.app, id, MKT, { ...ok, value: 'INFO@pelu-nova.es' })).toEqual({ ok: false, reason: 'already_exists' });
    expect(await sideEffects()).toEqual(before); // añadir un canal no contacta ni decide nada
  });
});

describe('correctField (REQ-REV-02)', () => {
  it('corrige nombre, web y sedes; deja una evidencia «observed» de revisión manual y la auditoría', async () => {
    const id = await prospect();
    expect(await correctField(t.app, id, MKT, { field: 'name', value: 'Clínica Corregida S.L.' })).toEqual({ ok: true });
    expect(await correctField(t.app, id, MKT, { field: 'sites_count', value: '3' })).toEqual({ ok: true });
    expect(await correctField(t.app, id, MKT, { field: 'website', value: 'https://www.corregida-web.es/' })).toEqual({ ok: true });
    const p = (await t.app.query('select name, name_norm, sites_count, domain, website from prospects where id = $1', [id])).rows[0];
    expect(p).toMatchObject({ name: 'Clínica Corregida S.L.', name_norm: 'clinica corregida', sites_count: 3, domain: 'corregida-web.es', website: 'https://www.corregida-web.es/' });
    const ev = (await t.app.query(`select provenance, extractor_version, source_url from evidences where prospect_id = $1 and field = 'sites_count' and value = '3'`, [id])).rows[0];
    expect(ev).toMatchObject({ provenance: 'observed', extractor_version: 'manual-review', source_url: expect.stringContaining('u-mkt') });
    expect((await audits('prospect.corrected', id)).map((a) => a.payload.field).sort()).toEqual(['name', 'sites_count', 'website']);
  });

  it('valores inválidos, rol sin permiso y fichas no revisables se rechazan sin cambiar nada', async () => {
    const id = await prospect();
    expect(await correctField(t.app, id, MKT, { field: 'sites_count', value: 'muchas' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await correctField(t.app, id, MKT, { field: 'sites_count', value: '0' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await correctField(t.app, id, MKT, { field: 'name', value: '  ' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await correctField(t.app, id, MKT, { field: 'website', value: 'no es una web' })).toEqual({ ok: false, reason: 'invalid_value' });
    expect(await correctField(t.app, id, { userId: 'u', role: 'sales' }, { field: 'name', value: 'X Y' })).toEqual({ ok: false, reason: 'forbidden' });
    expect(await correctField(t.app, id, MKT, { field: 'phone' as never, value: '1' })).toEqual({ ok: false, reason: 'invalid_field' });
    const blocked = await prospect({ status: 'blocked' });
    expect(await correctField(t.app, blocked, MKT, { field: 'name', value: 'Otra Cosa' })).toEqual({ ok: false, reason: 'not_reviewable' });
  });

  it('una web cuyo dominio ya tiene otra ficha se rechaza (no se crean duplicados)', async () => {
    const a = await prospect();
    const b = await prospect();
    const dom = ((await t.app.query('select website from prospects where id = $1', [a])).rows[0] as { website: string }).website;
    expect(await correctField(t.app, b, MKT, { field: 'website', value: dom })).toEqual({ ok: false, reason: 'domain_taken' });
  });
});

describe('bulkApprove: muestreo de calidad (REQ-REV-02 CA3)', () => {
  it('aprueba el lote salvo una muestra al azar de ≥ 10 % que queda en la cola para revisión individual', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push(await prospect());
    const r = await bulkApprove(t.app, ids, MKT, seededRng(5));
    expect(r.sample).toHaveLength(2); // 10 % de 12 = 1,2 ⇒ 2
    expect(r.approved).toHaveLength(10);
    expect(new Set([...r.approved, ...r.sample]).size).toBe(12);
    for (const id of r.sample) expect(await status(id)).toBe('enriched');
    for (const id of r.approved) expect(await status(id)).toBe('approved');
  });

  it('no aprueba en bloque sin permiso, informa de las fichas no revisables y no crea contactos', async () => {
    const ok = await prospect();
    const bad = await prospect({ status: 'blocked' });
    const before = await sideEffects();
    expect(await bulkApprove(t.app, [ok, bad], { userId: 'u', role: 'sales' })).toMatchObject({ approved: [], forbidden: true });
    const r = await bulkApprove(t.app, [ok, bad], MKT, seededRng(1));
    expect(r.skipped).toEqual([{ id: bad, reason: 'not_reviewable' }]);
    expect(await sideEffects()).toEqual(before);
  });

  it('un lote de una sola ficha la deja entera para revisión individual (la muestra mínima es 1)', async () => {
    const id = await prospect();
    const r = await bulkApprove(t.app, [id], MKT);
    expect(r).toMatchObject({ approved: [], sample: [id] });
    expect(await status(id)).toBe('enriched');
  });
});

describe('exportApprovedCsv (REQ-REV-03)', () => {
  it('exporta solo fichas aprobadas, sin teléfonos ni emails; el autónomo o forma desconocida sale sin nombre ni web', async () => {
    const co = await prospect({ legal: 'company' });
    const sole = await prospect({ legal: 'sole_trader' });
    const unk = await prospect({ legal: 'unknown' });
    const pending = await prospect({ legal: 'company' });
    for (const id of [co, sole, unk]) await t.admin.query(`update prospects set status = 'approved' where id = $1`, [id]);
    const csv = await exportApprovedCsv(t.app);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('id,nombre,forma_juridica,web,dominio,municipio_ine,municipio,provincia,sedes,puntuacion,nivel,revisada');
    const ids = lines.slice(1).map((l) => l.split(',')[0]);
    expect(ids).toEqual(expect.arrayContaining([co, sole, unk]));
    expect(ids).not.toContain(pending);
    // sin la columna id: un uuid puede contener «954» por azar
    expect(lines.slice(1).map((l) => l.split(',').slice(1).join(',')).join('\n')).not.toMatch(/954|\+34|@/);
    const row = (id: string) => lines.find((l) => l.startsWith(id))!.split(',');
    expect(row(co)[1]).not.toBe('');
    expect(row(sole).slice(1, 5)).toEqual(['', 'sole_trader', '', '']);
    expect(row(unk).slice(1, 5)).toEqual(['', 'unknown', '', '']);
    expect(row(co)[6]).toBe('Sevilla');
  });

  it('un nombre que empieza por «=» no se ejecuta como fórmula', async () => {
    const id = await prospect({ legal: 'company' });
    await t.admin.query(`update prospects set status = 'approved', name = '=HYPERLINK("http://x")' where id = $1`, [id]);
    const line = (await exportApprovedCsv(t.app)).split('\r\n').find((l) => l.startsWith(id))!;
    expect(line.split(',')[1]).toMatch(/^"?'=/);
  });
});
