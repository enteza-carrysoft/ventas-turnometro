import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productFactsSchema } from '../product/facts.js';
import { CONSENT_GRANTS, estimateAnnualValue, isWebmailDomain, parseDemoRequest } from './demo-request.js';

const ok = (over: Record<string, unknown> = {}) => ({ name: 'Ana Pérez', email: 'ana@clinicasol.es', phone: '954 12 34 56', company: 'Clínica Sol', ...over });

describe('parseDemoRequest (REQ-CNS-01 CA3: validación de email y teléfono)', () => {
  it('normaliza: email en minúsculas, teléfono en E.164 y texto recortado', () => {
    const r = parseDemoRequest(ok({ name: '  Ana   Pérez ', email: 'Ana@ClinicaSol.ES', phone: '954 12 34 56', company: ' Clínica   Sol ' }), { hasToken: false });
    expect(r).toEqual({ ok: true, data: { name: 'Ana Pérez', email: 'ana@clinicasol.es', phone: '+34954123456', company: 'Clínica Sol', boxes: { email: false, human_call: false, ai_call: false, sms_whatsapp: false } } });
  });

  it('exige al menos un medio de contacto: email o teléfono', () => {
    expect(parseDemoRequest(ok({ email: '', phone: '' }), { hasToken: false })).toMatchObject({ ok: false, errors: { contact: expect.any(String) } });
    expect(parseDemoRequest(ok({ email: '' }), { hasToken: false }).ok).toBe(true);
    expect(parseDemoRequest(ok({ phone: '' }), { hasToken: false }).ok).toBe(true);
  });

  it.each(['no-es-un-email', 'a@b', 'a b@c.es', '@x.es', 'x@.es'])('rechaza el email inválido %j', (email) => {
    expect(parseDemoRequest(ok({ email }), { hasToken: false })).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
  });

  it.each(['123', '902 12 34 56', '900 11 22 33', 'abcdefghi', '+1 202 555 0100'])('rechaza el teléfono que no sirve para llamar: %j', (phone) => {
    expect(parseDemoRequest(ok({ phone }), { hasToken: false })).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
  });

  it('acepta un móvil y un fijo españoles en varios formatos', () => {
    for (const [raw, e164] of [['600 11 22 33', '+34600112233'], ['+34 600112233', '+34600112233'], ['0034954123456', '+34954123456'], ['954123456', '+34954123456']] as const) {
      expect(parseDemoRequest(ok({ phone: raw }), { hasToken: false })).toMatchObject({ ok: true, data: { phone: e164 } });
    }
  });

  it('la empresa es obligatoria sin token (landing de sector) y opcional con token (la ficha ya consta)', () => {
    expect(parseDemoRequest(ok({ company: '' }), { hasToken: false })).toMatchObject({ ok: false, errors: { company: expect.any(String) } });
    expect(parseDemoRequest(ok({ company: '' }), { hasToken: true })).toMatchObject({ ok: true, data: { company: null } });
  });

  it('el nombre es obligatorio, sin caracteres de control y con límites', () => {
    expect(parseDemoRequest(ok({ name: '' }), { hasToken: false }).ok).toBe(false);
    expect(parseDemoRequest(ok({ name: 'x'.repeat(121) }), { hasToken: false }).ok).toBe(false);
    expect(parseDemoRequest(ok({ name: 'Ana\u0000\u0007 Pérez' }), { hasToken: false })).toMatchObject({ ok: true, data: { name: 'Ana Pérez' } });
    expect(parseDemoRequest(ok({ company: 'x'.repeat(161) }), { hasToken: false }).ok).toBe(false);
    expect(parseDemoRequest(ok({ email: `${'a'.repeat(250)}@x.es` }), { hasToken: false }).ok).toBe(false);
  });

  it('las casillas son explícitas: «on», true y «true» marcan; cualquier otra cosa o la ausencia NO marca (nunca por defecto)', () => {
    const r = parseDemoRequest(ok({ box_email: 'on', box_human_call: true, box_ai_call: 'true', box_sms_whatsapp: 'no' }), { hasToken: false });
    expect(r).toMatchObject({ ok: true, data: { boxes: { email: true, human_call: true, ai_call: true, sms_whatsapp: false } } });
    expect(parseDemoRequest(ok({ box_email: '1', box_human_call: 'yes', box_ai_call: 1 }), { hasToken: false })).toMatchObject({ data: { boxes: { email: false, human_call: false, ai_call: false } } });
  });

  it('cada casilla exige el dato al que se aplica: email para (a); teléfono para (b), (c) y (d)', () => {
    expect(parseDemoRequest(ok({ email: '', box_email: 'on' }), { hasToken: false })).toMatchObject({ ok: false, errors: { box_email: expect.any(String) } });
    for (const box of ['box_human_call', 'box_ai_call', 'box_sms_whatsapp']) {
      expect(parseDemoRequest(ok({ phone: '', [box]: 'on' }), { hasToken: false }), box).toMatchObject({ ok: false, errors: { [box]: expect.any(String) } });
    }
  });

  it('un campo oculto relleno es un robot: se rechaza como tal', () => {
    expect(parseDemoRequest(ok({ website_url: 'http://spam.example' }), { hasToken: false })).toEqual({ ok: false, errors: {}, bot: true });
  });

  it('un valor que no es texto no rompe nada', () => {
    expect(parseDemoRequest({ name: { a: 1 }, email: ['x'], phone: 5, company: null }, { hasToken: false }).ok).toBe(false);
    expect(parseDemoRequest(null, { hasToken: false }).ok).toBe(false);
  });
});

