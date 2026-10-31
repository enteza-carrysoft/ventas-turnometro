import { createTestDb, type TestDb } from '@turnosala/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, type Auth } from './auth.js';
import { handleKillSwitch } from './kill-switch-handler.js';
import { createUser } from './users.js';

const ORIGIN = 'http://localhost:3100';
let t: TestDb;
let auth: Auth;

beforeAll(async () => {
  t = await createTestDb();
  auth = createAuth(t.app, { secret: 'test-secret-'.repeat(5), baseURL: ORIGIN });
  await createUser(auth, t.app, { email: 'admin@example.test', name: 'Admin', password: 'clave-de-prueba-1', role: 'admin' });
  await createUser(auth, t.app, { email: 'mkt@example.test', name: 'Marketing', password: 'clave-de-prueba-2', role: 'marketing' });
  await createUser(auth, t.app, { email: 'nadie@example.test', name: 'Sin rol', password: 'clave-de-prueba-3', role: null });
}, 60_000);
afterAll(async () => {
  await t.drop();
});

async function login(email: string, password: string): Promise<string> {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const call = (cookie: string | null, body: unknown, over: Record<string, string> = {}): Promise<Response> =>
  handleKillSwitch(
    new Request(`${ORIGIN}/api/admin/kill-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...over },
      body: JSON.stringify(body),
    }),
    { auth, pool: t.app, siteOrigin: ORIGIN },
  );

const killSwitch = async (key = 'kill_switch'): Promise<unknown> =>
  (await t.app.query('select value from settings where key = $1', [key])).rows[0]?.value;

describe('autenticación', () => {
  it('no hay registro público (P5.2)', async () => {
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'intruso@example.test', name: 'X', password: 'una-clave-larga-123' }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await t.app.query(`select 1 from "user" where email = 'intruso@example.test'`)).rowCount).toBe(0);
  });

  it('contraseña incorrecta → no hay sesión', async () => {
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'admin@example.test', password: 'incorrecta-incorrecta' }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it('la contraseña no se guarda en claro', async () => {
    const r = await t.app.query(`select password from account where "providerId" = 'credential' limit 1`);
    expect(String(r.rows[0]?.password)).not.toContain('clave-de-prueba');
  });
});

describe('kill_switch: autorización en servidor (P5.2)', () => {
  it('sin sesión → 401 y no cambia nada', async () => {
    expect((await call(null, { enabled: true })).status).toBe(401);
    expect(await killSwitch()).toBe(false);
  });

  it('marketing → 403 y no cambia nada ni audita', async () => {
    const cookie = await login('mkt@example.test', 'clave-de-prueba-2');
    expect((await call(cookie, { enabled: true })).status).toBe(403);
    expect(await killSwitch()).toBe(false);
    expect((await t.app.query(`select count(*)::int as n from audit_log where action like 'kill_switch%'`)).rows[0]?.n).toBe(0);
  });

  it('usuario autenticado sin rol → 403', async () => {
    const cookie = await login('nadie@example.test', 'clave-de-prueba-3');
    expect((await call(cookie, { enabled: true })).status).toBe(403);
    expect(await killSwitch()).toBe(false);
  });

  it('admin → 200, cambia el ajuste y queda en audit_log con autor', async () => {
    const cookie = await login('admin@example.test', 'clave-de-prueba-1');
    const res = await call(cookie, { enabled: true });
    expect(res.status).toBe(200);
    expect(await killSwitch()).toBe(true);
    const log = await t.app.query(`select actor, entity, payload from audit_log where action = 'kill_switch.set'`);
    expect(log.rowCount).toBe(1);
    expect(log.rows[0]?.actor).toMatch(/.+/);
    expect(log.rows[0]?.payload).toMatchObject({ enabled: true, channel: null, role: 'admin' });
    const user = await t.app.query(`select id from "user" where email = 'admin@example.test'`);
    expect(log.rows[0]?.actor).toBe(user.rows[0]?.id);
  });

  it('admin puede apagarlo y activar solo un canal', async () => {
    const cookie = await login('admin@example.test', 'clave-de-prueba-1');
    expect((await call(cookie, { enabled: false })).status).toBe(200);
    expect(await killSwitch()).toBe(false);
    expect((await call(cookie, { enabled: true, channel: 'ai_call' })).status).toBe(200);
    expect(await killSwitch('kill_switch_ai_call')).toBe(true);
    expect(await killSwitch()).toBe(false);
    await call(cookie, { enabled: false, channel: 'ai_call' });
  });

  it('cuerpo inválido o canal desconocido → 422 sin cambios', async () => {
    const cookie = await login('admin@example.test', 'clave-de-prueba-1');
    expect((await call(cookie, { enabled: 'sí' })).status).toBe(422);
    expect((await call(cookie, { enabled: true, channel: 'paloma_mensajera' })).status).toBe(422);
    expect(await killSwitch()).toBe(false);
  });

  it('CSRF: origen distinto o ausente → 403 aunque la sesión sea de admin', async () => {
    const cookie = await login('admin@example.test', 'clave-de-prueba-1');
    expect((await call(cookie, { enabled: true }, { origin: 'https://malo.example.test' })).status).toBe(403);
    const sinOrigen = new Request(`${ORIGIN}/api/admin/kill-switch`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ enabled: true }),
    });
    expect((await handleKillSwitch(sinOrigen, { auth, pool: t.app, siteOrigin: ORIGIN })).status).toBe(403);
    expect(await killSwitch()).toBe(false);
  });

  it('un rol auditor o voice tampoco puede (solo admin)', async () => {
    for (const role of ['auditor', 'voice', 'sales'] as const) {
      const email = `${role}@example.test`;
      await createUser(auth, t.app, { email, name: role, password: 'clave-de-prueba-9', role });
      const cookie = await login(email, 'clave-de-prueba-9');
      expect((await call(cookie, { enabled: true })).status, role).toBe(403);
    }
    expect(await killSwitch()).toBe(false);
  });

  it('el kill_switch activado hace que la puerta bloquee (integración con CG-01)', async () => {
    const { check, uuidv7 } = await import('@turnosala/db');
    const cookie = await login('admin@example.test', 'clave-de-prueba-1');
    await call(cookie, { enabled: true });
    const p = uuidv7();
    await t.app.query(`insert into prospects (id, name, name_norm, status) values ($1,'X','x','approved')`, [p]);
    const r = await check(t.app, { prospectId: p, channel: 'postal_letter', purpose: 'prospecting', direction: 'outbound' });
    expect(r.ruleIds).toEqual(['CG-01']);
    await call(cookie, { enabled: false });
  });
});

describe('setKillSwitch: segunda capa de autorización (defensa en profundidad)', () => {
  it('rechaza a cualquier rol que no sea admin aunque se llame directamente, sin tocar nada', async () => {
    const { setKillSwitch, ForbiddenError } = await import('./kill-switch.js');
    for (const role of ['marketing', 'sales', 'auditor', 'voice', null] as const) {
      await expect(setKillSwitch(t.app, { userId: 'x', role }, { enabled: true }), String(role)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await killSwitch()).toBe(false);
    expect((await t.app.query(`select count(*)::int as n from audit_log where actor = 'x'`)).rows[0]?.n).toBe(0);
  });

  it('si la auditoría falla, el cambio no se aplica (misma transacción)', async () => {
    const { setKillSwitch } = await import('./kill-switch.js');
    await expect(setKillSwitch(t.app, { userId: 'admin-x', role: 'admin' }, { enabled: true, channel: 'ai_call' })).resolves.toBeUndefined();
    await t.app.query(`update settings set value = 'false' where key = 'kill_switch_ai_call'`);
    // ajuste inexistente → error y sin fila de auditoría nueva
    const before = (await t.app.query(`select count(*)::int as n from audit_log`)).rows[0]?.n as number;
    await t.app.query(`delete from settings where key = 'kill_switch_visit'`);
    await expect(setKillSwitch(t.app, { userId: 'admin-x', role: 'admin' }, { enabled: true, channel: 'visit' })).rejects.toThrow(/inexistente/);
    expect((await t.app.query(`select count(*)::int as n from audit_log`)).rows[0]?.n).toBe(before);
  });
});
