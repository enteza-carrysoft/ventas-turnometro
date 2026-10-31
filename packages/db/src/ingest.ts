import {
  decideIngest, detectLegalForm, matchMunicipality, normalizeAddress, normalizeName, normalizePhone, postalCodeOf, registrableDomain,
  type CustomerRow, type ExistingProspect, type IngestDecision, type LegalFormResult, type PhoneResult, type SuppressionLite, type Territory,
} from '@turnosala/core';
import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from './uuid.js';

// Ingesta de candidatos (REQ-VER-01/02/03, P2.2): normaliza, busca coincidencias, decide (función pura de core) y escribe en UNA
// transacción serializada con un cerrojo, para que ni la concurrencia pueda crear fichas duplicadas.

const evidenceSchema = z.object({
  field: z.string().trim().min(1),
  value: z.string().nullish(),
  provenance: z.enum(['observed', 'inferred']),
  explanation: z.string().optional(),
  sourceUrl: z.string().trim().min(1),
  quote: z.string().max(300).optional(),
  fetchedAt: z.date(),
});

const candidateSchema = z.object({
  name: z.string().trim().min(1),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  municipality: z.string().optional(),
  province: z.string().optional(),
  sourceId: z.string().trim().min(1),
  externalId: z.string().default(''),
  /** página de la que sale el dato; toda evidencia derivada la cita (P2.2) */
  sourceUrl: z.string().trim().min(1),
  fetchedAt: z.date(),
  extractorVersion: z.string().trim().min(1),
  evidences: z.array(evidenceSchema).default([]),
});
export type IngestCandidate = z.input<typeof candidateSchema>;

export interface IngestResult {
  prospectId: string;
  action: 'created' | 'merged' | 'blocked';
  matchedBy?: string | undefined;
  blockReason?: 'customer' | 'opposition' | undefined;
}

type Row = Record<string, unknown>;
type Client = pg.PoolClient;
type Parsed = z.output<typeof candidateSchema>;

interface Prepared {
  c: Parsed;
  nameNorm: string;
  domain: string | null;
  phone: PhoneResult | null;
  email: string | null;
  address: { raw: string; normalized: string; postalCode: string | null } | null;
  ineCode: string | null;
  legal: LegalFormResult;
}

const INGEST_LOCK = 7003;

function prepare(c: Parsed, territories: Territory[]): Prepared {
  return {
    c, nameNorm: normalizeName(c.name), domain: c.website ? registrableDomain(c.website) : null,
    phone: c.phone?.trim() ? normalizePhone(c.phone) : null, email: c.email?.trim().toLowerCase() || null,
    address: c.address?.trim() ? { raw: c.address.trim(), normalized: normalizeAddress(c.address), postalCode: postalCodeOf(c.address) } : null,
    ineCode: c.municipality ? matchMunicipality(c.municipality, territories, c.province) : null, legal: detectLegalForm(c.name),
  };
}

/** Teléfonos con los que se puede identificar a la empresa: solo fijos y móviles válidos (un 902 lo comparten cadenas enteras). */
const matchPhones = (p: Prepared): string[] => (p.phone?.e164 && !p.phone.notCallable ? [p.phone.e164] : []);

async function loadExisting(client: Client, p: Prepared): Promise<ExistingProspect[]> {
  const r = await client.query(
    `select p.id, p.name_norm, p.domain, p.ine_code, p.status,
            coalesce(array(select cp.value_norm from contact_points cp where cp.prospect_id = p.id and cp.valid is true
                             and cp.type in ('switchboard_phone','mobile_phone')), '{}') as phones
       from prospects p
      where ($1::text is not null and p.domain = $1)
         or p.id in (select prospect_id from contact_points where valid is true and type in ('switchboard_phone','mobile_phone') and value_norm = any($2::text[]))
         or ($3::text is not null and p.ine_code = $3 and p.name_norm % $4)`,
    [p.domain, matchPhones(p), p.ineCode, p.nameNorm],
  );
  return (r.rows as Row[]).map((x) => ({ id: x.id as string, nameNorm: x.name_norm as string, domain: (x.domain as string | null) ?? null, phones: x.phones as string[], ineCode: (x.ine_code as string | null) ?? null, status: x.status as string }));
}

