// Sitio web local para probar el rastreador. Solo para pruebas: ninguna prueba de CI usa la red.
import { createServer, type Server } from 'node:http';

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** respuesta lenta, para probar el tiempo máximo */
  delayMs?: number;
  /** cuerpo muy grande, para probar el límite de tamaño */
  repeat?: { text: string; times: number };
}
export interface Hit {
  path: string;
  userAgent: string;
}
export interface TestSite {
  baseUrl: string;
  hits: Hit[];
  close(): Promise<void>;
}

export const html = (body: string, title = 'Página'): Route => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>` });

export async function startSite(routes: Record<string, Route>): Promise<TestSite> {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string;
    hits.push({ path, userAgent: String(req.headers['user-agent'] ?? '') });
    const route = routes[path];
    const send = (): void => {
      if (!route) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no encontrado'); return; }
      res.writeHead(route.status ?? 200, route.headers ?? { 'content-type': 'text/plain' });
      if (route.repeat) { for (let i = 0; i < route.repeat.times; i++) res.write(route.repeat.text); res.end(); } else res.end(route.body ?? '');
    };
    if (route?.delayMs) setTimeout(send, route.delayMs); else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, hits, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
