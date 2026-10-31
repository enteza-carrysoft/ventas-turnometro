import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestCandidate } from './ingest.js';
import { annotateVerification } from './verification.js';
import { createTestDb, type TestDb } from './testing.js';

let t: TestDb;
let id: string;
const AT = new Date('2026-11-10T10:00:00Z');
const URL1 = 'https://clinicasol.es/';

beforeAll(async () => {
  t = await createTestDb();
  const r = await ingestCandidate(t.app, {
    name: 'Clínica Sol S.L.', website: URL1, email: 'info@clinicasol.es', sourceId: 'corporate_web', sourceUrl: URL1, fetchedAt: AT, extractorVersion: 't',
  });
  id = r.prospectId;
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const email = async () => (await t.app.query(`select valid, invalid_reason, checked_at from contact_points where prospect_id = $1 and type = 'generic_email'`, [id])).rows[0];
const webEvidence = async () => (await t.app.query(`select value, provenance, source_url from evidences where prospect_id = $1 and field = 'web_check' order by value`, [id])).rows;

describe('annotateVerification: los fallos se anotan (REQ-VER-01 CA2)', () => {
  it('MX correcto → el email queda válido y comprobado', async () => {
    await annotateVerification(t.app, id, { emails: [{ email: 'info@clinicasol.es', check: { ok: true } }] }, AT);
    expect(await email()).toMatchObject({ valid: true, invalid_reason: null });
  });

  it('sin MX → inválido con motivo «no_mx»', async () => {
    await annotateVerification(t.app, id, { emails: [{ email: 'info@clinicasol.es', check: { ok: false, reason: 'no_mx' } }] }, AT);
    expect(await email()).toMatchObject({ valid: false, invalid_reason: 'no_mx' });
  });

  it('un fallo temporal de DNS NO invalida el email: queda sin decidir y con el motivo anotado', async () => {
    await annotateVerification(t.app, id, { emails: [{ email: 'info@clinicasol.es', check: { ok: false, reason: 'dns_error' } }] }, AT);
    expect(await email()).toMatchObject({ valid: null, invalid_reason: 'dns_error' });
  });

  it('web que responde → evidencia observada «ok» con la URL', async () => {
    await annotateVerification(t.app, id, { web: { url: URL1, check: { ok: true, status: 200 } } }, AT);
    expect(await webEvidence()).toEqual([{ value: 'ok', provenance: 'observed', source_url: URL1 }]);
  });

  it('web caída o con error HTTP → se anota el motivo', async () => {
    await annotateVerification(t.app, id, { web: { url: URL1, check: { ok: false, reason: 'http_error', status: 404 } } }, AT);
    await annotateVerification(t.app, id, { web: { url: URL1, check: { ok: false, reason: 'unreachable' } } }, AT);
    expect((await webEvidence()).map((r: { value: string }) => r.value)).toEqual(['http_404', 'ok', 'unreachable']);
  });

  it('repetir la misma comprobación no duplica la evidencia', async () => {
    const before = (await webEvidence()).length;
    await annotateVerification(t.app, id, { web: { url: URL1, check: { ok: false, reason: 'unreachable' } } }, AT);
    expect((await webEvidence()).length).toBe(before);
  });

  it('una ficha inexistente da error y no escribe nada', async () => {
    await expect(annotateVerification(t.app, '00000000-0000-7000-8000-000000000000', { web: { url: URL1, check: { ok: true, status: 200 } } }, AT)).rejects.toThrow();
  });
});
