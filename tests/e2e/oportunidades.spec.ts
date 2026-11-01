import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { appPool, seedCandidate } from './seed.js';
import { USERS } from './users.js';

// Pipeline (F2.4): lista y tablero, filtros, acciones con teclado/arrastre y permisos por rol.
const pool = appPool();
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

let sales: BrowserContext;
let admin: BrowserContext;
let mkt: BrowserContext;
const names: Record<string, string> = {};
const ids: Record<string, string> = {};

async function seedDeal(key: string, owner: string | null, stage = 'interested'): Promise<void> {
  const p = await seedCandidate(pool);
  await pool.query(`update prospects set status = 'approved' where id = $1`, [p.id]);
  const id = `018f3333-0000-7000-8000-${String(Object.keys(ids).length + 1).padStart(12, '0')}`;
  await pool.query(`insert into deals (id, prospect_id, stage_id, owner_user_id, est_value_eur, created_by) values ($1,$2,$3,$4,1000,'e2e')`, [id, p.id, stage, owner]);
  names[key] = p.name;
  ids[key] = id;
}
const stageOf = async (key: string): Promise<string> => ((await pool.query('select stage_id from deals where id = $1', [ids[key]])).rows[0] as { stage_id: string }).stage_id;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000); // tres inicios de sesión espaciados por el límite de Better Auth
  const salesId = ((await pool.query(`select id from "user" where email = $1`, [USERS.sales.email])).rows[0] as { id: string }).id;
  await seedDeal('mia1', salesId);
  await seedDeal('mia2', salesId, 'trial');
  await seedDeal('ajena', null);
  await pool.query(`update deals set owner_user_id = (select id from "user" where email = $1) where id = $2`, [USERS.admin.email, ids.ajena]);
  await seedDeal('libre', null);
  sales = await browser.newContext();
  await login(await sales.newPage(), USERS.sales);
  await new Promise((r) => setTimeout(r, 4000));
  admin = await browser.newContext();
  await login(await admin.newPage(), USERS.admin);
  await new Promise((r) => setTimeout(r, 4000));
  mkt = await browser.newContext();
  await login(await mkt.newPage(), USERS.marketing);
});
test.afterAll(async () => { await pool.end(); });

test('lista: «Mis oportunidades» filtra por comercial; los totales por etapa se ven; el filtro de etapa acota', async () => {
  const page = await sales.newPage();
  await page.goto('/oportunidades?vista=lista&owner=me');
  await expect(page.getByText(names.mia1!)).toBeVisible();
  await expect(page.getByText(names.mia2!)).toBeVisible();
  await expect(page.getByText(names.ajena!)).toHaveCount(0);
  await expect(page.getByTestId('totales')).toContainText('Interesado');
  await page.goto('/oportunidades?vista=lista&owner=me&stage=trial');
  await expect(page.getByText(names.mia2!)).toBeVisible();
  await expect(page.getByText(names.mia1!)).toHaveCount(0);
  await page.close();
});

test('el comercial mueve su oportunidad con el selector (sin arrastrar), queda en la BD y en la auditoría con su autor', async () => {
  const page = await sales.newPage();
  await page.goto('/oportunidades?vista=lista&owner=me');
  const row = page.getByTestId('fila-oportunidad').filter({ hasText: names.mia1! });
  await row.getByLabel(/Mover .* a otra etapa/).selectOption('demo_booked');
  await row.getByRole('button', { name: 'Mover' }).click();
  await expect.poll(() => stageOf('mia1')).toBe('demo_booked'); // «Demo reservada» ya sale como opción del selector: se espera al cambio real
  await expect(row.locator('strong').first()).toContainText('Demo reservada');
  const a = (await pool.query(`select actor from audit_log where action = 'deal.stage_changed' and entity_id = $1`, [ids.mia1])).rows as Array<{ actor: string }>;
  expect(a).toHaveLength(1);
  expect(a[0]!.actor).not.toBe('system:unsubscribe');
  await page.close();
});

test('tablero: arrastrar una tarjeta a otra columna la mueve', async () => {
  const page = await sales.newPage();
  await page.goto('/oportunidades?vista=tablero&owner=me');
  const card = page.getByTestId('tarjeta').filter({ hasText: names.mia2! });
  await card.dragTo(page.locator('section[data-stage="demo_held"]'));
  await expect.poll(() => stageOf('mia2')).toBe('demo_held');
  await page.close();
});

