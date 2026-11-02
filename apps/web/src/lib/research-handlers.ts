import { cancelJob, createResearchJob, listRequests, MAX_BATCH, pauseJob, requestWork, resumeJob } from '@turnosala/db/web';
import { parseMarketHints } from '@turnosala/core';
import { z } from 'zod';
import { fail, guardPost, json, UUID, type RouteDeps } from './http.js';

// Rutas de la investigación (REQ-RES-01): lanzar un trabajo, pausar/reanudar/cancelar y pedir el análisis de mercado al worker.
// El panel no llama al modelo ni a las fuentes: encola, y el worker ejecuta. Solo marketing y admin.

const launchBody = z.object({
  segmentId: z.string().regex(UUID),
  ineCodes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(300),
  sourceIds: z.array(z.string().min(1)).min(1).max(10),
  maxCandidates: z.number().int().min(1).max(MAX_BATCH).optional(),
  budgetEur: z.number().gt(0).max(100),
});

export async function handleLaunchResearch(req: Request, deps: RouteDeps): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  const parsed = launchBody.safeParse(g.body);
  if (!parsed.success) return json(422, { error: 'datos no válidos' });
  try {
    const r = await createResearchJob(deps.pool, { ...parsed.data, createdBy: g.who.userId });
    return json(200, r);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23503') return json(422, { error: 'municipio o segmento no válido' });
    if (e instanceof Error && code === undefined) return json(422, { error: e.message }); // validaciones propias: fuente inactiva, segmento sin aprobar…
    throw e;
  }
}

const ACTIONS = { pause: pauseJob, resume: resumeJob, cancel: cancelJob } as const;

export async function handleResearchControl(req: Request, deps: RouteDeps, id: string, action: keyof typeof ACTIONS): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  if (!UUID.test(id)) return fail('not_found');
  const exists = (await deps.pool.query('select 1 from research_jobs where id = $1', [id])).rowCount;
  if (!exists) return fail('not_found');
  const changed = await ACTIONS[action](deps.pool, id, g.who.userId);
  return changed ? json(200, { ok: true }) : fail('conflict');
}

export async function handleRequestAnalysis(req: Request, deps: RouteDeps): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  const product = (await deps.pool.query(`select id from products order by (slug = 'turnosala') desc, slug limit 1`)).rows[0] as { id: string } | undefined;
  if (!product) return json(409, { error: 'no hay ningún producto dado de alta' });
  const open = (await listRequests(deps.pool, 'market.analyze', 5)).some((r) => r.status === 'queued' || r.status === 'running');
  if (open) return json(409, { error: 'ya hay un análisis en curso' });
  const hints = parseMarketHints((g.body as { hints?: unknown } | null)?.hints);
  const id = await requestWork(deps.pool, 'market.analyze', { productId: product.id, ...(hints.length ? { hints } : {}) }, g.who.userId);
  return json(200, { requestId: id });
}
