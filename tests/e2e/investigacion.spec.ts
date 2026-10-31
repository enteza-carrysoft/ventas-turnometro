import { claimRequest, claimTask, finishRequest, finishTask, touchWorkerHeartbeat } from '@turnosala/db';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { appPool, seedResearchBasics } from './seed.js';
import { USERS } from './users.js';

// Investigación (F1.4): lanzar, pausar, cancelar y ver el avance sin recargar (refresco ≤ 10 s). Este spec va el primero: los accesos se hacen
// una sola vez por usuario y se reutilizan (Better Auth limita a 3 intentos cada 10 s).
const pool = appPool();
test.afterAll(async () => {
  await pool.end();
});
test.describe.configure({ mode: 'serial' });

async function login(page: Page, u: { email: string; password: string }): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto('/login');
    await page.getByLabel('Correo').fill(u.email);
    await page.getByLabel('Contraseña').fill(u.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    try {
      await page.waitForURL('**/', { timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(6000);
    }
  }
  throw new Error('No se pudo iniciar sesión');
}
async function session(browser: Browser, u: { email: string; password: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await login(await ctx.newPage(), u);
  return ctx;
}

let mkt: BrowserContext;
let sales: BrowserContext;
test.beforeAll(async ({ browser }) => {
  mkt = await session(browser, USERS.marketing);
  sales = await session(browser, USERS.sales);
});
test.afterAll(async () => {
  await mkt.close();
  await sales.close();
});

const REFRESH = { timeout: 10_000 }; // CA4: el panel se actualiza solo en ≤ 10 s

test('sin ningún segmento aprobado el formulario lo explica; sin worker el panel avisa', async () => {
  const page = await mkt.newPage();
  await page.goto('/investigacion');
  await expect(page.getByText('Aún no hay segmentos aprobados.')).toBeVisible();
  await expect(page.getByTestId('worker')).toContainText('Sin señal del worker');
  await page.close();
});

test('el aviso del worker se actualiza solo cuando este da señal, y avisa de que la IA está apagada', async () => {
  const page = await mkt.newPage();
  await page.goto('/investigacion');
  await expect(page.getByTestId('worker')).toContainText('Sin señal del worker');
  await touchWorkerHeartbeat(pool, { workerId: 'e2e-worker', llmEnabled: false });
  await expect(page.getByTestId('worker')).toContainText('Worker en marcha', REFRESH); // sin recargar la página
  await expect(page.getByTestId('worker')).toContainText('desactivados');
  await page.close();
});

test('marketing lanza una investigación desde la pantalla; queda en cola con su lote y presupuesto', async () => {
  const { segmentName } = await seedResearchBasics(pool);
  const page = await mkt.newPage();
  await page.goto('/investigacion');
  await expect(page.getByRole('button', { name: 'Lanzar investigación' })).toBeDisabled(); // faltan municipios
  await page.getByLabel('Segmento aprobado').selectOption({ label: segmentName });
  await page.getByLabel('Municipios').selectOption(['41091', '41038']);
  await page.getByLabel(/Lote máximo/).fill('40');
  await page.getByLabel(/Presupuesto/).fill('2.5');
  await page.getByRole('button', { name: 'Lanzar investigación' }).click();
  const row = page.getByTestId('trabajo').first();
  await expect(row.getByTestId('estado-trabajo')).toHaveText('En cola');
  await expect(row).toContainText('0/2 tareas');
  await expect(row).toContainText('0/40');
  await expect(row).toContainText('0.00/2.50 €');
  const j = (await pool.query(`select created_by, max_candidates from research_jobs order by created_at desc limit 1`)).rows[0] as { max_candidates: number };
  expect(j.max_candidates).toBe(40);
  await page.close();
});

test('pausar, reanudar y cancelar desde la pantalla; quedan en la auditoría', async () => {
  const page = await mkt.newPage();
  await page.goto('/investigacion');
  const row = page.getByTestId('trabajo').first();
  await row.getByRole('button', { name: 'Pausar' }).click();
  await expect(row.getByTestId('estado-trabajo')).toHaveText('En pausa');
  await row.getByRole('button', { name: 'Reanudar' }).click();
  await expect(row.getByTestId('estado-trabajo')).toHaveText('En marcha');
  await row.getByRole('button', { name: 'Cancelar' }).click();
  await expect(row.getByTestId('estado-trabajo')).toHaveText('Cancelado');
  await expect(row.getByRole('button')).toHaveCount(0);
  const actions = (await pool.query(`select action from audit_log where action like 'research.%' and action <> 'research.created' order by id`)).rows.map((r: { action: string }) => r.action);
  expect(actions).toEqual(['research.paused', 'research.resumed', 'research.cancelled']);
  await page.close();
});

test('el avance se actualiza solo: cuando el worker termina las tareas, el panel muestra candidatas y coste sin recargar', async () => {
  const page = await mkt.newPage();
  await page.goto('/investigacion');
  await page.getByLabel('Municipios').selectOption(['41091']);
  await page.getByLabel(/Lote máximo/).fill('30');
  await page.getByRole('button', { name: 'Lanzar investigación' }).click();
  const row = page.getByTestId('trabajo').first();
  await expect(row.getByTestId('estado-trabajo')).toHaveText('En cola');

  const jobId = ((await pool.query(`select id from research_jobs where status = 'queued' order by created_at desc limit 1`)).rows[0] as { id: string }).id;
  const task = (await claimTask(pool, { workerId: 'e2e-worker', jobId }))!; // hace de worker
  await finishTask(pool, task.id, { candidates: 7, costEur: 0.35 });
  await expect(row.getByTestId('estado-trabajo')).toHaveText('Terminado', REFRESH);
  await expect(row).toContainText('1/1 tareas');
  await expect(row).toContainText('7/30');
  await expect(row).toContainText('0.35/5.00 €'); // presupuesto por defecto del formulario
  await page.close();
});

test('un comercial ve el estado pero no puede lanzar ni controlar investigaciones (ni por la API)', async ({ baseURL }) => {
  const page = await sales.newPage();
  await page.goto('/investigacion');
  await expect(page.getByText('Solo marketing y administración pueden lanzar investigaciones.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lanzar investigación' })).toHaveCount(0);
  await expect(page.getByTestId('trabajo').first().getByRole('button')).toHaveCount(0);
  const seg = ((await pool.query(`select id from segments where status = 'approved' limit 1`)).rows[0] as { id: string }).id;
  const before = Number(((await pool.query('select count(*) n from research_jobs')).rows[0] as { n: string }).n);
  const res = await page.request.post('/api/investigacion', { headers: { origin: baseURL! }, data: { segmentId: seg, ineCodes: ['41091'], sourceIds: ['osm'], budgetEur: 1 } });
  expect(res.status()).toBe(403);
  expect(Number(((await pool.query('select count(*) n from research_jobs')).rows[0] as { n: string }).n)).toBe(before);
  await page.close();
});

test('análisis de mercado: se pide desde segmentos, queda en cola y se actualiza solo cuando el worker lo termina', async () => {
  await pool.query(`update worker_requests set status = 'done' where status in ('queued','running')`);
  const page = await mkt.newPage();
  await page.goto('/segmentos');
  await page.getByRole('button', { name: 'Pedir análisis de mercado' }).click();
  await expect(page.getByTestId('analisis')).toContainText('en cola');
  await expect(page.getByRole('button', { name: 'Pedir análisis de mercado' })).toBeDisabled();
  const req = (await claimRequest(pool))!; // hace de worker
  await finishRequest(pool, req.id, { created: 2 });
  await expect(page.getByTestId('analisis')).toContainText('hecho', REFRESH);
  await expect(page.getByRole('button', { name: 'Pedir análisis de mercado' })).toBeEnabled(REFRESH);
  await page.close();
});
