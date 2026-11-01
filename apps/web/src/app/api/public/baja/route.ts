import { publicDeps } from '../../../../lib/public-config.js';
import { handleUnsubscribe } from '../../../../lib/unsubscribe-handlers.js';

export const dynamic = 'force-dynamic';

// Ruta PÚBLICA: sin sesión. Solo POST (un GET nunca da de baja: los antivirus de correo abren los enlaces).
export function POST(req: Request): Promise<Response> {
  return handleUnsubscribe(req, publicDeps());
}
