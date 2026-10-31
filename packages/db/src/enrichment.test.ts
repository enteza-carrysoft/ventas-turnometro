import type { VerifiedExtraction } from '@turnosala/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveEnrichment } from './enrichment.js';
import { ingestCandidate } from './ingest.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
const AT = new Date('2026-11-10T10:00:00Z');
const U1 = 'https://clinicasol.es/';
const U2 = 'https://clinicasol.es/contacto';

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const one = async <T extends Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> => (await t.app.query(sql, args)).rows[0] as T;
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await one<{ n: string }>(sql, args)).n);

async function newProspect(name: string, domain: string): Promise<string> {
  const r = await ingestCandidate(t.app, { name, website: `https://${domain}/`, sourceId: 'corporate_web', externalId: '', sourceUrl: `https://${domain}/`, fetchedAt: AT, extractorVersion: 'test-1', evidences: [] });
  return r.prospectId as string;
}

const verified = (over: Partial<VerifiedExtraction> = {}): VerifiedExtraction => ({
  fields: [{ key: 'sites_count', value: '2', provenance: 'observed', explanation: null, sourceUrl: U1, quote: 'Nuestros dos centros' }],
  signals: [{ key: 'varias_consultas', quote: 'Tenemos 3 consultas', sourceUrl: U1 }, { key: 'tv_en_sala', quote: 'TV en sala con turnos', sourceUrl: U1 }],
  contactPoints: [{ type: 'switchboard_phone', value: '+34954123456', sourceUrl: U2, quote: 'Llámanos al 954 12 34 56' }, { type: 'generic_email', value: 'info@clinicasol.es', sourceUrl: U2, quote: 'info@clinicasol.es' }],
  legalForm: { value: 'company', sourceUrl: U1, quote: 'Clínica Dental Sol, S.L.' },
  metrics: { accepted: 6, rejected: {} as never, personalEmailsDiscarded: 0, hallucinationRejected: 0 },
  ...over,
});
const OPTS = { fetchedAt: AT, extractorVersion: 'extract-v1' };

describe('saveEnrichment (REQ-ENR-01, REQ-ENR-03, REQ-SCO-01, P2.2)', () => {
  it('guarda cada dato con su fuente y cita, enlaza los contactos a su evidencia y pasa la ficha a «enriched»', async () => {
    const id = await newProspect('Clínica Dental Sol, S.L.', 'clinicasol.es');
    const r = await saveEnrichment(t.app, id, verified(), OPTS);
    expect(r).toMatchObject({ saved: true });
    const p = await one<Record<string, unknown>>('select * from prospects where id = $1', [id]);
    expect(p).toMatchObject({ status: 'enriched', sites_count: 2, legal_form: 'company' });
    const sig = await one<Record<string, unknown>>(`select * from evidences where prospect_id = $1 and field = 'signal:varias_consultas'`, [id]);
    expect(sig).toMatchObject({ provenance: 'observed', source_url: U1, quote: 'Tenemos 3 consultas', extractor_version: 'extract-v1' });
    const cp = await one<Record<string, unknown>>(`select cp.type, cp.value_norm, cp.valid, e.source_url, e.quote from contact_points cp join evidences e on e.id = cp.evidence_id where cp.prospect_id = $1 and cp.type = 'switchboard_phone'`, [id]);
    expect(cp).toMatchObject({ value_norm: '+34954123456', valid: null, source_url: U2, quote: 'Llámanos al 954 12 34 56' });
  });

  it('puntúa la ficha con el modelo vigente a partir de las señales con evidencia', async () => {
    const id = await newProspect('Consultas Luna, S.L.', 'consultasluna.es');
    await saveEnrichment(t.app, id, verified(), OPTS);
    const p = await one<{ score: number; tier: string; scoring_version: number; score_reasoning: string; score_breakdown: { simultaneous_attention: { points: number } } }>('select * from prospects where id = $1', [id]);
    expect(p.score).toBe(40); // 25 (varias_consultas) + 15 (tv_en_sala)
    expect(p).toMatchObject({ tier: 'nurture', scoring_version: 1 });
    expect(p.score_breakdown.simultaneous_attention.points).toBe(25);
    expect(p.score_reasoning).toContain(U1);
  });

  it('es idempotente: repetir el guardado no duplica evidencias ni contactos', async () => {
    const id = await newProspect('Clínica Mar, S.L.', 'clinicamar.es');
    await saveEnrichment(t.app, id, verified(), OPTS);
    const before = [await count('select count(*) n from evidences where prospect_id = $1', [id]), await count('select count(*) n from contact_points where prospect_id = $1', [id])];
    await saveEnrichment(t.app, id, verified(), OPTS);
    expect([await count('select count(*) n from evidences where prospect_id = $1', [id]), await count('select count(*) n from contact_points where prospect_id = $1', [id])]).toEqual(before);
  });

  it('una segunda pasada con más señales recalcula la puntuación con TODAS las evidencias acumuladas', async () => {
    const id = await newProspect('Centro Río, S.L.', 'centrorio.es');
    await saveEnrichment(t.app, id, verified({ signals: [{ key: 'tv_en_sala', quote: 'TV en sala', sourceUrl: U1 }] }), OPTS);
    expect((await one<{ score: number }>('select score from prospects where id = $1', [id])).score).toBe(15);
    await saveEnrichment(t.app, id, verified({ signals: [{ key: 'varias_consultas', quote: 'Tenemos 3 consultas', sourceUrl: U1 }] }), OPTS);
    expect((await one<{ score: number }>('select score from prospects where id = $1', [id])).score).toBe(40);
  });

  it('una ficha bloqueada o archivada no se enriquece ni se puntúa', async () => {
    const id = await newProspect('Bloqueada, S.L.', 'bloqueada.es');
    await t.admin.query(`update prospects set status = 'blocked', block_reason = 'opposition' where id = $1`, [id]);
    const base = await count('select count(*) n from evidences where prospect_id = $1', [id]);
    expect(await saveEnrichment(t.app, id, verified(), OPTS)).toMatchObject({ saved: false, reason: 'not_enrichable' });
    expect(await count('select count(*) n from evidences where prospect_id = $1', [id])).toBe(base);
    expect(await saveEnrichment(t.app, '00000000-0000-7000-8000-000000000000', verified(), OPTS)).toMatchObject({ saved: false, reason: 'not_found' });
  });

  it('un fallo a mitad no deja datos a medias (transacción)', async () => {
    const id = await newProspect('Atómica, S.L.', 'atomica.es');
    const bad = verified({ contactPoints: [{ type: 'switchboard_phone', value: '+34954123456', sourceUrl: '', quote: 'x' }] }); // source_url vacío: viola el CHECK
    const base = await count('select count(*) n from evidences where prospect_id = $1', [id]);
    await expect(saveEnrichment(t.app, id, bad, OPTS)).rejects.toThrow();
    expect(await count('select count(*) n from evidences where prospect_id = $1', [id])).toBe(base);
    expect((await one<{ status: string }>('select status from prospects where id = $1', [id])).status).toBe('candidate');
  });
});
