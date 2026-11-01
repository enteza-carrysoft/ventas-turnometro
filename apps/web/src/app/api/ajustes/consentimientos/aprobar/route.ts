import { reviewDeps } from '../../../../../lib/deps.js';
import { handleConsentText } from '../../../../../lib/consent-handlers.js';

export const dynamic = 'force-dynamic';

export function POST(req: Request): Promise<Response> {
  return handleConsentText(req, reviewDeps(), 'approve');
}
