import { check, budgetProviderFor, uuidv7 } from '@turnosala/db';
import type { Channel, CheckInput, CheckResult } from '@turnosala/core';
import type { ContactDeps, ExecutionResult, PlannedAction, RejectReason } from './types.js';

type Row = Record<string, unknown>;

/** Roles que pueden aprobar un lote REVIEW por canal (compliance.md «Aprobación de REVIEW»). */
const APPROVER_ROLES: Partial<Record<Channel, readonly string[]>> = {
  postal_letter: ['admin', 'marketing'],
  human_call: ['sales'],
  visit: ['sales'],
  email_marketing: ['admin'],
};

async function maxDecisionAgeS(deps: ContactDeps): Promise<number> {
  const r = await deps.pool.query(`select value from settings where key = 'review_decision_max_age_s'`);
  const v = (r.rows[0] as Row | undefined)?.value;
  return typeof v === 'number' && v > 0 ? v : 60;
}

/** T-20: una decisión recibida de fuera solo vale si es reciente y es de este mismo contacto, canal y destino. */
async function validateProvidedDecision(deps: ContactDeps, input: CheckInput, decisionId: string, now: Date): Promise<RejectReason | null> {
  const r = await deps.pool.query(
    'select prospect_id, channel, direction, destination, created_at from compliance_decisions where id = $1', [decisionId]);
  const d = r.rows[0] as Row | undefined;
  if (!d) return 'decision_unknown';
  const dest = input.phone ?? input.email?.trim().toLowerCase() ?? null;
  const same = d.prospect_id === input.prospectId && d.channel === input.channel && d.direction === input.direction &&
    (dest === null || d.destination === dest);
  if (!same) return 'decision_mismatch';
  const ageS = Math.abs(now.getTime() - (d.created_at as Date).getTime()) / 1000;
  return ageS > (await maxDecisionAgeS(deps)) ? 'decision_stale' : null;
}

/** REVIEW solo habilita la acción si el lote está aprobado y lo aprobó una persona con el rol adecuado. */
async function reviewApproved(deps: ContactDeps, action: PlannedAction): Promise<boolean> {
  const roles = APPROVER_ROLES[action.input.channel];
  if (!action.batchId || !roles) return false;
  const r = await deps.pool.query(
    `select 1 from review_approvals a join send_batches b on b.id = a.batch_id
     where a.batch_id = $1 and b.status in ('approved','executing') and a.role = any($2::text[]) limit 1`,
    [action.batchId, roles],
  );
  return (r.rowCount ?? 0) > 0;
}

async function existingAttempt(deps: ContactDeps, key: string): Promise<ExecutionResult | null> {
  const r = await deps.pool.query('select id from contact_attempts where idempotency_key = $1', [key]);
  const row = r.rows[0] as Row | undefined;
  return row ? { status: 'duplicate', attemptId: row.id as string } : null;
}

/** Registra el intento «sending» y reserva el coste estimado en una sola transacción. */
async function reserve(deps: ContactDeps, action: PlannedAction, decision: CheckResult, provider: string): Promise<string | 'duplicate'> {
  const i = action.input;
  const attemptId = uuidv7();
  const client = await deps.pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into contact_attempts (id, batch_id, prospect_id, channel, purpose, destination, decision_id, content_item_id,
         status, provider, idempotency_key, campaign_id, demo_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'sending',$9,$10,$11,$12)`,
      [attemptId, action.batchId ?? null, i.prospectId, i.channel, i.purpose, i.phone ?? i.email ?? i.postalAddressId ?? '',
        decision.decisionId, action.contentItemId ?? null, provider, action.id, i.campaignId ?? null, i.demoId ?? null],
    );
    await client.query(
      `insert into usage_costs (provider, route, campaign_id, units, cost_eur) values ($1,$2,$3,$4,$5)`,
      [budgetProviderFor(i.channel) ?? provider, `contact.${i.channel}`, i.campaignId ?? null, JSON.stringify({ reserved: true, attempt: attemptId }), action.estimatedCostEur ?? 0],
    );
    await client.query('commit');
    return attemptId;
  } catch (e) {
    await client.query('rollback');
    if ((e as { code?: string }).code === '23505') return 'duplicate'; // otra ejecución ganó la carrera
    throw e;
  } finally {
    client.release();
  }
}

async function settle(deps: ContactDeps, action: PlannedAction, attemptId: string, provider: string): Promise<ExecutionResult['status']> {
  const connector = deps.connectors[action.input.channel];
  try {
    const sent = await (connector as NonNullable<typeof connector>).send({ idempotencyKey: action.id, input: action.input, payload: action.payload });
    await deps.pool.query(`update contact_attempts set status = 'sent', provider_ref = $2, cost_eur = $3, updated_at = now() where id = $1`, [attemptId, sent.providerRef, sent.costEur]);
    const delta = sent.costEur - (action.estimatedCostEur ?? 0);
    if (delta !== 0) {
      await deps.pool.query(
        `insert into usage_costs (provider, route, campaign_id, units, cost_eur) values ($1,$2,$3,$4,$5)`,
        [budgetProviderFor(action.input.channel) ?? provider, `contact.${action.input.channel}`, action.input.campaignId ?? null, JSON.stringify({ adjustment: true, attempt: attemptId }), delta],
      );
    }
    return 'sent';
  } catch {
    // El mensaje del proveedor puede llevar datos del destinatario o credenciales: no se guarda ni se devuelve.
    await deps.pool.query(`update contact_attempts set status = 'failed', updated_at = now() where id = $1`, [attemptId]);
    return 'failed';
  }
}

/**
 * Único punto de salida del sistema (constitución P1.1): re-evalúa SIEMPRE la puerta justo antes de contactar.
 * ALLOW ejecuta; REVIEW solo con lote aprobado por el rol adecuado; BLOCK nunca. Una decisión externa solo se valida.
 * Limitación F0: sin reintentos del proveedor y sin bloqueo de presupuesto entre ejecuciones simultáneas.
 */
export async function execute(deps: ContactDeps, action: PlannedAction): Promise<ExecutionResult> {
  const now = (deps.clock ?? (() => new Date()))();
  const dup = await existingAttempt(deps, action.id);
  if (dup) return dup;
  const badProvided = action.decisionId ? await validateProvidedDecision(deps, action.input, action.decisionId, now) : null;
  const decision = await check(deps.pool, action.input, { clock: () => now });
  if (badProvided) return { status: 'rejected', reason: badProvided, decision };
  if (decision.decision === 'BLOCK') return { status: 'blocked', decision };
  if (decision.decision === 'REVIEW' && !(await reviewApproved(deps, action))) {
    return { status: 'rejected', reason: 'review_not_approved', decision };
  }
  const connector = deps.connectors[action.input.channel];
  if (!connector) return { status: 'failed', reason: 'no_connector', decision };
  const attemptId = await reserve(deps, action, decision, connector.provider);
  if (attemptId === 'duplicate') return (await existingAttempt(deps, action.id)) ?? { status: 'duplicate' };
  const status = await settle(deps, action, attemptId, connector.provider);
  return status === 'sent' ? { status, decision, attemptId } : { status, reason: 'connector_error', decision, attemptId };
}
