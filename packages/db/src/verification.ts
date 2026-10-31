import type { MxCheck, WebCheck } from '@turnosala/core';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

export interface VerificationResults {
  web?: { url: string; check: WebCheck } | undefined;
  emails?: Array<{ email: string; check: MxCheck }> | undefined;
}

const webValue = (c: WebCheck): string => (c.ok ? 'ok' : c.reason === 'http_error' ? `http_${c.status}` : c.reason);

/**
 * Guarda el resultado de la verificación (REQ-VER-01 CA2): la web como evidencia observada (con su motivo si falla) y el MX sobre el
 * contacto de email. Un fallo temporal de DNS no invalida el email: queda sin decidir con el motivo anotado.
 */
export async function annotateVerification(pool: pg.Pool, prospectId: string, r: VerificationResults, at: Date): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const exists = await client.query('select 1 from prospects where id = $1 for update', [prospectId]);
    if (!exists.rowCount) throw new Error('ficha no encontrada');
    if (r.web) {
      await client.query(
        `insert into evidences (id, prospect_id, field, value, provenance, source_url, fetched_at, extractor_version)
         values ($1,$2,'web_check',$3,'observed',$4,$5,'verify-1') on conflict do nothing`, [uuidv7(), prospectId, webValue(r.web.check), r.web.url, at]);
    }
    for (const { email, check } of r.emails ?? []) {
      const valid = check.ok ? true : check.reason === 'dns_error' ? null : false;
      await client.query(
        `update contact_points set valid = $3, invalid_reason = $4, checked_at = $5 where prospect_id = $1 and type = 'generic_email' and value_norm = $2`,
        [prospectId, email.trim().toLowerCase(), valid, check.ok ? null : check.reason, at],
      );
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
