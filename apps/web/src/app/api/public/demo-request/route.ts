import { handleDemoRequest } from '../../../../lib/public-handlers.js';
import { publicDeps } from '../../../../lib/public-config.js';

export const dynamic = 'force-dynamic';

// Ruta PÚBLICA: sin sesión. Las defensas (origen, límite por IP, captcha, tiempo mínimo) viven en el manejador.
export function POST(req: Request): Promise<Response> {
  return handleDemoRequest(req, publicDeps());
}
