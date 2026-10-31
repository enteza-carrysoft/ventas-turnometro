import { CHANNELS, type Channel } from '@turnosala/core';
import type pg from 'pg';
import { z } from 'zod';
import type { Role } from './users.js';

export class ForbiddenError extends Error {}

export const killSwitchInput = z.object({
  enabled: z.boolean(),
  channel: z.enum(CHANNELS as unknown as [Channel, ...Channel[]]).optional(),
});
export type KillSwitchInput = z.infer<typeof killSwitchInput>;

/**
 * Activa o desactiva el kill switch global o de un canal. Solo `admin` (P5.2/P5.5). Cambio y auditoría en la misma
 * transacción: si no queda en audit_log, tampoco cambia el ajuste.
 */
export async function setKillSwitch(
  pool: pg.Pool,
  actor: { userId: string; role: Role | null },
  input: KillSwitchInput,
): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('solo un admin puede cambiar el kill switch');
  const key = input.channel ? `kill_switch_${input.channel}` : 'kill_switch';
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query('update settings set value = $2, updated_by = $3, updated_at = now() where key = $1', [
      key, JSON.stringify(input.enabled), actor.userId,
    ]);
    if (r.rowCount !== 1) throw new Error(`ajuste «${key}» inexistente`);
    await client.query(
      `insert into audit_log (actor, action, entity, entity_id, payload) values ($1, 'kill_switch.set', 'settings', $2, $3)`,
      [actor.userId, key, JSON.stringify({ enabled: input.enabled, channel: input.channel ?? null, role: actor.role })],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
