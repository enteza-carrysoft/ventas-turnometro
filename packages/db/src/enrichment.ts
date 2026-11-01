import { DEFAULT_SCORING_MODEL, normalizeAddress, scoreProspect, type ScoringModel, type VerifiedExtraction } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

type Client = pg.PoolClient;

export interface SaveEnrichmentOptions {
  fetchedAt: Date;
  extractorVersion: string;
  scoringModel?: ScoringModel | undefined;
}
export type SaveEnrichmentResult =
  | { saved: true; evidences: number; contactPoints: number; score: number; tier: string }
  | { saved: false; reason: 'not_found' | 'not_enrichable' };

interface Ev {
  field: string;
  value: string | null;
  provenance: 'observed' | 'inferred';
  explanation: string | null;
  sourceUrl: string;
  quote: string | null;
}

/** Todo dato verificado, como evidencia con fuente y cita (P2.2). Los contactos llevan además el tipo y el valor normalizado. */
function toEvidences(v: VerifiedExtraction): Ev[] {
  return [
    ...v.fields.map((f) => ({ field: f.key, value: f.value, provenance: f.provenance, explanation: f.explanation, sourceUrl: f.sourceUrl, quote: f.quote })),
    ...v.signals.map((s) => ({ field: `signal:${s.key}`, value: null, provenance: 'observed' as const, explanation: null, sourceUrl: s.sourceUrl, quote: s.quote })),
    ...v.contactPoints.map((c) => ({ field: `contact:${c.type}`, value: c.value, provenance: 'observed' as const, explanation: null, sourceUrl: c.sourceUrl, quote: c.quote })),
    ...(v.legalForm ? [{ field: 'legal_form', value: v.legalForm.value, provenance: 'observed' as const, explanation: null, sourceUrl: v.legalForm.sourceUrl, quote: v.legalForm.quote }] : []),
  ];
}

async function writeEvidence(client: Client, prospectId: string, e: Ev, o: SaveEnrichmentOptions): Promise<string> {
  const args = [uuidv7(), prospectId, e.field, e.value, e.provenance, e.explanation, e.sourceUrl, e.quote, o.fetchedAt, o.extractorVersion];
  const ins = await client.query(
    `insert into evidences (id, prospect_id, field, value, provenance, explanation, source_url, quote, fetched_at, extractor_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`, args);
  if (ins.rows[0]) return (ins.rows[0] as { id: string }).id;
  const ex = await client.query(`select id from evidences where prospect_id = $1 and field = $2 and coalesce(value, '') = coalesce($3, '') and source_url = $4`, [prospectId, e.field, e.value, e.sourceUrl]);
  return (ex.rows[0] as { id: string }).id;
}

const valueNorm = (type: string, value: string): string => (type === 'postal_address' ? normalizeAddress(value) : type === 'generic_email' ? value.toLowerCase() : value);

async function writeContacts(client: Client, prospectId: string, v: VerifiedExtraction, ids: Map<string, string>): Promise<number> {
  let n = 0;
  for (const c of v.contactPoints) {
    const evidenceId = ids.get(`contact:${c.type}\u0000${c.value}\u0000${c.sourceUrl}`) as string;
    const r = await client.query(
      `insert into contact_points (id, prospect_id, type, value, value_norm, evidence_id) values ($1,$2,$3,$4,$5,$6)
       on conflict (type, value_norm, prospect_id) do nothing`, [uuidv7(), prospectId, c.type, c.value, valueNorm(c.type, c.value), evidenceId]);
    n += r.rowCount ?? 0;
  }
  return n;
}

/** Puntúa con TODAS las señales con evidencia de la ficha, no solo las de esta pasada (REQ-SCO-01). */
export async function rescoreProspect(client: Client, prospectId: string, model: ScoringModel = DEFAULT_SCORING_MODEL): Promise<{ score: number; tier: string }> {
  const rows = (await client.query(`select substr(field, 8) as key, source_url from evidences where prospect_id = $1 and field like 'signal:%'`, [prospectId])).rows as Array<{ key: string; source_url: string }>;
  const r = scoreProspect(rows.map((x) => ({ key: x.key, sourceUrl: x.source_url })), model);
  await client.query(
    `update prospects set score = $2, tier = $3, score_breakdown = $4, score_reasoning = $5, scoring_version = $6, updated_at = now() where id = $1`,
    [prospectId, r.score, r.tier, JSON.stringify(r.breakdown), r.reasoning, r.modelVersion]);
  return { score: r.score, tier: r.tier };
}

async function updateProspect(client: Client, prospectId: string, v: VerifiedExtraction, at: Date): Promise<void> {
  const sites = v.fields.find((f) => f.key === 'sites_count');
  const legal = v.legalForm && v.legalForm.value !== 'unknown' ? v.legalForm.value : null;
  await client.query(
    `update prospects set sites_count = coalesce($2::int, sites_count), legal_form = coalesce($3, legal_form),
       status = case when status = 'candidate' then 'enriched' else status end, last_evidence_at = greatest(coalesce(last_evidence_at, $4), $4), updated_at = now()
     where id = $1`, [prospectId, sites ? Number(sites.value) : null, legal, at]);
}

/**
 * Guarda el resultado verificado de una pasada de enriquecimiento, todo o nada. Idempotente. Las fichas bloqueadas o archivadas
 * no se tocan: la puerta de cumplimiento manda sobre la investigación (P1).
 */
export async function saveEnrichment(pool: pg.Pool, prospectId: string, v: VerifiedExtraction, o: SaveEnrichmentOptions): Promise<SaveEnrichmentResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const cur = (await client.query('select status from prospects where id = $1 for update', [prospectId])).rows[0] as { status: string } | undefined;
    if (!cur) { await client.query('rollback'); return { saved: false, reason: 'not_found' }; }
    if (cur.status === 'blocked' || cur.status === 'archived' || cur.status === 'discarded') { await client.query('rollback'); return { saved: false, reason: 'not_enrichable' }; }
    const ids = new Map<string, string>();
    const evs = toEvidences(v);
    for (const e of evs) ids.set(`${e.field}\u0000${e.value ?? ''}\u0000${e.sourceUrl}`, await writeEvidence(client, prospectId, e, o));
    const contactPoints = await writeContacts(client, prospectId, v, ids);
    await updateProspect(client, prospectId, v, o.fetchedAt);
    const { score, tier } = await rescoreProspect(client, prospectId, o.scoringModel ?? DEFAULT_SCORING_MODEL);
    await client.query('commit');
    return { saved: true, evidences: evs.length, contactPoints, score, tier };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
