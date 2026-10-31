import type pg from 'pg';

export interface BootstrapOptions {
  dbName: string;
  migratorPassword: string;
  appPassword: string;
}

const EXTENSIONS = ['pg_trgm', 'unaccent', 'vector', 'btree_gist'] as const;

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`identificador no válido: ${name}`);
  return name;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Con un superusuario: crea los roles `migrator` (propietario) y `app` (sin UPDATE/DELETE/TRUNCATE en las tablas P4),
 * la base de datos si falta y las extensiones. Idempotente.
 */
export async function bootstrapDatabase(admin: pg.Client, opts: BootstrapOptions): Promise<void> {
  const db = ident(opts.dbName);
  await admin.query('select pg_advisory_lock(7001)');
  try {
    for (const [role, pw] of [['migrator', opts.migratorPassword], ['app', opts.appPassword]] as const) {
      const exists = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
      const verb = exists.rowCount ? 'alter' : 'create';
      await admin.query(`${verb} role ${role} login nosuperuser nocreatedb nocreaterole password ${literal(pw)}`);
    }
    const hasDb = await admin.query('select 1 from pg_database where datname = $1', [db]);
    if (!hasDb.rowCount) await admin.query(`create database ${db} owner migrator`);
    else await admin.query(`alter database ${db} owner to migrator`); // p. ej. la base que crea el contenedor de Postgres
    await admin.query(`revoke all on database ${db} from public`);
    await admin.query(`grant connect on database ${db} to app, migrator`);
  } finally {
    await admin.query('select pg_advisory_unlock(7001)');
  }
}

/** Debe ejecutarse conectado a la base de datos destino (CREATE EXTENSION es por base). */
export async function ensureExtensions(adminOnDb: pg.Client): Promise<void> {
  for (const ext of EXTENSIONS) await adminOnDb.query(`create extension if not exists ${ext}`);
  await adminOnDb.query('grant usage on schema public to app');
}
