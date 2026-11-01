import { approveConsentText, createConsentTextDraft, type ConsentBox } from '@turnosala/db/web';
import { z } from 'zod';
import { fail, guardPost, json, UUID, type RouteDeps } from './http.js';

// Textos de consentimiento versionados (REQ-CNS-01). Solo el `admin` crea y aprueba (lo exige también la capa de BD); la aprobación del asesor legal
// la registra el admin. Una versión aprobada es inmutable: se corrige creando otra.

const createBody = z.object({ box: z.string(), version: z.string(), text: z.string() });

export async function handleConsentText(req: Request, deps: RouteDeps, action: 'create' | 'approve'): Promise<Response> {
  const g = await guardPost(req, deps);
  if (g instanceof Response) return g;
  const actor = { userId: g.who.userId, role: g.who.role };
  if (action === 'create') {
    const b = createBody.safeParse(g.body);
    if (!b.success) return fail('invalid');
    const r = await createConsentTextDraft(deps.pool, b.data.box as ConsentBox, { version: b.data.version, text: b.data.text }, actor);
    return r.ok ? json(200, { id: r.id }) : fail(r.reason);
  }
  const id = (g.body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return fail('not_found');
  const r = await approveConsentText(deps.pool, id, actor);
  return r.ok ? json(200, { ok: true }) : fail(r.reason);
}