async function loadCustomers(client: Client, p: Prepared): Promise<CustomerRow[]> {
  const r = await client.query(
    `select org_id, name_norm, domain, phone_e164 from turnosala_customers
      where ($1::text is not null and domain = $1) or phone_e164 = any($2::text[]) or name_norm % $3`,
    [p.domain, matchPhones(p), p.nameNorm],
  );
  return (r.rows as Row[]).map((x) => ({ orgId: x.org_id as string, nameNorm: x.name_norm as string, domain: (x.domain as string | null) ?? null, phone: (x.phone_e164 as string | null) ?? null }));
}

async function loadSuppressions(client: Client, p: Prepared, existingIds: string[]): Promise<SuppressionLite[]> {
  const r = await client.query(
    `select kind, value from suppressions where (kind = 'phone' and value = any($1::text[])) or (kind = 'domain' and value = $2)
        or (kind = 'email' and lower(value) = $3) or (kind = 'prospect' and value = any($4::text[]))`,
    [matchPhones(p), p.domain, p.email, existingIds],
  );
  return r.rows as SuppressionLite[];
}

async function createProspect(client: Client, p: Prepared, status: 'candidate' | 'blocked', blockReason: string | null): Promise<string> {
  const id = uuidv7();
  const address = p.address ? JSON.stringify({ raw: p.address.raw, normalized: p.address.normalized, postal_code: p.address.postalCode, municipality: p.c.municipality ?? null }) : null;
  await client.query(
    `insert into prospects (id, name, name_norm, legal_form, website, domain, ine_code, address, status, block_reason, last_evidence_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, p.c.name, p.nameNorm, p.legal.legalForm, p.c.website ?? null, p.domain, p.ineCode, address, status, blockReason, p.c.fetchedAt],
  );
  return id;
}

async function writeEvidence(client: Client, prospectId: string, p: Prepared, ev: z.output<typeof evidenceSchema>): Promise<string> {
  const args = [uuidv7(), prospectId, ev.field, ev.value ?? null, ev.provenance, ev.explanation ?? null, ev.sourceUrl, ev.quote ?? null, ev.fetchedAt, p.c.extractorVersion];
  const ins = await client.query(
    `insert into evidences (id, prospect_id, field, value, provenance, explanation, source_url, quote, fetched_at, extractor_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing returning id`, args);
  if (ins.rows[0]) return (ins.rows[0] as { id: string }).id;
  const ex = await client.query(`select id from evidences where prospect_id = $1 and field = $2 and coalesce(value, '') = coalesce($3, '') and source_url = $4`, [prospectId, ev.field, ev.value ?? null, ev.sourceUrl]);
  return (ex.rows[0] as { id: string }).id;
}

async function writeContact(client: Client, prospectId: string, type: string, value: string, valueNorm: string, evidenceId: string, valid: boolean | null, invalidReason: string | null, at: Date): Promise<void> {
  await client.query(
    `insert into contact_points (id, prospect_id, type, value, value_norm, evidence_id, valid, invalid_reason, checked_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (type, value_norm, prospect_id) do nothing`, [uuidv7(), prospectId, type, value, valueNorm, evidenceId, valid, invalidReason, at]);
}

/** Evidencias y contactos de la ficha: todo con fuente. Es idempotente: repetir la ingesta no duplica nada. */
async function writeChildren(client: Client, prospectId: string, p: Prepared): Promise<void> {
  const base = { sourceUrl: p.c.sourceUrl, fetchedAt: p.c.fetchedAt };
  const legalId = await writeEvidence(client, prospectId, p, { ...base, field: 'legal_form', value: p.legal.legalForm, provenance: 'inferred', explanation: p.legal.explanation });
  void legalId;
  if (p.phone && p.c.phone) {
    const ev = await writeEvidence(client, prospectId, p, { ...base, field: 'phone', value: p.phone.e164 ?? p.c.phone.trim(), provenance: 'observed' });
    const type = p.phone.kind === 'mobile' ? 'mobile_phone' : 'switchboard_phone';
    await writeContact(client, prospectId, type, p.c.phone.trim(), p.phone.e164 ?? p.c.phone.trim(), ev, !p.phone.notCallable, p.phone.notCallable ? 'not_callable' : null, p.c.fetchedAt);
  }
  if (p.address) {
    const ev = await writeEvidence(client, prospectId, p, { ...base, field: 'address', value: p.address.raw, provenance: 'observed' });
    await writeContact(client, prospectId, 'postal_address', p.address.raw, p.address.normalized, ev, null, null, p.c.fetchedAt);
  }
  if (p.email) {
    const ev = await writeEvidence(client, prospectId, p, { ...base, field: 'generic_email', value: p.email, provenance: 'observed' });
    await writeContact(client, prospectId, 'generic_email', p.email, p.email, ev, null, null, p.c.fetchedAt);
  }
  for (const e of p.c.evidences) await writeEvidence(client, prospectId, p, e);
  await client.query(`insert into prospect_sources (prospect_id, source_id, external_id) values ($1,$2,$3) on conflict do nothing`, [prospectId, p.c.sourceId, p.c.externalId]);
}

async function touchExisting(client: Client, prospectId: string, p: Prepared): Promise<void> {
  const address = p.address ? JSON.stringify({ raw: p.address.raw, normalized: p.address.normalized, postal_code: p.address.postalCode, municipality: p.c.municipality ?? null }) : null;
  await client.query(
    `update prospects set last_evidence_at = greatest(coalesce(last_evidence_at, $2), $2), updated_at = now(),
        website = coalesce(website, $3), domain = coalesce(domain, $4), ine_code = coalesce(ine_code, $5), address = coalesce(address, $6::jsonb),
        legal_form = case when legal_form = 'unknown' then $7 else legal_form end
      where id = $1`,
    [prospectId, p.c.fetchedAt, p.c.website ?? null, p.domain, p.ineCode, address, p.legal.legalForm],
  );
}

async function block(client: Client, prospectId: string, reason: 'customer' | 'opposition', matchedBy: string, actor: string): Promise<void> {
  await client.query(`update prospects set status = 'blocked', block_reason = $2, updated_at = now() where id = $1`, [prospectId, reason]);
  await client.query(
    `insert into audit_log (actor, action, entity, entity_id, payload) values ($1, 'prospect.blocked', 'prospect', $2, $3)`,
    [actor, prospectId, JSON.stringify({ reason, matchedBy })],
  );
}

async function apply(client: Client, p: Prepared, decision: IngestDecision): Promise<IngestResult> {
  if (decision.action === 'create') {
    const id = await createProspect(client, p, 'candidate', null);
    await writeChildren(client, id, p);
    return { prospectId: id, action: 'created' };
  }
  if (decision.action === 'merge') {
    await touchExisting(client, decision.prospectId, p);
    await writeChildren(client, decision.prospectId, p);
    return { prospectId: decision.prospectId, action: 'merged', matchedBy: decision.matchedBy };
  }
  const id = decision.mergeIntoId ?? (await createProspect(client, p, 'blocked', decision.reason));
  if (decision.mergeIntoId) await touchExisting(client, id, p);
  await writeChildren(client, id, p);
  await block(client, id, decision.reason, decision.matchedBy, `ingest:${p.c.sourceId}`);
  return { prospectId: id, action: 'blocked', matchedBy: decision.matchedBy, blockReason: decision.reason };
}

export async function ingestCandidate(pool: pg.Pool, raw: IngestCandidate): Promise<IngestResult> {
  const parsed = candidateSchema.parse(raw);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [INGEST_LOCK]);
    const terr = (await client.query('select ine_code, name, province from territories')).rows as Row[];
    const p = prepare(parsed, terr.map((t) => ({ ineCode: t.ine_code as string, name: t.name as string, province: t.province as string })));
    const existing = await loadExisting(client, p);
    const decision = decideIngest(
      { nameNorm: p.nameNorm, domain: p.domain, phones: matchPhones(p), emails: p.email ? [p.email] : [], ineCode: p.ineCode },
      existing, await loadCustomers(client, p), await loadSuppressions(client, p, existing.map((e) => e.id)),
    );
    const result = await apply(client, p, decision);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
