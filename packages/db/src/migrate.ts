import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Aplica las migraciones `NNNN_*.sql` pendientes, cada una en su transacción. Devuelve las aplicadas. */
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(7002)');
    await client.query(
      `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
    );
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name as string));
    const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      try {
        await client.query('begin');
        await client.query(readFileSync(`${dir}/${file}`, 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migración ${file} fallida: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(7002)').catch(() => undefined);
    client.release();
  }
  return applied;
}
