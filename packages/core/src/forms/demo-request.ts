import { normalizePhone } from '../normalize/normalize.js';
import type { ProductFacts } from '../product/facts.js';

// Formulario de solicitud de demo de las landings (REQ-CNS-01). Validación y normalización puras; el envío (consentimientos, ficha, oportunidad) vive en `db`.

export const BOX_KEYS = ['email', 'human_call', 'ai_call', 'sms_whatsapp'] as const;
export type BoxKey = (typeof BOX_KEYS)[number];

export interface DemoRequestData {
  name: string;
  email: string | null;
  /** E.164 español */
  phone: string | null;
  company: string | null;
  boxes: Record<BoxKey, boolean>;
}
export type ParseResult = { ok: true; data: DemoRequestData } | { ok: false; errors: Record<string, string>; bot?: true };

/** Qué consentimientos EXACTOS crea cada casilla marcada. La puerta compara canal, finalidad y destino con igualdad estricta (compliance.md), así que se crea una fila por cada par. */
export const CONSENT_GRANTS: Record<BoxKey, ReadonlyArray<{ channel: 'email' | 'human_call' | 'ai_call' | 'sms' | 'whatsapp'; purpose: 'prospecting' | 'demo_followup' | 'demo_confirmation'; to: 'email' | 'phone' }>> = {
  email: [{ channel: 'email', purpose: 'prospecting', to: 'email' }, { channel: 'email', purpose: 'demo_followup', to: 'email' }],
  human_call: [{ channel: 'human_call', purpose: 'prospecting', to: 'phone' }, { channel: 'human_call', purpose: 'demo_followup', to: 'phone' }],
  ai_call: [{ channel: 'ai_call', purpose: 'prospecting', to: 'phone' }, { channel: 'ai_call', purpose: 'demo_followup', to: 'phone' }],
  // (d) solo habilita CONFIRMAR la demo; nunca prospección ni seguimiento comercial
  sms_whatsapp: [{ channel: 'sms', purpose: 'demo_confirmation', to: 'phone' }, { channel: 'whatsapp', purpose: 'demo_confirmation', to: 'phone' }],
};

const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.es', 'ymail.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'telefonica.net', 'movistar.es', 'terra.es', 'wanadoo.es', 'orange.es',
]);
/** Correo personal: de su dominio no se deduce la web de la empresa. */
export const isWebmailDomain = (domain: string): boolean => WEBMAIL.has(domain.trim().toLowerCase());

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '');
const flag = (v: unknown): boolean => v === true || v === 'on' || v === 'true';

function parseContact(raw: Record<string, unknown>, errors: Record<string, string>): { email: string | null; phone: string | null } {
  const emailRaw = text(raw.email).toLowerCase();
  const phoneRaw = text(raw.phone);
  let email: string | null = null;
  let phone: string | null = null;
  if (emailRaw) {
    if (emailRaw.length <= 254 && EMAIL.test(emailRaw)) email = emailRaw;
    else errors.email = 'Escribe un correo electrónico válido.';
  }
  if (phoneRaw) {
    const p = normalizePhone(phoneRaw);
    if (p.e164 && !p.notCallable && p.e164.startsWith('+34')) phone = p.e164;
    else errors.phone = 'Escribe un teléfono español válido (fijo o móvil).';
  }
  if (!emailRaw && !phoneRaw) errors.contact = 'Indica un correo o un teléfono para poder contactarte.';
  return { email, phone };
}

export function parseDemoRequest(input: unknown, o: { hasToken: boolean }): ParseResult {
  if (!input || typeof input !== 'object') return { ok: false, errors: { form: 'Formulario no válido.' } };
  const raw = input as Record<string, unknown>;
  if (text(raw.website_url) !== '') return { ok: false, errors: {}, bot: true }; // campo oculto: un humano no lo ve ni lo rellena
  const errors: Record<string, string> = {};
  const name = text(raw.name);
  if (name.length < 2 || name.length > 120) errors.name = 'Escribe tu nombre.';
  const company = text(raw.company);
  if (company.length > 160) errors.company = 'El nombre de la empresa es demasiado largo.';
  else if (!company && !o.hasToken) errors.company = 'Escribe el nombre de tu empresa.';
  const { email, phone } = parseContact(raw, errors);
  const boxes = { email: flag(raw.box_email), human_call: flag(raw.box_human_call), ai_call: flag(raw.box_ai_call), sms_whatsapp: flag(raw.box_sms_whatsapp) };
  if (boxes.email && !email) errors.box_email = 'Para recibir correos, indica tu correo electrónico.';
  for (const k of ['human_call', 'ai_call', 'sms_whatsapp'] as const) if (boxes[k] && !phone) errors[`box_${k}`] = 'Para esta opción, indica tu teléfono.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name, email, phone, company: company || null, boxes } };
}

/** Importe estimado de una oportunidad: plan propuesto × 12 meses, sin IVA (REQ-CRM-01). Un plan «solo presupuesto» o inexistente no tiene importe. */
export function estimateAnnualValue(facts: ProductFacts, planId: string): number | null {
  const plan = facts.plans.find((p) => p.id === planId);
  return plan && plan.price_month_ex_vat !== null ? Math.round(plan.price_month_ex_vat * 12 * 100) / 100 : null;
}
