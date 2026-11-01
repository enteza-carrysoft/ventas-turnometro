import type pg from 'pg';

/**
 * Límite de envíos por IP (ventana deslizante). Una sección crítica por (IP, tipo) con un bloqueo de Postgres serializa los envíos simultáneos:
 * se cuenta y solo se registra el intento si cabe. Así, con ráfagas, pasan exactamente `limit` y el resto se rechaza. La IP llega ya convertida
 * en HMAC (no se guarda en claro).
 */
export async function checkFormRate(
  pool: pg.Pool,
  o: { ipHmac: string; kind: string; limit: number; windowMs: number; now?: Date | undefined },
): Promise<{ allowed: boolean; count: number }> {
  const now = o.now ?? new Date();
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`form:${o.kind}:${o.ipHmac}`]);
    const r = (await c.query(
      'select count(*)::int as n from public_form_hits where ip_hmac = $1 and kind = $2 and at > $3 and at <= $4',
      [o.ipHmac, o.kind, new Date(now.getTime() - o.windowMs), now])).rows[0] as { n: number };
    const allowed = r.n < o.limit;
    if (allowed) await c.query('insert into public_form_hits (ip_hmac, kind, at) values ($1,$2,$3)', [o.ipHmac, o.kind, now]);
    await c.query('commit');
    return { allowed, count: r.n + (allowed ? 1 : 0) };
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
