import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate.js';
import {
  ADDR_ID, attempt, ctx, days, demo, DEMO_ID, EMAIL_ADDR, grant, hours, input, P, PHONE, SAT_11, TUE_11,
} from './fixtures.js';

const rule = (r: ReturnType<typeof evaluate>): string => `${r.decision} ${r.ruleIds[0]}`;

describe('CG-01 kill_switch', () => {
  it('T-11 global: cualquier canal → BLOCK', () => {
    const c = ctx({ settings: { ...ctx().settings, killSwitch: true } });
    expect(rule(evaluate(input('ai_call', 'prospecting', { direction: 'inbound' }), c))).toBe('BLOCK CG-01');
    expect(rule(evaluate(input('postal_letter', 'prospecting'), c))).toBe('BLOCK CG-01');
  });
  it('por canal: bloquea ese canal y no otros', () => {
    const c = ctx({ settings: { ...ctx().settings, killSwitchByChannel: { ai_call: true } }, consents: [grant('ai_call')] });
    expect(rule(evaluate(input('ai_call', 'prospecting'), c))).toBe('BLOCK CG-01');
    expect(evaluate(input('postal_letter', 'prospecting'), c).ruleIds[0]).not.toBe('CG-01');
  });
});

describe('CG-02 sandbox', () => {
  const sandbox = (testContacts: { phones?: string[]; emails?: string[]; postal?: string[] }) =>
    ctx({ settings: { ...ctx().settings, appMode: 'sandbox' }, consents: [grant('ai_call')],
      testContacts: { phones: [], emails: [], postal: [], ...testContacts } });
  it('T-12 destino fuera de test_contacts → BLOCK', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), sandbox({})))).toBe('BLOCK CG-02');
  });
  it('destino en test_contacts → sigue a las demás reglas (ALLOW CG-11)', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), sandbox({ phones: [PHONE] })))).toBe('ALLOW CG-11');
  });
  it('email y dirección postal también se comprueban', () => {
    expect(rule(evaluate(input('email_marketing', 'prospecting'), sandbox({})))).toBe('BLOCK CG-02');
    expect(rule(evaluate(input('postal_letter', 'prospecting'), sandbox({})))).toBe('BLOCK CG-02');
    const ok = sandbox({ postal: ['calle sierpes 1 41004 sevilla'] });
    expect(evaluate(input('postal_letter', 'prospecting'), ok).ruleIds[0]).not.toBe('CG-02');
  });
  it('en production no se exige test_contacts', () => {
    expect(evaluate(input('ai_call', 'prospecting'), ctx({ consents: [grant('ai_call')] })).ruleIds[0]).toBe('CG-11');
  });
});

describe('CG-03 suppressions', () => {
  const c = (s: { kind: 'phone' | 'email' | 'domain' | 'prospect'; value: string }) =>
    ctx({ suppressions: [s], consents: [grant('ai_call')] });
  it('teléfono, email, dominio y ficha bloquean', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), c({ kind: 'phone', value: PHONE })))).toBe('BLOCK CG-03');
    expect(rule(evaluate(input('email_marketing', 'prospecting'), c({ kind: 'email', value: EMAIL_ADDR.toUpperCase() })))).toBe('BLOCK CG-03');
    expect(rule(evaluate(input('email_marketing', 'prospecting'), c({ kind: 'domain', value: 'clinicaejemplo.es' })))).toBe('BLOCK CG-03');
    expect(rule(evaluate(input('postal_letter', 'prospecting'), c({ kind: 'prospect', value: P })))).toBe('BLOCK CG-03');
  });
  it('T-03 consentimiento vigente + oposición posterior → BLOCK CG-03', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), c({ kind: 'prospect', value: P })))).toBe('BLOCK CG-03');
  });
  it('T-07 llamada entrante desde número excluido → BLOCK CG-03', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting', { direction: 'inbound' }), c({ kind: 'phone', value: PHONE })))).toBe('BLOCK CG-03');
  });
  it('una exclusión ajena no bloquea', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), c({ kind: 'phone', value: '+34699999999' })))).toBe('ALLOW CG-11');
  });
});

