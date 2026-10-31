import { approveSegment, bulkApprove, correctField, exportApprovedCsv, retireSegment, reviewProspect } from '@turnosala/db/web';
import { z } from 'zod';
import { fail, guardPost, json, UUID, type RouteDeps } from './http.js';
import { roleOf, type Role } from './users.js';

// Rutas de la revisión humana y de los segmentos. Cada una comprueba en SERVIDOR: origen exacto (CSRF), tipo JSON, sesión y rol; la
// interfaz solo es una comodidad. Aprobar no contacta con nadie (REQ-REV-02 CA1).

export type ReviewDeps = RouteDeps;

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
