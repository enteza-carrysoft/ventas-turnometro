import { z } from 'zod';
import { CAPABILITIES, PROVIDER_IDS, type Capability, type Citation, type ErrorReason, type ProviderId, type WebSearchOptions } from './providers/types.js';

export const ROUTE_IDS = [
  'market.analyze', 'market.size', 'discovery', 'enrich.extract', 'content.generate', 'inbound.classify', 'voice.dialog', 'report.weekly',
] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

const providerSchema = z.enum(PROVIDER_IDS);

/** Una ruta (settings.llm_routes): qué proveedor y modelo usa, qué capacidades exige y qué modelos se aceptan como servidos. */
export const routeConfigSchema = z.object({
  provider: providerSchema,
  /** un identificador de modelo por proveedor: no coinciden entre ellos (p. ej. `claude-opus-5-5` vs `anthropic/claude-opus-5.5[1m]`) */
  models: z.object({ openrouter: z.string().min(1).optional(), anthropic: z.string().min(1).optional() }),
  /** lista cerrada de modelos que pueden responder (REQ-LLM-04 CA2); vacía = solo el pedido */
  allowedModels: z.array(z.string().min(1)),
  requires: z.array(z.enum(CAPABILITIES)),
  maxTokens: z.number().int().positive(),
  /** intención de esfuerzo; NO se envía al proveedor hasta verificarlo con el modelo real (F1.1, «Aprendizajes») */
  effort: z.enum(['low', 'medium', 'high']).optional(),
  zdr: z.boolean(),
});
export type RouteConfig = z.infer<typeof routeConfigSchema>;

export const priceSchema = z.object({
  input_per_mtok_usd: z.number().nonnegative(),
  output_per_mtok_usd: z.number().nonnegative(),
  cached_per_mtok_usd: z.number().nonnegative(),
});
export type Price = z.infer<typeof priceSchema>;

export interface LlmConfig {
  routes: Record<RouteId, RouteConfig>;
  enabledProviders: ProviderId[];
  /** contrato de encargo confirmado por proveedor; en `production` es obligatorio (REQ-LLM-03 CA3) */
  dpaConfirmed: Partial<Record<ProviderId, boolean | undefined>>;
  appMode: 'sandbox' | 'production';
  /** presupuesto diario de LLM en euros (D-03) */
  dailyBudgetEur: number;
  /** 1 por defecto: sobrestima el gasto mientras no haya un cambio configurado (lado seguro) */
  usdToEur: number;
  prices: Record<string, Price>;
}

export interface UsageRow {
  route: RouteId;
  provider: ProviderId;
  requestedModel: string;
  servedModel: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costEur: number;
  costSource: 'provider' | 'table' | 'unknown';
  status: 'ok' | 'refused' | 'truncated' | 'error';
  reason: string | null;
  fallbackUsed: boolean;
  requestId: string | null;
  /** búsquedas web que el proveedor dice haber hecho en esta llamada (facturables) */
  webSearches: number;
  at: Date;
}

/** Acceso a la configuración y al gasto; la implementación real vive en `pg-store.ts`. */
export interface LlmStore {
  loadConfig(): Promise<LlmConfig>;
  spentTodayEur(at: Date): Promise<number>;
  recordUsage(row: UsageRow): Promise<void>;
}

export type GatewayReason =
  | ErrorReason
  | 'provider_disabled' | 'dpa_missing' | 'capability_unsupported' | 'provider_unavailable' | 'no_model_for_provider'
  | 'budget' | 'budget_unknown' | 'model_not_allowed' | 'invalid_output' | 'provider_exception' | 'no_config' | 'usage_not_recorded';

export interface LlmRequest<T> {
  system?: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** salida estructurada: el JSON Schema sale de este esquema Zod y la respuesta se valida con él (P5.4) */
  schema?: { name: string; zod: z.ZodType<T> } | undefined;
  maxTokens?: number | undefined;
  /** búsqueda web del proveedor, dentro de estos límites; exige la capacidad “web_search” */
  webSearch?: WebSearchOptions | undefined;
}

export interface LlmResult<T> {
  status: 'ok' | 'refused' | 'truncated' | 'error';
  reason?: GatewayReason | undefined;
  data?: T | undefined;
  text?: string | undefined;
  provider: ProviderId | null;
  requestedModel: string | null;
  servedModel: string | null;
  fallbackUsed: boolean;
  usage: { input: number; output: number; cachedInput: number; costEur: number; costSource: 'provider' | 'table' | 'unknown' };
  /** fuentes que citó la búsqueda web (las da el proveedor, no el modelo) */
  citations?: Citation[] | undefined;
  webSearches?: number | undefined;
}

export type { Capability, Citation, ProviderId, WebSearchOptions };
