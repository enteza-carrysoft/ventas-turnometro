import { BOX_KEYS, CONSENT_GRANTS, isWebmailDomain, type DemoRequestData } from '@turnosala/core';
import type pg from 'pg';
import { type ConsentBox, type ConsentTextRow } from './consent-texts.js';
import { insertConsent } from './consents.js';
import { openDealForMilestone, pickOwner } from './deals.js';
import { rescoreProspect } from './enrichment.js';
import { ingestCandidate } from './ingest.js';
import type { ResolvedToken } from './tokens.js';
import { uuidv7 } from './uuid.js';

// Envío del formulario de solicitud de demo (REQ-CNS-01, REQ-CRM-01). Nada se envía a nadie: solo se registran lo que la persona facilitó, sus consentimientos
// exactos (uno por casilla y destino), la señal de interés y la oportunidad. Una exclusión previa (oposición, cliente) manda: se avisa a una persona y no se abre nada.

type Client = pg.PoolClient;
const ACTOR = 'system:inbound_form';
const ATTEND_TASK = 'Atender la demo solicitada';
const REVIEW_TASK = 'Revisar solicitud de demo de un contacto excluido';

export interface SubmitInput {
  form: DemoRequestData;
  texts: Record<ConsentBox, ConsentTextRow>;
  sourceUrl: string;
  ip: string | null;
  userAgent: string | null;
  token: ResolvedToken | null;
  sector?: string | null | undefined;
  utm?: Record<string, string> | undefined;
  now?: Date | undefined;
}
export type SubmitResult =
  | { status: 'recorded'; prospectId: string; dealId: string; requestId: string; consentIds: string[]; assignedTo: string | null }
  | { status: 'excluded'; reason: 'suppressed' | 'blocked'; prospectId: string };

/** Defensa en profundidad: cada casilla necesita el dato al que se aplica (la validación de formulario ya lo exige). */
function assertDestinations(f: DemoRequestData): void {
  if (!f.email && !f.phone) throw new Error('Hace falta un correo o un teléfono');
  if (f.boxes.email && !f.email) throw new Error('La casilla de correo necesita un correo electrónico');
  if ((f.boxes.human_call || f.boxes.ai_call || f.boxes.sms_whatsapp) && !f.phone) throw new Error('Las casillas de llamada y mensajes necesitan un teléfono');
}

const emailDomain = (email: string | null): string | null => (email ? email.split('@')[1]?.toLowerCase() ?? null : null);

async function resolveProspect(pool: pg.Pool, i: SubmitInput): Promise<{ prospectId: string; blocked: boolean }> {
  if (i.token) {
    const st = (await pool.query('select status from prospects where id = $1', [i.token.prospectId])).rows[0] as { status: string } | undefined;
    if (!st) throw new Error('La ficha del enlace ya no existe');
    return { prospectId: i.token.prospectId, blocked: st.status === 'blocked' || st.status === 'archived' };
  }
  const domain = emailDomain(i.form.email);
  const website = domain && !isWebmailDomain(domain) ? `https://${domain}/` : undefined;
  const r = await ingestCandidate(pool, {
    name: i.form.company ?? 'Sin nombre', ...(website ? { website } : {}), sourceId: 'inbound_form', externalId: '', sourceUrl: i.sourceUrl,
    fetchedAt: i.now ?? new Date(), extractorVersion: 'inbound-v1', evidences: [],
  });
  const st = (await pool.query('select status from prospects where id = $1', [r.prospectId])).rows[0] as { status: string };
  return { prospectId: r.prospectId, blocked: r.action === 'blocked' || st.status === 'blocked' || st.status === 'archived' };
}

async function isSuppressed(pool: pg.Pool, prospectId: string, f: DemoRequestData): Promise<boolean> {
  const own = (await pool.query('select domain from prospects where id = $1', [prospectId])).rows[0] as { domain: string | null } | undefined;
  const given = emailDomain(f.email);
  const domains = [own?.domain, given && !isWebmailDomain(given) ? given : null].filter((d): d is string => !!d);
  const r = await pool.query(
    `select 1 from suppressions where (kind = 'email' and lower(value) = $1) or (kind = 'phone' and value = $2)
        or (kind = 'domain' and lower(value) = any($3::text[])) or (kind = 'prospect' and value = $4) limit 1`,
    [f.email ?? '', f.phone ?? '', domains, prospectId]);
  return (r.rowCount ?? 0) > 0;
}

