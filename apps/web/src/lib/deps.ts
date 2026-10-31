import { getServer } from './server.js';
import type { ReviewDeps } from './review-handlers.js';

/** Dependencias de las rutas de revisión: el usuario sale de la sesión de Better Auth (se comprueba en cada petición). */
export function reviewDeps(): ReviewDeps {
  const { auth, pool, siteOrigin } = getServer();
  return { pool, siteOrigin, userId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null };
}
