import type pg from 'pg';

// Consulta del pipeline (REQ-CRM-02): lista y tablero comparten filtros; los totales por etapa usan los mismos salvo la etapa. Solo lectura.
// Todo valor del filtro va como parámetro (nada se concatena) y los identificadores mal formados no devuelven nada en vez de romper.

export interface DealFilters {
  /** 'me' (el que consulta), 'unassigned' o el id de un usuario */
  owner?: string | undefined;
  stage?: string | undefined;
  segmentId?: string | undefined;
  province?: string | undefined;
  campaignId?: string | undefined;
  nextTaskFrom?: Date | undefined;
  nextTaskTo?: Date | undefined;
  noTask?: boolean | undefined;
  /** por defecto, solo abiertas */
  status?: 'open' | 'closed' | 'all' | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}
export interface DealRow {
  id: string;
  prospectId: string;
  prospectName: string;
  municipality: string | null;
  province: string | null;
  segmentName: string | null;
  campaignName: string | null;
  stageId: string;
  stageName: string;
  probability: number;
  ownerUserId: string | null;
  ownerName: string | null;
  estValueEur: number | null;
  score: number | null;
  tier: string | null;
  openedAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  lostReasonId: string | null;
  nextTaskDueAt: Date | null;
  nextTaskTitle: string | null;
}
export interface StageTotal {
  stageId: string;
  stageName: string;
  count: number;
  valueEur: number;
  weightedEur: number;
}

const VIEW_ROLES = ['admin', 'sales', 'marketing', 'auditor'];
const MAX_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FROM = `
  from deals d
  join prospects p on p.id = d.prospect_id
  join deal_stages st on st.id = d.stage_id
  left join territories te on te.ine_code = p.ine_code
  left join segments sg on sg.id = p.segment_id
  left join campaigns ca on ca.id = d.campaign_id
  left join "user" u on u.id = d.owner_user_id
  left join lateral (
    select k.due_at, k.title from tasks k
     where k.status = 'open' and (k.deal_id = d.id or (k.deal_id is null and k.prospect_id = d.prospect_id))
     order by k.due_at limit 1) nt on true`;

async function canView(pool: pg.Pool, userId: string): Promise<boolean> {
  const r = (await pool.query('select role from app_user_roles where user_id = $1 limit 1', [userId])).rows[0] as { role: string } | undefined;
  return !!r && VIEW_ROLES.includes(r.role);
}

/** Cláusulas y parámetros. Devuelve `null` si algún identificador está mal formado (el resultado sería vacío). */
function where(f: DealFilters, viewerId: string, withStage: boolean): { sql: string; params: unknown[] } | null {
  const w: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown): void => { params.push(v); w.push(cond.replace('?', `$${params.length}`)); };
  const status = f.status ?? 'open';
  if (status === 'open') w.push('d.closed_at is null');
  else if (status === 'closed') w.push('d.closed_at is not null');
  if (f.owner === 'me') add('d.owner_user_id = ?', viewerId);
  else if (f.owner === 'unassigned') w.push('d.owner_user_id is null');
  else if (f.owner) add('d.owner_user_id = ?', f.owner);
  if (withStage && f.stage) add('d.stage_id = ?', f.stage);
  for (const [id, col] of [[f.segmentId, 'p.segment_id'], [f.campaignId, 'd.campaign_id']] as const) {
    if (id === undefined) continue;
    if (!UUID.test(id)) return null;
    add(`${col} = ?`, id);
  }
  if (f.province) add('te.province = ?', f.province);
  if (f.noTask) w.push('nt.due_at is null');
  if (f.nextTaskFrom) add('nt.due_at >= ?', f.nextTaskFrom);
  if (f.nextTaskTo) add('nt.due_at <= ?', f.nextTaskTo);
  if (f.search?.trim()) add(`p.name ilike ? escape '\\'`, `%${f.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return { sql: w.length ? `where ${w.join(' and ')}` : '', params };
}

/** Límite pedido, acotado a 1..500 (por defecto 300). */
export function clampLimit(v: number | undefined): number {
  return Math.min(Math.max(Math.trunc(v ?? 300) || 300, 1), MAX_LIMIT);
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Raw): DealRow {
  return {
    id: r.id as string, prospectId: r.prospect_id as string, prospectName: r.prospect_name as string, municipality: r.municipality as string | null, province: r.province as string | null,
    segmentName: r.segment_name as string | null, campaignName: r.campaign_name as string | null, stageId: r.stage_id as string, stageName: r.stage_name as string,
    probability: Number(r.probability), ownerUserId: r.owner_user_id as string | null, ownerName: r.owner_name as string | null, estValueEur: num(r.est_value_eur), score: num(r.score),
    tier: r.tier as string | null, openedAt: r.opened_at as Date, updatedAt: r.updated_at as Date, closedAt: r.closed_at as Date | null, lostReasonId: r.lost_reason_id as string | null,
    nextTaskDueAt: r.next_due as Date | null, nextTaskTitle: r.next_title as string | null,
  };
}

/** Oportunidades según los filtros, por etapa y más recientes primero. `null` si el usuario no puede ver el pipeline (voz, sin rol). */
export async function listDeals(pool: pg.Pool, viewer: { userId: string }, f: DealFilters): Promise<DealRow[] | null> {
  if (!(await canView(pool, viewer.userId))) return null;
  const w = where(f, viewer.userId, true);
  if (!w) return [];
  const limit = clampLimit(f.limit);
  const rows = (await pool.query(
    `select d.id, d.prospect_id, p.name as prospect_name, te.name as municipality, te.province, sg.name as segment_name, ca.name as campaign_name,
            d.stage_id, st.name as stage_name, st.probability, d.owner_user_id, u.name as owner_name, d.est_value_eur, p.score, p.tier,
            d.opened_at, d.updated_at, d.closed_at, d.lost_reason_id, nt.due_at as next_due, nt.title as next_title
       ${FROM} ${w.sql} order by st.sort, d.updated_at desc, d.id limit ${limit}`, w.params)).rows as Raw[];
  return rows.map(toRow);
}

/** Totales por etapa (todas las etapas, en orden) con los mismos filtros que la lista salvo la etapa. Ponderado = importe × probabilidad de la etapa. */
export async function dealTotals(pool: pg.Pool, viewer: { userId: string }, f: DealFilters): Promise<StageTotal[] | null> {
  if (!(await canView(pool, viewer.userId))) return null;
  const w = where(f, viewer.userId, false);
  const base = w ? await pool.query(
    `select d.stage_id, count(*)::int as n, coalesce(sum(d.est_value_eur), 0) as value ${FROM} ${w.sql} group by d.stage_id`, w.params) : { rows: [] };
  const by = new Map((base.rows as Raw[]).map((r) => [r.stage_id as string, r]));
  const stages = (await pool.query('select id, name, probability from deal_stages order by sort')).rows as Array<{ id: string; name: string; probability: number }>;
  return stages.map((s) => {
    const r = by.get(s.id);
    const value = Number(r?.value ?? 0);
    return { stageId: s.id, stageName: s.name, count: Number(r?.n ?? 0), valueEur: value, weightedEur: Math.round(value * s.probability) / 100 };
  });
}
