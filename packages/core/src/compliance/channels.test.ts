import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate.js';
import {
  attempt, CAMP, ctx, days, demo, DEMO_ID, EMAIL_ADDR, grant, input, TUE_11, withdraw,
} from './fixtures.js';

const rule = (r: ReturnType<typeof evaluate>): string => `${r.decision} ${r.ruleIds[0]}`;
const withFlags = (f: Partial<ReturnType<typeof ctx>['settings']>) => ({ ...ctx().settings, ...f });

describe('IA de voz: CG-10 / CG-11 / CG-12', () => {
  it('T-01 saliente con teléfono público y sin consentimiento → BLOCK CG-12', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx()))).toBe('BLOCK CG-12');
  });
  it('T-02 saliente con consentimiento ai_call válido, martes 11:00 → ALLOW CG-11 con consentId', () => {
    const r = evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call')] }));
    expect(rule(r)).toBe('ALLOW CG-11');
    expect(r.consentId).toBe('consent-ai_call-1');
  });
  it('T-03b solo retirada del consentimiento (sin suppressions) → BLOCK CG-12', () => {
    const r = evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call'), withdraw('ai_call')] }));
    expect(rule(r)).toBe('BLOCK CG-12');
  });
  it('una nueva concesión posterior a la retirada vuelve a valer', () => {
    const c = ctx({ consents: [grant('ai_call'), withdraw('ai_call', { createdAt: days(3) }), grant('ai_call', { id: 'nuevo', createdAt: days(2) })] });
    expect(evaluate(input('ai_call', 'prospecting'), c).consentId).toBe('nuevo');
  });
  it('T-04 consentimiento para otro teléfono → BLOCK CG-12', () => {
    const c = ctx({ consents: [grant('ai_call', { phone: '+34699999999' })] });
    expect(rule(evaluate(input('ai_call', 'prospecting'), c))).toBe('BLOCK CG-12');
  });
  it('finalidad distinta → BLOCK; consentimiento de otro canal (human_call, email) → BLOCK', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call', { purpose: 'demo_followup' })] })))).toBe('BLOCK CG-12');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('human_call'), grant('email')] })))).toBe('BLOCK CG-12');
  });
  it('REQ-CNS-04: caduca a los 12 meses o al cerrar la campaña', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call', { createdAt: days(366) })] })))).toBe('BLOCK CG-12');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call', { createdAt: days(364) })] })))).toBe('ALLOW CG-11');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call')], closedCampaignIds: [CAMP] })))).toBe('BLOCK CG-12');
  });
  it('CG-12 nunca devuelve REVIEW, ni con todos los flags jurídicos activos', () => {
    const s = withFlags({ b2bHumanCallsApproved: true, postalB2bApproved: true, lssiCustomerExceptionApproved: true });
    expect(evaluate(input('ai_call', 'prospecting'), ctx({ settings: s })).decision).toBe('BLOCK');
  });
  it('CG-10 entrante de un número no excluido → ALLOW', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting', { direction: 'inbound' }), ctx()))).toBe('ALLOW CG-10');
  });
});

describe('Llamada humana: CG-20 / CG-21 / CG-22', () => {
  const on = { settings: withFlags({ b2bHumanCallsApproved: true }) };
  it('CG-20 con consentimiento human_call vigente → ALLOW', () => {
    const r = evaluate(input('human_call', 'prospecting'), ctx({ consents: [grant('human_call')] }));
    expect(rule(r)).toBe('ALLOW CG-20');
  });
  it('CG-20 negativo: consentimiento retirado → no ALLOW', () => {
    const r = evaluate(input('human_call', 'prospecting'), ctx({ consents: [grant('human_call'), withdraw('human_call')] }));
    expect(r.decision).not.toBe('ALLOW');
  });
  it('T-09 prospección sin b2b_human_calls_approved → BLOCK CG-22', () => {
    expect(rule(evaluate(input('human_call', 'prospecting'), ctx()))).toBe('BLOCK CG-22');
  });
  it('T-10 a centralita con aprobación, empresa company → REVIEW CG-21', () => {
    expect(rule(evaluate(input('human_call', 'prospecting'), ctx(on)))).toBe('REVIEW CG-21');
  });
  it('CG-21 negativo: móvil, o finalidad distinta → BLOCK CG-22', () => {
    expect(rule(evaluate(input('human_call', 'prospecting'), ctx({ ...on, phoneType: 'mobile_phone' })))).toBe('BLOCK CG-22');
    expect(rule(evaluate(input('human_call', 'trial_help'), ctx(on)))).toBe('BLOCK CG-22');
  });
});

