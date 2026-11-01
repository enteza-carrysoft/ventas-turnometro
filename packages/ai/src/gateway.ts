import { z } from 'zod';
import type { Capability, LlmProvider, ProviderId, ProviderResponse } from './providers/types.js';
import type { GatewayReason, LlmConfig, LlmRequest, LlmResult, LlmStore, Price, RouteConfig, RouteId, UsageRow } from './types.js';

export interface GatewayDeps {
  store: LlmStore;
  providers: Partial<Record<ProviderId, LlmProvider>>;
  clock?: (() => Date) | undefined;
}

type Cost = { costEur: number; costSource: UsageRow['costSource'] };
const ZERO = { input: 0, output: 0, cachedInput: 0, costEur: 0, costSource: 'unknown' as const };

function stop<T>(reason: GatewayReason, extra: Partial<LlmResult<T>> = {}): LlmResult<T> {
  return { status: 'error', reason, provider: null, requestedModel: null, servedModel: null, fallbackUsed: false, usage: ZERO, ...extra };
}

/** Coste en euros: el que informa el proveedor; si no, la tabla de precios; si no, «desconocido» (queda marcado). */
function costOf(res: ProviderResponse, model: string, cfg: LlmConfig): Cost {
  if (res.usage.costUsd !== null) return { costEur: res.usage.costUsd * cfg.usdToEur, costSource: 'provider' };
  const price: Price | undefined = cfg.prices[res.servedModel ?? ''] ?? cfg.prices[model];
  if (!price) return { costEur: 0, costSource: 'unknown' };
  const { input, output, cachedInput } = res.usage;
  const usd = ((input - cachedInput) * price.input_per_mtok_usd + cachedInput * price.cached_per_mtok_usd + output * price.output_per_mtok_usd) / 1_000_000;
  return { costEur: usd * cfg.usdToEur, costSource: 'table' };
}

function jsonSchemaOf(zod: z.ZodType): Record<string, unknown> {
  const schema = { ...(z.toJSONSchema(zod) as Record<string, unknown>) };
  delete schema.$schema;
  return schema;
}

function parseStructured<T>(text: string, zod: z.ZodType<T>): { ok: true; data: T } | { ok: false } {
  try {
    const parsed = zod.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Comprobaciones previas a la llamada. Devuelve el motivo de rechazo o null si la ruta puede ejecutarse. */
function gate(cfg: LlmConfig, rc: RouteConfig, adapter: LlmProvider | undefined, needs: { schema: boolean; search: boolean }): GatewayReason | null {
  if (!cfg.enabledProviders.includes(rc.provider)) return 'provider_disabled';
  if (cfg.appMode === 'production' && cfg.dpaConfirmed[rc.provider] !== true) return 'dpa_missing';
  if (!adapter) return 'provider_unavailable';
  if (!rc.models[rc.provider]) return 'no_model_for_provider';
  const required = new Set<Capability>(rc.requires);
  if (needs.schema) required.add('structured_output');
  if (needs.search) required.add('web_search');
  for (const c of required) if (!adapter.capabilities.has(c)) return 'capability_unsupported';
  return null;
}

/** Decide el estado final de una respuesta del proveedor: modelo servido permitido y salida válida (P5.4). */
function settle<T>(res: ProviderResponse, rc: RouteConfig, model: string, schema: LlmRequest<T>['schema']): { status: LlmResult<T>['status']; reason: GatewayReason | undefined; data: T | undefined } {
  if (res.status !== 'ok') return { status: res.status, reason: res.reason, data: undefined };
  const allowed = new Set([model, ...rc.allowedModels]);
  if (res.servedModel === null || !allowed.has(res.servedModel)) return { status: 'error', reason: 'model_not_allowed', data: undefined };
  if (!schema) return { status: 'ok', reason: undefined, data: undefined };
  const parsed = parseStructured(res.text ?? '', schema.zod);
  return parsed.ok ? { status: 'ok', reason: undefined, data: parsed.data } : { status: 'error', reason: 'invalid_output', data: undefined };
}

async function callProvider(adapter: LlmProvider, rc: RouteConfig, model: string, req: LlmRequest<unknown>): Promise<ProviderResponse | null> {
  try {
    return await adapter.call({
      model, system: req.system, messages: req.messages, maxTokens: req.maxTokens ?? rc.maxTokens, zdr: rc.zdr,
      jsonSchema: req.schema ? { name: req.schema.name, schema: jsonSchemaOf(req.schema.zod) } : undefined,
      webSearch: req.webSearch,
    });
  } catch {
    return null; // el mensaje de la excepción puede llevar datos del prompt: no se propaga
  }
}

/**
 * Pasarela única de acceso a modelos (ADR-005, REQ-LLM-01…04). El resto del sistema pide una **ruta**, nunca un modelo ni
 * un proveedor. Falla cerrado: sin configuración, sin presupuesto o sin poder registrar el gasto, no hay resultado.
 */
export function createGateway(deps: GatewayDeps) {
  const clock = deps.clock ?? (() => new Date());

  async function run<T>(route: RouteId, req: LlmRequest<T>): Promise<LlmResult<T>> {
    const at = clock();
    let cfg: LlmConfig;
    try {
      cfg = await deps.store.loadConfig();
    } catch {
      return stop('no_config');
    }
    const rc = cfg.routes[route] as RouteConfig | undefined;
    if (!rc) return stop('no_config');
    const adapter = deps.providers[rc.provider];
    const refused = gate(cfg, rc, adapter, { schema: req.schema !== undefined, search: req.webSearch !== undefined });
    if (refused || !adapter) return stop(refused ?? 'provider_unavailable', { provider: rc.provider });
    const model = rc.models[rc.provider] as string;
    const base = { provider: rc.provider, requestedModel: model };

    let spent: number;
    try {
      spent = await deps.store.spentTodayEur(at);
    } catch {
      return stop('budget_unknown', base);
    }
    if (spent >= cfg.dailyBudgetEur) return stop('budget', base);

    const res = await callProvider(adapter, rc, model, req as LlmRequest<unknown>);
    if (!res) return stop('provider_exception', base);
    const outcome = settle(res, rc, model, req.schema);
    const cost = costOf(res, model, cfg);
    try {
      await deps.store.recordUsage({
        route, ...base, servedModel: res.servedModel, inputTokens: res.usage.input, outputTokens: res.usage.output, cachedInputTokens: res.usage.cachedInput,
        ...cost, status: outcome.status, reason: outcome.reason ?? null, fallbackUsed: res.fallbackUsed, requestId: res.requestId ?? null, webSearches: res.webSearches ?? 0, at,
      });
    } catch {
      return stop('usage_not_recorded', base); // sin registro no hay resultado: el gasto no se puede escapar del presupuesto
    }
    return {
      status: outcome.status, reason: outcome.reason, ...base, servedModel: res.servedModel, fallbackUsed: res.fallbackUsed,
      usage: { input: res.usage.input, output: res.usage.output, cachedInput: res.usage.cachedInput, ...cost },
      ...(req.webSearch ? { citations: res.citations ?? [], webSearches: res.webSearches ?? 0 } : {}),
      ...(outcome.status === 'ok' ? (req.schema ? { data: outcome.data } : { text: res.text }) : {}),
    };
  }

  return { run };
}
