import { trigramSimilarity } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importTurnosalaCustomers } from './customers.js';
import { ingestCandidate, type IngestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
const URL1 = 'https://clinicasol.es/contacto';

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into territories (ine_code, name, province, region, population) values
    ('T0001','Sevilla','Sevilla','Andalucía',680000), ('T0002','Dos Hermanas','Sevilla','Andalucía',135000)`);
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const cand = (over: Partial<IngestCandidate> = {}): IngestCandidate => ({
  name: 'Clínica Dental Sol, S.L.', website: 'https://www.clinicasol.es/', phone: '954 12 34 56', address: 'C/ Sierpes 12, 41004 Sevilla', municipality: 'Sevilla', province: 'Sevilla',
  sourceId: 'corporate_web', externalId: '', sourceUrl: URL1, fetchedAt: AT, extractorVersion: 'test-1',
  evidences: [{ field: 'sites_count', value: '1', provenance: 'observed', sourceUrl: URL1, quote: 'Nuestra clínica en Sevilla', fetchedAt: AT }], ...over,
});

const one = async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> => (await t.app.query(sql, args)).rows[0] as T;
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await one<{ n: string }>(sql, args)).n);

describe('crear una ficha (REQ-VER-01, REQ-VER-03, P2.2)', () => {
  it('normaliza y guarda nombre, dominio, municipio INE, forma jurídica y fuente; queda en «candidate»', async () => {
    const r = await ingestCandidate(t.app, cand());
    expect(r).toMatchObject({ action: 'created' });
    const p = await one<Record<string, unknown>>('select * from prospects where id = $1', [r.prospectId]);
    expect(p).toMatchObject({ name: 'Clínica Dental Sol, S.L.', name_norm: 'clinica dental sol', domain: 'clinicasol.es', website: 'https://www.clinicasol.es/', ine_code: 'T0001', legal_form: 'company', status: 'candidate' });
    expect(await count(`select count(*) n from prospect_sources where prospect_id = $1 and source_id = 'corporate_web'`, [r.prospectId])).toBe(1);
  });

  it('el teléfono se guarda en E.164 como centralita válida y la dirección normalizada, cada uno con su evidencia', async () => {
    const id = (await one<{ id: string }>(`select id from prospects where domain = 'clinicasol.es'`)).id;
    const phone = await one<Record<string, unknown>>(`select * from contact_points where prospect_id = $1 and type = 'switchboard_phone'`, [id]);
    expect(phone).toMatchObject({ value_norm: '+34954123456', valid: true, invalid_reason: null });
    expect(phone.evidence_id).not.toBeNull();
    const addr = await one<Record<string, unknown>>(`select value_norm from contact_points where prospect_id = $1 and type = 'postal_address'`, [id]);
    expect(addr.value_norm).toBe('calle sierpes 12 41004 sevilla');
  });

  it('la forma jurídica se guarda como evidencia INFERIDA con su explicación (REQ-VER-03)', async () => {
    const id = (await one<{ id: string }>(`select id from prospects where domain = 'clinicasol.es'`)).id;
    const e = await one<Record<string, unknown>>(`select * from evidences where prospect_id = $1 and field = 'legal_form'`, [id]);
    expect(e).toMatchObject({ value: 'company', provenance: 'inferred', source_url: URL1 });
    expect(String(e.explanation)).toMatch(/SL/i);
  });

  it('un teléfono no normalizable queda como no llamable (CA1) y un 902 también', async () => {
    const a = await ingestCandidate(t.app, cand({ name: 'Centro Uno', website: 'https://centrouno.es', phone: '12345' }));
    const b = await ingestCandidate(t.app, cand({ name: 'Centro Dos', website: 'https://centrodos.es', phone: '902 12 34 56' }));
    const cp = async (id: string) => one<Record<string, unknown>>(`select value_norm, valid, invalid_reason from contact_points where prospect_id = $1 and type = 'switchboard_phone'`, [id]);
    expect(await cp(a.prospectId)).toMatchObject({ valid: false, invalid_reason: 'not_callable' });
    expect(await cp(b.prospectId)).toMatchObject({ value_norm: '+34902123456', valid: false, invalid_reason: 'not_callable' });
  });

  it('un nombre sin forma jurídica queda «unknown»; una C.B. como autónomo; un ayuntamiento como organismo público', async () => {
    const forms: Array<[string, string]> = [['Óptica Ruiz', 'unknown'], ['Fisio & Salud C.B.', 'sole_trader'], ['Ayuntamiento de Utrera', 'public_body']];
    for (const [i, [name, form]] of forms.entries()) {
      const r = await ingestCandidate(t.app, cand({ name, website: `https://empresa-f${i}.es`, phone: undefined, municipality: undefined }));
      expect((await one<{ legal_form: string }>('select legal_form from prospects where id = $1', [r.prospectId])).legal_form).toBe(form);
    }
  });

  it('una web de red social no es el dominio de la empresa (null) y no provoca fusiones', async () => {
    const a = await ingestCandidate(t.app, cand({ name: 'Ficha FB uno', website: 'https://facebook.com/uno', phone: undefined, municipality: undefined }));
    const b = await ingestCandidate(t.app, cand({ name: 'Ficha FB dos distinta', website: 'https://facebook.com/dos', phone: undefined, municipality: undefined }));
    expect(a.prospectId).not.toBe(b.prospectId);
    expect((await one<{ domain: string | null }>('select domain from prospects where id = $1', [a.prospectId])).domain).toBeNull();
  });

  it('un municipio desconocido deja ine_code a null (no se inventa)', async () => {
    const r = await ingestCandidate(t.app, cand({ name: 'Sin municipio', website: 'https://sinmuni.es', phone: undefined, municipality: 'Atlantis' }));
    expect((await one<{ ine_code: string | null }>('select ine_code from prospects where id = $1', [r.prospectId])).ine_code).toBeNull();
  });
});

