import {
  holidaysAround, normalizeEmail, type Channel, type CheckInput, type ComplianceContext, type ConsentRow,
  type PriorAttempt, type SuppressionRow,
} from '@turnosala/core';
import type pg from 'pg';
import { parseSettings } from './compliance-settings.js';

export type Db = Pick<pg.Pool, 'query'>;

const CONSENT_CHANNEL: Partial<Record<Channel, ConsentRow['channel']>> = {
  ai_call: 'ai_call', human_call: 'human_call', email_marketing: 'email',
  sms_transactional: 'sms', whatsapp_transactional: 'whatsapp',
};
/** Proveedor cuyo presupuesto diario limita el canal (decisions.md D-03). */
const BUDGET_PROVIDER: Partial<Record<Channel, string>> = {
  ai_call: 'voice', email_marketing: 'email', email_transactional: 'email',
};

type Row = Record<string, unknown>;

async function loadProspect(db: Db, input: CheckInput): Promise<ComplianceContext['prospect']> {
  const r = await db.query('select id, status, legal_form, domain from prospects where id = $1', [input.prospectId]);
  const p = r.rows[0] as Row | undefined;
  if (!p) return null;
  // turnosala_customers llega en F1: hasta entonces nadie figura como cliente (limitación anotada en la fase).
  return { id: p.id as string, status: p.status as never, legalForm: p.legal_form as never, domain: (p.domain as string | null) ?? null, isCustomer: false };
}

async function loadSuppressions(db: Db, input: CheckInput, domain: string | null): Promise<SuppressionRow[]> {
  const email = normalizeEmail(input.email) ?? null;
  const domains = [email?.split('@')[1] ?? null, domain?.toLowerCase() ?? null].filter((d): d is string => d !== null);
  const r = await db.query(
    `select kind, value from suppressions where
       (kind = 'phone' and value = $1) or (kind = 'email' and lower(value) = $2)
       or (kind = 'domain' and lower(value) = any($3::text[])) or (kind = 'prospect' and value = $4)`,
    [input.phone ?? null, email, domains, input.prospectId],
  );
  return r.rows.map((x: Row) => ({ kind: x.kind as SuppressionRow['kind'], value: x.value as string }));
}

async function loadConsents(db: Db, input: CheckInput): Promise<ConsentRow[]> {
  const channel = CONSENT_CHANNEL[input.channel];
  if (!channel) return [];
  const email = normalizeEmail(input.email) ?? null;
  const byEmail = channel === 'email';
  const r = await db.query(
    `select id, channel, purpose, action, phone, email, campaign_id, created_at from consents
     where channel = $1 and ${byEmail ? 'lower(email) = $2' : 'phone = $2'}`,
    [channel, byEmail ? email : (input.phone ?? null)],
  );
  return r.rows.map((x: Row) => ({
    id: x.id as string, channel: x.channel as ConsentRow['channel'], purpose: x.purpose as string,
    action: x.action as ConsentRow['action'], phone: (x.phone as string | null) ?? null, email: (x.email as string | null) ?? null,
    campaignId: (x.campaign_id as string | null) ?? null, createdAt: x.created_at as Date,
  }));
}

async function loadAttempts(db: Db, prospectId: string): Promise<PriorAttempt[]> {
  const r = await db.query(
    `select a.channel, a.purpose, a.campaign_id, a.demo_id, d.consent_id, a.status, a.outcome, a.created_at
     from contact_attempts a left join compliance_decisions d on d.id = a.decision_id
     where a.prospect_id = $1 and a.status in ('sending','sent','delivered','failed','returned')`,
    [prospectId],
  );
  return r.rows.map((x: Row) => ({
    channel: x.channel as Channel, purpose: x.purpose as PriorAttempt['purpose'],
    campaignId: (x.campaign_id as string | null) ?? null, demoId: (x.demo_id as string | null) ?? null,
    consentId: (x.consent_id as string | null) ?? null, status: x.status as PriorAttempt['status'],
    outcome: (x.outcome as PriorAttempt['outcome']) ?? null, at: x.created_at as Date,
  }));
}

