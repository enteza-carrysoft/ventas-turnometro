import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { USERS } from './users.js';
import { appPool, seedCandidate, seedProspect, seedSegment } from './seed.js';

// Revisión con teclado (F1.9). Better Auth limita el acceso a 3 intentos cada 10 s: el spec anterior termina provocando ese límite a propósito,
// así que el primer acceso reintenta con espera, y después se reutilizan las sesiones.
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

let mkt: BrowserContext;
let sales: BrowserContext;
async function session(browser: Browser, u: { email: string; password: string }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await login(await ctx.newPage(), u);
  return ctx;
}
test.beforeAll(async ({ browser }) => {
  mkt = await session(browser, USERS.marketing);
  sales = await session(browser, USERS.sales);
});
test.afterAll(async () => {
  await mkt.close();
  await sales.close();
});

const one = async <T>(sql: string, args: unknown[] = []): Promise<T> => (await pool.query(sql, args)).rows[0] as T;
const status = async (id: string): Promise<string> => (await one<{ status: string }>('select status from prospects where id = $1', [id])).status;
const sideEffects = async (): Promise<number[]> => Promise.all(['contact_attempts', 'consents', 'compliance_decisions', 'suppressions'].map(async (t) => Number((await one<{ n: string }>(`select count(*) n from ${t}`)).n)));
/** Aísla la prueba: solo quedan pendientes las fichas que ella crea. */
const clearQueue = (): Promise<unknown> => pool.query(`update prospects set status = 'archived' where status in ('enriched','pending_review')`);

test('la ficha resalta los campos inferidos y muestra fuente, cita, puntuación y desglose', async () => {
  await clearQueue();
  const p = await seedProspect(pool);
  const page = await mkt.newPage();
  await page.goto(`/fichas/${p.id}`);
  await expect(page.getByTestId('titulo-ficha')).toHaveText(p.name);
  await expect(page.getByTestId('estado')).toHaveText('Pendiente de revisar');
  const inferred = page.getByTestId('evidencia-inferida').filter({ hasText: 'dos centros' });
  await expect(page.getByTestId('evidencia-inferida')).toHaveCount(2); // forma jurídica (de la ingesta) y sedes
  await expect(inferred).toContainText('Inferido');
  await expect(inferred).toHaveCSS('background-color', 'rgb(255, 244, 204)');
  await expect(inferred).toContainText('dos centros');
  await expect(page.getByTestId('puntuacion')).toContainText('/ 100');
  await expect(page.getByRole('link', { name: /^https:\/\/e2e-\d+\.es\/$/ }).first()).toBeVisible(); // la fuente de cada evidencia es un enlace
  await page.close();
});

test('la ficha de una candidata sin enriquecer dice que aún no tiene puntuación, en vez de enseñar «— / 100» y una tabla vacía', async () => {
  const c = await seedCandidate(pool);
  const page = await mkt.newPage();
  await page.goto(`/fichas/${c.id}`);
  await expect(page.getByTestId('titulo-ficha')).toHaveText(c.name);
  await expect(page.getByTestId('estado')).toHaveText('Candidata');
  await expect(page.getByTestId('puntuacion')).toContainText('Sin puntuar todavía');
  await expect(page.getByTestId('puntuacion')).not.toContainText('/ 100');
  await expect(page.getByRole('cell', { name: 'Atención simultánea' })).toHaveCount(0); // sin tabla de criterios
  await expect(page.getByRole('button', { name: 'Aprobar (A)' })).toBeDisabled(); // una candidata no se aprueba
  await page.close();
});

test('teclado: A aprueba y pasa a la siguiente; aprobar NO crea contactos, consentimientos ni decisiones', async () => {
  await clearQueue();
  const a = await seedProspect(pool);
  const b = await seedProspect(pool);
  const before = await sideEffects();
  const page = await mkt.newPage();
  await page.goto('/fichas');
  await expect(page.getByTestId('pendientes')).toContainText('2 fichas pendientes');
  await page.getByTestId('empezar').click();
  await expect(page).toHaveURL(new RegExp(`/fichas/(${a.id}|${b.id})$`));
  const first = page.url().split('/').pop()!;
  await page.keyboard.press('a');
  await expect.poll(() => status(first)).toBe('approved');
  await expect(page).toHaveURL(new RegExp(`/fichas/(${a.id}|${b.id})$`));
  expect(page.url()).not.toContain(first);
  expect(await sideEffects()).toEqual(before);
  await page.close();
});

test('teclado: D descarta con motivo y B bloquea con motivo; escribir en el campo no dispara atajos', async () => {
  await clearQueue();
  const a = await seedProspect(pool);
  const b = await seedProspect(pool);
  const page = await mkt.newPage();
  await page.goto(`/fichas/${a.id}`);
  await page.keyboard.press('d');
  const reason = page.getByLabel('Motivo');
  await expect(reason).toBeFocused();
  await reason.pressSequentially('No encaja: abre pocos días a la semana'); // teclas reales: contiene a, d, b y c, que no deben disparar atajos
  await page.keyboard.press('Enter');
  await expect.poll(() => status(a.id)).toBe('discarded');
  expect((await one<{ payload: { reason: string } }>(`select payload from audit_log where action = 'prospect.discarded' and entity_id = $1`, [a.id])).payload.reason).toBe('No encaja: abre pocos días a la semana');

  await page.goto(`/fichas/${b.id}`);
  await page.keyboard.press('b');
  await page.getByLabel('Motivo').fill('Pidió no ser contactada');
  await page.keyboard.press('Enter');
  await expect.poll(() => status(b.id)).toBe('blocked');
  expect((await one<{ block_reason: string }>('select block_reason from prospects where id = $1', [b.id])).block_reason).toContain('Pidió no ser contactada');
  await page.close();
});

