// Prepara una base de datos de desarrollo o despliegue: roles migrator/app, extensiones y migraciones.
//
//   PowerShell:
//     $env:ADMIN_DATABASE_URL = 'postgres://postgres:<clave>@127.0.0.1:5433/postgres'
//     $env:MIGRATOR_PASSWORD  = '<clave nueva para migrator>'
//     $env:APP_PASSWORD       = '<clave nueva para app>'
//     npm run db:setup            # base «prospector» por defecto; otra con $env:DB_NAME
//
// Las contraseñas solo se leen del entorno (nunca por argumento ni se imprimen).
import { bootstrapDatabase, ensureExtensions, migrate, urlFor } from '@turnosala/db';
import pg from 'pg';

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable de entorno ${name} (ver el comentario de scripts/db-setup.ts).`);
    process.exit(1);
  }
  return v;
}

const adminUrl = need('ADMIN_DATABASE_URL');
const dbName = process.env.DB_NAME ?? 'prospector';
const migratorPassword = need('MIGRATOR_PASSWORD');
const appPassword = need('APP_PASSWORD');

const boot = new pg.Client({ connectionString: adminUrl });
await boot.connect();
await bootstrapDatabase(boot, { dbName, migratorPassword, appPassword });
await boot.end();

const admin = new pg.Client({ connectionString: urlFor(adminUrl, decodeURIComponent(new URL(adminUrl).username), decodeURIComponent(new URL(adminUrl).password), dbName) });
await admin.connect();
await ensureExtensions(admin);
await admin.end();

const migrator = new pg.Pool({ connectionString: urlFor(adminUrl, 'migrator', migratorPassword, dbName) });
const applied = await migrate(migrator);
await migrator.end();

console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes.');
console.log(`Base «${dbName}» lista. DATABASE_URL de la aplicación (rol app): postgres://app:<APP_PASSWORD>@<host>:<puerto>/${dbName}`);
