import type { Capability, ErrorReason, LlmProvider, ProviderRequest, ProviderResponse, ProviderUsage } from './types.js';

export interface OpenRouterOptions {
  /** clave de API (de la variable de entorno OPENROUTER_API_KEY); sin valor por defecto (constitución P5.1) */
  apiKey: string;
  /** `https://openrouter.ai/api/v1`, o `https://eu.openrouter.ai/api/v1` para la región UE (D-16) */
  baseUrl?: string | undefined;
  siteUrl?: string | undefined;
  appTitle?: string | undefined;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const RETRYABLE = new Set([408, 429, 502, 503, 504]);
const HTTP_REASON: Record<number, ErrorReason> = {
  400: 'bad_request', 401: 'auth', 402: 'credits', 403: 'forbidden', 408: 'timeout', 429: 'rate_limited',
  502: 'provider_down', 503: 'unavailable', 504: 'timeout',
};
const EMPTY_USAGE: ProviderUsage = { input: 0, output: 0, cachedInput: 0, costUsd: null };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function parseUsage(raw: unknown): ProviderUsage {
  const u = obj(raw);
  return {
    input: num(u.prompt_tokens),
    output: num(u.completion_tokens),
    cachedInput: num(obj(u.prompt_tokens_details).cached_tokens),
    costUsd: typeof u.cost === 'number' && Number.isFinite(u.cost) ? u.cost : null,
  };
}

function fail(reason: ErrorReason, usage: ProviderUsage = EMPTY_USAGE): ProviderResponse {
  return { status: 'error', reason, servedModel: null, usage, fallbackUsed: false };
}

/** Interpreta un cuerpo HTTP 200. OpenRouter puede devolver un error dentro de un 200: se mira siempre el campo `error`. */
function interpret(body: Json, requested: string): ProviderResponse {
  const usage = parseUsage(body.usage);
  const served = typeof body.model === 'string' ? body.model : null;
  const base = { servedModel: served, usage, fallbackUsed: served !== null && served !== requested, requestId: typeof body.id === 'string' ? body.id : undefined };
  if (body.error) return { ...base, status: 'error', reason: 'provider_error' };
  const choice = obj((Array.isArray(body.choices) ? body.choices : [])[0]);
  const message = obj(choice.message);
  switch (choice.finish_reason) {
    case 'stop': {
      const text = typeof message.content === 'string' ? message.content : '';
      return text.trim() ? { ...base, status: 'ok', text } : { ...base, status: 'error', reason: 'empty_response' };
    }
    case 'length': return { ...base, status: 'truncated' };
    case 'content_filter': return { ...base, status: 'refused' };
    case 'error': return { ...base, status: 'error', reason: 'provider_error' };
    case 'tool_calls': return { ...base, status: 'error', reason: 'unexpected_tool_calls' };
    default: return { ...base, status: 'error', reason: choice.finish_reason === undefined ? 'bad_response' : 'unknown_finish' };
  }
}

function buildBody(req: ProviderRequest): Json {
  const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages];
  return {
    model: req.model,
    ...(req.fallbackModels?.length ? { models: [req.model, ...req.fallbackModels] } : {}),
    messages,
    max_tokens: req.maxTokens,
    // Privacidad (constitución P5.6): nunca a proveedores que recojan datos; y los parámetros no soportados NO se ignoran.
    provider: { require_parameters: true, data_collection: 'deny', ...(req.zdr ? { zdr: true } : {}) },
    ...(req.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema } } } : {}),
  };
}

export function createOpenRouterProvider(opts: OpenRouterOptions): LlmProvider {
  if (!opts.apiKey?.trim()) throw new Error('Falta la clave de API de OpenRouter (variable de entorno OPENROUTER_API_KEY)');
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 3;
  const headers = {
    authorization: `Bearer ${opts.apiKey}`,
    'content-type': 'application/json',
    'http-referer': opts.siteUrl ?? 'https://go.turnosala.com',
    'x-title': opts.appTitle ?? 'TurnoSala Prospector',
  };
  const capabilities: ReadonlySet<Capability> = new Set<Capability>(['structured_output', 'prompt_cache']);

  async function once(req: ProviderRequest): Promise<{ http: number; body: Json; retryAfterMs: number | null } | 'network'> {
    try {
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(buildBody(req)), signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });
      const ra = Number(res.headers.get('retry-after'));
      const body = obj(await res.json().catch(() => ({})));
      return { http: res.status, body, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null };
    } catch {
      return 'network'; // el mensaje del error puede incluir la URL o cabeceras: no se propaga
    }
  }

  return {
    id: 'openrouter',
    capabilities,
    async call(req: ProviderRequest): Promise<ProviderResponse> {
      let last: ProviderResponse = fail('network');
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const r = await once(req);
        if (r === 'network') last = fail('network');
        else if (r.http === 200) return interpret(r.body, req.model);
        else {
          last = fail(HTTP_REASON[r.http] ?? `http_${r.http}`);
          if (!RETRYABLE.has(r.http)) return last;
          if (attempt < maxAttempts) { await sleep(r.retryAfterMs ?? 1000 * 2 ** (attempt - 1)); continue; }
        }
        if (attempt < maxAttempts) await sleep(1000 * 2 ** (attempt - 1));
      }
      return last;
    },
  };
}
