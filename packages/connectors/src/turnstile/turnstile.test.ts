import { describe, expect, it, vi } from 'vitest';
import { createTurnstileVerifier, SANDBOX_TEST_TOKEN, TURNSTILE_VERIFY_URL } from './turnstile.js';

const SECRET = 'secreto-de-prueba-NO-REAL-0123456789';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const verifier = (reply: () => Promise<Response>, over: Partial<Parameters<typeof createTurnstileVerifier>[0]> = {}) => {
  const f = vi.fn(async () => reply());
  return { v: createTurnstileVerifier({ secret: SECRET, fetch: f as unknown as typeof fetch, ...over }), f };
};
const sent = (f: ReturnType<typeof vi.fn>): URLSearchParams => new URLSearchParams(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));

describe('createTurnstileVerifier (documentación de Cloudflare consultada el 01/11/2026)', () => {
  it('valida contra el endpoint oficial siteverify con POST y formulario: secret, response y la IP del visitante', async () => {
    const { v, f } = verifier(async () => json({ success: true, hostname: 'go.turnosala.com' }));
    expect(await v.verify('TOKEN-OK', '203.0.113.7')).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(TURNSTILE_VERIFY_URL).toBe(url);
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(sent(f))).toEqual({ secret: SECRET, response: 'TOKEN-OK', remoteip: '203.0.113.7' });
  });

  it('sin IP no envía remoteip', async () => {
    const { v, f } = verifier(async () => json({ success: true }));
    await v.verify('TOKEN-OK', null);
    expect(sent(f).has('remoteip')).toBe(false);
  });

  it('un token vacío, que no es texto o de más de 2048 caracteres se rechaza SIN llamar a Cloudflare', async () => {
    const { v, f } = verifier(async () => json({ success: true }));
    for (const bad of ['', '   ', undefined, null, 42, 'x'.repeat(2049)]) {
      expect(await v.verify(bad, null), String(bad).slice(0, 10)).toEqual({ ok: false, reason: 'missing_token' });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('success=false: rechazado, con los códigos de error de Cloudflare (token caducado, repetido o inválido)', async () => {
    const { v } = verifier(async () => json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await v.verify('TOKEN-USADO', null)).toEqual({ ok: false, reason: 'rejected', codes: ['timeout-or-duplicate'] });
  });

  it('comprueba el hostname y la acción cuando se esperan (recomendación de Cloudflare)', async () => {
    const good = verifier(async () => json({ success: true, hostname: 'go.turnosala.com', action: 'demo_request' }), { expectedHostname: 'go.turnosala.com', expectedAction: 'demo_request' });
    expect(await good.v.verify('T', null)).toEqual({ ok: true });
    const badHost = verifier(async () => json({ success: true, hostname: 'otra-web.es', action: 'demo_request' }), { expectedHostname: 'go.turnosala.com' });
    expect(await badHost.v.verify('T', null)).toEqual({ ok: false, reason: 'hostname_mismatch' });
    const badAction = verifier(async () => json({ success: true, hostname: 'go.turnosala.com', action: 'baja' }), { expectedAction: 'demo_request' });
    expect(await badAction.v.verify('T', null)).toEqual({ ok: false, reason: 'action_mismatch' });
    const noHost = verifier(async () => json({ success: true }), { expectedHostname: 'go.turnosala.com' });
    expect(await noHost.v.verify('T', null)).toEqual({ ok: false, reason: 'hostname_mismatch' });
  });

  it('si Cloudflare no responde bien (red, 5xx, JSON roto, tiempo agotado) NO se acepta: falla cerrado', async () => {
    // incluye un 503 cuyo cuerpo «dice» success:true: un error HTTP nunca se acepta, diga lo que diga el cuerpo
    for (const reply of [async () => { throw new TypeError('fetch failed'); }, async () => json({}, 503), async () => json({ success: true, hostname: 'go.turnosala.com' }, 503), async () => new Response('<html>', { status: 200 }), async () => json({ success: 'sí' })]) {
      const { v } = verifier(reply);
      expect(await v.verify('T', null)).toEqual({ ok: false, reason: 'unavailable' });
    }
    // un Cloudflare que no contesta: la petición se aborta al llegar el tiempo máximo
    const f = vi.fn((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
    const t = createTurnstileVerifier({ secret: SECRET, fetch: f as unknown as typeof fetch, timeoutMs: 50 });
    expect(await t.verify('T', null)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('el secreto nunca aparece en el resultado', async () => {
    const { v } = verifier(async () => json({ success: false, 'error-codes': ['invalid-input-secret'] }));
    expect(JSON.stringify(await v.verify('T', null))).not.toContain(SECRET);
  });

  it('exige un secreto configurado', () => {
    expect(() => createTurnstileVerifier({ secret: '  ' })).toThrow(/secret/i);
  });
});

describe('modo de pruebas de sandbox (sin red)', () => {
  it('acepta únicamente el token fijo de pruebas y rechaza el resto, sin llamar a ninguna red', async () => {
    const f = vi.fn();
    const v = createTurnstileVerifier({ secret: 'ignorado', sandboxTest: true, fetch: f as unknown as typeof fetch });
    expect(await v.verify(SANDBOX_TEST_TOKEN, null)).toEqual({ ok: true });
    expect(await v.verify('otro-token', null)).toEqual({ ok: false, reason: 'rejected', codes: ['sandbox-token'] });
    expect(await v.verify('', null)).toEqual({ ok: false, reason: 'missing_token' });
    expect(f).not.toHaveBeenCalled();
  });
});
