// Servidor HTTP local que imita a OpenRouter. Solo para pruebas: ninguna prueba de CI usa la red ni gasta dinero.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

export interface Captured {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}
export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  json: unknown;
}
export interface TestServer {
  baseUrl: string;
  requests: Captured[];
  close(): Promise<void>;
}

export async function startTestServer(handler: (req: Captured, n: number) => Reply): Promise<TestServer> {
  const requests: Captured[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const captured: Captured = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
      requests.push(captured);
      const reply = handler(captured, requests.length);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Respuesta típica de /chat/completions de OpenRouter. */
export function completion(over: {
  content?: string | null; finish?: string; model?: string; cost?: number | null; prompt?: number; completion?: number; cached?: number; error?: unknown;
} = {}): unknown {
  const body: Record<string, unknown> = {
    id: 'gen-test-1',
    model: over.model ?? 'anthropic/claude-opus-5.5[1m]',
    choices: [{ finish_reason: over.finish ?? 'stop', message: { role: 'assistant', content: over.content === undefined ? '{"ok":true}' : over.content } }],
    usage: {
      prompt_tokens: over.prompt ?? 1000,
      completion_tokens: over.completion ?? 200,
      prompt_tokens_details: { cached_tokens: over.cached ?? 0 },
      ...(over.cost === null ? {} : { cost: over.cost ?? 0.0123 }),
    },
  };
  if (over.error) body.error = over.error;
  return body;
}
