import { trigramSimilarity } from '../normalize/normalize.js';

// Decisión de deduplicación (REQ-VER-02), pura: la BD le entrega los candidatos cercanos y ella decide.
//   1. ¿Coincide con una ficha ya existente (incluidas archivadas/descartadas/bloqueadas)? dominio > teléfono > nombre+municipio.
//   2. ¿Es cliente actual de TurnoSala o hay una oposición? → la ficha queda bloqueada con motivo (nunca se prospecta).
//   3. Si no, se crea.

export const NAME_SIMILARITY_MIN = 0.8;
/** Más exigente porque aquí no hay municipio que desambigüe; un falso positivo solo deja la ficha bloqueada para revisión. */
export const CUSTOMER_NAME_SIMILARITY_MIN = 0.9;

export interface Candidate {
  nameNorm: string;
  domain: string | null;
  /** teléfonos E.164 válidos */
  phones: string[];
  emails: string[];
  ineCode: string | null;
}
export interface ExistingProspect {
  id: string;
  nameNorm: string;
  domain: string | null;
  phones: string[];
  ineCode: string | null;
  status: string;
}
export interface CustomerRow {
  orgId: string;
  nameNorm: string;
  domain: string | null;
  phone: string | null;
}
export interface SuppressionLite {
  kind: 'phone' | 'email' | 'domain' | 'prospect';
  value: string;
}

export type MatchedBy = 'domain' | 'phone' | 'name_municipality' | 'name' | 'email' | 'prospect';
export type IngestDecision =
  | { action: 'create' }
  | { action: 'merge'; prospectId: string; matchedBy: 'domain' | 'phone' | 'name_municipality' }
  | { action: 'blocked'; reason: 'customer' | 'opposition'; matchedBy: MatchedBy; mergeIntoId?: string };

function findExisting(c: Candidate, existing: readonly ExistingProspect[]): { id: string; by: 'domain' | 'phone' | 'name_municipality' } | null {
  const byDomain = c.domain ? existing.find((e) => e.domain === c.domain) : undefined;
  if (byDomain) return { id: byDomain.id, by: 'domain' };
  const byPhone = existing.find((e) => e.phones.some((p) => c.phones.includes(p)));
  if (byPhone) return { id: byPhone.id, by: 'phone' };
  if (c.ineCode) {
    const byName = existing.find((e) => e.ineCode === c.ineCode && trigramSimilarity(e.nameNorm, c.nameNorm) >= NAME_SIMILARITY_MIN);
    if (byName) return { id: byName.id, by: 'name_municipality' };
  }
  return null;
}

function findCustomer(c: Candidate, customers: readonly CustomerRow[]): 'domain' | 'phone' | 'name' | null {
  if (c.domain && customers.some((k) => k.domain === c.domain)) return 'domain';
  if (customers.some((k) => k.phone !== null && c.phones.includes(k.phone))) return 'phone';
  if (customers.some((k) => trigramSimilarity(k.nameNorm, c.nameNorm) >= CUSTOMER_NAME_SIMILARITY_MIN)) return 'name';
  return null;
}

function findSuppression(c: Candidate, matchedId: string | null, sups: readonly SuppressionLite[]): MatchedBy | null {
  const has = (kind: SuppressionLite['kind'], values: readonly string[]): boolean => sups.some((s) => s.kind === kind && values.includes(s.value));
  if (has('phone', c.phones)) return 'phone';
  if (c.domain && has('domain', [c.domain])) return 'domain';
  if (has('email', c.emails.map((e) => e.toLowerCase()))) return 'email';
  if (matchedId && has('prospect', [matchedId])) return 'prospect';
  return null;
}

export function decideIngest(
  candidate: Candidate, existing: readonly ExistingProspect[], customers: readonly CustomerRow[], suppressions: readonly SuppressionLite[],
): IngestDecision {
  const match = findExisting(candidate, existing);
  const extra = match ? { mergeIntoId: match.id } : {};
  const customer = findCustomer(candidate, customers);
  if (customer) return { action: 'blocked', reason: 'customer', matchedBy: customer, ...extra };
  const opposed = findSuppression(candidate, match?.id ?? null, suppressions);
  if (opposed) return { action: 'blocked', reason: 'opposition', matchedBy: opposed, ...extra };
  return match ? { action: 'merge', prospectId: match.id, matchedBy: match.by } : { action: 'create' };
}
