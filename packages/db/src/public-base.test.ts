import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveConsentText, createConsentTextDraft, currentConsentTexts, CONSENT_BOXES } from './consent-texts.js';
import { checkFormRate } from './form-limits.js';
import { ingestCandidate } from './ingest.js';
import { createPublicToken, resolvePublicToken, revokePublicToken } from './tokens.js';
import { createTestDb, type TestDb } from './testing.js';
import { uuidv7 } from './uuid.js';

let t: TestDb;
let prospectId: string;
const AT = new Date('2026-11-10T10:00:00Z');
const plusMin = (m: number): Date => new Date(AT.getTime() + m * 60_000);

beforeAll(async () => {
  t = await createTestDb();
  await t.app.query(`insert into "user" ("id","name","email","emailVerified") values ('u-adm','Ana','ana@x.test',true)`);
  prospectId = (await ingestCandidate(t.app, { name: 'Clínica Token Sur S.L.', website: 'https://tokensur.es/', phone: '955 111 222', sourceId: 'osm', externalId: 'tk1', sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] })).prospectId as string;
}, 60_000);
afterAll(async () => {
  await t.drop();
});

describe('tokens públicos (REQ-CNS-01, REQ-CNS-03 CA2): 128 bits aleatorios, en BD solo su hash', () => {
  it('devuelve un token de 22 caracteres url-safe (128 bits) y guarda SOLO el hash SHA-256', async () => {
    const { token } = await createPublicToken(t.app, { kind: 'landing', prospectId });
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const hash = createHash('sha256').update(token).digest('hex');
    const row = (await t.app.query('select token_hash from public_tokens where prospect_id = $1', [prospectId])).rows.map((r) => r.token_hash as string);
    expect(row).toContain(hash);
    const all = JSON.stringify((await t.app.query('select * from public_tokens')).rows);
    expect(all).not.toContain(token); // el token en claro no está en ninguna columna
  });

  it('resuelve el token a su ficha, campaña y contacto, y solo para su tipo', async () => {
    const campaignId = null;
    const { token } = await createPublicToken(t.app, { kind: 'unsubscribe', prospectId, contact: { email: 'Info@TokenSur.es' } });
    expect(await resolvePublicToken(t.app, 'unsubscribe', token)).toEqual({ prospectId, campaignId, contact: { email: 'info@tokensur.es', phone: null } });
    expect(await resolvePublicToken(t.app, 'landing', token)).toBeNull(); // un token de baja no abre una landing
  });

  it('un token distinto, mal formado, vacío o con caracteres raros no resuelve (y no llega a la BD)', async () => {
    const { token } = await createPublicToken(t.app, { kind: 'landing', prospectId });
    const other = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const bad of [other, '', 'corto', 'x'.repeat(23), `${token}'; drop table public_tokens;--`, token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase()]) {
      expect(await resolvePublicToken(t.app, 'landing', bad), bad).toBeNull();
    }
    expect(await resolvePublicToken(t.app, 'landing', token)).not.toBeNull();
  });

  it('caducado o revocado no resuelve', async () => {
    const a = await createPublicToken(t.app, { kind: 'landing', prospectId, expiresAt: plusMin(60) });
    expect(await resolvePublicToken(t.app, 'landing', a.token, plusMin(30))).not.toBeNull();
    expect(await resolvePublicToken(t.app, 'landing', a.token, plusMin(61))).toBeNull();
    const b = await createPublicToken(t.app, { kind: 'landing', prospectId });
    await revokePublicToken(t.app, b.id);
    expect(await resolvePublicToken(t.app, 'landing', b.token)).toBeNull();
  });

  it('cada token es distinto', async () => {
    const tokens = await Promise.all(Array.from({ length: 20 }, () => createPublicToken(t.app, { kind: 'landing', prospectId })));
    expect(new Set(tokens.map((x) => x.token)).size).toBe(20);
  });

  it('el tipo y la ficha se validan en BD', async () => {
    await expect(t.app.query(`insert into public_tokens (id, kind, token_hash, prospect_id) values ($1,'otro','h',$2)`, [uuidv7(), prospectId])).rejects.toThrow(/check/i);
    await expect(t.app.query(`insert into public_tokens (id, kind, token_hash, prospect_id) values ($1,'landing','h2',$2)`, [uuidv7(), uuidv7()])).rejects.toThrow(/foreign key|violates/i);
  });
});