describe('CG-04 presupuesto', () => {
  it('agotado → BLOCK; con margen o sin tope → sigue', () => {
    const base = { consents: [grant('ai_call')] };
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ ...base, channelBudget: { spentTodayEur: 10, limitEur: 10 } })))).toBe('BLOCK CG-04');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ ...base, channelBudget: { spentTodayEur: 9.99, limitEur: 10 } })))).toBe('ALLOW CG-11');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ctx({ ...base, channelBudget: { spentTodayEur: 999, limitEur: null } })))).toBe('ALLOW CG-11');
  });
});

describe('CG-05 franjas (Europe/Madrid)', () => {
  const ai = (at: Date) =>
    evaluate(input('ai_call', 'prospecting', { at }), ctx({ now: at, consents: [grant('ai_call', { createdAt: new Date('2026-06-01T00:00:00Z') })] }));
  it('T-05 sábado 11:00 → BLOCK', () => expect(rule(ai(SAT_11))).toBe('BLOCK CG-05'));
  it('martes 11:00 → dentro', () => expect(rule(ai(TUE_11))).toBe('ALLOW CG-11'));
  it('antes de 10:00, hueco 14:00–16:00 y tras 19:00 → BLOCK', () => {
    expect(rule(ai(new Date('2026-11-10T08:59:00Z')))).toBe('BLOCK CG-05'); // 09:59
    expect(rule(ai(new Date('2026-11-10T14:00:00Z')))).toBe('BLOCK CG-05'); // 15:00
    expect(rule(ai(new Date('2026-11-10T18:00:00Z')))).toBe('BLOCK CG-05'); // 19:00
  });
  it('límites: 10:00 incluido, 14:00 y 19:00 excluidos; 16:00 incluido', () => {
    expect(rule(ai(new Date('2026-11-10T09:00:00Z')))).toBe('ALLOW CG-11'); // 10:00
    expect(rule(ai(new Date('2026-11-10T13:00:00Z')))).toBe('BLOCK CG-05'); // 14:00
    expect(rule(ai(new Date('2026-11-10T15:00:00Z')))).toBe('ALLOW CG-11'); // 16:00
  });
  it('festivo (8-dic-2026, martes) → BLOCK', () => {
    expect(rule(ai(new Date('2026-12-08T10:00:00Z')))).toBe('BLOCK CG-05');
  });
  it('horario de verano: 10:30 CEST (08:30Z) vale; el mismo UTC en invierno sería 09:30', () => {
    expect(rule(ai(new Date('2026-07-14T08:30:00Z')))).toBe('ALLOW CG-11');
    expect(rule(ai(new Date('2026-07-14T07:30:00Z')))).toBe('BLOCK CG-05'); // 09:30 CEST
  });
  it('las llamadas entrantes no tienen franja (llama el interesado)', () => {
    const at = SAT_11;
    expect(rule(evaluate(input('ai_call', 'prospecting', { direction: 'inbound', at }), ctx({ now: at })))).toBe('ALLOW CG-10');
  });
  it('visitas: 13:30–17:00 fuera; 10:00 dentro', () => {
    const v = (iso: string) => evaluate(input('visit', 'prospecting', { at: new Date(iso) }), ctx());
    expect(rule(v('2026-11-10T12:30:00Z'))).toBe('BLOCK CG-05'); // 13:30
    expect(rule(v('2026-11-10T09:00:00Z'))).toBe('REVIEW CG-60'); // 10:00
  });
  it('email: nocturno y fin de semana → BLOCK; martes 11:00 → pasa', () => {
    const e = (at: Date) => evaluate(input('email_marketing', 'prospecting', { at }), ctx({ now: at, consents: [grant('email')] }));
    expect(rule(e(new Date('2026-11-10T21:30:00Z')))).toBe('BLOCK CG-05'); // 22:30
    expect(rule(e(new Date('2026-11-10T06:30:00Z')))).toBe('BLOCK CG-05'); // 07:30
    expect(rule(e(SAT_11))).toBe('BLOCK CG-05');
    expect(rule(e(TUE_11))).toBe('ALLOW CG-30');
  });
  it('las cartas no tienen franja', () => {
    expect(evaluate(input('postal_letter', 'prospecting', { at: SAT_11 }), ctx({ now: SAT_11 })).ruleIds[0]).not.toBe('CG-05');
  });
});