test('el comercial no ve controles en la oportunidad ajena y la API se lo niega (403); la sin asignar sí puede tomarla', async () => {
  const page = await sales.newPage();
  await page.goto('/oportunidades?vista=lista');
  const ajena = page.getByTestId('fila-oportunidad').filter({ hasText: names.ajena! });
  await expect(ajena).toBeVisible();
  await expect(ajena.getByRole('button', { name: 'Mover' })).toHaveCount(0);
  const denied = await page.request.post(`/api/oportunidades/${ids.ajena}/mover`, { data: { stage: 'trial' }, headers: { origin: new URL(page.url()).origin } });
  expect(denied.status()).toBe(403);
  expect(await stageOf('ajena')).toBe('interested');
  const libre = page.getByTestId('fila-oportunidad').filter({ hasText: names.libre! });
  await libre.getByLabel(/Mover .* a otra etapa/).selectOption('demo_booked');
  await libre.getByRole('button', { name: 'Mover' }).click();
  await expect.poll(() => stageOf('libre')).toBe('demo_booked');
  const owner = (await pool.query('select owner_user_id from deals where id = $1', [ids.libre])).rows[0] as { owner_user_id: string | null };
  expect(owner.owner_user_id).not.toBeNull();
  await page.close();
});

test('perder exige motivo; con «Oposición / no contactar» la ficha queda bloqueada', async () => {
  const page = await sales.newPage();
  await page.goto('/oportunidades?vista=lista&owner=me');
  const row = page.getByTestId('fila-oportunidad').filter({ hasText: names.mia2! });
  await row.getByRole('button', { name: 'Perder…' }).click();
  await row.getByLabel('Motivo de la pérdida').selectOption({ label: 'Oposición / no contactar' });
  await row.getByRole('button', { name: 'Confirmar pérdida' }).click();
  await expect(page.getByText(names.mia2!)).toHaveCount(0); // sale de las abiertas
  expect(await stageOf('mia2')).toBe('lost');
  const st = (await pool.query(`select p.status, p.block_reason from prospects p join deals d on d.prospect_id = p.id where d.id = $1`, [ids.mia2])).rows[0] as { status: string; block_reason: string };
  expect(st).toMatchObject({ status: 'blocked', block_reason: 'opposition' });
  await page.close();
});

test('solo el admin ve «Ganar…» y, al confirmar, la oportunidad queda ganada y la ficha como cliente', async () => {
  const sp = await sales.newPage();
  await sp.goto('/oportunidades?vista=lista&owner=me');
  await expect(sp.getByRole('button', { name: 'Ganar…' })).toHaveCount(0);
  await sp.close();
  const page = await admin.newPage();
  await page.goto('/oportunidades?vista=lista');
  const row = page.getByTestId('fila-oportunidad').filter({ hasText: names.ajena! });
  await row.getByRole('button', { name: 'Ganar…' }).click();
  await row.getByRole('button', { name: 'Confirmar: marcar como ganada' }).click();
  await expect.poll(() => stageOf('ajena')).toBe('won');
  const c = await pool.query(`select 1 from turnosala_customers where org_id like 'manual:%' and name = $1`, [names.ajena]);
  expect(c.rowCount).toBe(1);
  await page.close();
});

test('marketing ve el pipeline pero sin ningún control de edición; las cerradas se ven con el filtro de estado', async () => {
  const page = await mkt.newPage();
  await page.goto('/oportunidades?vista=lista');
  await expect(page.getByTestId('fila-oportunidad').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mover' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Perder…' })).toHaveCount(0);
  await page.goto('/oportunidades?vista=lista&estado=closed');
  await expect(page.getByText(names.mia2!)).toBeVisible();
  await expect(page.getByText(names.ajena!)).toBeVisible();
  await page.close();
});

test('el panel de inicio muestra los contadores de oportunidades abiertas (todas y mías)', async () => {
  const page = await sales.newPage();
  await page.goto('/');
  await expect(page.getByTestId('abiertas-todas')).toHaveText(/^\d+$/);
  const mine = Number(await page.getByTestId('abiertas-mias').innerText());
  const expected = Number(((await pool.query(`select count(*) n from deals d join "user" u on u.id = d.owner_user_id where u.email = $1 and d.closed_at is null`, [USERS.sales.email])).rows[0] as { n: string }).n);
  expect(mine).toBe(expected);
  await page.close();
});

test('móvil a 400 px: la lista se usa sin desplazamiento horizontal de la página', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, storageState: await sales.storageState() });
  const page = await ctx.newPage();
  await page.goto('/oportunidades?vista=lista');
  await expect(page.getByTestId('fila-oportunidad').first()).toBeVisible();
  const overflow = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth');
  expect(overflow as number).toBeLessThanOrEqual(1);
  await ctx.close();
});
