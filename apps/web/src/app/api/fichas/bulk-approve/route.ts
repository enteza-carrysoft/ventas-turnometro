import { reviewDeps } from '../../../../lib/deps.js';
import { handleBulkApprove } from '../../../../lib/review-handlers.js';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return handleBulkApprove(req, reviewDeps());
}
