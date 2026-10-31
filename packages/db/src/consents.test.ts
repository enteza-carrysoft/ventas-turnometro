import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertConsent } from './consents.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});

const ok = {
  channel: 'ai_call',
  purpose: 'demo',
  action: 'grant',
  phone: '+34600111222',
  textVersion: 'ai_call-v1',
  textSnapshot: 'Acepto que un asistente de IA me llame.',
  sourceUrl: 'https://go.turnosala.com/demo/clinicas',
} as const;

describe('T-13 consentimiento por la aplicación (REQ-CNS-02)', () => {
  it('guarda un consentimiento completo', async () => {
    const id = await insertConsent(t.app, ok);
    const r = await t.app.query(`select text_version from consents where id = $1`, [id]);
    expect(r.rows[0]?.text_version).toBe('ai_call-v1');
  });
  it('rechaza sin texto', async () => {
    await expect(insertConsent(t.app, { ...ok, textSnapshot: '  ' })).rejects.toThrow();
  });
  it('rechaza sin versión', async () => {
    await expect(insertConsent(t.app, { ...ok, textVersion: '' })).rejects.toThrow();
  });
  it('rechaza sin origen', async () => {
    await expect(insertConsent(t.app, { ...ok, sourceUrl: '' })).rejects.toThrow();
  });
  it('rechaza sin teléfono ni email', async () => {
    await expect(insertConsent(t.app, { ...ok, phone: null })).rejects.toThrow();
  });
  it('rechaza un canal desconocido', async () => {
    await expect(insertConsent(t.app, { ...ok, channel: 'carrier_pigeon' as never })).rejects.toThrow();
  });
  it('no se guardó ninguna fila inválida', async () => {
    const r = await t.app.query(`select count(*)::int as n from consents`);
    expect(r.rows[0]?.n).toBe(1);
  });
});

describe('uuidv7', () => {
  it('tiene formato v7 y ordena por tiempo', () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(uuidv7()).not.toBe(uuidv7());
  });
});
