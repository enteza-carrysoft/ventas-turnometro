import { NextResponse, type NextRequest } from 'next/server';
import { buildPublicCsp, isPublicPath, newNonce, noIndexPath } from './lib/csp.js';

// Next.js 16 (proxy, antes «middleware»): cabeceras de seguridad SOLO para las páginas públicas (/demo, /c, /baja). El panel conserva su comportamiento.
export function proxy(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname;
  if (!isPublicPath(path)) return NextResponse.next();
  const nonce = newNonce();
  const csp = buildPublicCsp(nonce, { dev: process.env.NODE_ENV === 'development', captcha: Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY) });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('referrer-policy', 'no-referrer'); // el token del enlace personal va en la URL: no debe salir en el Referer hacia terceros
  if (noIndexPath(path)) {
    response.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
    response.headers.set('cache-control', 'no-store');
  }
  return response;
}

export const config = { matcher: ['/demo/:path*', '/c/:path*', '/baja/:path*'] };
