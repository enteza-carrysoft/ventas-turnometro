import type pg from 'pg';
import { applyOpposition } from './opposition.js';
import { resolvePublicToken } from './tokens.js';

// Baja desde el enlace de una comunicación (REQ-CNS-03). El token (22 caracteres, solo su hash en BD) identifica la ficha y, si lo tiene, el contacto al que se escribió.
// Un token inválido, caducado, revocado o de otro tipo da el mismo resultado: no se filtra nada. Repetir la baja es idempotente.

export type UnsubscribeScope = 'contact' | 'company';
export type UnsubscribeResult = { status: 'done'; scope: UnsubscribeScope } | { status: 'invalid' };

const ACTOR = 'system:unsubscribe';

export async function unsubscribeByToken(pool: pg.Pool, token: string, scope: UnsubscribeScope, now: Date = new Date()): Promise<UnsubscribeResult> {
  if (scope !== 'contact' && scope !== 'company') return { status: 'invalid' };
  const t = await resolvePublicToken(pool, 'unsubscribe', token, now);
  if (!t) return { status: 'invalid' };
  const { email, phone } = t.contact;
  if (scope === 'contact') {
    if (!email && !phone) return { status: 'invalid' }; // sin contacto en el enlace, solo cabe la baja de la empresa
    await applyOpposition(pool, { actor: ACTOR, origin: 'unsubscribe', reason: 'Baja del contacto desde el enlace de la comunicación', email, phone });
  } else {
    await applyOpposition(pool, { actor: ACTOR, origin: 'unsubscribe', reason: 'Baja de la empresa desde el enlace de la comunicación', prospectId: t.prospectId, email, phone });
  }
  return { status: 'done', scope };
}
