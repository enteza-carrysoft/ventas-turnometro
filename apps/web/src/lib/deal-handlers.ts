import { assignDeal, loseDeal, moveDeal, winDeal, type DealResult } from '@turnosala/db/web';
import { fail, guardSessionPost, json, UUID, type RouteDeps } from './http.js';

// Acciones sobre una oportunidad desde el panel (REQ-CRM-01/05/06). La ruta solo comprueba origen, JSON y sesión; QUIÉN puede hacer QUÉ lo decide la capa de datos,
// con el rol leído de la base de datos en cada acción.

export type DealAction = 'move' | 'lose' | 'win' | 'assign';
const NOTE_MAX = 1000;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function run(deps: RouteDeps, id: string, action: DealAction, body: Record<string, unknown>, userId: string): Promise<DealResult> | null {
  const actor = { userId };
  switch (action) {
    case 'move': {
      const stage = str(body.stage);
      return stage ? moveDeal(deps.pool, id, stage, actor) : null;
    }
    case 'lose': {
      const reasonId = str(body.reasonId);
      return reasonId ? loseDeal(deps.pool, id, { reasonId, note: typeof body.note === 'string' ? body.note.slice(0, NOTE_MAX * 4) : undefined }, actor) : null;
    }
    case 'win':
      return winDeal(deps.pool, id, actor);
    case 'assign': {
      const owner = body.ownerUserId;
      return owner === null || typeof owner === 'string' ? assignDeal(deps.pool, id, owner, actor) : null;
    }
  }
}

export async function handleDealAction(req: Request, deps: RouteDeps, id: string, action: DealAction): Promise<Response> {
  const g = await guardSessionPost(req, deps);
  if (g instanceof Response) return g;
  if (!UUID.test(id)) return fail('not_found');
  const body = g.body && typeof g.body === 'object' && !Array.isArray(g.body) ? (g.body as Record<string, unknown>) : {};
  const pending = run(deps, id, action, body, g.userId);
  if (!pending) return fail('invalid');
  const r = await pending;
  return r.ok ? json(200, { ok: true }) : fail(r.reason);
}
