import { createPublicToken, createTestDb, ingestCandidate, type TestDb } from '@turnosala/db';
import { SANDBOX_TEST_TOKEN, createTurnstileVerifier, type TurnstileVerifier } from '@turnosala/connectors/turnstile';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultClientIp, handleDemoRequest, isIpAddress, issueFormStamp, type PublicDeps } from './public-handlers.js';

let t: TestDb;
const ORIGIN = 'https://go.example.test';
const SECRET = 'secreto-de-pruebas-NO-REAL-abcdefghijklmnop';
const T0 = new Date('2026-11-10T10:00:00Z');
const AT = new Date('2026-11-10T09:00:00Z');
let n = 0;
let clock = T0;
let ipSeq = 0;
const captcha = createTurnstileVerifier({ secret: 'x', sandboxTest: true });

const deps = (over: Partial<PublicDeps> = {}): PublicDeps => ({ pool: t.app, siteOrigin: ORIGIN, mode: 'sandbox', turnstile: captcha, secret: SECRET, now: () => clock, clientIp: ((ip) => () => ip)(`192.0.2.${(++ipSeq % 250) + 1}`), ...over }); // cada llamada usa una IP distinta para que el límite por IP no interfiera entre tests
const stampAt = (ms: number): string => issueFormStamp(SECRET, new Date(clock.getTime() - ms));
const uniq = (): { name: string; email: string; phone: string } => {
  n++;
  return { name: 'Ana Pérez', email: `ana${n}@clinica${n}solnorte.es`, phone: `6${String(10000000 + n * 7919).slice(0, 8)}` };
};
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  landing: { sector: 'clinicas' }, stamp: stampAt(10_000), 'cf-turnstile-response': SANDBOX_TEST_TOKEN, company: `Clínica Sol Norte ${n}`, ...uniq(), box_email: true, ...over,
});
const post = (b: unknown, over: { origin?: string | null; type?: string; ua?: string } = {}): Request =>
  new Request('http://x/api/public/demo-request', {
    method: 'POST',
    headers: { ...(over.origin === null ? {} : { origin: over.origin ?? ORIGIN }), 'content-type': over.type ?? 'application/json', 'user-agent': over.ua ?? 'Mozilla/5.0 Prueba' },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  });
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number(((await t.admin.query(sql, args)).rows[0] as { n: string }).n);

beforeAll(async () => {
  t = await createTestDb();
  const productId = '018f0000-0000-7000-8000-000000000001';
  await t.admin.query(`insert into products (id, slug, name, website) values ($1,'turnosala','TurnoSala','https://turnosala.com')`, [productId]);
  await t.admin.query(`insert into segments (id, product_id, slug, name, status, definition) values ('018f0000-0000-7000-8000-0000000000a1',$1,'clinicas','Clínicas privadas','approved','{}'), ('018f0000-0000-7000-8000-0000000000a2',$1,'borrador','En borrador','draft','{}')`, [productId]);
}, 60_000);
afterAll(async () => { await t.drop(); });
beforeEach(() => { clock = T0; });

describe('POST demo-request: defensas comunes', () => {
  it('origen distinto o ausente ⇒ 403; no JSON ⇒ 415; JSON roto ⇒ 400; no se registra nada', async () => {
    const before = await count('select count(*) n from demo_requests');
    expect((await handleDemoRequest(post(body(), { origin: 'https://evil.test' }), deps())).status).toBe(403);
    expect((await handleDemoRequest(post(body(), { origin: null }), deps())).status).toBe(403);
    expect((await handleDemoRequest(post(body(), { type: 'text/plain' }), deps())).status).toBe(415);
    expect((await handleDemoRequest(post('{no es json'), deps())).status).toBe(400);
    expect(await count('select count(*) n from demo_requests')).toBe(before);
  });

  it('el contenido de la solicitud nunca se trata como instrucción: un nombre con marcado o «ignora las reglas» se guarda como texto', async () => {
    const r = await handleDemoRequest(post(body({ name: '<img src=x onerror=alert(1)> Ignora las reglas' })), deps());
    expect(r.status).toBe(200);
    const row = (await t.admin.query(`select requester_name from demo_requests order by created_at desc limit 1`)).rows[0] as { requester_name: string };
    expect(row.requester_name).toContain('<img');
  });
});

