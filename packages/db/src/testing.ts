import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { bootstrapDatabase, ensureExtensions } from './bootstrap.js';
import { migrate } from './migrate.js';

/** Solo para pruebas locales/CI: contraseñas de desarrollo de los roles de la BD temporal. */
const MIGRATOR_PW = 'migrator_test_only';
const APP_PW = 'app_test_only';

export interface TestDb {
  name: string;
  /** superusuario (para comprobar que los triggers también lo paran) */
  admin: pg.Pool;
  /** propietario del esquema */
  migrator: pg.Pool;
  /** rol de la aplicación */
  app: pg.Pool;
  drop(): Promise<void>;
}

function urlFor(base: string, user: string, password: string, db: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

export function adminUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgres://postgres:dev_only_change_me@127.0.0.1:5433/postgres';
}

/** Crea una base de datos efímera con roles, extensiones y migraciones aplicadas. */
export async function createTestDb(): Promise<TestDb> {
  const base = adminUrl();
  const name = `t_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const boot = new pg.Client({ connectionString: base });
  await boot.connect();
  try {
    await bootstrapDatabase(boot, { dbName: name, migratorPassword: MIGRATOR_PW, appPassword: APP_PW });
  } finally {
    await boot.end();
  }
  const baseUser = new URL(base);
  const adminUrlOnDb = urlFor(base, decodeURIComponent(baseUser.username), decodeURIComponent(baseUser.password), name);
  const ext = new pg.Client({ connectionString: adminUrlOnDb });
  await ext.connect();
  try {
    await ensureExtensions(ext);
  } finally {
    await ext.end();
  }
  const adminOnDb = new pg.Pool({ connectionString: adminUrlOnDb });
  const migrator = new pg.Pool({ connectionString: urlFor(base, 'migrator', MIGRATOR_PW, name) });
  await migrate(migrator);
  const app = new pg.Pool({ connectionString: urlFor(base, 'app', APP_PW, name) });
  return {
    name,
    admin: adminOnDb,
    migrator,
    app,
    async drop() {
      await Promise.all([app.end(), migrator.end(), adminOnDb.end()]);
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      try {
        await c.query(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}
