import { reviewDeps } from '../../../lib/deps.js';
import { handleRequestAnalysis } from '../../../lib/research-handlers.js';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return handleRequestAnalysis(req, reviewDeps());
}
