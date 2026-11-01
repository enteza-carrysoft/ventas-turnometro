import { expect, test, type Page } from '@playwright/test';
import { appPool, seedSegment } from './seed.js';
import { USERS } from './users.js';
import { approveSegment } from '@turnosala/db';

// Pantalla de textos legales (F2.1d). Corre DESPUÉS de landing.spec (orden alfabético): aprobar una versión cambia el texto vigente que ese spec comprueba.
const pool = appPool();
test.afterAll(async () => { await pool.end(); });
test.describe.configure({ mode: 'serial' });

async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto('/login');
    await page.getByLabel('Correo').fill(u.email);
    await page.getByLabel('Contraseña').fill(u.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    try { await page.waitForURL('**/', { timeout: 4000 }); return; } catch { await page.waitForTimeout(6000); }
  }
  throw new Error('No se pudo iniciar sesión');
}
const NEW_TEXT = 'Texto aprobado por el asesor: acepto recibir correos de TurnoSala sobre la demo.';

test('marketing ve los textos pero no puede crear ni aprobar versiones', async ({ page }) => {
  await login(page, USERS.marketing);
  await page.goto('/ajustes/consentimientos');
  await expect(page.getByRole('heading', { name: 'Textos de consentimiento' })).toBeVisible();
  await expect(page.getByText('Borrador sin aprobar').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear borrador' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aprobar versión' })).toHaveCount(0);
});

test('el admin crea una versión, la aprueba y pasa a ser la vigente en el formulario público', async ({ page, browser }) => {
  await login(page, USERS.admin);
  await page.goto('/ajustes/consentimientos');
  const section = page.getByRole('region', { name: 'Casilla: correo electrónico' });
  await section.getByLabel('Versión nueva').fill('v2-asesor');
  await section.getByLabel('Texto exacto').fill(NEW_TEXT);
  await section.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(section.getByText('v2-asesor · Borrador sin aprobar')).toBeVisible();

  // repetir la misma versión da un mensaje claro
  await section.getByLabel('Versión nueva').fill('v2-asesor');
  await section.getByLabel('Texto exacto').fill('otro');
  await section.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(section.getByRole('alert')).toContainText('Ya existe una versión');

  const row = section.getByTestId('version-texto').filter({ hasText: 'v2-asesor' });
  await row.getByRole('button', { name: 'Aprobar versión' }).click();
  await expect(section.getByText('v2-asesor · Aprobada y vigente')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Aprobar versión' })).toHaveCount(0);

  // la página pública (sin sesión) muestra ya el texto aprobado en esa casilla
  await seedSegment(pool, 'textos-e2e');
  const id = ((await pool.query(`select id from segments where slug = 'textos-e2e'`)).rows[0] as { id: string }).id;
  await approveSegment(pool, id, { userId: 'e2e', role: 'admin' });
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/demo/textos-e2e');
  await expect(anon.getByText(NEW_TEXT)).toBeVisible();
  // sigue habiendo un aviso: las otras cuatro casillas continúan sin aprobar
  await expect(anon.getByRole('note')).toContainText('Texto legal sin aprobar');
});
