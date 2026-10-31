import type { SegmentDraft } from '@turnosala/core';
import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from './uuid.js';

// Segmentos ICP (REQ-MKT-02 CA2): nacen en `draft` y solo marketing/admin los aprueba, edita o retira. Todo queda en `audit_log`.
// El modelo no aprueba nunca; un segmento aprobado o retirado no se sobrescribe al repetir el análisis.

type Db = pg.Pool;
type Client = pg.PoolClient;
export type Actor = { userId: string; role: 'admin' | 'marketing' | 'sales' | 'auditor' | 'voice' | null };
const canManage = (a: Actor): boolean => a.role === 'admin' || a.role === 'marketing';

async function tx<T>(pool: Db, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const audit = (c: Client, actor: string, action: string, id: string | null, payload: unknown): Promise<unknown> =>
  c.query(`insert into audit_log (actor, action, entity, entity_id, payload) values ($1,$2,'segment',$3,$4)`, [actor, action, id, JSON.stringify(payload)]);

export async function saveSegmentDrafts(pool: Db, productId: string, drafts: SegmentDraft[], o: { actor: string }): Promise<{ created: number; updated: number; kept: number }> {
  const out = { created: 0, updated: 0, kept: 0 };
  await tx(pool, async (c) => {
    for (const d of drafts) {
      const ex = (await c.query('select id, status from segments where product_id = $1 and slug = $2 for update', [productId, d.slug])).rows[0] as { id: string; status: string } | undefined;
      if (!ex) {
        await c.query(`insert into segments (id, product_id, slug, name, status, definition) values ($1,$2,$3,$4,'draft',$5)`, [uuidv7(), productId, d.slug, d.name, JSON.stringify(d.definition)]);
        out.created++;
      } else if (ex.status === 'draft') {
        await c.query('update segments set name = $2, definition = $3 where id = $1', [ex.id, d.name, JSON.stringify(d.definition)]);
        out.updated++;
      } else out.kept++;
    }
    await audit(c, o.actor, 'segment.drafted', null, { product_id: productId, ...out });
  });
  return out;
}

type Fail<R extends string> = { ok: false; reason: R };
type Seg = { id: string; status: string; slug: string; definition: Record<string, unknown> };

async function lock(c: Client, id: string): Promise<Seg | undefined> {
  return (await c.query('select id, status, slug, definition from segments where id = $1 for update', [id])).rows[0] as Seg | undefined;
}

export async function approveSegment(pool: Db, segmentId: string, actor: Actor): Promise<{ ok: true } | Fail<'forbidden' | 'not_found' | 'not_draft'>> {
  if (!canManage(actor)) return { ok: false, reason: 'forbidden' };
  return tx(pool, async (c) => {
    const s = await lock(c, segmentId);
    if (!s) return { ok: false, reason: 'not_found' } as const;
    if (s.status !== 'draft') return { ok: false, reason: 'not_draft' } as const;
    await c.query(`update segments set status = 'approved' where id = $1`, [segmentId]);
    await audit(c, actor.userId, 'segment.approved', segmentId, { slug: s.slug, role: actor.role, at: new Date().toISOString() });
    return { ok: true } as const;
  });
}

export async function retireSegment(pool: Db, segmentId: string, actor: Actor): Promise<{ ok: true } | Fail<'forbidden' | 'not_found' | 'not_approved'>> {
  if (!canManage(actor)) return { ok: false, reason: 'forbidden' };
  return tx(pool, async (c) => {
    const s = await lock(c, segmentId);
    if (!s) return { ok: false, reason: 'not_found' } as const;
    if (s.status !== 'approved') return { ok: false, reason: 'not_approved' } as const;
    await c.query(`update segments set status = 'retired' where id = $1`, [segmentId]);
    await audit(c, actor.userId, 'segment.retired', segmentId, { slug: s.slug, role: actor.role });
    return { ok: true } as const;
  });
}

const OSM_SAFE = /^[A-Za-z0-9:_\-./ ]+$/;
/** Campos que marketing puede editar. El encaje y las fuentes (inferidos por el modelo) no se tocan a mano. */
const patchSchema = z.object({
  description: z.string().trim().min(1).max(600),
  message: z.string().trim().min(1).max(600),
  bestDemo: z.string().trim().min(1).max(600),
  decisionMakerRole: z.string().trim().min(2).max(120),
  signals: z.array(z.string().trim().min(1)).max(15),
  osmFilters: z.array(z.tuple([z.string().regex(OSM_SAFE), z.string().regex(OSM_SAFE)])).max(8),
}).partial().strict();
export type SegmentPatch = z.infer<typeof patchSchema>;

export async function editSegment(pool: Db, segmentId: string, patch: SegmentPatch, actor: Actor): Promise<{ ok: true } | Fail<'forbidden' | 'not_found' | 'not_draft' | 'invalid_patch'>> {
  if (!canManage(actor)) return { ok: false, reason: 'forbidden' };
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return { ok: false, reason: 'invalid_patch' };
  return tx(pool, async (c) => {
    const s = await lock(c, segmentId);
    if (!s) return { ok: false, reason: 'not_found' } as const;
    if (s.status !== 'draft') return { ok: false, reason: 'not_draft' } as const;
    await c.query('update segments set definition = $2 where id = $1', [segmentId, JSON.stringify({ ...s.definition, ...parsed.data })]);
    await audit(c, actor.userId, 'segment.edited', segmentId, { slug: s.slug, fields: Object.keys(parsed.data) });
    return { ok: true } as const;
  });
}
