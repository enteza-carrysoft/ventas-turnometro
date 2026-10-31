import type pg from 'pg';
import { z } from 'zod';
import { uuidv7 } from './uuid.js';

/** REQ-CNS-02 / T-13: sin texto, versión, origen y destino no se guarda (además de los CHECK de la BD). */
export const consentInputSchema = z
  .object({
    prospectId: z.uuid().nullish(),
    channel: z.enum(['email', 'human_call', 'ai_call', 'sms', 'whatsapp']),
    purpose: z.string().trim().min(1),
    action: z.enum(['grant', 'withdraw']),
    phone: z.string().trim().min(1).nullish(),
    email: z.string().trim().min(1).nullish(),
    textVersion: z.string().trim().min(1),
    textSnapshot: z.string().trim().min(1),
    sourceUrl: z.url(),
    ip: z.string().nullish(),
    userAgent: z.string().nullish(),
    campaignId: z.uuid().nullish(),
  })
  .refine((c) => c.phone || c.email, { message: 'hace falta teléfono o email', path: ['phone'] });

export type ConsentInput = z.input<typeof consentInputSchema>;

export async function insertConsent(db: Pick<pg.Pool, 'query'>, input: ConsentInput): Promise<string> {
  const c = consentInputSchema.parse(input);
  const id = uuidv7();
  await db.query(
    `insert into consents (id, prospect_id, channel, purpose, action, phone, email, text_version, text_snapshot,
                           source_url, ip, user_agent, campaign_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, c.prospectId ?? null, c.channel, c.purpose, c.action, c.phone ?? null, c.email ?? null, c.textVersion,
      c.textSnapshot, c.sourceUrl, c.ip ?? null, c.userAgent ?? null, c.campaignId ?? null],
  );
  return id;
}
