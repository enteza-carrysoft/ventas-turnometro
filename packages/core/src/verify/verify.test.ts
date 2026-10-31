import { describe, expect, it } from 'vitest';
import { checkEmailMx, checkWebsite, type HttpProbe, type MxResolver } from './verify.js';

const http = (status: number | Error): HttpProbe => ({ probe: async () => { if (status instanceof Error) throw status; return { status }; } });
const dns = (res: Array<{ exchange: string; priority: number }> | Error): MxResolver => ({ resolveMx: async () => { if (res instanceof Error) throw res; return res; } });
const dnsErr = (code: string): Error => Object.assign(new Error(code), { code });

describe('checkWebsite: la web responde con 2xx/3xx (REQ-VER-01 CA2)', () => {
  it.each([200, 204, 301, 302, 308, 399])('HTTP %i → ok', async (status) => {
    expect(await checkWebsite('https://clinicasol.es', http(status))).toEqual({ ok: true, status });
  });
  it.each([400, 403, 404, 410, 500, 503])('HTTP %i → fallo anotado con su código', async (status) => {
    expect(await checkWebsite('https://clinicasol.es', http(status))).toEqual({ ok: false, reason: 'http_error', status });
  });
  it('caída de red, DNS o tiempo agotado → «unreachable» (no lanza)', async () => {
    expect(await checkWebsite('https://clinicasol.es', http(dnsErr('ENOTFOUND')))).toEqual({ ok: false, reason: 'unreachable' });
    expect(await checkWebsite('https://clinicasol.es', http(new Error('timeout')))).toEqual({ ok: false, reason: 'unreachable' });
  });
  it('una URL vacía o inválida ni se intenta', async () => {
    let called = false;
    const spy: HttpProbe = { probe: async () => { called = true; return { status: 200 }; } };
    expect(await checkWebsite('', spy)).toEqual({ ok: false, reason: 'invalid_url' });
    expect(await checkWebsite('no es una url', spy)).toEqual({ ok: false, reason: 'invalid_url' });
    expect(called).toBe(false);
  });
});

describe('checkEmailMx: el dominio del email genérico tiene MX (REQ-VER-01 CA2)', () => {
  it('con al menos un MX → ok', async () => {
    expect(await checkEmailMx('info@clinicasol.es', dns([{ exchange: 'mx.clinicasol.es', priority: 10 }]))).toEqual({ ok: true });
  });
  it('sin registros MX o dominio inexistente → no_mx', async () => {
    expect(await checkEmailMx('info@clinicasol.es', dns([]))).toEqual({ ok: false, reason: 'no_mx' });
    expect(await checkEmailMx('info@nada.es', dns(dnsErr('ENOTFOUND')))).toEqual({ ok: false, reason: 'no_mx' });
    expect(await checkEmailMx('info@nada.es', dns(dnsErr('ENODATA')))).toEqual({ ok: false, reason: 'no_mx' });
  });
  it('un «null MX» (RFC 7505: el dominio declara que no recibe correo) → no_mx', async () => {
    expect(await checkEmailMx('info@clinicasol.es', dns([{ exchange: '', priority: 0 }]))).toEqual({ ok: false, reason: 'no_mx' });
    expect(await checkEmailMx('info@clinicasol.es', dns([{ exchange: '.', priority: 0 }]))).toEqual({ ok: false, reason: 'no_mx' });
  });
  it('un fallo temporal de DNS no se confunde con «no hay MX»', async () => {
    expect(await checkEmailMx('info@clinicasol.es', dns(dnsErr('ESERVFAIL')))).toEqual({ ok: false, reason: 'dns_error' });
    expect(await checkEmailMx('info@clinicasol.es', dns(dnsErr('ETIMEOUT')))).toEqual({ ok: false, reason: 'dns_error' });
  });
  it('un email sin forma válida ni se consulta', async () => {
    for (const bad of ['', 'sin-arroba', 'a@', '@b.es', 'a b@c.es']) expect(await checkEmailMx(bad, dns([{ exchange: 'x', priority: 1 }]))).toEqual({ ok: false, reason: 'invalid_email' });
  });
});
