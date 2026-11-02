import { toCsv } from '@turnosala/core';
import type pg from 'pg';

// Lectura de la cola, de la ficha y exportación (REQ-REV-01, REQ-REV-03). Solo consultas: ninguna acción de contacto nace aquí.

export const REVIEWABLE = ['enriched', 'pending_review'] as const;

export interface QueueItem {
  id: string;
  name: string;
  score: number | null;
  tier: string | null;
  status: string;
  legalForm: string;
  municipality: string | null;
  inferredCount: number;
}

export async function listQueue(pool: pg.Pool, o: { limit?: number } = {}): Promise<QueueItem[]> {
  const r = await pool.query(
    `select p.id, p.name, p.score, p.tier, p.status, p.legal_form, t.name as municipality,
            (select count(*) from evidences e where e.prospect_id = p.id and e.provenance = 'inferred')::int as inferred_count
       from prospects p left join territories t on t.ine_code = p.ine_code
      where p.status = any($2::text[]) order by p.score desc nulls last, p.created_at, p.id limit $1`, [o.limit ?? 50, [...REVIEWABLE]]);
  return (r.rows as Array<Record<string, unknown>>).map((x) => ({
    id: x.id as string, name: x.name as string, score: x.score as number | null, tier: x.tier as string | null, status: x.status as string,
    legalForm: x.legal_form as string, municipality: x.municipality as string | null, inferredCount: x.inferred_count as number,
  }));
}

export interface ApprovedItem {
  id: string; name: string; score: number | null; tier: string | null; legalForm: string; website: string | null; municipality: string | null;
  segment: string | null; reviewedBy: string | null; reviewedAt: Date | null; contacts: Array<{ type: string; value: string }>;
}

/** Fichas aprobadas para consultarlas en el panel (solo lectura; usar sus canales sigue pasando por la puerta, P1). */
export async function listApproved(pool: pg.Pool, o: { limit?: number } = {}): Promise<ApprovedItem[]> {
  const r = await pool.query(
    `select p.id, p.name, p.score, p.tier, p.legal_form, p.website, t.name as municipality, s.name as segment, p.reviewed_at,
            coalesce(u.name, p.reviewed_by) as reviewed_by,
            coalesce((select json_agg(json_build_object('type', c.type, 'value', c.value) order by c.type, c.value) from contact_points c where c.prospect_id = p.id), '[]') as contacts
       from prospects p left join territories t on t.ine_code = p.ine_code left join segments s on s.id = p.segment_id left join "user" u on u.id = p.reviewed_by
      where p.status = 'approved' order by p.score desc nulls last, p.reviewed_at desc, p.id limit $1`, [o.limit ?? 200]);
  return (r.rows as Array<Record<string, unknown>>).map((x) => ({
    id: x.id as string, name: x.name as string, score: x.score as number | null, tier: x.tier as string | null, legalForm: x.legal_form as string,
    website: x.website as string | null, municipality: x.municipality as string | null, segment: x.segment as string | null,
    reviewedBy: x.reviewed_by as string | null, reviewedAt: x.reviewed_at as Date | null, contacts: x.contacts as Array<{ type: string; value: string }>,
  }));
}

export interface Card {
  prospect: {
    id: string; name: string; status: string; legalForm: string; website: string | null; domain: string | null; ineCode: string | null; municipality: string | null;
    province: string | null; address: unknown; sitesCount: number | null; score: number | null; tier: string | null; scoreBreakdown: unknown; scoreReasoning: string | null;
    scoringVersion: number | null; blockReason: string | null;
  };
  evidences: Array<{ id: string; field: string; value: string | null; provenance: 'observed' | 'inferred'; explanation: string | null; sourceUrl: string; quote: string | null; fetchedAt: Date }>;
  contactPoints: Array<{ type: string; value: string; valid: boolean | null; invalidReason: string | null; evidenceId: string | null }>;
  history: Array<{ action: string; actor: string; payload: unknown; at: Date }>;
}

export async function getCard(pool: pg.Pool, id: string): Promise<Card | undefined> {
  const p = (await pool.query(
    `select p.*, t.name as municipality, t.province as province from prospects p left join territories t on t.ine_code = p.ine_code where p.id = $1`, [id])).rows[0] as Record<string, unknown> | undefined;
  if (!p) return undefined;
  const ev = (await pool.query('select id, field, value, provenance, explanation, source_url, quote, fetched_at from evidences where prospect_id = $1 order by field, fetched_at, id', [id])).rows as Array<Record<string, unknown>>;
  const cp = (await pool.query('select type, value, valid, invalid_reason, evidence_id from contact_points where prospect_id = $1 order by type, value', [id])).rows as Array<Record<string, unknown>>;
  const hs = (await pool.query(`select action, actor, payload, created_at from audit_log where entity = 'prospect' and entity_id = $1 order by id`, [id])).rows as Array<Record<string, unknown>>;
  return {
    prospect: {
      id, name: p.name as string, status: p.status as string, legalForm: p.legal_form as string, website: p.website as string | null, domain: p.domain as string | null,
      ineCode: p.ine_code as string | null, municipality: p.municipality as string | null, province: p.province as string | null, address: p.address, sitesCount: p.sites_count as number | null,
      score: p.score as number | null, tier: p.tier as string | null, scoreBreakdown: p.score_breakdown, scoreReasoning: p.score_reasoning as string | null,
      scoringVersion: p.scoring_version as number | null, blockReason: p.block_reason as string | null,
    },
    evidences: ev.map((e) => ({ id: e.id as string, field: e.field as string, value: e.value as string | null, provenance: e.provenance as 'observed' | 'inferred', explanation: e.explanation as string | null, sourceUrl: e.source_url as string, quote: e.quote as string | null, fetchedAt: e.fetched_at as Date })),
    contactPoints: cp.map((c) => ({ type: c.type as string, value: c.value as string, valid: c.valid as boolean | null, invalidReason: c.invalid_reason as string | null, evidenceId: c.evidence_id as string | null })),
    history: hs.map((h) => ({ action: h.action as string, actor: h.actor as string, payload: h.payload, at: h.created_at as Date })),
  };
}

const EXPORT_HEADERS = ['id', 'nombre', 'forma_juridica', 'web', 'dominio', 'municipio_ine', 'municipio', 'provincia', 'sedes', 'puntuacion', 'nivel', 'revisada'] as const;

/**
 * CSV interno de fichas APROBADAS, sin datos personales: ni teléfonos ni emails. El autónomo o la forma jurídica desconocida (que se trata
 * como autónomo) sale sin nombre, web ni dominio, porque podrían identificar a una persona (P2.3).
 */
export async function exportApprovedCsv(pool: pg.Pool): Promise<string> {
  const r = await pool.query(
    `select p.id, p.name, p.legal_form, p.website, p.domain, p.ine_code, t.name as municipality, t.province, p.sites_count, p.score, p.tier, p.reviewed_at
       from prospects p left join territories t on t.ine_code = p.ine_code where p.status = 'approved' order by p.score desc nulls last, p.id`);
  const rows = (r.rows as Array<Record<string, unknown>>).map((p) => {
    const company = p.legal_form === 'company' || p.legal_form === 'public_body';
    return [p.id, company ? p.name : '', p.legal_form, company ? p.website : '', company ? p.domain : '', p.ine_code, p.municipality, p.province, p.sites_count, p.score, p.tier, p.reviewed_at ? (p.reviewed_at as Date).toISOString().slice(0, 10) : ''] as Array<string | number | null>;
  });
  return toCsv(EXPORT_HEADERS, rows);
}
