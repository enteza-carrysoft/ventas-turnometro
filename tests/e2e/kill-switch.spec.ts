import { adminUrl, TEST_APP_PW, urlFor } from '@turnosala/db';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_DB } from '../../playwright.config.js';
import { USERS } from './users.js';

// Better Auth limita /sign-in a 3 intentos cada 10 s por IP (protección contra fuerza bruta, activa en producción):
// los tests reutilizan sesiones en vez de iniciar sesión en cada uno.
const ADMIN_STATE = 'test-results/admin-state.json';

const pool = new pg.Pool({ connectionString: urlFor(adminUrl(), 'app', TEST_APP_PW, E2E_DB) });
test.afterAll(async () => {
  await pool.end();
});

async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/');
}

const auditCount = async (): Promise<number> =>
  (await pool.query(`select count(*)::int as n from audit_log where action = 'kill_switch.set'`)).rows[0].n as number;

test.describe.configure({ mode: 'serial' });

test('sin sesión, el panel redirige al acceso', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Acceso al panel' })).toBeVisible();
});

test('credenciales incorrectas no dan acceso', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(USERS.admin.email);
  await page.getByLabel('Contraseña').fill('contraseña-equivocada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Correo o contraseña incorrectos.');
  await expect(page).toHaveURL(/\/login$/);
});

test('marketing ve el modo y el kill switch pero NO puede activarlo (ni por la API)', async ({ page, baseURL }) => {
  await login(page, USERS.marketing);
  await expect(page.getByTestId('modo')).toContainText('SANDBOX');
  await expect(page.getByTestId('kill-switch')).toContainText('desactivado');
  await expect(page.getByRole('button', { name: /kill switch/i })).toHaveCount(0);
  await expect(page.getByText('Solo un administrador puede cambiar el kill switch.')).toBeVisible();

  // Saltándose la interfaz: la autorización se comprueba en el servidor.
  const res = await page.request.post('/api/admin/kill-switch', { headers: { origin: baseURL! }, data: { enabled: true } });
  expect(res.status()).toBe(403);
  await page.reload();
  await expect(page.getByTestId('kill-switch')).toContainText('desactivado');
  expect(await auditCount()).toBe(0);
});

test('admin activa el kill switch, queda en audit_log y se ve en el panel; luego lo desactiva', async ({ page }) => {
  await login(page, USERS.admin);
  await expect(page.getByTestId('usuario')).toContainText('Administrador');
  await page.context().storageState({ path: ADMIN_STATE });
  await page.getByRole('button', { name: 'Activar kill switch' }).click();
  await expect(page.getByTestId('kill-switch')).toContainText('ACTIVADO');
  expect(await auditCount()).toBe(1);

  const row = (await pool.query(`select a.actor, a.payload, u.email from audit_log a join "user" u on u.id = a.actor where a.action = 'kill_switch.set'`)).rows[0];
  expect(row.email).toBe(USERS.admin.email);
  expect(row.payload).toMatchObject({ enabled: true, role: 'admin' });
  expect((await pool.query(`select value from settings where key = 'kill_switch'`)).rows[0].value).toBe(true);

  await page.reload();
  await expect(page.getByTestId('kill-switch')).toContainText('ACTIVADO');
  await page.getByRole('button', { name: 'Desactivar kill switch' }).click();
  await expect(page.getByTestId('kill-switch')).toContainText('desactivado');
  expect(await auditCount()).toBe(2);
});

test('al cerrar sesión se vuelve al acceso y el panel deja de estar disponible', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('usuario')).toContainText('Ana Admin');
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await context.close();
});

test('fuerza bruta: tras 3 intentos de acceso en 10 s el servidor responde 429', async ({ request, baseURL }) => {
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await request.post('/api/auth/sign-in/email', {
      headers: { origin: baseURL! },
      data: { email: USERS.admin.email, password: 'intento-' + i + '-incorrecto' },
    });
    statuses.push(res.status());
  }
  expect(statuses).toContain(429);
  expect(statuses.filter((x) => x === 200)).toHaveLength(0);
});
