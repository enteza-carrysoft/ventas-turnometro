import { createPublicToken } from '@turnosala/db';
import { expect, test } from '@playwright/test';
import { appPool, seedCandidate } from './seed.js';

// Baja pública (F2.2): mostrar la página no da de baja; el botón sí, y cierra la oportunidad como perdida por oposición.
const pool = appPool();
test.afterAll(async () => { await pool.end(); });
test.describe.configure({ mode: 'serial' });

async function world(email: string): Promise<{ prospectId: string; dealId: string; token: string }> {
  const prospectId = (await seedCandidate(pool)).id;
  await pool.query(`update prospects set status = 'approved' where id = $1`, [prospectId]);
  const dealId = '018f1111-0000-7000-8000-' + String(Date.now()).padStart(12, '0').slice(-12);
  await pool.query(`insert into deals (id, prospect_id, stage_id, created_by) values ($1,$2,'interested','e2e')`, [dealId, prospectId]);
  const { token } = await createPublicToken(pool, { kind: 'unsubscribe', prospectId, contact: { email } });
  return { prospectId, dealId, token };
}
const one = async (sql: string, a: unknown[]): Promise<Record<string, unknown>> => (await pool.query(sql, a)).rows[0] as Record<string, unknown>;

test('abrir el enlace NO da de baja (los antivirus de correo lo abren); lleva noindex, no-store y el correo enmascarado', async ({ page }) => {
  const w = await world('marta.ruiz@clinicabaja.es');
  const res = await page.goto(`/baja/${w.token}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  expect(res?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('button', { name: /m\*\*\*@clinicabaja\.es/ })).toBeVisible();
  await expect(page.getByText('marta.ruiz')).toHaveCount(0);
  expect((await one('select status from prospects where id = $1', [w.prospectId])).status).toBe('approved');
  expect((await one('select stage_id from deals where id = $1', [w.dealId])).stage_id).toBe('interested');
});

test('«que no se contacte con mi empresa»: ficha bloqueada, oportunidad perdida por oposición y mensaje de confirmación', async ({ page }) => {
  const w = await world('pablo@empresabaja.es');
  await page.goto(`/baja/${w.token}`);
  await page.getByRole('button', { name: 'Que no se contacte más con mi empresa' }).click();
  await expect(page.getByRole('status')).toContainText('No volveremos a contactar con tu empresa');
  expect(await one('select status, block_reason from prospects where id = $1', [w.prospectId])).toMatchObject({ status: 'blocked', block_reason: 'opposition' });
  expect(await one('select stage_id, lost_reason_id, closed_at is not null as closed from deals where id = $1', [w.dealId])).toMatchObject({ stage_id: 'lost', lost_reason_id: 'opposition', closed: true });
  // recargar el enlace sigue funcionando (idempotente) y no revela nada nuevo
  expect((await page.goto(`/baja/${w.token}`))?.status()).toBe(200);
});

test('«solo este contacto»: se excluye el correo pero la ficha y la oportunidad siguen', async ({ page }) => {
  const email = 'solo.yo@contactobaja.es';
  const w = await world(email);
  await page.goto(`/baja/${w.token}`);
  await page.getByRole('button', { name: /No quiero recibir más comunicaciones/ }).click();
  await expect(page.getByRole('status')).toContainText('No volveremos a escribir');
  expect((await one(`select count(*)::int n from suppressions where kind = 'email' and value = $1`, [email])).n).toBe(1);
  expect((await one('select status from prospects where id = $1', [w.prospectId])).status).toBe('approved');
  expect((await one('select stage_id from deals where id = $1', [w.dealId])).stage_id).toBe('interested');
});

test('un token inventado da 404 y no filtra nada', async ({ page }) => {
  expect((await page.goto('/baja/tokeninventadotokeninventado'))?.status()).toBe(404);
  expect((await page.goto('/baja/corto'))?.status()).toBe(404);
});
