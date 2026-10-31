import { reviewDeps } from '../../../../lib/deps.js';
import { handleExport } from '../../../../lib/review-handlers.js';

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return handleExport(req, reviewDeps());
}
