// Comprobaciones de verificación (REQ-VER-01 CA2) sobre puertos: la lógica es pura y testeable; el acceso real a la red
// (HTTP con robots.txt y ritmo educado, DNS) lo aportan los adaptadores del rastreador (F1.6) y se inyectan aquí.

export interface HttpProbe {
  /** HEAD (y GET si el servidor no lo admite) a la URL; lanza ante fallos de red, DNS o tiempo agotado */
  probe(url: string): Promise<{ status: number }>;
}
export interface MxResolver {
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
}

export type WebCheck = { ok: true; status: number } | { ok: false; reason: 'http_error'; status: number } | { ok: false; reason: 'unreachable' | 'invalid_url' };
export type MxCheck = { ok: true } | { ok: false; reason: 'no_mx' | 'dns_error' | 'invalid_email' };

/** La web «responde» si devuelve 2xx o 3xx. El fallo se devuelve (nunca se lanza) para anotarlo. */
export async function checkWebsite(url: string, http: HttpProbe): Promise<WebCheck> {
  let target: string;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`);
    if (!url.trim() || !u.hostname.includes('.')) return { ok: false, reason: 'invalid_url' };
    target = u.toString();
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  try {
    const { status } = await http.probe(target);
    return status >= 200 && status < 400 ? { ok: true, status } : { ok: false, reason: 'http_error', status };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND', 'ENOENT']);

/** El dominio del email tiene al menos un MX utilizable. Distingue «no hay MX» de un fallo temporal de DNS. */
export async function checkEmailMx(email: string, dns: MxResolver): Promise<MxCheck> {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  if (!m) return { ok: false, reason: 'invalid_email' };
  try {
    const records = await dns.resolveMx((m[1] as string).toLowerCase());
    const usable = records.filter((r) => r.exchange.trim() !== '' && r.exchange.trim() !== '.');
    return usable.length ? { ok: true } : { ok: false, reason: 'no_mx' };
  } catch (e) {
    return { ok: false, reason: NO_RECORDS.has((e as { code?: string }).code ?? '') ? 'no_mx' : 'dns_error' };
  }
}