describe('Email: CG-30 / CG-31 / CG-32', () => {
  it('CG-30 con consentimiento email vigente → ALLOW', () => {
    expect(rule(evaluate(input('email_marketing', 'prospecting'), ctx({ consents: [grant('email')] })))).toBe('ALLOW CG-30');
  });
  it('CG-30 distingue mayúsculas del email (coincidencia exacta en minúsculas)', () => {
    const r = evaluate(input('email_marketing', 'prospecting', { email: 'RECEPCION@ClinicaEjemplo.es' }), ctx({ consents: [grant('email')] }));
    expect(rule(r)).toBe('ALLOW CG-30');
  });
  it('T-08 info@ encontrado en la web → BLOCK CG-32', () => {
    const r = evaluate(input('email_marketing', 'prospecting', { email: 'info@empresa.es' }), ctx());
    expect(rule(r)).toBe('BLOCK CG-32');
  });
  it('CG-31 cliente previo con excepción aprobada → REVIEW; sin la excepción → BLOCK CG-32', () => {
    const customer = { ...ctx().prospect!, isCustomer: true };
    const base = { prospect: customer };
    // purpose distinto de prospecting: un cliente no se prospecta (REQ-VER-02 CA2 lo deja `blocked`)
    expect(rule(evaluate(input('email_marketing', 'trial_help'), ctx({ ...base, settings: withFlags({ lssiCustomerExceptionApproved: true }) })))).toBe('REVIEW CG-31');
    expect(rule(evaluate(input('email_marketing', 'trial_help'), ctx(base)))).toBe('BLOCK CG-32');
  });
});

describe('Transaccionales de demo: CG-40 / CG-41', () => {
  const d = (over = {}) => ctx({ demo: demo(over) });
  const mail = (c: ReturnType<typeof ctx>, email = EMAIL_ADDR) =>
    rule(evaluate(input('email_transactional', 'demo_confirmation', { demoId: DEMO_ID, email }), c));
  it('T-22b confirmación por email a la demo solicitada, contacto recién creado → ALLOW CG-40', () => {
    expect(mail(d())).toBe('ALLOW CG-40');
  });
  it('CG-40 negativo: email distinto al de la solicitud, demo no solicitada o cancelada → BLOCK CG-41', () => {
    expect(mail(d(), 'otro@clinicaejemplo.es')).toBe('BLOCK CG-41');
    expect(mail(d({ requestedByInterested: false }))).toBe('BLOCK CG-41');
    expect(mail(d({ status: 'cancelled' }))).toBe('BLOCK CG-41');
    expect(mail(d({ prospectId: 'otra-ficha' }))).toBe('BLOCK CG-41');
  });
  it('CG-41 otra finalidad (trial_help, demo_followup) → BLOCK', () => {
    expect(rule(evaluate(input('email_transactional', 'trial_help'), ctx()))).toBe('BLOCK CG-41');
  });
  it('SMS exige además consentimiento sms vigente; WhatsApp, whatsapp', () => {
    const sms = (c: ReturnType<typeof ctx>) => rule(evaluate(input('sms_transactional', 'demo_confirmation', { demoId: DEMO_ID }), c));
    expect(sms(d())).toBe('BLOCK CG-41');
    expect(sms(ctx({ demo: demo(), consents: [grant('sms', { purpose: 'demo_confirmation' })] }))).toBe('ALLOW CG-40');
    expect(sms(ctx({ demo: demo(), consents: [grant('sms', { purpose: 'demo_confirmation' }), withdraw('sms')] }))).toBe('BLOCK CG-41');
    const wa = rule(evaluate(input('whatsapp_transactional', 'demo_confirmation', { demoId: DEMO_ID }),
      ctx({ demo: demo(), consents: [grant('sms', { purpose: 'demo_confirmation' })] })));
    expect(wa).toBe('BLOCK CG-41');
  });
  it('CG-06 confirmación + 1 recordatorio; el tercero → BLOCK', () => {
    const prior = [attempt('email_transactional', 'demo_confirmation', { demoId: DEMO_ID }),
      attempt('email_transactional', 'demo_confirmation', { demoId: DEMO_ID })];
    expect(mail(ctx({ demo: demo(), priorAttempts: prior.slice(0, 1) }))).toBe('ALLOW CG-40');
    expect(mail(ctx({ demo: demo(), priorAttempts: prior }))).toBe('BLOCK CG-06');
  });
});

