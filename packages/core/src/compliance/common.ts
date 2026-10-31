import { normalizeEmail } from './consent.js';
import type { Channel, CheckInput, ComplianceContext, Decision } from './types.js';

export interface Verdict {
  decision: Decision;
  ruleId: string;
  reason: string;
  consentId?: string | null;
}
export type Rule = (input: CheckInput, ctx: ComplianceContext) => Verdict | null;

export const allow = (ruleId: string, reason: string, consentId: string | null = null): Verdict =>
  ({ decision: 'ALLOW', ruleId, reason, consentId });
export const block = (ruleId: string, reason: string): Verdict => ({ decision: 'BLOCK', ruleId, reason });
export const review = (ruleId: string, reason: string): Verdict => ({ decision: 'REVIEW', ruleId, reason });

export const E164 = /^\+[1-9]\d{6,14}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PHONE_CHANNELS: ReadonlySet<Channel> =
  new Set<Channel>(['human_call', 'ai_call', 'sms_transactional', 'whatsapp_transactional']);
export const EMAIL_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(['email_marketing', 'email_transactional']);
export const TRANSACTIONAL: ReadonlySet<Channel> =
  new Set<Channel>(['email_transactional', 'sms_transactional', 'whatsapp_transactional']);

export const when = (ok: boolean, v: () => Verdict): Verdict | null => (ok ? v() : null);

export const at = (input: CheckInput, ctx: ComplianceContext): Date => input.at ?? ctx.now;

export const campaignOf = (input: CheckInput): string | null => input.campaignId ?? null;

/** Destino real de la acción, tal como lo ve `test_contacts` (sandbox). */
export function destinationOf(input: CheckInput, ctx: ComplianceContext): string | null {
  if (PHONE_CHANNELS.has(input.channel)) return input.phone ?? null;
  if (EMAIL_CHANNELS.has(input.channel)) return normalizeEmail(input.email) ?? null;
  return ctx.postalAddress?.value ?? null;
}

export function emailDomain(email: string | undefined): string | null {
  const e = normalizeEmail(email);
  return e && e.includes('@') ? (e.split('@')[1] ?? null) : null;
}
