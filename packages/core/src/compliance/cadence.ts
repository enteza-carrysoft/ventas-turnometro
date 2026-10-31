import { activeConsent } from './consent.js';
import { at, block, campaignOf, type Rule, type Verdict } from './common.js';
import { DAY_MS, HOUR_MS, localParts } from './time.js';
import type { CheckInput, ComplianceContext, PriorAttempt } from './types.js';

const CG = 'CG-06';

const prior = (ctx: ComplianceContext, channel: PriorAttempt['channel'], purpose?: PriorAttempt['purpose']): PriorAttempt[] =>
  ctx.priorAttempts.filter((a) => a.channel === channel && (purpose === undefined || a.purpose === purpose));

const sameCampaign = (list: PriorAttempt[], input: CheckInput): PriorAttempt[] =>
  list.filter((a) => a.campaignId === campaignOf(input));

const last = (list: PriorAttempt[]): PriorAttempt | undefined =>
  [...list].sort((a, b) => b.at.getTime() - a.at.getTime())[0];

function postal(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  const cfg = ctx.settings.cadences.postalLetter;
  const all = prior(ctx, 'postal_letter', 'prospecting');
  if (all.some((a) => a.status === 'returned')) return block(CG, 'carta devuelta: no se envían más cartas a esta empresa');
  const camp = sameCampaign(all, input);
  if (camp.length >= cfg.maxPerCampaign) return block(CG, `máximo de ${cfg.maxPerCampaign} cartas por empresa y campaña`);
  const l = last(camp);
  if (l && at(input, ctx).getTime() - l.at.getTime() < cfg.minDaysBetween * DAY_MS) {
    return block(CG, `menos de ${cfg.minDaysBetween} días desde la carta anterior`);
  }
  return null;
}

function humanCall(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  const cfg = ctx.settings.cadences.humanCall;
  const camp = sameCampaign(prior(ctx, 'human_call', 'prospecting'), input);
  if (camp.some((a) => a.outcome === 'not_interested')) return block(CG, 'dijo «no interesa» en esta campaña');
  const answered = camp.filter((a) => a.outcome !== 'unanswered').length; // outcome desconocido = contestado
  if (answered >= cfg.maxAnsweredPerCampaign) return block(CG, 'ya hay un intento contestado en esta campaña');
  if (camp.filter((a) => a.outcome === 'unanswered').length >= cfg.maxUnanswered) {
    return block(CG, `máximo de ${cfg.maxUnanswered} intentos sin respuesta`);
  }
  return null;
}

function visit(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  const n = sameCampaign(prior(ctx, 'visit', 'prospecting'), input).length;
  return n >= ctx.settings.cadences.visit.maxPerCampaign ? block(CG, 'máximo de visitas por empresa y campaña') : null;
}

function aiCall(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  if (input.direction !== 'outbound') return null;
  const cfg = ctx.settings.cadences.aiCall;
  const now = at(input, ctx);
  const tz = ctx.settings.timeWindows.timezone;
  const all = prior(ctx, 'ai_call');
  const today = localParts(now, tz).date;
  if (all.filter((a) => localParts(a.at, tz).date === today).length >= cfg.maxPerDay) {
    return block(CG, `máximo de ${cfg.maxPerDay} llamada de IA al día`);
  }
  const l = last(all);
  if (l && now.getTime() - l.at.getTime() < cfg.minHoursBetween * HOUR_MS) {
    return block(CG, `menos de ${cfg.minHoursBetween} h desde el intento anterior`);
  }
  const consent = activeConsent(ctx, input, 'ai_call', input.purpose, now);
  if (consent && all.filter((a) => a.consentId === consent.id).length >= cfg.maxAttemptsPerConsent) {
    return block(CG, `máximo de ${cfg.maxAttemptsPerConsent} intentos por consentimiento`);
  }
  return null;
}

function emailMarketing(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  const cfg = ctx.settings.cadences.emailMarketing;
  const now = at(input, ctx).getTime();
  const all = prior(ctx, 'email_marketing');
  if (all.filter((a) => now - a.at.getTime() < 7 * DAY_MS).length >= cfg.maxPerWeek) {
    return block(CG, `máximo de ${cfg.maxPerWeek} email comercial a la semana`);
  }
  if (sameCampaign(all, input).length >= cfg.maxPerCampaign) return block(CG, `máximo de ${cfg.maxPerCampaign} emails por campaña`);
  return null;
}

function transactional(input: CheckInput, ctx: ComplianceContext): Verdict | null {
  if (input.purpose !== 'demo_confirmation' || !input.demoId) return null;
  const n = prior(ctx, input.channel, 'demo_confirmation').filter((a) => a.demoId === input.demoId).length;
  return n >= ctx.settings.cadences.transactionalDemo.max ? block(CG, 'confirmación y un recordatorio ya enviados') : null;
}

/** CG-06 — cadencia superada (compliance.md «Cadencias por defecto»). */
export const cg06: Rule = (input, ctx) => {
  switch (input.channel) {
    case 'postal_letter': return input.purpose === 'prospecting' ? postal(input, ctx) : null;
    case 'human_call': return input.purpose === 'prospecting' ? humanCall(input, ctx) : null;
    case 'visit': return input.purpose === 'prospecting' ? visit(input, ctx) : null;
    case 'ai_call': return aiCall(input, ctx);
    case 'email_marketing': return emailMarketing(input, ctx);
    default: return transactional(input, ctx);
  }
};
