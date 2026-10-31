import { z } from 'zod';
import { normalizeAddress, normalizePhone } from '../normalize/normalize.js';
import { CONTACT_TYPES, FIELD_KEYS, type VerifiedExtraction } from '../extraction/extraction.js';

// Conjunto dorado (F1.10): webs anotadas A MANO por una persona (el modelo no puede anotar: sería circular). La anotación debe ser
// exhaustiva: lo que la web dice y no se anotó cuenta como error del modelo. Las métricas son código; el modelo no se evalúa a sí mismo.

export const PRECISION_GATE = 0.9;

const fieldShape = Object.fromEntries(FIELD_KEYS.map((k) => [k, z.string().trim().min(1).optional()])) as Record<(typeof FIELD_KEYS)[number], z.ZodOptional<z.ZodString>>;

export const goldenEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  website: z.url(),
  annotated_by: z.string().trim().min(1),
  annotated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  expected: z.object({
    fields: z.object(fieldShape).strict(),
    signals: z.array(z.string().trim().min(1)),
    contact_points: z.array(z.object({ type: z.enum(CONTACT_TYPES.filter((t) => t !== 'personal_email') as [string, ...string[]]), value: z.string().trim().min(1) })),
    legal_form: z.enum(['company', 'sole_trader', 'public_body', 'unknown']).optional(),
  }).strict(),
}).strict();
export type GoldenEntry = z.infer<typeof goldenEntrySchema>;

export interface Counts {
  returned: number;
  correct: number;
  expected: number;
}
export interface EntryScore {
  id: string;
  fields: Counts;
  signals: Counts;
  contacts: Counts;
  legalForm: Counts;
  /** lo que el modelo propuso: aceptado + rechazado por la verificación */
  proposed: number;
  hallucinationRejected: number;
  costEur: number;
}

const plain = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const NUMERIC = new Set(['sites_count', 'consultation_rooms']);

const fieldValue = (key: string, v: string): string => (NUMERIC.has(key) ? String(Number.parseInt(v, 10)) : plain(v));

function contactKey(type: string, value: string): string {
  const v = value.trim();
  if (type === 'switchboard_phone' || type === 'mobile_phone') return `phone|${normalizePhone(v).e164 ?? v.replace(/\D/g, '')}`;
  if (type === 'generic_email') return `email|${v.toLowerCase()}`;
  if (type === 'postal_address') return `address|${normalizeAddress(v)}`;
  return `${type}|${v}`;
}

export function scoreEntry(g: GoldenEntry, v: VerifiedExtraction, costEur = 0): EntryScore {
  const expectedFields = new Map(Object.entries(g.expected.fields).map(([k, val]) => [k, fieldValue(k, val as string)]));
  const expectedSignals = new Set(g.expected.signals);
  const expectedContacts = new Set(g.expected.contact_points.map((c) => contactKey(c.type, c.value)));
  const returnedSignals = new Set(v.signals.map((s) => s.key));
  const returnedContacts = new Set(v.contactPoints.map((c) => contactKey(c.type, c.value)));
  const r = v.metrics.rejected;
  return {
    id: g.id,
    fields: { returned: v.fields.length, correct: v.fields.filter((f) => expectedFields.get(f.key) === fieldValue(f.key, f.value)).length, expected: expectedFields.size },
    signals: { returned: returnedSignals.size, correct: [...returnedSignals].filter((k) => expectedSignals.has(k)).length, expected: expectedSignals.size },
    contacts: { returned: returnedContacts.size, correct: [...returnedContacts].filter((k) => expectedContacts.has(k)).length, expected: expectedContacts.size },
    legalForm: { returned: v.legalForm ? 1 : 0, correct: v.legalForm && g.expected.legal_form === v.legalForm.value ? 1 : 0, expected: g.expected.legal_form ? 1 : 0 },
    proposed: v.metrics.accepted + Object.values(r).reduce((a, b) => a + b, 0),
    hallucinationRejected: v.metrics.hallucinationRejected,
    costEur,
  };
}

export interface Aggregate {
  entries: number;
  /** aciertos / devueltos sobre campos + señales + contactos + forma jurídica; `null` si no se devolvió nada */
  precision: number | null;
  recall: number | null;
  fieldPrecision: number | null;
  literalRejectionRate: number | null;
  costPerEntryEur: number | null;
  totalCostEur: number;
  passesGate: boolean;
}

const sum = (xs: Counts[]): Counts => xs.reduce((a, c) => ({ returned: a.returned + c.returned, correct: a.correct + c.correct, expected: a.expected + c.expected }), { returned: 0, correct: 0, expected: 0 });
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function aggregate(scores: readonly EntryScore[]): Aggregate {
  const all = sum(scores.flatMap((s) => [s.fields, s.signals, s.contacts, s.legalForm]));
  const fields = sum(scores.map((s) => s.fields));
  const proposed = scores.reduce((a, s) => a + s.proposed, 0);
  const total = scores.reduce((a, s) => a + s.costEur, 0);
  return {
    entries: scores.length,
    precision: ratio(all.correct, all.returned),
    recall: ratio(all.correct, all.expected),
    fieldPrecision: ratio(fields.correct, fields.returned),
    literalRejectionRate: ratio(scores.reduce((a, s) => a + s.hallucinationRejected, 0), proposed),
    costPerEntryEur: ratio(total, scores.length),
    totalCostEur: total,
    // comparación en enteros para que 27/30 = 0,9 no dependa del redondeo de coma flotante
    passesGate: all.returned > 0 && all.correct * 10 >= all.returned * 9,
  };
}
