// Crea un usuario del panel (no hay registro público). La contraseña se lee del entorno, nunca se imprime.
//
//   PowerShell:
//     $env:DATABASE_URL       = 'postgres://app:<clave>@127.0.0.1:5433/prospector'
//     $env:BETTER_AUTH_SECRET = '<el mismo secreto que usa la aplicación>'
//     $env:BETTER_AUTH_URL    = 'http://localhost:3000'
//     $env:NEW_USER_PASSWORD  = '<mínimo 12 caracteres>'
//     npm run user:create -- persona@empresa.es "Nombre Apellido" admin
import pg from 'pg';
import { createAuth } from '../apps/web/src/lib/auth.js';
import { createUser, ROLES, type Role } from '../apps/web/src/lib/users.js';

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable de entorno ${name} (ver el comentario de scripts/create-user.ts).`);
    process.exit(1);
  }
  return v;
}

const [email, name, role] = process.argv.slice(2);
if (!email || !name || !role || !(ROLES as readonly string[]).includes(role)) {
  console.error(`Uso: npm run user:create -- <correo> "<nombre>" <${ROLES.join('|')}>`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: need('DATABASE_URL') });
const auth = createAuth(pool, { secret: need('BETTER_AUTH_SECRET'), baseURL: need('BETTER_AUTH_URL') });
try {
  const id = await createUser(auth, pool, { email, name, password: need('NEW_USER_PASSWORD'), role: role as Role });
  console.log(`Usuario creado: ${email} (${role}) id=${id}`);
} finally {
  await pool.end();
}