test('teclado: C corrige un campo, queda como «observado» por revisión manual y en la auditoría', async () => {
  await clearQueue();
  const p = await seedProspect(pool);
  const page = await mkt.newPage();
  await page.goto(`/fichas/${p.id}`);
  await page.keyboard.press('c');
  await page.getByLabel('Campo').selectOption('sites_count');
  await page.getByLabel('Nuevo valor').fill('5');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await one<{ sites_count: number }>('select sites_count from prospects where id = $1', [p.id])).sites_count).toBe(5);
  await expect(page.getByTestId('evidencia').filter({ hasText: 'sites_count' }).first()).toBeVisible();
  expect((await one<{ n: string }>(`select count(*) n from audit_log where action = 'prospect.corrected' and entity_id = $1`, [p.id])).n).toBe('1');
  await page.close();
});

test('aprobación en bloque: se aprueba el lote salvo una muestra de calidad de al menos el 10 %', async () => {
  await clearQueue();
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push((await seedProspect(pool)).id);
  const page = await mkt.newPage();
  await page.goto('/fichas');
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: /Aprobar seleccionadas \(10\)/ }).click();
  await expect(page.getByTestId('resultado-bloque')).toContainText('9 aprobadas');
  await expect(page.getByTestId('resultado-bloque')).toContainText('1 reservada');
  const counts = (await pool.query(`select status, count(*)::int n from prospects where id = any($1::uuid[]) group by status`, [ids])).rows as Array<{ status: string; n: number }>;
  expect(Object.fromEntries(counts.map((c) => [c.status, c.n]))).toEqual({ approved: 9, enriched: 1 });
  await page.close();
});

test('exportación: solo fichas aprobadas y sin teléfonos ni emails; el autónomo sale sin nombre', async () => {
  await clearQueue();
  const co = await seedProspect(pool);
  const sole = await seedProspect(pool);
  const pending = await seedProspect(pool);
  await pool.query(`update prospects set legal_form = 'company', status = 'approved' where id = $1`, [co.id]);
  await pool.query(`update prospects set legal_form = 'sole_trader', status = 'approved' where id = $1`, [sole.id]);
  const page = await mkt.newPage();
  const res = await page.request.get('/api/fichas/export');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('attachment');
  const csv = await res.text();
  expect(csv).toContain(co.id);
  expect(csv).toContain(co.name);
  expect(csv).not.toContain(pending.id);
  expect(csv).not.toContain(sole.name);
  expect(csv.split('\r\n').slice(1).map((l) => l.split(',').slice(1).join(',')).join('\n')).not.toMatch(/\+34|955|@/);
  await page.close();
});

test('segmentos: marketing aprueba un borrador y el estado cambia', async () => {
  const approvedBefore = Number((await one<{ n: string }>(`select count(*) n from audit_log where action = 'segment.approved'`)).n);
  await seedSegment(pool, 'clinicas-e2e');
  const page = await mkt.newPage();
  await page.goto('/segmentos');
  const card = page.getByTestId('segmento').filter({ hasText: 'Segmento clinicas-e2e' });
  await expect(card.getByTestId('estado-segmento')).toContainText('Borrador');
  await card.getByRole('button', { name: 'Aprobar segmento' }).click();
  await expect(card.getByTestId('estado-segmento')).toContainText('Aprobado');
  expect(Number((await one<{ n: string }>(`select count(*) n from audit_log where action = 'segment.approved'`)).n)).toBe(approvedBefore + 1);
  await page.close();
});

test('un comercial ve la cola pero no puede revisar (ni por la API)', async ({ baseURL }) => {
  await clearQueue();
  const p = await seedProspect(pool);
  const page = await sales.newPage();
  await page.goto('/fichas');
  await expect(page.getByText('Solo marketing y administración pueden aprobar o descartar fichas.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Aprobar seleccionadas/ })).toHaveCount(0);
  await page.goto(`/fichas/${p.id}`);
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  expect(await status(p.id)).toBe('enriched');
  const res = await page.request.post(`/api/fichas/${p.id}/review`, { headers: { origin: baseURL! }, data: { action: 'approve' } });
  expect(res.status()).toBe(403);
  expect(await status(p.id)).toBe('enriched');
  expect((await page.request.get('/api/fichas/export')).status()).toBe(200); // lectura permitida
  await page.close();
});

test('sin sesión, la cola, la ficha y la exportación no están disponibles', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/fichas');
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/fichas/export')).status()).toBe(401);
  await ctx.close();
});
