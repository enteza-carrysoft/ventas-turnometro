import type { Reviewer } from '@turnosala/db/web';
import type pg from 'pg';
import { roleOf } from './users.js';

// Defensas comunes de las rutas que modifican datos: origen exacto (CSRF), tipo JSON, sesión y rol, siempre en SERVIDOR.

export interface RouteDeps {
  pool: pg.Pool;
  /** origen público de la aplicación (p. ej. https://go.turnosala.com) */
  siteOrigin: string;
  /** id del usuario de la sesión, o null */
  userId(req: Request): Promise<string | null>;
}

export const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST con las defensas comunes. Devuelve el revisor autenticado (marketing o admin) o la respuesta de error. */
export async function guardPost(req: Request, deps: RouteDeps): Promise<{ who: Reviewer; body: unknown } | Response> {
  if (req.headers.get('origin') !== deps.siteOrigin) return json(403, { error: 'origen no permitido' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'se esperaba JSON' });
  const userId = await deps.userId(req);
  if (!userId) return json(401, { error: 'sin sesión' });
  const role = await roleOf(deps.pool, userId);
  if (role !== 'admin' && role !== 'marketing') return json(403, { error: 'permiso insuficiente' });
  return { who: { userId, role }, body: await req.json().catch(() => null) };
}

/** POST con sesión de CUALQUIER usuario con cuenta: origen exacto, JSON y sesión. El permiso por rol lo decide la capa de datos (el rol sale de la BD en cada acción). */
export async function guardSessionPost(req: Request, deps: RouteDeps): Promise<{ userId: string; body: unknown } | Response> {
  if (req.headers.get('origin') !== deps.siteOrigin) return json(403, { error: 'origen no permitido' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'se esperaba JSON' });
  const userId = await deps.userId(req);
  if (!userId) return json(401, { error: 'sin sesión' });
  return { userId, body: await req.json().catch(() => null) };
}

const FAIL_STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, not_reviewable: 409, not_draft: 409, not_approved: 409, domain_taken: 409, conflict: 409,
  already_approved: 409, closed: 409, invalid_stage: 422, invalid_reason: 422, invalid_owner: 422, use_win: 422, use_lose: 422, version_exists: 409, invalid: 422, reason_required: 422, invalid_value: 422, invalid_field: 422, invalid_patch: 422, invalid_source: 422, personal_email: 422, already_exists: 409,
};
export const fail = (reason: string): Response => json(FAIL_STATUS[reason] ?? 400, { error: reason });