async function recordExcluded(pool: pg.Pool, i: SubmitInput, prospectId: string, reason: 'suppressed' | 'blocked'): Promise<SubmitResult> {
  const f = i.form;
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'inbound.excluded_request','prospect',$2,$3)`,
      [ACTOR, prospectId, JSON.stringify({ reason, name: f.name, email: f.email, phone: f.phone, company: f.company, source_url: i.sourceUrl })]);
    const owner = await pickOwner(c);
    const pending = (await c.query(`select 1 from tasks where prospect_id = $1 and title = $2 and status = 'open'`, [prospectId, REVIEW_TASK])).rowCount;
    if (owner && !pending) {
      await c.query(
        `insert into tasks (id, prospect_id, kind, title, note, assignee_user_id, due_at, created_by) values ($1,$2,'other',$3,$4,$5,$6,$7)`,
        [uuidv7(), prospectId, REVIEW_TASK, `Pidió una demo (${f.name}) alguien con una exclusión previa (${reason}). No se ha abierto nada: decide una persona. Detalle en la auditoría.`, owner, i.now ?? new Date(), ACTOR]);
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return { status: 'excluded', reason, prospectId };
}

/** Una fila por casilla marcada y destino (compliance.md compara canal, finalidad y destino con igualdad estricta). El texto guardado es el que la persona vio, literal. */
async function grantConsents(c: Client, i: SubmitInput, prospectId: string): Promise<string[]> {
  const ids: string[] = [];
  const privacy = i.texts.privacy;
  for (const box of BOX_KEYS) {
    if (!i.form.boxes[box]) continue;
    const text = i.texts[box];
    for (const g of CONSENT_GRANTS[box]) {
      ids.push(await insertConsent(c, {
        prospectId, channel: g.channel, purpose: g.purpose, action: 'grant',
        ...(g.to === 'email' ? { email: i.form.email } : { phone: i.form.phone }),
        textVersion: `${text.version}+${privacy.version}`, textSnapshot: `${text.text}\n\n${privacy.text}`,
        sourceUrl: i.sourceUrl, ip: i.ip, userAgent: i.userAgent, campaignId: i.token?.campaignId ?? null,
      }));
    }
  }
  return ids;
}

function cleanUtm(utm: Record<string, string> | undefined): Record<string, string> | undefined {
  const out = Object.fromEntries(Object.entries(utm ?? {}).filter(([k, v]) => /^utm_[a-z]{1,20}$/.test(k) && typeof v === 'string' && v.length <= 100));
  return Object.keys(out).length ? out : undefined;
}

async function recordRequest(pool: pg.Pool, i: SubmitInput, prospectId: string): Promise<SubmitResult> {
  const f = i.form;
  const at = i.now ?? new Date();
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select 1 from prospects where id = $1 for update', [prospectId]); // serializa las solicitudes de la misma ficha
    await c.query(`update prospects set status = 'pending_review', updated_at = now() where id = $1 and status = 'candidate'`, [prospectId]);
    const requestId = uuidv7();
    const consentIds = await grantConsents(c, i, prospectId);
    await c.query(
      `insert into evidences (id, prospect_id, field, value, provenance, source_url, quote, fetched_at, extractor_version)
       values ($1,$2,'signal:inbound_interest',null,'observed',$3,'Solicitud de demo enviada desde el formulario',$4,'inbound-v1') on conflict do nothing`, [uuidv7(), prospectId, i.sourceUrl, at]);
    await rescoreProspect(c, prospectId);
    const deal = await openDealForMilestone(c, {
      prospectId, campaignId: i.token?.campaignId ?? null, sourceChannel: i.token ? 'landing_personalizada' : 'landing_sector', utm: cleanUtm(i.utm), createdBy: ACTOR,
    });
    await c.query(
      `insert into demo_requests (id, prospect_id, deal_id, requester_name, requester_email, requester_phone, company, sector, source_url, campaign_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [requestId, prospectId, deal.dealId, f.name, f.email, f.phone, f.company, i.sector ?? null, i.sourceUrl, i.token?.campaignId ?? null, at]);
    const open = (await c.query(`select 1 from tasks where deal_id = $1 and title = $2 and status = 'open'`, [deal.dealId, ATTEND_TASK])).rowCount;
    if (deal.ownerUserId && !open) {
      await c.query(
        `insert into tasks (id, prospect_id, deal_id, kind, title, assignee_user_id, due_at, created_by) values ($1,$2,$3,'follow_up',$4,$5,$6,$7)`,
        [uuidv7(), prospectId, deal.dealId, ATTEND_TASK, deal.ownerUserId, at, ACTOR]);
    }
    await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'demo_request.received','prospect',$2,$3)`, [ACTOR, prospectId, JSON.stringify({ request_id: requestId, deal_id: deal.dealId, consents: consentIds.length })]);
    await c.query('commit');
    return { status: 'recorded', prospectId, dealId: deal.dealId, requestId, consentIds, assignedTo: deal.ownerUserId };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function submitDemoRequest(pool: pg.Pool, i: SubmitInput): Promise<SubmitResult> {
  assertDestinations(i.form);
  const { prospectId, blocked } = await resolveProspect(pool, i);
  if (blocked) return recordExcluded(pool, i, prospectId, 'blocked');
  if (await isSuppressed(pool, prospectId, i.form)) return recordExcluded(pool, i, prospectId, 'suppressed');
  return recordRequest(pool, i, prospectId);
}
