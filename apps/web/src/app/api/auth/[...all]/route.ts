import { toNextJsHandler } from 'better-auth/next-js';
import { getServer } from '../../../../lib/server.js';

export const dynamic = 'force-dynamic';

export function GET(req: Request): Promise<Response> {
  return toNextJsHandler(getServer().auth).GET(req);
}
export function POST(req: Request): Promise<Response> {
  return toNextJsHandler(getServer().auth).POST(req);
}
