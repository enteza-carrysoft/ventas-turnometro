// Reglas transversales CG-01 … CG-08 (se evalúan antes que las de cada canal).
import { normalizeEmail } from './consent.js';
import {
  at, block, destinationOf, E164, EMAIL, EMAIL_CHANNELS, emailDomain, PHONE_CHANNELS, type Rule,
} from './common.js';
import { DAY_MS, inRanges, isWeekend, localParts, toMinutes } from './time.js';
import type { CheckInput, ComplianceContext } from './types.js';

export const cg01: Rule = (input, ctx) =>
  ctx.settings.killSwitch || ctx.settings.killSwitchByChannel[input.channel] === true
    ? block('CG-01', ctx.settings.killSwitch ? 'kill_switch global activo' : `kill_switch del canal ${input.channel} activo`)
    : null;

export const cg02: Rule = (input, ctx) => {
  if (ctx.settings.appMode !== 'sandbox') return null;
  const dest = destinationOf(input, ctx);
  const list = PHONE_CHANNELS.has(input.channel) ? ctx.testContacts.phones
    : EMAIL_CHANNELS.has(input.channel) ? ctx.testContacts.emails : ctx.testContacts.postal;
  return dest !== null && list.includes(dest) ? null : block('CG-02', 'sandbox: el destino no está en test_contacts');
};

function isSuppressed(input: CheckInput, ctx: ComplianceContext): boolean {
  const email = normalizeEmail(input.email);
  const domains = new Set([emailDomain(input.email), ctx.prospect?.domain?.toLowerCase() ?? null]);
  return ctx.suppressions.some(
    (s) =>
      (s.kind === 'phone' && s.value === input.phone) ||
      (s.kind === 'email' && s.value.toLowerCase() === email) ||
      (s.kind === 'domain' && domains.has(s.value.toLowerCase())) ||
      (s.kind === 'prospect' && s.value === input.prospectId),
  );
}

export const cg03: Rule = (input, ctx) =>
  isSuppressed(input, ctx) ? block('CG-03', 'destino, dominio o ficha en suppressions (oposición)') : null;

export const cg04: Rule = (_input, ctx) => {
  const { spentTodayEur, limitEur } = ctx.channelBudget;
  return limitEur !== null && spentTodayEur >= limitEur ? block('CG-04', 'presupuesto diario del canal agotado') : null;
};

const CALLS = new Set(['human_call', 'ai_call']);

/** CG-05 solo se aplica a envíos salientes: en una llamada entrante llama el interesado. */
export const cg05: Rule = (input, ctx) => {
  if (input.direction !== 'outbound') return null;
  const w = ctx.settings.timeWindows;
  const p = localParts(at(input, ctx), w.timezone);
  const holiday = ctx.holidays.includes(p.date);
  if (CALLS.has(input.channel) || input.channel === 'visit') {
    const ranges = input.channel === 'visit' ? w.visit : w.call;
    if (isWeekend(p.weekday)) return block('CG-05', 'fin de semana');
    if (holiday) return block('CG-05', 'festivo');
    return inRanges(p.minutes, ranges) ? null : block('CG-05', 'fuera de la franja horaria');
  }
  if (EMAIL_CHANNELS.has(input.channel)) {
    if (!w.email.weekends && isWeekend(p.weekday)) return block('CG-05', 'email: fin de semana');
    const night = p.minutes >= toMinutes(w.email.blockedFrom) || p.minutes < toMinutes(w.email.blockedUntil);
    return night ? block('CG-05', 'email: franja nocturna') : null;
  }
  return null;
};

function missingData(i: CheckInput, c: ComplianceContext): string | null {
  const ch = i.channel;
  const email = normalizeEmail(i.email);
  if (PHONE_CHANNELS.has(ch) && !(i.phone && E164.test(i.phone))) return 'teléfono ausente o no E.164';
  if (EMAIL_CHANNELS.has(ch) && !(email && EMAIL.test(email))) return 'email ausente o no válido';
  if (ch === 'postal_letter' || ch === 'visit') {
    const a = c.postalAddress;
    if (!(i.postalAddressId && a && a.id === i.postalAddressId && a.prospectId === i.prospectId)) {
      return 'dirección postal normalizada ausente o ajena a la ficha';
    }
  }
  if ((i.purpose === 'demo_confirmation' || i.purpose === 'demo_followup') && !(i.demoId && c.demo && c.demo.id === i.demoId)) {
    return 'falta la demo (demoId)';
  }
  if (i.direction === 'outbound' && i.purpose === 'prospecting' && c.prospect?.status !== 'approved') {
    return 'ficha no aprobada';
  }
  return null;
}

export const cg07: Rule = (input, ctx) => {
  const why = missingData(input, ctx);
  return why ? block('CG-07', why) : null;
};

/** CG-08 — autónomos y desconocidos: consulta Lista Robinson vigente y limpia (listed/error también bloquean). */
export const cg08: Rule = (input, ctx) => {
  const risky = ctx.prospect === null || ctx.prospect.legalForm === 'sole_trader' || ctx.prospect.legalForm === 'unknown';
  if (!risky || input.purpose !== 'prospecting') return null;
  if (input.channel !== 'postal_letter' && input.channel !== 'human_call') return null;
  const r = ctx.robinson;
  const fresh = r !== null && at(input, ctx).getTime() - r.checkedAt.getTime() <= ctx.settings.robinsonMaxAgeDays * DAY_MS;
  return r !== null && fresh && r.result === 'clear' ? null : block('CG-08', 'sin consulta Robinson vigente y limpia (autónomo/desconocido)');
};
