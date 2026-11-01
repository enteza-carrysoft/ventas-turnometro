import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { uuidv7 } from './uuid.js';

// Tokens de enlaces públicos: 128 bits aleatorios (22 caracteres url-safe). En BD solo el SHA-256: una fuga de la BD no da enlaces utilizables, y se pueden revocar.

export type TokenKind = 'landing' | 'unsubscribe';
const SHAPE = /^[A-Za-z0-9_-]{22}$/;
const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface NewToken {
  kind: TokenKind;
  prospectId: string;
  campaignId?: string | null | undefined;
  contact?: { email?: string | undefined; phone?: string | undefined } | undefined;
  expiresAt?: Date | undefined;
}

export async function createPublicToken(pool: pg.Pool, t: NewToken): Promise<{ id: string; token: string }> {
  const token = randomBytes(16).toString('base64url');
  const id = uuidv7();
  await pool.query(
    `insert into public_tokens (id, kind, token_hash, prospect_id, campaign_id, contact_email, contact_phone, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, t.kind, hash(token), t.prospectId, t.campaignId ?? null, t.contact?.email?.trim().toLowerCase() || null, t.contact?.phone?.trim() || null, t.expiresAt ?? null],
  );
  return { id, token };
}

export interface ResolvedToken {
  prospectId: string;
  campaignId: string | null;
  contact: { email: string | null; phone: string | null };
}

/** Un token mal formado ni siquiera llega a la BD. Caducado, revocado o de otro tipo ⇒ `null`, sin distinguir el motivo. */
export async function resolvePublicToken(pool: pg.Pool, kind: TokenKind, token: string, now: Date = new Date()): Promise<ResolvedToken | null> {
  if (!SHAPE.test(token)) return null;
  const r = (await pool.query(
    `select prospect_id, campaign_id, contact_email, contact_phone from public_tokens
      where kind = $1 and token_hash = $2 and revoked_at is null and (expires_at is null or expires_at > $3)`, [kind, hash(token), now])).rows[0] as
    { prospect_id: string; campaign_id: string | null; contact_email: string | null; contact_phone: string | null } | undefined;
  return r ? { prospectId: r.prospect_id, campaignId: r.campaign_id, contact: { email: r.contact_email, phone: r.contact_phone } } : null;
}

export async function revokePublicToken(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('update public_tokens set revoked_at = now() where id = $1 and revoked_at is null', [id]);
}