describe('fusionar duplicados (REQ-VER-02 CA1)', () => {
  const first = async () => (await one<{ id: string }>(`select id from prospects where domain = 'clinicasol.es'`)).id;

  it('mismo dominio → misma ficha, evidencia nueva añadida', async () => {
    const id = await first();
    const before = await count('select count(*) n from evidences where prospect_id = $1', [id]);
    const r = await ingestCandidate(t.app, cand({ name: 'Clínica Dental Sol (otra fuente)', phone: undefined, sourceId: 'osm', externalId: 'node/1', sourceUrl: 'https://osm.example/node/1',
      evidences: [{ field: 'opening_hours', value: 'L-V 9-20', provenance: 'observed', sourceUrl: 'https://osm.example/node/1', fetchedAt: AT }] }));
    expect(r).toMatchObject({ action: 'merged', prospectId: id, matchedBy: 'domain' });
    expect(await count('select count(*) n from evidences where prospect_id = $1', [id])).toBeGreaterThan(before);
    expect(await count(`select count(*) n from prospect_sources where prospect_id = $1`, [id])).toBe(2);
    expect(await count(`select count(*) n from prospects where domain = 'clinicasol.es'`)).toBe(1);
  });

  it('repetir exactamente la misma ingesta no duplica evidencias ni contactos', async () => {
    const id = await first();
    const ev = await count('select count(*) n from evidences where prospect_id = $1', [id]);
    const cp = await count('select count(*) n from contact_points where prospect_id = $1', [id]);
    await ingestCandidate(t.app, cand());
    await ingestCandidate(t.app, cand());
    expect(await count('select count(*) n from evidences where prospect_id = $1', [id])).toBe(ev);
    expect(await count('select count(*) n from contact_points where prospect_id = $1', [id])).toBe(cp);
  });

  it('mismo teléfono con otro nombre y sin web → fusión por teléfono', async () => {
    const r = await ingestCandidate(t.app, cand({ name: 'Nombre comercial distinto', website: undefined }));
    expect(r).toMatchObject({ action: 'merged', matchedBy: 'phone', prospectId: await first() });
  });

  it('nombre muy parecido en el mismo municipio → fusión por nombre; en otro municipio → ficha nueva', async () => {
    const base = await ingestCandidate(t.app, cand({ name: 'Policlínica Aljarafe Norte', website: undefined, phone: undefined }));
    const typo = await ingestCandidate(t.app, cand({ name: 'Policlínica Aljarafe Norte ', website: undefined, phone: undefined, sourceId: 'osm', sourceUrl: 'https://osm.example/2' }));
    expect(typo).toMatchObject({ action: 'merged', matchedBy: 'name_municipality', prospectId: base.prospectId });
    const other = await ingestCandidate(t.app, cand({ name: 'Policlínica Aljarafe Norte', website: undefined, phone: undefined, municipality: 'Dos Hermanas' }));
    expect(other.action).toBe('created');
    expect(other.prospectId).not.toBe(base.prospectId);
  });

  it('una ficha archivada también se encuentra y no cambia de estado', async () => {
    const r = await ingestCandidate(t.app, cand({ name: 'Archivada SL', website: 'https://archivada.es', phone: undefined }));
    await t.app.query(`update prospects set status = 'archived' where id = $1`, [r.prospectId]);
    const again = await ingestCandidate(t.app, cand({ name: 'Archivada SL', website: 'https://archivada.es', phone: undefined }));
    expect(again).toMatchObject({ action: 'merged', prospectId: r.prospectId });
    expect((await one<{ status: string }>('select status from prospects where id = $1', [r.prospectId])).status).toBe('archived');
  });

  it('cinco ingestas simultáneas del mismo dominio crean UNA sola ficha', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => ingestCandidate(t.app, cand({ name: 'Carrera SL', website: 'https://carrera.es', phone: undefined }))));
    expect(new Set(results.map((r) => r.prospectId)).size).toBe(1);
    expect(results.filter((r) => r.action === 'created')).toHaveLength(1);
    expect(await count(`select count(*) n from prospects where domain = 'carrera.es'`)).toBe(1);
  });
});

