import { checkFormRate, unsubscribeByToken } from '@turnosala/db/web';
import { json } from './http.js';
import { defaultClientIp, ipHmac, readPublicJson, type PublicDeps } from './public-handlers.js';

// Baja pública (sin sesión) desde el enlace de una comunicación. GET solo muestra la página (los antivirus de correo abren los enlaces): la baja se hace con un POST
// deliberado. Cualquier fallo del token devuelve el MISMO 404, sin distinguir inválido, caducado, revocado o de otro tipo.

const NOT_FOUND = (): Response => json(404, { error: 'no_encontrado' });

export async function handleUnsubscribe(req: Request, deps: PublicDeps): Promise<Response> {
  const body = await readPublicJson(req, deps.siteOrigin);
  if (body instanceof Response) return body;
  const now = (deps.now ?? (() => new Date()))();
  const ip = (deps.clientIp ?? defaultClientIp)(req);
  const rate = await checkFormRate(deps.pool, { ipHmac: ipHmac(deps.secret, ip), kind: 'unsubscribe', limit: 20, windowMs: 3600_000, now });
  if (!rate.allowed) return json(429, { error: 'demasiadas_solicitudes' });
  if (typeof body.token !== 'string' || (body.scope !== 'contact' && body.scope !== 'company')) return NOT_FOUND();
  const r = await unsubscribeByToken(deps.pool, body.token, body.scope, now);
  return r.status === 'done' ? json(200, { ok: true }) : NOT_FOUND();
}