describe('textos de consentimiento versionados (REQ-CNS-01 CA1, REQ-CNS-02)', () => {
  it('hay un borrador sembrado para cada casilla y para la información básica de privacidad', async () => {
    expect([...CONSENT_BOXES].sort()).toEqual(['ai_call', 'email', 'human_call', 'privacy', 'sms_whatsapp']);
    const rows = (await t.app.query('select box, version, status from consent_texts order by box')).rows;
    expect(rows.map((r) => [r.box, r.status])).toEqual([['ai_call', 'draft'], ['email', 'draft'], ['human_call', 'draft'], ['privacy', 'draft'], ['sms_whatsapp', 'draft']]);
  });

  it('en sandbox se usan los borradores marcados como sin aprobar; en producción no hay formulario hasta que todos estén aprobados', async () => {
    const sandbox = await currentConsentTexts(t.app, { requireApproved: false });
    expect(sandbox.ok).toBe(true);
    if (sandbox.ok) expect(sandbox.allApproved).toBe(false);
    const prod = await currentConsentTexts(t.app, { requireApproved: true });
    expect(prod).toMatchObject({ ok: false });
    if (!prod.ok) expect([...prod.unapproved].sort()).toEqual(['ai_call', 'email', 'human_call', 'privacy', 'sms_whatsapp']);
  });

  it('solo un admin crea versiones y aprueba; al aprobar todas, producción ya puede mostrar el formulario con esos textos exactos', async () => {
    expect(await approveConsentText(t.app, uuidv7(), { userId: 'u-adm', role: 'sales' })).toEqual({ ok: false, reason: 'forbidden' });
    for (const box of CONSENT_BOXES) {
      const d = await createConsentTextDraft(t.app, box, { version: 'v1', text: `Texto aprobado de ${box}` }, { userId: 'u-adm', role: 'admin' });
      expect(d.ok).toBe(true);
      if (d.ok) expect(await approveConsentText(t.app, d.id, { userId: 'u-adm', role: 'admin' })).toEqual({ ok: true });
    }
    const prod = await currentConsentTexts(t.app, { requireApproved: true });
    expect(prod.ok).toBe(true);
    if (prod.ok) {
      expect(prod.allApproved).toBe(true);
      expect(prod.texts.email).toMatchObject({ version: 'v1', text: 'Texto aprobado de email', approved: true });
    }
  });

  it('una versión aprobada es inmutable (ni el texto ni borrarla), y una versión nueva en borrador no desplaza a la aprobada en producción', async () => {
    const v1 = (await t.app.query(`select id from consent_texts where box = 'email' and version = 'v1'`)).rows[0] as { id: string };
    await expect(t.app.query(`update consent_texts set text = 'trampa' where id = $1`, [v1.id])).rejects.toThrow(/aprobad/i);
    await expect(t.app.query(`delete from consent_texts where id = $1`, [v1.id])).rejects.toThrow(/aprobad/i);
    await createConsentTextDraft(t.app, 'email', { version: 'v2', text: 'Borrador nuevo' }, { userId: 'u-adm', role: 'admin' });
    const prod = await currentConsentTexts(t.app, { requireApproved: true });
    if (prod.ok) expect(prod.texts.email.version).toBe('v1');
    const sandbox = await currentConsentTexts(t.app, { requireApproved: false });
    if (sandbox.ok) expect(sandbox.texts.email.version).toBe('v1'); // lo aprobado manda también en sandbox
  });

  it('versión repetida, texto vacío y rol sin permiso se rechazan', async () => {
    const admin = { userId: 'u-adm', role: 'admin' as const };
    expect(await createConsentTextDraft(t.app, 'email', { version: 'v1', text: 'otra vez' }, admin)).toEqual({ ok: false, reason: 'version_exists' });
    expect(await createConsentTextDraft(t.app, 'email', { version: 'v9', text: '   ' }, admin)).toEqual({ ok: false, reason: 'invalid' });
    expect(await createConsentTextDraft(t.app, 'email', { version: 'v9', text: 'x' }, { userId: 'u', role: 'marketing' })).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('fuente inbound_form', () => {
  it('existe (para la clave foránea de prospect_sources) pero está INACTIVA: no es una fuente de investigación y no puede usarse en trabajos', async () => {
    const r = (await t.app.query(`select active from allowed_sources where id = 'inbound_form'`)).rows[0] as { active: boolean };
    expect(r.active).toBe(false);
  });
});

describe('límite de envíos por IP (REQ-CNS-01 CA3) sin guardar la IP en claro', () => {
  const opts = { limit: 3, windowMs: 3_600_000 };

  it('permite hasta el límite y bloquea el siguiente; ventana deslizante', async () => {
    const k = { ipHmac: 'ip-a', kind: 'demo_request', ...opts };
    expect((await checkFormRate(t.app, { ...k, now: AT })).allowed).toBe(true);
    expect((await checkFormRate(t.app, { ...k, now: plusMin(1) })).allowed).toBe(true);
    expect((await checkFormRate(t.app, { ...k, now: plusMin(2) })).allowed).toBe(true);
    expect((await checkFormRate(t.app, { ...k, now: plusMin(3) })).allowed).toBe(false);
    expect((await checkFormRate(t.app, { ...k, now: plusMin(61) })).allowed).toBe(true); // salen de la ventana los 3 primeros
  });

  it('cada IP y cada tipo de formulario llevan su cuenta', async () => {
    for (let i = 0; i < 3; i++) await checkFormRate(t.app, { ipHmac: 'ip-b', kind: 'demo_request', ...opts, now: AT });
    expect((await checkFormRate(t.app, { ipHmac: 'ip-b', kind: 'demo_request', ...opts, now: AT })).allowed).toBe(false);
    expect((await checkFormRate(t.app, { ipHmac: 'ip-c', kind: 'demo_request', ...opts, now: AT })).allowed).toBe(true);
    expect((await checkFormRate(t.app, { ipHmac: 'ip-b', kind: 'unsubscribe', ...opts, now: AT })).allowed).toBe(true);
  });

  it('con peticiones simultáneas nunca se supera el límite', async () => {
    const res = await Promise.all(Array.from({ length: 10 }, () => checkFormRate(t.app, { ipHmac: 'ip-d', kind: 'demo_request', ...opts, now: AT })));
    expect(res.filter((r) => r.allowed)).toHaveLength(3);
  });
});