describe('clientes y oposiciones: la ficha queda bloqueada con motivo (REQ-VER-02 CA2)', () => {
  it('importar clientes por CSV y detectar a un cliente por dominio', async () => {
    const r = await importTurnosalaCustomers(t.app, 'org_id,name,domain,phone\norg-1,Clínica Cliente S.L.,https://www.clinicacliente.es,955 11 11 11\norg-2,Otro Cliente,,\n', { at: AT });
    expect(r).toMatchObject({ imported: 2 });
    const c = await ingestCandidate(t.app, cand({ name: 'Clínica Cliente', website: 'https://clinicacliente.es', phone: undefined }));
    expect(c).toMatchObject({ action: 'blocked', blockReason: 'customer' });
    expect(await one('select status, block_reason from prospects where id = $1', [c.prospectId])).toMatchObject({ status: 'blocked', block_reason: 'customer' });
  });

  it('por teléfono y por nombre muy parecido también', async () => {
    const byPhone = await ingestCandidate(t.app, cand({ name: 'Nombre cualquiera', website: undefined, phone: '955 11 11 11' }));
    expect(byPhone).toMatchObject({ action: 'blocked', blockReason: 'customer' });
    const byName = await ingestCandidate(t.app, cand({ name: 'Otro Cliente', website: undefined, phone: undefined }));
    expect(byName).toMatchObject({ action: 'blocked', blockReason: 'customer' });
  });

  it('si la ficha ya existía y luego se descubre que es cliente, esa ficha pasa a bloqueada (no se crea otra)', async () => {
    const r = await ingestCandidate(t.app, cand({ name: 'Futuro Cliente SL', website: 'https://futurocliente.es', phone: undefined }));
    await t.app.query(`update prospects set status = 'approved' where id = $1`, [r.prospectId]);
    await importTurnosalaCustomers(t.app, 'org_id,name,domain,phone\norg-9,Futuro Cliente SL,futurocliente.es,\n', { at: AT });
    const again = await ingestCandidate(t.app, cand({ name: 'Futuro Cliente SL', website: 'https://futurocliente.es', phone: undefined }));
    expect(again).toMatchObject({ action: 'blocked', prospectId: r.prospectId, blockReason: 'customer' });
    expect((await one<{ status: string }>('select status from prospects where id = $1', [r.prospectId])).status).toBe('blocked');
  });

  it('una oposición sobre el dominio o el teléfono bloquea con motivo «opposition»', async () => {
    await t.app.query(`insert into suppressions (id, kind, value, reason, origin) values ($1,'domain','opuesta.es','no contactar','crm'), ($2,'phone','+34955222222','no contactar','call')`, [uuidv7(), uuidv7()]);
    const a = await ingestCandidate(t.app, cand({ name: 'Opuesta SL', website: 'https://www.opuesta.es', phone: undefined }));
    const b = await ingestCandidate(t.app, cand({ name: 'Otra opuesta', website: undefined, phone: '955 22 22 22' }));
    expect(a).toMatchObject({ action: 'blocked', blockReason: 'opposition' });
    expect(b).toMatchObject({ action: 'blocked', blockReason: 'opposition' });
  });

  it('cada bloqueo deja constancia en audit_log', async () => {
    expect(await count(`select count(*) n from audit_log where action = 'prospect.blocked'`)).toBeGreaterThanOrEqual(5);
  });
});

