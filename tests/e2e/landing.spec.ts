import { createPublicToken, approveSegment } from '@turnosala/db';
import { expect, test, type Page } from '@playwright/test';
import { appPool, seedCandidate, seedSegment } from './seed.js';

// Páginas públicas de demo (F2.1): sin sesión, CSP estricta, casillas sin marcar, envío real contra la base de datos del e2e.
const pool = appPool();
const SLUG = 'landing-e2e';
let token = '';
let prospectId = '';

test.beforeAll(async () => {
  await seedSegment(pool, SLUG);
  const id = ((await pool.query('select id from segments where slug = $1', [SLUG])).rows[0] as { id: string }).id;
  await approveSegment(pool, id, { userId: 'e2e', role: 'admin' });
  prospectId = (await seedCandidate(pool)).id;
  await pool.query(`update prospects set status = 'approved' where id = $1`, [prospectId]);
  token = (await createPublicToken(pool, { kind: 'landing', prospectId })).token;
});
test.afterAll(async () => {
  await pool.end();
});
test.describe.configure({ mode: 'serial' });

/** Eventos de la CSP: cualquier recurso bloqueado en una página pública es un fallo de la política. El script va como texto: se ejecuta en el navegador (el tsconfig no incluye la librería DOM). */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.addInitScript(`document.addEventListener('securitypolicyviolation', (e) => { window.__csp = (window.__csp || []).concat(e.violatedDirective + ' ' + e.blockedURI); });`);
  page.on('console', (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
  return violations;
}
const cspHits = async (page: Page): Promise<string[]> => (await page.evaluate('window.__csp || []')) as string[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number(((await pool.query(sql, args)).rows[0] as { n: string }).n);

async function fill(page: Page, v: { name: string; company?: string; email?: string; phone?: string }): Promise<void> {
  await page.getByLabel('Tu nombre', { exact: true }).fill(v.name);
  if (v.company !== undefined) await page.getByLabel('Nombre de tu empresa', { exact: true }).fill(v.company);
  if (v.email) await page.getByLabel('Correo electrónico', { exact: true }).fill(v.email);
  if (v.phone) await page.getByLabel('Teléfono', { exact: true }).fill(v.phone);
}
// El servidor exige 3 s desde que se mostró el formulario (marca de tiempo firmada).
const waitHuman = (page: Page): Promise<void> => page.waitForTimeout(3300);

test('la página del sector se ve sin sesión, con las casillas SIN marcar, la información de privacidad y la CSP estricta', async ({ page }) => {
  const logs = await watchCsp(page);
  const res = await page.goto(`/demo/${SLUG}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('segmento landing-e2e');
  await expect(page.getByRole('note')).toContainText('Texto legal sin aprobar');
  const boxes = page.getByRole('checkbox');
  await expect(boxes).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(boxes.nth(i)).not.toBeChecked();
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(res?.headers()['referrer-policy']).toBe('no-referrer');
  expect(await cspHits(page)).toEqual([]);
  expect(logs).toEqual([]);
});

test('un sector inexistente o en borrador da 404', async ({ page }) => {
  expect((await page.goto('/demo/no-existe'))?.status()).toBe(404);
  expect((await page.goto('/demo/Mal%20Slug!'))?.status()).toBe(404);
});

test('datos incompletos muestran errores en español y no registran nada', async ({ page }) => {
  const before = await count('select count(*) n from demo_requests');
  await page.goto(`/demo/${SLUG}`);
  await waitHuman(page);
  await page.getByRole('button', { name: 'Solicitar demo' }).click();
  await expect(page.getByText('Escribe tu nombre.')).toBeVisible();
  await expect(page.getByText('Escribe el nombre de tu empresa.')).toBeVisible();
  expect(await count('select count(*) n from demo_requests')).toBe(before);
});

test('una casilla marcada sin su dato (llamada sin teléfono) se rechaza con un mensaje claro', async ({ page }) => {
  await page.goto(`/demo/${SLUG}`);
  await fill(page, { name: 'Lucía Prueba', company: 'Clínica Mar Azul', email: 'lucia@clinicamarazul.es' });
  await page.getByRole('checkbox').nth(1).check();
  await waitHuman(page);
  await page.getByRole('button', { name: 'Solicitar demo' }).click();
  await expect(page.getByText('Para esta opción, indica tu teléfono.')).toBeVisible();
});

test('envío válido sin marcar casillas: se registra la solicitud pero NO se crea ningún consentimiento', async ({ page }) => {
  const email = 'sin-casillas@clinicasolnorte.es';
  await page.goto(`/demo/${SLUG}`);
  await fill(page, { name: 'Pedro Prueba', company: 'Clínica Sol Norte', email });
  await waitHuman(page);
  await page.getByRole('button', { name: 'Solicitar demo' }).click();
  await expect(page.getByRole('status')).toContainText('Hemos recibido tu solicitud');
  expect(await count('select count(*) n from demo_requests where requester_email = $1', [email])).toBe(1);
  expect(await count(`select count(*) n from consents c join demo_requests q on q.prospect_id = c.prospect_id where q.requester_email = $1`, [email])).toBe(0);
});

test('envío con la casilla de correo: dos consentimientos exactos (prospección y seguimiento de demo) con el texto y la versión mostrados', async ({ page }) => {
  const email = 'con-casilla@clinicaolivar.es';
  await page.goto(`/demo/${SLUG}`);
  const shown = (await page.getByRole('checkbox').first().locator('xpath=following-sibling::span').innerText()).trim();
  await fill(page, { name: 'Marta Prueba', company: 'Clínica Olivar', email });
  await page.getByRole('checkbox').first().check();
  await waitHuman(page);
  await page.getByRole('button', { name: 'Solicitar demo' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const rows = (await pool.query(
    `select c.channel, c.purpose, c.email, c.text_snapshot, c.text_version, c.ip is not null as has_ip from consents c join demo_requests q on q.prospect_id = c.prospect_id where q.requester_email = $1 order by c.purpose`, [email])).rows as
    Array<{ channel: string; purpose: string; email: string; text_snapshot: string; text_version: string; has_ip: boolean }>;
  expect(rows.map((r) => [r.channel, r.purpose, r.email])).toEqual([['email', 'demo_followup', email], ['email', 'prospecting', email]]);
  expect(rows.every((r) => r.text_snapshot.startsWith(shown) && r.text_version === 'borrador-1+borrador-1' && r.has_ip)).toBe(true);
});

test('el enlace personal no pide la empresa, lleva noindex y no se guarda; un token inválido da 404', async ({ page }) => {
  const res = await page.goto(`/c/${token}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  expect(res?.headers()['cache-control']).toBe('no-store');
  await expect(page.getByLabel('Nombre de tu empresa', { exact: true })).toHaveCount(0);
  const email = 'enlace@centroaurora.es';
  await fill(page, { name: 'Elena Prueba', email });
  await waitHuman(page);
  await page.getByRole('button', { name: 'Solicitar demo' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  const q = (await pool.query('select prospect_id, source_url from demo_requests where requester_email = $1', [email])).rows[0] as { prospect_id: string; source_url: string };
  expect(q.prospect_id).toBe(prospectId);
  expect(q.source_url).not.toContain(token);
  expect((await page.goto('/c/tokeninventadotokeninventado'))?.status()).toBe(404);
});
