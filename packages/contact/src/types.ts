import type { Channel, CheckInput, CheckResult } from '@turnosala/core';
import type pg from 'pg';

/** Puerto hacia un proveedor externo. Las implementaciones reales viven en packages/connectors. */
export interface Connector {
  /** nombre del proveedor, p. ej. 'twilio', 'resend' */
  provider: string;
  send(req: { idempotencyKey: string; input: CheckInput; payload?: unknown }): Promise<{ providerRef: string; costEur: number }>;
}

export interface PlannedAction {
  /** clave de idempotencia: la misma acción nunca se envía dos veces */
  id: string;
  input: CheckInput;
  batchId?: string | undefined;
  contentItemId?: string | undefined;
  /** decisión calculada antes por otro componente: solo se valida (≤ 60 s, mismo contacto y canal); nunca se confía en ella */
  decisionId?: string | undefined;
  estimatedCostEur?: number | undefined;
  payload?: unknown;
}

export type RejectReason =
  | 'decision_unknown' | 'decision_stale' | 'decision_mismatch' | 'review_not_approved';

export interface ExecutionResult {
  status: 'sent' | 'blocked' | 'rejected' | 'failed' | 'duplicate';
  reason?: RejectReason | 'no_connector' | 'connector_error' | undefined;
  decision?: CheckResult | undefined;
  attemptId?: string | undefined;
}

export interface ContactDeps {
  pool: pg.Pool;
  connectors: Partial<Record<Channel, Connector>>;
  clock?: (() => Date) | undefined;
}
