// Reintentos educados (REQ-RES-03): máximo 3 intentos con espera exponencial; 429/406 esperan 30 s (política de Overpass); lo prohibido no se reintenta.

export type SourceErrorKind = 'rate_limited' | 'http_5xx' | 'network' | 'timeout' | 'forbidden' | 'bad_response';

export class SourceError extends Error {
  constructor(readonly kind: SourceErrorKind, message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

export const MAX_ATTEMPTS = 3;
const BASE_MS = 2000;
const RATE_LIMIT_MS = 30_000;

export interface RetryOptions {
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

function waitFor(e: SourceError, attempt: number): number | null {
  if (e.kind === 'rate_limited') return RATE_LIMIT_MS;
  if (e.kind === 'http_5xx' || e.kind === 'network' || e.kind === 'timeout') return BASE_MS * 2 ** (attempt - 1);
  return null;
}

export async function withRetry<T>(op: () => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      const wait = e instanceof SourceError ? waitFor(e, attempt) : null;
      if (wait === null || attempt >= MAX_ATTEMPTS) throw e;
      await sleep(wait);
    }
  }
}