describe('CG-06 cadencias', () => {
  const letters = (...over: Array<Partial<ReturnType<typeof attempt>>>) =>
    ctx({ settings: { ...ctx().settings, postalB2bApproved: true }, priorAttempts: over.map((o) => attempt('postal_letter', 'prospecting', o)) });
  const letter = (c: ReturnType<typeof ctx>) => rule(evaluate(input('postal_letter', 'prospecting'), c));
  it('T-18 tercera carta en la campaña → BLOCK', () => {
    expect(letter(letters({ at: days(60) }, { at: days(30) }))).toBe('BLOCK CG-06');
  });
  it('segunda carta a ≥21 días → pasa; a <21 días → BLOCK', () => {
    expect(letter(letters({ at: days(21) }))).toBe('REVIEW CG-50');
    expect(letter(letters({ at: days(20) }))).toBe('BLOCK CG-06');
  });
  it('carta devuelta → no más cartas; cartas de otra campaña no cuentan', () => {
    expect(letter(letters({ at: days(90), status: 'returned' }))).toBe('BLOCK CG-06');
    expect(letter(letters({ at: days(30), campaignId: 'otra' }, { at: days(40), campaignId: 'otra' }))).toBe('REVIEW CG-50');
  });
  const calls = (...over: Array<Partial<ReturnType<typeof attempt>>>) =>
    ctx({ settings: { ...ctx().settings, b2bHumanCallsApproved: true }, priorAttempts: over.map((o) => attempt('human_call', 'prospecting', o)) });
  const call = (c: ReturnType<typeof ctx>) => rule(evaluate(input('human_call', 'prospecting'), c));
  it('llamada humana: un contestado (o desconocido) bloquea; sin respuesta hasta 3', () => {
    expect(call(calls({ outcome: 'answered' }))).toBe('BLOCK CG-06');
    expect(call(calls({ outcome: null }))).toBe('BLOCK CG-06');
    expect(call(calls({ outcome: 'unanswered' }, { outcome: 'unanswered' }))).toBe('REVIEW CG-21');
    expect(call(calls({ outcome: 'unanswered' }, { outcome: 'unanswered' }, { outcome: 'unanswered' }))).toBe('BLOCK CG-06');
    expect(call(calls({ outcome: 'not_interested' }))).toBe('BLOCK CG-06');
  });
  it('visita: la segunda en la campaña → BLOCK', () => {
    expect(rule(evaluate(input('visit', 'prospecting'), ctx({ priorAttempts: [attempt('visit', 'prospecting')] })))).toBe('BLOCK CG-06');
    expect(rule(evaluate(input('visit', 'prospecting'), ctx()))).toBe('REVIEW CG-60');
  });
  const ai = (...over: Array<Partial<ReturnType<typeof attempt>>>) =>
    ctx({ consents: [grant('ai_call', { createdAt: days(100) })], priorAttempts: over.map((o) => attempt('ai_call', 'prospecting', o)) });
  it('T-06 tercer intento con el mismo consentimiento → BLOCK', () => {
    const k = 'consent-ai_call-1';
    expect(rule(evaluate(input('ai_call', 'prospecting'), ai({ at: days(10), consentId: k }, { at: days(5), consentId: k })))).toBe('BLOCK CG-06');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ai({ at: days(5), consentId: k })))).toBe('ALLOW CG-11');
  });
  it('ai_call: 1 al día y 48 h entre intentos', () => {
    expect(rule(evaluate(input('ai_call', 'prospecting'), ai({ at: hours(2) })))).toBe('BLOCK CG-06');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ai({ at: hours(47) })))).toBe('BLOCK CG-06');
    expect(rule(evaluate(input('ai_call', 'prospecting'), ai({ at: hours(49) })))).toBe('ALLOW CG-11');
  });
  it('email comercial: 1 por semana y 4 por campaña', () => {
    const e = (...a: Array<Partial<ReturnType<typeof attempt>>>) =>
      rule(evaluate(input('email_marketing', 'prospecting'), ctx({ consents: [grant('email')], priorAttempts: a.map((o) => attempt('email_marketing', 'prospecting', o)) })));
    expect(e({ at: days(6) })).toBe('BLOCK CG-06');
    expect(e({ at: days(8) })).toBe('ALLOW CG-30');
    expect(e({ at: days(8) }, { at: days(15) }, { at: days(22) }, { at: days(29) })).toBe('BLOCK CG-06');
  });
});

