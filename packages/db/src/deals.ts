import { estimateAnnualValue, productFactsSchema } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Oportunidades (REQ-CRM-01). Aquí vive la creación por hito, que usan el formulario de las landings (F2.1) y, más adelante, la revisión humana de llamadas,
// las respuestas interesadas y las llamadas entrantes. Mover de etapa, perder, ganar y los permisos llegan en F2.3.

type Client = pg.PoolClient;
export const DEFAULT_PROPOSED_PLAN = 'pro'; // Profesional (D por defecto de la spec de F2)

export interface MilestoneDeal {
  prospectId: string;
  campaignId?: string | null | undefined;
  sourceChannel: string;
  utm?: Record<string, string> | undefined;
  createdBy: string;
}
export interface MilestoneResult {
  dealId: string;
  created: boolean;
  ownerUserId: string | null;
}

/** Reparto por turnos: el comercial (`sales`) con menos oportunidades abiertas; a igualdad, por id. Sin comerciales ⇒ sin asignar. */
export async function pickOwner(c: Client): Promise<string | null> {
  const r = (await c.query(
    `select r.user_id from app_user_roles r left join deals d on d.owner_user_id = r.user_id and d.closed_at is null
      where r.role = 'sales' group by r.user_id order by count(d.id), r.user_id limit 1`)).rows[0] as { user_id: string } | undefined;
  return r?.user_id ?? null;
}

async function estimatedValue(c: Client): Promise<number | null> {
  const row = (await c.query(`select facts from product_facts where status = 'approved' order by approved_at desc limit 1`)).rows[0] as { facts: unknown } | undefined;
  const parsed = row ? productFactsSchema.safeParse(row.facts) : null;
  return parsed?.success ? estimateAnnualValue(parsed.data, DEFAULT_PROPOSED_PLAN) : null;
}

/**
 * Abre la oportunidad de la ficha en «Interesado» o reutiliza la que ya tiene abierta (máximo una, REQ-CRM-01 CA1). El llamador debe haber bloqueado la fila de
 * la ficha (`select … for update`) en la misma transacción: así dos hitos simultáneos no crean dos oportunidades. Una oportunidad en «Nuevo» sube a
 * «Interesado»; las demás etapas no retroceden. La atribución (campaña, canal, UTM) es la del primer contacto.
 */
export async function openDealForMilestone(c: Client, m: MilestoneDeal): Promise<MilestoneResult> {
  const open = (await c.query('select id, stage_id, owner_user_id from deals where prospect_id = $1 and closed_at is null', [m.prospectId])).rows[0] as
    { id: string; stage_id: string; owner_user_id: string | null } | undefined;
  if (open) {
    if (open.stage_id === 'new') {
      await c.query(`update deals set stage_id = 'interested', updated_at = now() where id = $1`, [open.id]);
      await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'deal.stage_changed','deal',$2,$3)`, [m.createdBy, open.id, JSON.stringify({ prospect_id: m.prospectId, from: 'new', to: 'interested', reason: 'hito comercial' })]);
    }
    return { dealId: open.id, created: false, ownerUserId: open.owner_user_id };
  }
  const id = uuidv7();
  const owner = await pickOwner(c);
  await c.query(
    `insert into deals (id, prospect_id, stage_id, owner_user_id, campaign_id, source_channel, utm, proposed_plan, est_value_eur, created_by)
     values ($1,$2,'interested',$3,$4,$5,$6,$7,$8,$9)`,
    [id, m.prospectId, owner, m.campaignId ?? null, m.sourceChannel, m.utm ? JSON.stringify(m.utm) : null, DEFAULT_PROPOSED_PLAN, await estimatedValue(c), m.createdBy]);
  await c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,'deal.created','deal',$2,$3)`, [m.createdBy, id, JSON.stringify({ prospect_id: m.prospectId, stage: 'interested', source_channel: m.sourceChannel, owner })]);
  return { dealId: id, created: true, ownerUserId: owner };
}
