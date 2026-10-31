import type { CheckInput, ComplianceContext, ConsentRow } from './types.js';

const TWELVE_MONTHS_MS = 365 * 24 * 3_600_000;

export function normalizeEmail(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e || undefined;
}

function sameDestination(row: ConsentRow, input: CheckInput): boolean {
  if (row.channel === 'email') {
    const e = normalizeEmail(input.email);
    return e !== undefined && row.email?.trim().toLowerCase() === e;
  }
  return input.phone !== undefined && row.phone === input.phone; // coincidencia exacta E.164
}

/**
 * Consentimiento vigente (compliance.md): concedido para este canal, destino exacto y finalidad,
 * sin retirada posterior, no caducado (REQ-CNS-04) y con la campaña sin cerrar.
 * Finalidad: igualdad estricta (lo más restrictivo; compliance.md no define «compatible»).
 */
export function activeConsent(
  ctx: ComplianceContext,
  input: CheckInput,
  channel: ConsentRow['channel'],
  purpose: string,
  at: Date,
): ConsentRow | null {
  const rows = ctx.consents.filter((r) => r.channel === channel && sameDestination(r, input));
  const withdrawals = rows.filter((r) => r.action === 'withdraw');
  const valid = rows.filter((g) => {
    if (g.action !== 'grant' || g.purpose !== purpose) return false;
    if (withdrawals.some((w) => w.createdAt.getTime() >= g.createdAt.getTime())) return false;
    if (g.campaignId !== null && ctx.closedCampaignIds.includes(g.campaignId)) return false;
    if (channel === 'ai_call' && at.getTime() - g.createdAt.getTime() > TWELVE_MONTHS_MS) return false;
    return g.createdAt.getTime() <= at.getTime();
  });
  valid.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return valid[0] ?? null;
}
