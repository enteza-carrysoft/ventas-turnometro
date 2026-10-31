import type { NewUser } from '../../apps/web/src/lib/users.js';

// Usuarios de la base de datos efímera del e2e; las contraseñas no sirven en ningún otro sitio.
export const USERS = {
  admin: { email: 'admin@e2e.test', name: 'Ana Admin', password: 'e2e-clave-admin-1', role: 'admin' },
  marketing: { email: 'marketing@e2e.test', name: 'Marta Marketing', password: 'e2e-clave-mkt-1', role: 'marketing' },
} satisfies Record<string, NewUser>;
