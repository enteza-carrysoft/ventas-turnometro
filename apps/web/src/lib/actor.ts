import { headers } from 'next/headers';
import { getServer } from './server.js';
import { roleOf, type Role } from './users.js';

export interface Actor {
  userId: string;
  email: string;
  name: string;
  role: Role | null;
}

/** Usuario de la sesión actual con su rol, o null. Se consulta en servidor en cada petición. */
export async function currentActor(): Promise<Actor | null> {
  const { auth, pool } = getServer();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name, role: await roleOf(pool, session.user.id) };
}
