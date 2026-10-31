import { handleKillSwitch } from '../../../../lib/kill-switch-handler.js';
import { getServer } from '../../../../lib/server.js';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return handleKillSwitch(req, getServer());
}
