// Contrato común de los proveedores de LLM (ADR-005). Cada adaptador implementa `LlmProvider` y declara sus capacidades.

export const PROVIDER_IDS = ['openrouter', 'anthropic'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const CAPABILITIES = ['structured_output', 'web_search', 'prompt_cache', 'batch', 'strict_tools'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Motivos de error normalizados: la pasarela y el resto del sistema nunca ven códigos propios de un proveedor. */
export type ErrorReason =
  | 'credits' | 'auth' | 'bad_request' | 'forbidden' | 'rate_limited' | 'timeout' | 'provider_down' | 'unavailable'
  | 'network' | 'provider_error' | 'empty_response' | 'bad_response' | 'unexpected_tool_calls' | 'unknown_finish'
  | `http_${number}`;

export interface ProviderRequest {
  model: string;
  /** modelos de reserva permitidos, si la ruta admite más de uno */
  fallbackModels?: string[] | undefined;
  system?: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  jsonSchema?: { name: string; schema: Record<string, unknown> } | undefined;
  maxTokens: number;
  /** cero retención de datos exigida por la ruta */
  zdr: boolean;
  /** búsqueda web del proveedor; el modelo decide cuándo buscar, dentro de estos límites */
  webSearch?: WebSearchOptions | undefined;
}

export interface WebSearchOptions {
  maxResults: number;
  maxUses: number;
  excludedDomains?: string[] | undefined;
}

export interface Citation {
  url: string;
  title: string;
}

export interface ProviderUsage {
  input: number;
  output: number;
  cachedInput: number;
  /** coste que informa el proveedor (créditos ≈ USD); null si no lo informa */
  costUsd: number | null;
}

export interface ProviderResponse {
  status: 'ok' | 'refused' | 'truncated' | 'error';
  /** solo con status `ok` */
  text?: string | undefined;
  reason?: ErrorReason | undefined;
  servedModel: string | null;
  usage: ProviderUsage;
  fallbackUsed: boolean;
  requestId?: string | undefined;
  /** fuentes citadas por la búsqueda web (http/https, sin duplicados) */
  citations?: Citation[] | undefined;
  /** búsquedas que el proveedor dice haber hecho (facturables) */
  webSearches?: number | undefined;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly capabilities: ReadonlySet<Capability>;
  call(req: ProviderRequest): Promise<ProviderResponse>;
}
