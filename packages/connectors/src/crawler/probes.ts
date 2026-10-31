import { resolveMx } from 'node:dns/promises';
import type { HttpProbe, MxResolver } from '@turnosala/core';

// Adaptadores reales de los puertos de verificación (REQ-VER-01 CA2). Solo comprueban que la web responde y que el dominio del email
// tiene MX: no leen contenido ni contactan con nadie. En CI se sustituyen por dobles locales.

export interface HttpProbeOptions {
  userAgent: string;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
}

export function createHttpProbe(opts: HttpProbeOptions): HttpProbe {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const request = (url: string, method: 'HEAD' | 'GET'): Promise<Response> =>
    doFetch(url, { method, redirect: 'follow', headers: { 'user-agent': opts.userAgent }, signal: AbortSignal.timeout(timeoutMs) });
  return {
    async probe(url: string): Promise<{ status: number }> {
      let res = await request(url, 'HEAD');
      if (res.status === 405 || res.status === 501) {
        await res.body?.cancel();
        res = await request(url, 'GET');
      }
      await res.body?.cancel();
      return { status: res.status };
    },
  };
}

export function createMxResolver(resolve: (domain: string) => Promise<Array<{ exchange: string; priority: number }>> = resolveMx): MxResolver {
  return { resolveMx: (domain) => resolve(domain) };
}
