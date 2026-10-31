import * as ch from './channels.js';
import { cg06 } from './cadence.js';
import { block, type Rule } from './common.js';
import * as g from './gates.js';
import type { CheckInput, ComplianceContext, EvaluateResult } from './types.js';

/** Orden de evaluación de compliance.md: la primera regla que decide, gana. */
export const RULES: ReadonlyArray<readonly [string, Rule]> = [
  ['CG-01', g.cg01], ['CG-02', g.cg02], ['CG-03', g.cg03], ['CG-04', g.cg04], ['CG-05', g.cg05],
  ['CG-06', cg06], ['CG-07', g.cg07], ['CG-08', g.cg08],
  ['CG-10', ch.cg10], ['CG-11', ch.cg11], ['CG-12', ch.cg12],
  ['CG-20', ch.cg20], ['CG-21', ch.cg21], ['CG-22', ch.cg22],
  ['CG-30', ch.cg30], ['CG-31', ch.cg31], ['CG-32', ch.cg32],
  ['CG-40', ch.cg40], ['CG-41', ch.cg41],
  ['CG-50', ch.cg50], ['CG-51', ch.cg51], ['CG-52', ch.cg52],
  ['CG-60', ch.cg60],
];

/**
 * Puerta de cumplimiento, pura: no toca BD ni reloj. Cualquier excepción interna se convierte en BLOCK
 * (P1.2: error técnico ⇒ BLOCK con motivo).
 */
export function evaluate(input: CheckInput, ctx: ComplianceContext): EvaluateResult {
  try {
    for (const [, rule] of RULES) {
      const v = rule(input, ctx);
      if (v) return { decision: v.decision, ruleIds: [v.ruleId], reasons: [v.reason], consentId: v.consentId ?? null };
    }
  } catch (e) {
    const v = block('CG-99', `error al evaluar: ${e instanceof Error ? e.message : String(e)}`);
    return { decision: v.decision, ruleIds: [v.ruleId], reasons: [v.reason], consentId: null };
  }
  const v = block('CG-99', 'ninguna regla aplica');
  return { decision: v.decision, ruleIds: [v.ruleId], reasons: [v.reason], consentId: null };
}
