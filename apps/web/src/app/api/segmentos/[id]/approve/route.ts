import { reviewDeps } from '../../../../../lib/deps.js';
import { handleSegmentAction } from '../../../../../lib/review-handlers.js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleSegmentAction(req, reviewDeps(), (await ctx.params).id, 'approve');
}
