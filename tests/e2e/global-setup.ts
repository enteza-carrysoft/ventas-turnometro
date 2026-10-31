import { createTestDb } from '@turnosala/db';
import { createAuth } from '../../apps/web/src/lib/auth.js';
import { createUser } from '../../apps/web/src/lib/users.js';
import { E2E_DB } from '../../playwright.config.js';
import { USERS } from './users.js';

/** Crea la base de datos del e2e (limpia, con migraciones) y los usuarios de prueba. */
export default async function globalSetup(): Promise<void> {
  const db = await createTestDb({ name: E2E_DB });
  try {
    const auth = createAuth(db.app, { secret: process.env.E2E_AUTH_SECRET ?? 'solo-para-sembrar-usuarios-e2e', baseURL: 'http://127.0.0.1:3100' });
    for (const u of Object.values(USERS)) await createUser(auth, db.app, u);
  } finally {
    await Promise.all([db.app.end(), db.migrator.end(), db.admin.end()]);
  }
}
