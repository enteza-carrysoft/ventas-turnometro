import { describe, expect, it } from 'vitest';
import { PUBLIC_PATHS, buildPublicCsp, isPublicPath, noIndexPath, newNonce } from './csp.js';

const directives = (csp: string): Map<string, string[]> =>
  new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...vals] = d.split(/\s+/); return [name!, vals] as [string, string[]]; }));

describe('buildPublicCsp', () => {
  const csp = directives(buildPublicCsp('NONCE123', { dev: false, captcha: true }));

  it('lo no listado se bloquea: default-src, object-src, base-uri, form-action y frame-ancestors restringidos', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('los scripts exigen nonce (strict-dynamic) y solo Cloudflare Turnstile como origen externo; nunca unsafe-inline ni unsafe-eval en producción', () => {
    const s = csp.get('script-src')!;
    expect(s).toContain("'nonce-NONCE123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).toContain('https://challenges.cloudflare.com');
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
    expect(s.filter((x) => x.startsWith('https://'))).toEqual(['https://challenges.cloudflare.com']);
  });

  it('el widget de Turnstile se carga en un iframe de Cloudflare y solo de Cloudflare', () => {
    expect(csp.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
  });

  it('las peticiones del navegador van solo al propio sitio (más Cloudflare para el reto)', () => {
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://challenges.cloudflare.com']);
  });

  it('sin captcha (sandbox) no se abre ningún origen externo', () => {
    const none = directives(buildPublicCsp('N', { dev: false, captcha: false }));
    expect(none.get('script-src')!.some((x) => x.startsWith('https://'))).toBe(false);
    expect(none.has('frame-src')).toBe(false);
    expect(none.get('connect-src')).toEqual(["'self'"]);
  });

  it('solo en desarrollo se permite unsafe-eval (lo exige React en dev)', () => {
    expect(directives(buildPublicCsp('N', { dev: true, captcha: true })).get('script-src')).toContain("'unsafe-eval'");
  });

  it('estilos: bloque con nonce y atributos style en línea (los usa el diseño) sin abrir unsafe-inline en las hojas', () => {
    expect(csp.get('style-src')).toContain("'nonce-NONCE123'");
    expect(csp.get('style-src')).not.toContain("'unsafe-inline'");
    expect(csp.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
  });
});

describe('newNonce', () => {
  it('es aleatorio, distinto en cada petición y apto para una cabecera (base64 sin comillas ni punto y coma)', () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(a).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });
});

describe('rutas públicas', () => {
  it('/demo, /c y /baja son públicas; el panel y la API del panel no', () => {
    for (const p of ['/demo/clinicas', '/c/abc', '/baja/abc', '/demo/x/y']) expect(isPublicPath(p), p).toBe(true);
    for (const p of ['/', '/fichas', '/fichas/1', '/api/fichas', '/login', '/democracia', '/cuenta', '/baja', '/demo']) expect(isPublicPath(p), p).toBe(false);
    expect(PUBLIC_PATHS).toEqual(['/demo/', '/c/', '/baja/']);
  });

  it('las páginas con un enlace personal (/c y /baja) llevan noindex; los sectores no tienen datos personales', () => {
    expect(noIndexPath('/c/abc')).toBe(true);
    expect(noIndexPath('/baja/abc')).toBe(true);
    expect(noIndexPath('/demo/clinicas')).toBe(false);
  });
});
