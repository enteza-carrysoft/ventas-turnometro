import { checkEmailMx, checkWebsite } from '@turnosala/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpProbe, createMxResolver } from './probes.js';
import { html, startSite, type TestSite } from './test-site.js';

let site: TestSite | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});
const UA = 'TurnoSalaProspectorBot/1.0 (+https://turnosala.com/bot)';

describe('createHttpProbe (REQ-VER-01 CA2)', () => {
  it('hace HEAD con el User-Agent identificable y devuelve el estado', async () => {
    site = await startSite({ '/': html('hola') });
    const probe = createHttpProbe({ userAgent: UA });
    expect(await probe.probe(site.baseUrl + '/')).toEqual({ status: 200 });
    expect(site.hits[0]?.userAgent).toBe(UA);
  });

  it('si el servidor no admite HEAD (405/501) reintenta una vez con GET', async () => {
    const calls: string[] = [];
    const fake = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      calls.push(String(init?.method));
      return new Response(null, { status: init?.method === 'HEAD' ? 405 : 200 });
    });
    const probe = createHttpProbe({ userAgent: UA, fetch: fake as unknown as typeof fetch });
    expect(await probe.probe('http://x.es/')).toEqual({ status: 200 });
    expect(calls).toEqual(['HEAD', 'GET']);
  });

  it('un 404 se devuelve como estado (no lanza); un fallo de red o un tiempo agotado SÍ lanzan', async () => {
    site = await startSite({ '/lenta': { ...html('x'), delayMs: 500 } });
    const probe = createHttpProbe({ userAgent: UA, timeoutMs: 100 });
    expect(await probe.probe(site.baseUrl + '/no-existe')).toEqual({ status: 404 });
    await expect(probe.probe(site.baseUrl + '/lenta')).rejects.toThrow();
    await expect(createHttpProbe({ userAgent: UA, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch }).probe('http://x.es')).rejects.toThrow();
  });

  it('se integra con checkWebsite', async () => {
    site = await startSite({ '/': html('ok') });
    const probe = createHttpProbe({ userAgent: UA });
    expect(await checkWebsite(site.baseUrl, probe)).toEqual({ ok: true, status: 200 });
    expect(await checkWebsite(site.baseUrl + '/nada', probe)).toEqual({ ok: false, reason: 'http_error', status: 404 });
  });
});

describe('createMxResolver (REQ-VER-01 CA2)', () => {
  it('delega en la función DNS inyectada y devuelve exchange/priority', async () => {
    const dns = vi.fn(async () => [{ exchange: 'mx.clinicasol.es', priority: 10 }]);
    const r = createMxResolver(dns);
    expect(await r.resolveMx('clinicasol.es')).toEqual([{ exchange: 'mx.clinicasol.es', priority: 10 }]);
    expect(dns).toHaveBeenCalledWith('clinicasol.es');
    expect(await checkEmailMx('info@clinicasol.es', r)).toEqual({ ok: true });
  });

  it('el código de error de DNS llega intacto para distinguir «sin MX» de un fallo temporal', async () => {
    const r = createMxResolver(async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); });
    expect(await checkEmailMx('info@inexistente.es', r)).toEqual({ ok: false, reason: 'no_mx' });
    const t = createMxResolver(async () => { throw Object.assign(new Error('x'), { code: 'ETIMEOUT' }); });
    expect(await checkEmailMx('info@lento.es', t)).toEqual({ ok: false, reason: 'dns_error' });
  });
});