async function loadDemo(db: Db, input: CheckInput): Promise<ComplianceContext['demo']> {
  if (!input.demoId) return null;
  const r = await db.query(
    'select id, prospect_id, booked_via, status, requester_email, requester_phone from demos where id = $1', [input.demoId]);
  const d = r.rows[0] as Row | undefined;
  if (!d) return null;
  return {
    id: d.id as string, prospectId: d.prospect_id as string, requestedByInterested: d.booked_via === 'form' || d.booked_via === 'voice',
    status: d.status as never, requesterEmail: (d.requester_email as string | null) ?? null, requesterPhone: (d.requester_phone as string | null) ?? null,
  };
}

async function loadBudget(db: Db, provider: string | undefined, limits: Record<string, number>, at: Date): Promise<ComplianceContext['channelBudget']> {
  if (!provider) return { spentTodayEur: 0, limitEur: null };
  const r = await db.query(
    `select coalesce(sum(cost_eur), 0) as spent from usage_costs where provider = $1 and created_at >= $2::timestamptz
       and created_at < $2::timestamptz + interval '1 day'`,
    [provider, dayStartMadrid(at)],
  );
  return { spentTodayEur: Number((r.rows[0] as Row | undefined)?.spent ?? 0), limitEur: limits[provider] ?? null };
}

/** Inicio (UTC) del día local en Europe/Madrid que contiene `at`. */
export function dayStartMadrid(at: Date): Date {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(at)) p[x.type] = x.value;
  const sinceMidnightMs = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000;
  return new Date(at.getTime() - sinceMidnightMs - (at.getTime() % 1000));
}

export async function loadContext(db: Db, input: CheckInput, now: Date): Promise<ComplianceContext> {
  const at = input.at ?? now;
  const { settings, budgets } = parseSettings((await db.query('select key, value from settings')).rows as Array<{ key: string; value: unknown }>);
  const prospect = await loadProspect(db, input);
  const tc = await db.query('select kind, value from test_contacts');
  const kinds = (k: string): string[] => tc.rows.filter((x: Row) => x.kind === k).map((x: Row) => x.value as string);
  const pt = input.phone
    ? ((await db.query(`select type from contact_points where prospect_id = $1 and value_norm = $2 and type in ('switchboard_phone','mobile_phone')`, [input.prospectId, input.phone])).rows[0] as Row | undefined)
    : undefined;
  const addr = input.postalAddressId
    ? ((await db.query(`select id, prospect_id, value_norm from contact_points where id = $1 and type = 'postal_address'`, [input.postalAddressId])).rows[0] as Row | undefined)
    : undefined;
  const consents = await loadConsents(db, input);
  const campaignIds = [...new Set(consents.map((c) => c.campaignId).filter((c): c is string => c !== null))];
  const closed = campaignIds.length
    ? (await db.query(`select id from campaigns where id = any($1::uuid[]) and status = 'closed'`, [campaignIds])).rows.map((x: Row) => x.id as string)
    : [];
  const rob = (await db.query('select result, checked_at from robinson_checks where prospect_id = $1 order by checked_at desc limit 1', [input.prospectId])).rows[0] as Row | undefined;
  return {
    now: at, settings,
    testContacts: { phones: kinds('phone'), emails: kinds('email').map((e) => e.toLowerCase()), postal: kinds('postal') },
    prospect,
    phoneType: (pt?.type as ComplianceContext['phoneType']) ?? null,
    postalAddress: addr ? { id: addr.id as string, prospectId: addr.prospect_id as string, value: addr.value_norm as string } : null,
    demo: await loadDemo(db, input),
    // Las cartas (contenido, plantilla aprobada) llegan en F4: hasta entonces CG-50 no puede dar REVIEW.
    letter: { addressedToCompany: false, templateApproved: false },
    suppressions: await loadSuppressions(db, input, prospect?.domain ?? null),
    consents, closedCampaignIds: closed,
    priorAttempts: await loadAttempts(db, input.prospectId),
    robinson: rob ? { result: rob.result as never, checkedAt: rob.checked_at as Date } : null,
    channelBudget: await loadBudget(db, BUDGET_PROVIDER[input.channel], budgets, at),
    holidays: holidaysAround(at),
  };
}
