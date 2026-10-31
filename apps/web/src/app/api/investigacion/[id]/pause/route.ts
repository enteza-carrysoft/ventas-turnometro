import { reviewDeps } from '../../../../../lib/deps.js';
import { handleResearchControl } from '../../../../../lib/research-handlers.js';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleResearchControl(req, reviewDeps(), (await ctx.params).id, 'pause');
}
