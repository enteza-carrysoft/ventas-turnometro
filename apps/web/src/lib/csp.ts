// Política de seguridad de contenido de las páginas PÚBLICAS (nonce por petición, según la guía de Next.js 16 consultada el 01/11/2026: el nonce se genera en
// proxy.ts, se envía en la cabecera CSP y Next lo aplica solo a sus scripts). El panel interno no usa esta política.

export const PUBLIC_PATHS = ['/demo/', '/c/', '/baja/'] as const;
const NOINDEX = ['/c/', '/baja/'] as const;
const CLOUDFLARE = 'https://challenges.cloudflare.com';

export const isPublicPath = (path: string): boolean => PUBLIC_PATHS.some((p) => path.startsWith(p) && path.length > p.length);
/** Las páginas con enlace personal no se indexan nunca; los sectores no contienen datos personales. */
export const noIndexPath = (path: string): boolean => NOINDEX.some((p) => path.startsWith(p));

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * `captcha`: abre solo los orígenes de Cloudflare Turnstile (script, iframe y reto). Los directivos exactos del widget no vienen en la documentación de Cloudflare
 * que consultamos: se comprueba en un navegador real con la clave de pruebas (F2.1d), no en CI.
 */
export function buildPublicCsp(nonce: string, o: { dev: boolean; captcha: boolean }): string {
  const cf = o.captcha ? ` ${CLOUDFLARE}` : '';
  const d = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${cf}${o.dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'${o.dev ? " 'unsafe-inline'" : ''}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${cf}`,
    ...(o.captcha ? [`frame-src ${CLOUDFLARE}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return d.join('; ');
}
