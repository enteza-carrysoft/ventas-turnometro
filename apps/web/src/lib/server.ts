import pg from 'pg';
import { createAuth, type Auth } from './auth.js';

interface Server {
  pool: pg.Pool;
  auth: Auth;
  siteOrigin: string;
}

const g = globalThis as unknown as { __prospector?: Server };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`); // nunca hay valores por defecto para secretos
  return v;
}

/** Pool (rol `app`) y Better Auth, una sola vez por proceso. */
export function getServer(): Server {
  if (!g.__prospector) {
    const pool = new pg.Pool({ connectionString: need('DATABASE_URL'), max: 10 });
    // Sin este manejador, perder una conexión inactiva (reinicio o failover de Postgres) tumba el proceso entero.
    pool.on('error', (err) => console.error(`[pg] conexión inactiva perdida: ${err.message}`));
    const baseURL = need('BETTER_AUTH_URL');
    g.__prospector = {
      pool,
      auth: createAuth(pool, { secret: need('BETTER_AUTH_SECRET'), baseURL }),
      siteOrigin: new URL(baseURL).origin,
    };
  }
  return g.__prospector;
}
