// Reglas por canal CG-10 … CG-60 (compliance.md).
import { activeConsent, normalizeEmail } from './consent.js';
import { allow, at, block, review, TRANSACTIONAL, when, type Rule } from './common.js';

const ai = (i: { channel: string }): boolean => i.channel === 'ai_call';

export const cg10: Rule = (i) => when(ai(i) && i.direction === 'inbound', () => allow('CG-10', 'llama el interesado'));
export const cg11: Rule = (i, c) => {
  if (!ai(i) || i.direction !== 'outbound') return null;
  const k = activeConsent(c, i, 'ai_call', i.purpose, at(i, c));
  return k ? allow('CG-11', 'consentimiento ai_call vigente', k.id) : null;
};
export const cg12: Rule = (i) =>
  when(ai(i) && i.direction === 'outbound', () => block('CG-12', 'llamada saliente de IA sin consentimiento ai_call vigente'));

export const cg20: Rule = (i, c) => {
  if (i.channel !== 'human_call') return null;
  const k = activeConsent(c, i, 'human_call', i.purpose, at(i, c));
  return k ? allow('CG-20', 'consentimiento human_call vigente', k.id) : null;
};
export const cg21: Rule = (i, c) =>
  when(
    i.channel === 'human_call' && i.purpose === 'prospecting' && c.phoneType === 'switchboard_phone' && c.settings.b2bHumanCallsApproved,
    () => review('CG-21', 'llamada humana B2B a centralita: una persona aprueba el lote'),
  );
export const cg22: Rule = (i) => when(i.channel === 'human_call', () => block('CG-22', 'llamada humana sin base permitida'));

export const cg30: Rule = (i, c) => {
  if (i.channel !== 'email_marketing') return null;
  const k = activeConsent(c, i, 'email', i.purpose, at(i, c));
  return k ? allow('CG-30', 'consentimiento email vigente', k.id) : null;
};
export const cg31: Rule = (i, c) =>
  when(
    i.channel === 'email_marketing' && c.prospect?.isCustomer === true && c.settings.lssiCustomerExceptionApproved,
    () => review('CG-31', 'cliente previo, producto similar (LSSI 21.2) aprobado por el asesor'),
  );
export const cg32: Rule = (i) =>
  when(i.channel === 'email_marketing', () => block('CG-32', 'email comercial sin consentimiento (incluye info@ y direcciones halladas)'));

function demoRequestedHere(i: Parameters<Rule>[0], c: Parameters<Rule>[1]): boolean {
  const d = c.demo;
  return !!d && d.id === i.demoId && d.prospectId === i.prospectId && d.requestedByInterested && d.status !== 'cancelled';
}

function transactionalAuthorized(i: Parameters<Rule>[0], c: Parameters<Rule>[1]): { ok: boolean; consentId: string | null } {
  const d = c.demo;
  if (!d || i.purpose !== 'demo_confirmation' || !demoRequestedHere(i, c)) return { ok: false, consentId: null };
  if (i.channel === 'email_transactional') {
    return { ok: !!d.requesterEmail && normalizeEmail(d.requesterEmail) === normalizeEmail(i.email), consentId: null };
  }
  if (!d.requesterPhone || d.requesterPhone !== i.phone) return { ok: false, consentId: null };
  const ch = i.channel === 'sms_transactional' ? 'sms' : 'whatsapp';
  const k = activeConsent(c, i, ch, 'demo_confirmation', at(i, c));
  return { ok: k !== null, consentId: k?.id ?? null };
}

export const cg40: Rule = (i, c) => {
  if (!TRANSACTIONAL.has(i.channel)) return null;
  const r = transactionalAuthorized(i, c);
  return r.ok ? allow('CG-40', 'confirmación de una demo solicitada por el interesado', r.consentId) : null;
};
export const cg41: Rule = (i) =>
  when(TRANSACTIONAL.has(i.channel), () => block('CG-41', 'mensaje transaccional fuera de una demo solicitada'));

export const cg50: Rule = (i, c) =>
  when(
    i.channel === 'postal_letter' && i.purpose === 'prospecting' && c.letter.addressedToCompany && c.letter.templateApproved &&
      c.settings.postalB2bApproved,
    () => review('CG-50', 'carta B2B a la empresa: aprobación por lote'),
  );
export const cg51: Rule = (i, c) =>
  when(i.channel === 'postal_letter' && i.purpose === 'demo_followup' && demoRequestedHere(i, c), () =>
    allow('CG-51', 'seguimiento a quien solicitó la demo'));
export const cg52: Rule = (i) => when(i.channel === 'postal_letter', () => block('CG-52', 'carta sin base permitida'));

export const cg60: Rule = (i, c) =>
  when(i.channel === 'visit' && i.purpose === 'prospecting' && c.prospect?.status === 'approved' && c.postalAddress !== null, () =>
    review('CG-60', 'visita a dirección comercial: el comercial confirma la ruta'));