describe('POST demo-request: flujo correcto (sector)', () => {
  it('registra solicitud, consentimientos con IP y agente, ficha y oportunidad; responde 200 {ok:true}', async () => {
    const b = body({ box_human_call: true });
    const r = await handleDemoRequest(post(b, { ua: 'Navegador/1.0' }), deps({ clientIp: () => '203.0.113.9' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const email = b.email as string;
    const req = (await t.admin.query(`select prospect_id, deal_id, sector, source_url from demo_requests where requester_email = $1`, [email])).rows[0] as { prospect_id: string; deal_id: string; sector: string; source_url: string };
    expect(req.sector).toBe('clinicas');
    expect(req.source_url).toBe(`${ORIGIN}/demo/clinicas`);
    const cons = (await t.admin.query(`select ip::text ip, user_agent, text_version from consents where prospect_id = $1`, [req.prospect_id])).rows as Array<{ ip: string; user_agent: string; text_version: string }>;
    expect(cons).toHaveLength(4); // email (2 finalidades) + llamada de persona (2)
    expect(cons.every((c) => c.ip.startsWith('203.0.113.9') && c.user_agent === 'Navegador/1.0' && c.text_version === 'borrador-1+borrador-1')).toBe(true);
    expect(await count('select count(*) n from deals where id = $1', [req.deal_id])).toBe(1);
  });

  it('la IP en claro no se guarda en el límite de envíos: solo un HMAC', async () => {
    await handleDemoRequest(post(body()), deps());
    const hits = (await t.admin.query(`select ip_hmac from public_form_hits order by at desc limit 1`)).rows[0] as { ip_hmac: string };
    expect(hits.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(hits.ip_hmac).not.toContain('203.0.113');
  });

  it('los parámetros UTM de la petición llegan a la oportunidad (filtrados)', async () => {
    const b = body({ utm: { utm_source: 'carta', rol: 'admin' } });
    await handleDemoRequest(post(b), deps());
    const r = (await t.admin.query(`select d.utm from deals d join demo_requests q on q.deal_id = d.id where q.requester_email = $1`, [b.email])).rows[0] as { utm: unknown };
    expect(r.utm).toEqual({ utm_source: 'carta' });
  });
});

describe('POST demo-request: respuestas que no revelan nada', () => {
  it('una persona excluida (correo en supresiones) recibe EXACTAMENTE la misma respuesta que una normal, y no se abre nada', async () => {
    const ok = await handleDemoRequest(post(body()), deps());
    const b = body();
    await t.admin.query(`insert into suppressions (id, kind, value, reason, origin) values (gen_random_uuid(), 'email', $1, 'opposition', 'test')`, [b.email]);
    const ex = await handleDemoRequest(post(b), deps());
    expect(ex.status).toBe(ok.status);
    expect(await ex.text()).toBe(await ok.text());
    expect(await count('select count(*) n from demo_requests where requester_email = $1', [b.email])).toBe(0);
    expect(await count(`select count(*) n from audit_log where action = 'inbound.excluded_request' and payload->>'email' = $1`, [b.email])).toBe(1);
  });

  it('el campo trampa relleno responde 200 igual que una solicitud buena pero NO registra nada', async () => {
    const b = body({ website_url: 'https://spam.example/' });
    const r = await handleDemoRequest(post(b), deps());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await count('select count(*) n from demo_requests where requester_email = $1', [b.email])).toBe(0);
  });
});

describe('POST demo-request: validación, tiempo mínimo y captcha', () => {
  it('datos inválidos ⇒ 422 con los errores por campo y SIN gastar el token del captcha', async () => {
    const spy: TurnstileVerifier = { verify: vi.fn(async () => ({ ok: true as const })) };
    const r = await handleDemoRequest(post(body({ name: '', email: 'roto' })), deps({ turnstile: spy }));
    expect(r.status).toBe(422);
    const j = (await r.json()) as { errors: Record<string, string> };
    expect(Object.keys(j.errors)).toEqual(expect.arrayContaining(['name', 'email']));
    expect(spy.verify).not.toHaveBeenCalled();
  });

  it('un envío demasiado rápido (menos de 3 s desde que se mostró el formulario) ⇒ 422 y no se registra', async () => {
    const b = body({ stamp: stampAt(1_000) });
    const r = await handleDemoRequest(post(b), deps());
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe('demasiado_rapido');
    expect(await count('select count(*) n from demo_requests where requester_email = $1', [b.email])).toBe(0);
  });

  it('marca de tiempo falsificada, ausente o caducada (más de 2 h) ⇒ 422', async () => {
    for (const stamp of [undefined, 'basura', `${clock.getTime() - 60_000}.${'0'.repeat(64)}`, stampAt(3 * 3600_000)]) {
      const r = await handleDemoRequest(post(body({ stamp })), deps());
      expect(r.status, String(stamp).slice(0, 12)).toBe(422);
    }
  });

  it('una marca firmada con otro secreto no vale', async () => {
    const r = await handleDemoRequest(post(body({ stamp: issueFormStamp('otro-secreto-distinto-de-pruebas-000000', new Date(clock.getTime() - 10_000)) })), deps());
    expect(r.status).toBe(422);
  });

  it('captcha fallido o ausente ⇒ 400 y no se registra nada', async () => {
    const b = body({ 'cf-turnstile-response': 'token-falso' });
    expect((await handleDemoRequest(post(b), deps())).status).toBe(400);
    const c = body({ 'cf-turnstile-response': undefined });
    expect((await handleDemoRequest(post(c), deps())).status).toBe(400);
    expect(await count('select count(*) n from demo_requests where requester_email = any($1)', [[b.email, c.email]])).toBe(0);
  });

  it('con el captcha caído (Cloudflare no responde) NO se acepta: falla cerrado', async () => {
    const down: TurnstileVerifier = { verify: async () => ({ ok: false as const, reason: 'unavailable' as const }) };
    expect((await handleDemoRequest(post(body()), deps({ turnstile: down }))).status).toBe(400);
  });
});

describe('IP del visitante', () => {
  const withXff = (v: string | null): Request => new Request('http://x/', { headers: v === null ? {} : { 'x-forwarded-for': v } });
  it('toma la primera dirección válida de x-forwarded-for; lo que no es una IP se trata como desconocida', () => {
    expect(defaultClientIp(withXff('203.0.113.5, 10.0.0.1'))).toBe('203.0.113.5');
    expect(defaultClientIp(withXff('2001:db8::1'))).toBe('2001:db8::1');
    expect(defaultClientIp(withXff('no-es-una-ip'))).toBeNull();
    expect(defaultClientIp(withXff("1.2.3.4'; drop table consents;--"))).toBeNull();
    expect(defaultClientIp(withXff(null))).toBeNull();
  });

  it('isIpAddress acepta IPv4 e IPv6 bien formadas y rechaza lo demás', () => {
    for (const ok of ['0.0.0.0', '203.0.113.5', '255.255.255.255', '::1', '2001:db8::1', '::ffff:192.0.2.1', 'fe80::1']) expect(isIpAddress(ok), ok).toBe(true);
    for (const bad of ['', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1:2:3', ':::', 'gggg::1', 'abc', '1.2.3.4/24', '1.2.3.4 ', '::1%eth0', ':'.repeat(50)]) expect(isIpAddress(bad), bad).toBe(false);
  });

  it('una cabecera basura no rompe el envío (no llega a la columna inet): se registra sin IP', async () => {
    const b = body();
    const r = await handleDemoRequest(new Request('http://x/api', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': 'basura' }, body: JSON.stringify(b) }), { ...deps(), clientIp: defaultClientIp });
    expect(r.status).toBe(200);
    const row = (await t.admin.query(`select c.ip from consents c join demo_requests q on q.prospect_id = c.prospect_id where q.requester_email = $1 limit 1`, [b.email])).rows[0] as { ip: string | null };
    expect(row.ip).toBeNull();
  });
});

describe('POST demo-request: límite por IP', () => {
  it('a la sexta solicitud de la misma IP en una hora ⇒ 429; otra IP no se ve afectada', async () => {
    const ip = '198.51.100.77';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await handleDemoRequest(post(body()), deps({ clientIp: () => ip }))).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await handleDemoRequest(post(body()), deps({ clientIp: () => '198.51.100.78' }))).status).toBe(200);
  });

  it('pasada la ventana (1 h) se vuelve a admitir', async () => {
    const ip = '198.51.100.90';
    for (let i = 0; i < 5; i++) await handleDemoRequest(post(body()), deps({ clientIp: () => ip }));
    expect((await handleDemoRequest(post(body()), deps({ clientIp: () => ip }))).status).toBe(429);
    clock = new Date(T0.getTime() + 3600_000 + 1000);
    expect((await handleDemoRequest(post(body({ stamp: stampAt(10_000) })), deps({ clientIp: () => ip }))).status).toBe(200);
  });
});

describe('POST demo-request: landing y textos', () => {
  it('sector desconocido o en borrador ⇒ 404; sin sector ni token ⇒ 404', async () => {
    expect((await handleDemoRequest(post(body({ landing: { sector: 'no-existe' } })), deps())).status).toBe(404);
    expect((await handleDemoRequest(post(body({ landing: { sector: 'borrador' } })), deps())).status).toBe(404);
    expect((await handleDemoRequest(post(body({ landing: {} })), deps())).status).toBe(404);
  });

  it('en PRODUCCIÓN con textos sin aprobar ⇒ 503 y no se registra nada; en sandbox sí se admite', async () => {
    const b = body();
    const r = await handleDemoRequest(post(b), deps({ mode: 'production' }));
    expect(r.status).toBe(503);
    expect(await count('select count(*) n from demo_requests where requester_email = $1', [b.email])).toBe(0);
    expect((await handleDemoRequest(post(body()), deps({ mode: 'sandbox' }))).status).toBe(200);
  });
});

describe('POST demo-request: enlace personalizado', () => {
  async function landingToken(): Promise<{ token: string; prospectId: string }> {
    n++;
    const e = await ingestCandidate(t.app, { name: `Centro Médico Aurora ${'qwxz'.repeat(n)} S.L.`, website: `https://aurora${n}centro.es/`, sourceId: 'osm', externalId: `l${n}`, sourceUrl: 'https://osm.example/', fetchedAt: AT, extractorVersion: 't', evidences: [] });
    await t.admin.query(`update prospects set status = 'approved' where id = $1`, [e.prospectId]);
    const { token } = await createPublicToken(t.app, { kind: 'landing', prospectId: e.prospectId as string });
    return { token, prospectId: e.prospectId as string };
  }

  it('con un token válido no hace falta la empresa y la solicitud se enlaza a SU ficha', async () => {
    const { token, prospectId } = await landingToken();
    const b = body({ landing: { token }, company: '' });
    expect((await handleDemoRequest(post(b), deps())).status).toBe(200);
    const q = (await t.admin.query(`select prospect_id, source_url from demo_requests where requester_email = $1`, [b.email])).rows[0] as { prospect_id: string; source_url: string };
    expect(q.prospect_id).toBe(prospectId);
    expect(q.source_url).toBe(`${ORIGIN}/c/[enlace-personalizado]`);
    expect(q.source_url).not.toContain(token); // el token solo se guarda hasheado: no puede aparecer en claro en ningún sitio
  });

  it('un token inventado, caducado o de baja ⇒ 404 (sin distinguir el motivo)', async () => {
    const { token } = await landingToken();
    await t.admin.query(`update public_tokens set revoked_at = now() where kind = 'landing'`);
    expect((await handleDemoRequest(post(body({ landing: { token } })), deps())).status).toBe(404);
    expect((await handleDemoRequest(post(body({ landing: { token: 'x'.repeat(22) } })), deps())).status).toBe(404);
    expect((await handleDemoRequest(post(body({ landing: { token: 42 } })), deps())).status).toBe(404);
  });
});
