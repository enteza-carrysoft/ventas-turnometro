import { evaluate, normalizeEmail, type CheckInput, type CheckResult, type EvaluateResult } from '@turnosala/core';
import { loadContext, type Db } from './compliance-context.js';
import { uuidv7 } from './uuid.js';

export interface CheckOptions {
  /** Reloj inyectado (por defecto, el del sistema). La evaluación usa input.at si viene. */
  clock?: () => Date;
}

/**
 * Orquestador de la puerta (compliance.md): carga el contexto, llama a la función pura `evaluate()` y guarda la
 * decisión en `compliance_decisions`. Si no puede cargar el contexto, decide BLOCK CG-99 (P1.2) y lo guarda.
 * Si ni siquiera puede guardar la decisión, la excepción se propaga y no hay contacto.
 */
export async function check(db: Db, input: CheckInput, opts: CheckOptions = {}): Promise<CheckResult> {
  const now = (opts.clock ?? (() => new Date()))();
  let result: EvaluateResult;
  let destination: string | null = input.phone ?? normalizeEmail(input.email) ?? null;
  try {
    const ctx = await loadContext(db, input, now);
    result = evaluate(input, ctx);
    destination = destination ?? ctx.postalAddress?.value ?? null;
  } catch (e) {
    result = {
      decision: 'BLOCK', ruleIds: ['CG-99'], consentId: null,
      reasons: [`no se pudo cargar el contexto: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const decisionId = uuidv7();
  await db.query(
    `insert into compliance_decisions (id, input, prospect_id, channel, direction, destination, decision, rule_ids, reasons, consent_id, created_at)
     values ($1, $2, (select id from prospects where id = $3), $4, $5, $6, $7, $8, $9, $10, $11)`,
    [decisionId, JSON.stringify(input), input.prospectId, input.channel, input.direction, destination,
      result.decision, result.ruleIds, result.reasons, result.consentId, now],
  );
  return { ...result, decisionId };
}
