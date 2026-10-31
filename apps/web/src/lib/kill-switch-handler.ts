import type pg from 'pg';
import type { Auth } from './auth.js';
import { ForbiddenError, killSwitchInput, setKillSwitch } from './kill-switch.js';
import { roleOf } from './users.js';

export interface HandlerDeps {
  auth: Auth;
  pool: pg.Pool;
  /** origen público de la aplicación (p. ej. https://go.turnosala.com) */
  siteOrigin: string;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** POST /api/admin/kill-switch — sesión + rol admin comprobados en servidor; origen exacto contra CSRF. */
export async function handleKillSwitch(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.headers.get('origin') !== deps.siteOrigin) return json(403, { error: 'origen no permitido' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'se esperaba JSON' });
  const session = await deps.auth.api.getSession({ headers: req.headers });
  if (!session) return json(401, { error: 'sin sesión' });
  const role = await roleOf(deps.pool, session.user.id);
  if (role !== 'admin') return json(403, { error: 'permiso insuficiente' });
  const parsed = killSwitchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(422, { error: 'datos no válidos' });
  try {
    await setKillSwitch(deps.pool, { userId: session.user.id, role }, parsed.data);
  } catch (e) {
    if (e instanceof ForbiddenError) return json(403, { error: 'permiso insuficiente' });
    return json(500, { error: 'no se pudo cambiar el kill switch' });
  }
  return json(200, { enabled: parsed.data.enabled, channel: parsed.data.channel ?? null });
}
