import { CHANNELS, type Channel, type ComplianceSettings } from '@turnosala/core';
import { z } from 'zod';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const range = z.tuple([hhmm, hhmm]);
const num = z.number().nonnegative();

const timeWindows = z.object({
  timezone: z.string().min(1),
  call: z.array(range),
  visit: z.array(range),
  email: z.object({ blocked_from: hhmm, blocked_until: hhmm, weekends: z.boolean() }),
});

const cadences = z.object({
  postal_letter: z.object({ max_per_campaign: num, min_days_between: num }),
  human_call: z.object({ max_answered_per_campaign: num, max_unanswered: num }),
  visit: z.object({ max_per_campaign: num }),
  ai_call: z.object({ max_per_day: num, max_attempts_per_consent: num, min_hours_between: num }),
  email_marketing: z.object({ max_per_week: num, max_per_campaign: num }),
  transactional_demo: z.object({ max: num }),
});

export const budgetSchema = z.record(z.string(), num);

/** Todo ajuste obligatorio debe existir y tener forma válida: si no, lanza (y check() devuelve BLOCK CG-99). */
export function parseSettings(rows: Array<{ key: string; value: unknown }>): { settings: ComplianceSettings; budgets: Record<string, number> } {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const get = <T>(key: string, schema: z.ZodType<T>): T => {
    if (!m.has(key)) throw new Error(`falta el ajuste obligatorio «${key}»`);
    const r = schema.safeParse(m.get(key));
    if (!r.success) throw new Error(`ajuste «${key}» no válido`);
    return r.data;
  };
  const killSwitchByChannel: Partial<Record<Channel, boolean>> = {};
  for (const ch of CHANNELS) killSwitchByChannel[ch] = get(`kill_switch_${ch}`, z.boolean());
  const w = get('time_windows', timeWindows);
  const c = get('cadences', cadences);
  const settings: ComplianceSettings = {
    killSwitch: get('kill_switch', z.boolean()),
    killSwitchByChannel,
    appMode: get('app_mode', z.enum(['sandbox', 'production'])),
    b2bHumanCallsApproved: get('b2b_human_calls_approved', z.boolean()),
    postalB2bApproved: get('postal_b2b_approved', z.boolean()),
    lssiCustomerExceptionApproved: get('lssi_customer_exception_approved', z.boolean()),
    robinsonMaxAgeDays: get('robinson_max_age_days', num),
    timeWindows: {
      timezone: w.timezone, call: w.call, visit: w.visit,
      email: { blockedFrom: w.email.blocked_from, blockedUntil: w.email.blocked_until, weekends: w.email.weekends },
    },
    cadences: {
      postalLetter: { maxPerCampaign: c.postal_letter.max_per_campaign, minDaysBetween: c.postal_letter.min_days_between },
      humanCall: { maxAnsweredPerCampaign: c.human_call.max_answered_per_campaign, maxUnanswered: c.human_call.max_unanswered },
      visit: { maxPerCampaign: c.visit.max_per_campaign },
      aiCall: {
        maxPerDay: c.ai_call.max_per_day, maxAttemptsPerConsent: c.ai_call.max_attempts_per_consent,
        minHoursBetween: c.ai_call.min_hours_between,
      },
      emailMarketing: { maxPerWeek: c.email_marketing.max_per_week, maxPerCampaign: c.email_marketing.max_per_campaign },
      transactionalDemo: { max: c.transactional_demo.max },
    },
  };
  return { settings, budgets: get('budget_daily_eur', budgetSchema) };
}
