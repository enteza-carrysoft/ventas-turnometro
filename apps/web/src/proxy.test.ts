import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy.js';

const KEYS = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const;
const run = (path: string, env: Partial<Record<(typeof KEYS)[number], string>> = {}): ReturnType<typeof proxy> => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    return proxy(new NextRequest(`https://go.example.test${path}`));
  } finally {
    for (const k of KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('proxy: páginas públicas', () => {
  it('añade una CSP con nonce propio a cada petición pública, y es distinto en cada una', () => {
    const a = run('/demo/clinicas').headers.get('content-security-policy')!;
    const b = run('/demo/clinicas').headers.get('content-security-policy')!;
    expect(a).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(a.match(/'nonce-([^']+)'/)![1]).not.toBe(b.match(/'nonce-([^']+)'/)![1]);
  });

  it('el nonce también viaja a la página como cabecera de petición (x-nonce) para el script del captcha', () => {
    const r = run('/demo/clinicas');
    expect(r.headers.get('x-middleware-override-headers')).toContain('x-nonce');
    expect(r.headers.get('x-middleware-request-x-nonce')).toBe(r.headers.get('content-security-policy')!.match(/'nonce-([^']+)'/)![1]);
  });

  it('no se envía el enlace personal a otros sitios (sin Referer) y las páginas con enlace personal no se guardan ni se indexan', () => {
    for (const p of ['/c/abcDEF123', '/baja/abcDEF123']) {
      const h = run(p).headers;
      expect(h.get('referrer-policy'), p).toBe('no-referrer');
      expect(h.get('x-robots-tag'), p).toBe('noindex, nofollow, noarchive');
      expect(h.get('cache-control'), p).toBe('no-store');
    }
    const demo = run('/demo/clinicas').headers;
    expect(demo.get('referrer-policy')).toBe('no-referrer');
    expect(demo.get('x-robots-tag')).toBeNull();
  });

  it('con claves de Turnstile la CSP abre Cloudflare; sin ellas (sandbox) no abre ningún origen externo', () => {
    expect(run('/demo/x', { TURNSTILE_SITE_KEY: 's', TURNSTILE_SECRET_KEY: 'k' }).headers.get('content-security-policy')).toContain('https://challenges.cloudflare.com');
    expect(run('/demo/x').headers.get('content-security-policy')).not.toContain('https://');
  });
});

describe('proxy: el resto de rutas no se toca', () => {
  it('el panel y su API no reciben la CSP pública ni cabeceras de las páginas públicas', () => {
    for (const p of ['/', '/fichas', '/api/fichas', '/login', '/democracia']) {
      const h = run(p).headers;
      expect(h.get('content-security-policy'), p).toBeNull();
      expect(h.get('referrer-policy'), p).toBeNull();
    }
  });
});
