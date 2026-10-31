import { approveSegment, bulkApprove, correctField, exportApprovedCsv, retireSegment, reviewProspect, type Reviewer } from '@turnosala/db/web';
import type pg from 'pg';
import { z } from 'zod';
import { roleOf, type Role } from './users.js';

// Rutas de la revisión humana y de los segmentos. Cada una comprueba en SERVIDOR: origen exacto (CSRF), tipo JSON, sesión y rol; la
// interfaz solo es una comodidad. Aprobar no contacta con nadie (REQ-REV-02 CA1).

export interface ReviewDeps {
  pool: pg.Pool;
  /** origen público de la aplicación (p. ej. https://go.turnosala.com) */
  siteOrigin: string;
  /** id del usuario de la sesión, o null */
  userId(req: Request): Promise<string | null>;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST con las defensas comunes. Devuelve el revisor autenticado o la respuesta de error. */
async function guardPost(req: Request, deps: ReviewDeps): Promise<{ who: Reviewer; body: unknown } | Response> {
  if (req.headers.get('origin') !== deps.siteOrigin) return json(403, { error: 'origen no permitido' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'se esperaba JSON' });
  const userId = await deps.userId(req);
  if (!userId) return json(401, { error: 'sin sesión' });
  const role = await roleOf(deps.pool, userId);
  if (role !== 'admin' && role !== 'marketing') return json(403, { error: 'permiso insuficiente' });
  return { who: { userId, role }, body: await req.json().catch(() => null) };
}

const FAIL_STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, not_reviewable: 409, not_draft: 409, not_approved: 409, domain_taken: 409,
  reason_required: 422, invalid_value: 422, invalid_field: 422, invalid_patch: 422,
};
const fail = (reason: string): Response => json(FAIL_STATUS[reason] ?? 400, { error: reason });

const reviewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('discard'), reason: z.string() }),
  z.object({ action: z.literal('block'), reason: z.string() }),
]);

export async function handleReview(req: Request, deps: ReviewDeps, id: string): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  if (!UUID.test(id)) return json(404, { error: 'not_found' });
  const parsed = reviewBody.safeParse(g.body);
  if (!parsed.success) return json(422, { error: 'datos no válidos' });
  const r = await reviewProspect(deps.pool, id, g.who, parsed.data);
  return r.ok ? json(200, { status: r.status }) : fail(r.reason);
}

const correctBody = z.object({ field: z.enum(['name', 'website', 'sites_count']), value: z.string() });

export async function handleCorrect(req: Request, deps: ReviewDeps, id: string): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  if (!UUID.test(id)) return json(404, { error: 'not_found' });
  const parsed = correctBody.safeParse(g.body);
  if (!parsed.success) return json(422, { error: 'datos no válidos' });
  const r = await correctField(deps.pool, id, g.who, parsed.data);
  return r.ok ? json(200, { ok: true }) : fail(r.reason);
}

const bulkBody = z.object({ ids: z.array(z.string().regex(UUID)).min(1).max(500) });

export async function handleBulkApprove(req: Request, deps: ReviewDeps): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  const parsed = bulkBody.safeParse(g.body);
  if (!parsed.success) return json(422, { error: 'datos no válidos' });
  const r = await bulkApprove(deps.pool, parsed.data.ids, g.who);
  return r.forbidden ? fail('forbidden') : json(200, { approved: r.approved, sample: r.sample, skipped: r.skipped });
}

const EXPORT_ROLES: readonly Role[] = ['admin', 'marketing', 'sales', 'auditor'];

/** GET /api/fichas/export — CSV interno de fichas aprobadas, sin datos personales (REQ-REV-03). */
export async function handleExport(req: Request, deps: ReviewDeps): Promise<Response> {
  const userId = await deps.userId(req);
  if (!userId) return json(401, { error: 'sin sesión' });
  const role = await roleOf(deps.pool, userId);
  if (!role || !EXPORT_ROLES.includes(role)) return json(403, { error: 'permiso insuficiente' });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(await exportApprovedCsv(deps.pool), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="fichas-aprobadas-${day}.csv"`, 'cache-control': 'no-store' },
  });
}

export async function handleSegmentAction(req: Request, deps: ReviewDeps, id: string, action: 'approve' | 'retire'): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  if (!UUID.test(id)) return json(404, { error: 'not_found' });
  const r = action === 'approve' ? await approveSegment(deps.pool, id, g.who) : await retireSegment(deps.pool, id, g.who);
  return r.ok ? json(200, { ok: true }) : fail(r.reason);
}