describe('CONSENT_GRANTS: cada casilla crea los consentimientos EXACTOS que la puerta entiende (canal, finalidad, destino)', () => {
  it('correspondencia casilla → (canal, finalidad, dato)', () => {
    expect(CONSENT_GRANTS.email).toEqual([{ channel: 'email', purpose: 'prospecting', to: 'email' }, { channel: 'email', purpose: 'demo_followup', to: 'email' }]);
    expect(CONSENT_GRANTS.human_call).toEqual([{ channel: 'human_call', purpose: 'prospecting', to: 'phone' }, { channel: 'human_call', purpose: 'demo_followup', to: 'phone' }]);
    expect(CONSENT_GRANTS.ai_call).toEqual([{ channel: 'ai_call', purpose: 'prospecting', to: 'phone' }, { channel: 'ai_call', purpose: 'demo_followup', to: 'phone' }]);
    expect(CONSENT_GRANTS.sms_whatsapp).toEqual([{ channel: 'sms', purpose: 'demo_confirmation', to: 'phone' }, { channel: 'whatsapp', purpose: 'demo_confirmation', to: 'phone' }]);
  });

  it('la casilla (d) solo habilita la CONFIRMACIÓN de la demo, nunca prospección ni seguimiento comercial', () => {
    expect(CONSENT_GRANTS.sms_whatsapp.every((g) => g.purpose === 'demo_confirmation')).toBe(true);
  });
});

describe('isWebmailDomain', () => {
  it.each(['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.es', 'icloud.com', 'proton.me', 'live.com', 'telefonica.net'])('%s es correo personal', (d) => expect(isWebmailDomain(d)).toBe(true));
  it.each(['clinicasol.es', 'gmail.com.evil.es', 'opticagmail.es', 'miempresa.com'])('%s no lo es', (d) => expect(isWebmailDomain(d)).toBe(false));
});

describe('estimateAnnualValue (REQ-CRM-01: plan propuesto × 12 meses, de product_facts)', () => {
  const facts = productFactsSchema.parse(JSON.parse(readFileSync(new URL('../../../db/seeds/product-facts.v1.json', import.meta.url), 'utf8')));
  it('Profesional = 69 × 12 = 828 €', () => expect(estimateAnnualValue(facts, 'pro')).toBe(828));
  it('Básico y Business', () => {
    expect(estimateAnnualValue(facts, 'basic')).toBe(288);
    expect(estimateAnnualValue(facts, 'business')).toBe(1788);
  });
  it('Enterprise (solo presupuesto) y un plan inexistente no tienen importe', () => {
    expect(estimateAnnualValue(facts, 'enterprise')).toBeNull();
    expect(estimateAnnualValue(facts, 'no-existe')).toBeNull();
  });
});
