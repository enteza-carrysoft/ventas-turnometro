import { reviewDeps } from '../../../../../lib/deps.js';
import { handleDealAction } from '../../../../../lib/deal-handlers.js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleDealAction(req, reviewDeps(), (await ctx.params).id, 'lose');
}
