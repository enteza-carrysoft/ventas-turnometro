import { reviewDeps } from '../../../lib/deps.js';
import { handleLaunchResearch } from '../../../lib/research-handlers.js';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return handleLaunchResearch(req, reviewDeps());
}
