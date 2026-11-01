// Verificación en servidor de Cloudflare Turnstile (el captcha de los formularios públicos, REQ-CNS-01 CA3). Documentación consultada el 01/11/2026:
// POST https://challenges.cloudflare.com/turnstile/v0/siteverify con `secret` y `response` (y `remoteip` opcional); token de ≤ 2048 caracteres, válido 300 s y de un solo uso.
// Falla CERRADO: si Cloudflare no responde bien, el envío no se acepta. El secreto nunca sale en un resultado.

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Token fijo del modo de pruebas de sandbox (sin red). En producción este modo no existe: la configuración lo rechaza. */
export const SANDBOX_TEST_TOKEN = 'SANDBOX-CAPTCHA-OK';
const MAX_TOKEN = 2048;

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'missing_token' | 'unavailable' | 'hostname_mismatch' | 'action_mismatch' }
  | { ok: false; reason: 'rejected'; codes: string[] };

export interface TurnstileOptions {
  secret: string;
  expectedHostname?: string | undefined;
  expectedAction?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
  /** solo sandbox: acepta únicamente `SANDBOX_TEST_TOKEN` y no usa la red */
  sandboxTest?: boolean | undefined;
}
export interface TurnstileVerifier {
  verify(token: unknown, remoteIp: string | null): Promise<TurnstileResult>;
}

interface SiteVerify {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

function readBody(raw: unknown): SiteVerify | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.success !== 'boolean') return null;
  return {
    success: b.success,
    ...(typeof b.hostname === 'string' ? { hostname: b.hostname } : {}),
    ...(typeof b.action === 'string' ? { action: b.action } : {}),
    'error-codes': Array.isArray(b['error-codes']) ? (b['error-codes'] as unknown[]).filter((c): c is string => typeof c === 'string') : [],
  };
}

export function createTurnstileVerifier(o: TurnstileOptions): TurnstileVerifier {
  if (!o.secret?.trim()) throw new Error('Falta el secret de Turnstile');
  const doFetch = o.fetch ?? fetch;
  return {
    async verify(token: unknown, remoteIp: string | null): Promise<TurnstileResult> {
      if (typeof token !== 'string' || token.trim() === '' || token.length > MAX_TOKEN) return { ok: false, reason: 'missing_token' };
      if (o.sandboxTest) return token === SANDBOX_TEST_TOKEN ? { ok: true } : { ok: false, reason: 'rejected', codes: ['sandbox-token'] };
      const form = new URLSearchParams({ secret: o.secret, response: token });
      if (remoteIp) form.set('remoteip', remoteIp);
      let body: SiteVerify | null;
      try {
        const res = await doFetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(o.timeoutMs ?? 5000) });
        if (!res.ok) return { ok: false, reason: 'unavailable' };
        body = readBody(await res.json());
      } catch {
        return { ok: false, reason: 'unavailable' }; // el mensaje del error podría contener la URL o datos de la petición: no se propaga
      }
      if (!body) return { ok: false, reason: 'unavailable' };
      if (!body.success) return { ok: false, reason: 'rejected', codes: body['error-codes'] ?? [] };
      if (o.expectedHostname && body.hostname !== o.expectedHostname) return { ok: false, reason: 'hostname_mismatch' };
      if (o.expectedAction && body.action !== o.expectedAction) return { ok: false, reason: 'action_mismatch' };
      return { ok: true };
    },
  };
}