describe('entrada inválida y restricciones de la BD (P2.2)', () => {
  it('una fuente inexistente, un nombre vacío o una evidencia sin URL → error y nada se guarda', async () => {
    const before = await count('select count(*) n from prospects');
    await expect(ingestCandidate(t.app, cand({ sourceId: 'no_existe' }))).rejects.toThrow();
    await expect(ingestCandidate(t.app, cand({ name: '  ' }))).rejects.toThrow();
    await expect(ingestCandidate(t.app, cand({ evidences: [{ field: 'x', value: 'y', provenance: 'observed', sourceUrl: '', fetchedAt: AT }] }))).rejects.toThrow();
    expect(await count('select count(*) n from prospects')).toBe(before);
  });

  it('una evidencia inferida sin explicación o con una cita de más de 300 caracteres la rechaza la propia BD', async () => {
    const id = (await one<{ id: string }>(`select id from prospects where domain = 'clinicasol.es'`)).id;
    const ins = (provenance: string, explanation: string | null, quote: string | null): Promise<unknown> =>
      t.app.query(`insert into evidences (id, prospect_id, field, value, provenance, explanation, source_url, quote, fetched_at, extractor_version) values ($1,$2,'f','v',$3,$4,'https://x.es',$5,now(),'t')`,
        [uuidv7(), id, provenance, explanation, quote]);
    await expect(ins('inferred', null, null)).rejects.toThrow(/check/);
    await expect(ins('inferred', '   ', null)).rejects.toThrow(/check/);
    await expect(ins('observed', null, 'x'.repeat(301))).rejects.toThrow(/check/);
    await expect(ins('observed', null, 'x'.repeat(300))).resolves.toBeDefined();
  });
});

describe('equivalencia con pg_trgm', () => {
  it('trigramSimilarity coincide con similarity() de PostgreSQL', async () => {
    const pairs: Array<[string, string]> = [['clinica dental sol', 'clinica dental sol sevilla'], ['optica ruiz', 'optica ruis'], ['abc', 'xyz'], ['fisio salud', 'fisio y salud sevilla'], ['policlinica aljarafe norte', 'policlinica aljarafe']];
    for (const [a, b] of pairs) {
      const pg = Number((await one<{ s: string }>('select similarity($1, $2)::float8 as s', [a, b])).s);
      expect(trigramSimilarity(a, b), `${a} / ${b}`).toBeCloseTo(pg, 5);
    }
  });
});