describe('Carta: CG-50 / CG-51 / CG-52', () => {
  const on = { settings: withFlags({ postalB2bApproved: true }) };
  it('T-16 carta a company con postal_b2b_approved → REVIEW CG-50', () => {
    expect(rule(evaluate(input('postal_letter', 'prospecting'), ctx(on)))).toBe('REVIEW CG-50');
  });
  it('T-17 sin postal_b2b_approved → BLOCK CG-52', () => {
    expect(rule(evaluate(input('postal_letter', 'prospecting'), ctx()))).toBe('BLOCK CG-52');
  });
  it('CG-50 negativo: plantilla sin aprobar, o dirigida a una persona → BLOCK CG-52', () => {
    expect(rule(evaluate(input('postal_letter', 'prospecting'), ctx({ ...on, letter: { addressedToCompany: true, templateApproved: false } })))).toBe('BLOCK CG-52');
    expect(rule(evaluate(input('postal_letter', 'prospecting'), ctx({ ...on, letter: { addressedToCompany: false, templateApproved: true } })))).toBe('BLOCK CG-52');
  });
  it('CG-51 seguimiento a quien solicitó la demo → ALLOW', () => {
    expect(rule(evaluate(input('postal_letter', 'demo_followup', { demoId: DEMO_ID }), ctx({ demo: demo() })))).toBe('ALLOW CG-51');
  });
  it('CG-51 negativo: demo no solicitada por el interesado → BLOCK CG-52', () => {
    expect(rule(evaluate(input('postal_letter', 'demo_followup', { demoId: DEMO_ID }), ctx({ demo: demo({ requestedByInterested: false }) })))).toBe('BLOCK CG-52');
  });
});

describe('Visita: CG-60 y CG-99', () => {
  it('CG-60 visita de prospección a ficha approved → REVIEW', () => {
    expect(rule(evaluate(input('visit', 'prospecting'), ctx()))).toBe('REVIEW CG-60');
  });
  it('CG-60 negativo: ficha no aprobada → BLOCK CG-07', () => {
    const c = ctx({ prospect: { ...ctx().prospect!, status: 'pending_review' } });
    expect(rule(evaluate(input('visit', 'prospecting'), c))).toBe('BLOCK CG-07');
  });
  it('CG-99 ninguna regla aplica (visita con otra finalidad) → BLOCK', () => {
    expect(rule(evaluate(input('visit', 'trial_help'), ctx()))).toBe('BLOCK CG-99');
  });
});

describe('Propiedades generales', () => {
  it('la evaluación es determinista y no depende del reloj del sistema', () => {
    const c = ctx({ consents: [grant('ai_call')] });
    const i = input('ai_call', 'prospecting', { at: undefined });
    expect(evaluate(i, c)).toEqual(evaluate(i, { ...c, now: TUE_11 }));
    expect(evaluate(i, { ...c, now: new Date('2026-11-14T10:00:00Z') }).ruleIds[0]).toBe('CG-05'); // sábado: el ctx.now manda
  });
  it('una falta de datos (dato ausente) nunca da ALLOW', () => {
    const c = ctx({ prospect: null, postalAddress: null, phoneType: null });
    for (const ch of ['postal_letter', 'visit', 'human_call', 'ai_call', 'email_marketing'] as const) {
      expect(evaluate(input(ch, 'prospecting', { phone: undefined, email: undefined, postalAddressId: undefined }), c).decision).toBe('BLOCK');
    }
  });
});