describe('CG-07 dato imprescindible', () => {
  const g = (i: ReturnType<typeof input>, c = ctx()) => rule(evaluate(i, c));
  it('teléfono ausente o no E.164 → BLOCK', () => {
    expect(g(input('ai_call', 'prospecting', { phone: undefined }), ctx({ consents: [grant('ai_call')] }))).toBe('BLOCK CG-07');
    expect(g(input('ai_call', 'prospecting', { phone: '600111222' }), ctx({ consents: [grant('ai_call')] }))).toBe('BLOCK CG-07');
  });
  it('email ausente o inválido → BLOCK', () => {
    expect(g(input('email_marketing', 'prospecting', { email: 'sin-arroba' }))).toBe('BLOCK CG-07');
  });
  it('dirección ausente o de otra ficha → BLOCK', () => {
    expect(g(input('postal_letter', 'prospecting', { postalAddressId: undefined }))).toBe('BLOCK CG-07');
    expect(g(input('postal_letter', 'prospecting'), ctx({ postalAddress: { id: ADDR_ID, prospectId: 'otra', value: 'x' } }))).toBe('BLOCK CG-07');
  });
  it('demo_confirmation / demo_followup sin demoId → BLOCK', () => {
    expect(g(input('email_transactional', 'demo_confirmation'))).toBe('BLOCK CG-07');
    expect(g(input('postal_letter', 'demo_followup'))).toBe('BLOCK CG-07');
  });
  it('T-22a carta de prospección a ficha pending_review → BLOCK CG-07', () => {
    const pending = ctx({ prospect: { ...ctx().prospect!, status: 'pending_review' }, settings: { ...ctx().settings, postalB2bApproved: true } });
    expect(g(input('postal_letter', 'prospecting'), pending)).toBe('BLOCK CG-07');
  });
  it('las entrantes no exigen ficha aprobada', () => {
    const pending = ctx({ prospect: { ...ctx().prospect!, status: 'pending_review' } });
    expect(g(input('ai_call', 'prospecting', { direction: 'inbound' }), pending)).toBe('ALLOW CG-10');
  });
  it('error interno al evaluar → BLOCK (P1.2)', () => {
    const broken = { ...ctx(), settings: undefined } as unknown as ReturnType<typeof ctx>;
    expect(g(input('ai_call', 'prospecting'), broken)).toBe('BLOCK CG-99');
  });
});

describe('CG-08 Lista Robinson', () => {
  const sole = (robinson: ReturnType<typeof ctx>['robinson'], legalForm: 'sole_trader' | 'unknown' | 'company' = 'sole_trader') =>
    ctx({ robinson, settings: { ...ctx().settings, postalB2bApproved: true },
      prospect: { ...ctx().prospect!, legalForm } });
  const letter = (c: ReturnType<typeof ctx>) => rule(evaluate(input('postal_letter', 'prospecting'), c));
  it('T-15 autónomo sin consulta → BLOCK; unknown se trata igual', () => {
    expect(letter(sole(null))).toBe('BLOCK CG-08');
    expect(letter(sole(null, 'unknown'))).toBe('BLOCK CG-08');
  });
  it('consulta limpia de hace ≤30 días → continúa; de hace 31 días, listed o error → BLOCK', () => {
    expect(letter(sole({ result: 'clear', checkedAt: days(30) }))).toBe('REVIEW CG-50');
    expect(letter(sole({ result: 'clear', checkedAt: days(31) }))).toBe('BLOCK CG-08');
    expect(letter(sole({ result: 'listed', checkedAt: days(1) }))).toBe('BLOCK CG-08');
    expect(letter(sole({ result: 'error', checkedAt: days(1) }))).toBe('BLOCK CG-08');
  });
  it('empresa no necesita consulta', () => expect(letter(sole(null, 'company'))).toBe('REVIEW CG-50'));
  it('aplica también a la llamada humana de prospección', () => {
    const c = ctx({ settings: { ...ctx().settings, b2bHumanCallsApproved: true }, prospect: { ...ctx().prospect!, legalForm: 'sole_trader' } });
    expect(rule(evaluate(input('human_call', 'prospecting'), c))).toBe('BLOCK CG-08');
  });
  it('no aplica a una carta de seguimiento a quien solicitó la demo (CG-51)', () => {
    const c = ctx({ demo: demo(), prospect: { ...ctx().prospect!, legalForm: 'sole_trader' } });
    expect(rule(evaluate(input('postal_letter', 'demo_followup', { demoId: DEMO_ID }), c))).toBe('ALLOW CG-51');
  });
});
