import { z } from 'zod';
import { normalizeAddress, normalizePhone } from '../normalize/normalize.js';
import { classifyEmail, containsPersonName } from './redact.js';

// Verificación de lo que devuelve el modelo (REQ-ENR-01/02/03, P2.2, P5.4). El modelo EXTRAE; este código DECIDE qué se acepta:
// toda cita debe aparecer literalmente en la página señalada, toda URL debe haberse rastreado y el tipo de un teléfono lo fija el código.

export const FIELD_KEYS = ['name', 'phone', 'address', 'sites_count', 'opening_hours', 'specialties', 'consultation_rooms'] as const;
export const CONTACT_TYPES = ['switchboard_phone', 'mobile_phone', 'generic_email', 'personal_email', 'postal_address', 'web_form', 'booking_url'] as const;

const url = z.string().trim().min(1);
const quote = z.string().min(4).max(300);

/** Esquema de la salida estructurada. Estricto: todo es obligatorio (lo que no hay es `null`/lista vacía), sin campos de personas. */
export const extractionOutputSchema = z.object({
  fields: z.array(z.object({
    key: z.enum(FIELD_KEYS), value: z.string().min(1), provenance: z.enum(['observed', 'inferred']), explanation: z.string().nullable(), source_url: url, quote,
  })),
  signals: z.array(z.object({ key: z.string().min(1), source_url: url, quote })),
  contact_points: z.array(z.object({ type: z.enum(CONTACT_TYPES), value: z.string().min(1), source_url: url, quote })),
  legal_form: z.object({ value: z.enum(['company', 'sole_trader', 'public_body', 'unknown']), source_url: url, quote }).nullable(),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/** Texto de una página TAL COMO SE ENVIÓ al modelo (ya sin datos personales): contra él se verifican las citas. */
export interface PageText {
  url: string;
  finalUrl: string;
  text: string;
  links: string[];
}

export type RejectReason =
  | 'unknown_url' | 'quote_not_found' | 'unknown_signal' | 'inferred_without_explanation' | 'invalid_value'
  | 'person_name' | 'value_not_in_quote' | 'invalid_contact' | 'link_not_in_page';

export interface Metrics {
  accepted: number;
  rejected: Record<RejectReason, number>;
  personalEmailsDiscarded: number;
  /** lo que el modelo se inventó o no puede respaldar: cita, URL, valor o enlace inexistentes */
  hallucinationRejected: number;
}
export interface VerifiedExtraction {
  fields: Array<{ key: (typeof FIELD_KEYS)[number]; value: string; provenance: 'observed' | 'inferred'; explanation: string | null; sourceUrl: string; quote: string }>;
  signals: Array<{ key: string; quote: string; sourceUrl: string }>;
  contactPoints: Array<{ type: 'switchboard_phone' | 'mobile_phone' | 'generic_email' | 'postal_address' | 'web_form' | 'booking_url'; value: string; sourceUrl: string; quote: string }>;
  legalForm: { value: 'company' | 'sole_trader' | 'public_body' | 'unknown'; sourceUrl: string; quote: string } | null;
  metrics: Metrics;
}

/** Espacios, saltos de línea y NBSP no cuentan; las mayúsculas y las letras, sí. */
export function normalizeQuoteText(s: string): string {
  return s.normalize('NFC').replace(new RegExp('[\\u00a0\\u200b\\u2007\\u202f]', 'g'), ' ').replace(/\s+/g, ' ').trim();
}

const digits = (s: string): string => s.replace(/\D/g, '');
const NUMERIC_KEYS = new Set(['sites_count', 'consultation_rooms']);

class Ctx {
  readonly rejected = Object.fromEntries(
    (['unknown_url', 'quote_not_found', 'unknown_signal', 'inferred_without_explanation', 'invalid_value', 'person_name', 'value_not_in_quote', 'invalid_contact', 'link_not_in_page'] as const).map((r) => [r, 0]),
  ) as Record<RejectReason, number>;
  accepted = 0;
  personalEmailsDiscarded = 0;
  private readonly byUrl = new Map<string, PageText>();
  private readonly normalized = new Map<PageText, string>();

  constructor(pages: readonly PageText[]) {
    for (const p of pages) {
      this.byUrl.set(p.url, p);
      this.byUrl.set(p.finalUrl, p);
      this.normalized.set(p, normalizeQuoteText(p.text));
    }
  }

  reject(reason: RejectReason): null {
    this.rejected[reason]++;
    return null;
  }

  /** La página citada, si la URL se rastreó y la cita aparece literalmente en ella; si no, se anota el motivo. */
  source(sourceUrl: string, q: string): PageText | null {
    const page = this.byUrl.get(sourceUrl.trim());
    if (!page) return this.reject('unknown_url');
    const nq = normalizeQuoteText(q);
    return nq.length >= 4 && (this.normalized.get(page) as string).includes(nq) ? page : this.reject('quote_not_found');
  }
}

function verifyField(f: ExtractionOutput['fields'][number], ctx: Ctx): VerifiedExtraction['fields'][number] | null {
  if (!ctx.source(f.source_url, f.quote)) return null;
  if (f.provenance === 'inferred' && !f.explanation?.trim()) return ctx.reject('inferred_without_explanation');
  if (NUMERIC_KEYS.has(f.key) && !/^\d{1,3}$/.test(f.value.trim())) return ctx.reject('invalid_value');
  if (f.key !== 'name' && (containsPersonName(f.value) || containsPersonName(f.quote))) return ctx.reject('person_name');
  return { key: f.key, value: f.value.trim(), provenance: f.provenance, explanation: f.explanation, sourceUrl: f.source_url.trim(), quote: f.quote };
}

function verifyContact(c: ExtractionOutput['contact_points'][number], ctx: Ctx): VerifiedExtraction['contactPoints'][number] | null {
  const page = ctx.source(c.source_url, c.quote);
  if (!page) return null;
  const base = { sourceUrl: c.source_url.trim(), quote: c.quote };
  const value = c.value.trim();
  switch (c.type) {
    case 'switchboard_phone':
    case 'mobile_phone': {
      const p = normalizePhone(value);
      if (!p.e164 || p.notCallable) return ctx.reject('invalid_contact');
      if (!digits(c.quote).includes(digits(value).slice(-9))) return ctx.reject('value_not_in_quote');
      return { type: p.kind === 'mobile' ? 'mobile_phone' : 'switchboard_phone', value: p.e164, ...base };
    }
    case 'generic_email':
    case 'personal_email': {
      if (c.type === 'personal_email' || classifyEmail(value) === 'personal_email') { ctx.personalEmailsDiscarded++; return null; }
      if (!c.quote.toLowerCase().includes(value.toLowerCase())) return ctx.reject('value_not_in_quote');
      return { type: 'generic_email', value: value.toLowerCase(), ...base };
    }
    case 'postal_address':
      return normalizeAddress(c.quote).includes(normalizeAddress(value)) ? { type: c.type, value, ...base } : ctx.reject('value_not_in_quote');
    default:
      return page.links.includes(value) ? { type: c.type, value, ...base } : ctx.reject('link_not_in_page');
  }
}

/**
 * Acepta del modelo solo lo que se puede comprobar contra las páginas rastreadas (REQ-ENR-01 CA2). Todo lo demás se descarta y se
 * cuenta por motivo; `hallucinationRejected` es la métrica de calidad por versión de prompt.
 */
export function verifyExtraction(
  output: ExtractionOutput, pages: readonly PageText[], opts: { signalVocabulary: readonly string[] },
): VerifiedExtraction {
  const ctx = new Ctx(pages);
  const vocab = new Set(opts.signalVocabulary);
  const fields = output.fields.map((f) => verifyField(f, ctx)).filter((x) => x !== null);
  const signals: VerifiedExtraction['signals'] = [];
  for (const s of output.signals) {
    if (!vocab.has(s.key)) ctx.reject('unknown_signal');
    else if (ctx.source(s.source_url, s.quote)) signals.push({ key: s.key, quote: s.quote, sourceUrl: s.source_url.trim() });
  }
  const contactPoints = output.contact_points.map((c) => verifyContact(c, ctx)).filter((x) => x !== null);
  const lf = output.legal_form;
  const legalForm = lf && ctx.source(lf.source_url, lf.quote) ? { value: lf.value, sourceUrl: lf.source_url.trim(), quote: lf.quote } : null;
  const accepted = fields.length + signals.length + contactPoints.length + (legalForm ? 1 : 0);
  const r = ctx.rejected;
  return {
    fields, signals, contactPoints, legalForm,
    metrics: { accepted, rejected: r, personalEmailsDiscarded: ctx.personalEmailsDiscarded, hallucinationRejected: r.quote_not_found + r.unknown_url + r.value_not_in_quote + r.link_not_in_page },
  };
}
