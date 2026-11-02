// Entorno LOCAL de pruebas en Docker (sandbox). Ver deploy/LEEME-LOCAL.md.
//
//   PowerShell:
//     npm run local:init -- tu@correo.es "Tu Nombre" --demo-territories --demo-segment   # primera vez: lo deja todo listo (tarda unos minutos)
//     npm run local:up | local:down | local:logs | local:status
//     npm run local:maps-on | local:maps-off   (activa/desactiva Google Maps como fuente; necesita GOOGLE_MAPS_API_KEY)
//     npm run local:ai-on | local:ai-off                                       # enciende/apaga el gasto en IA (necesita OPENROUTER_API_KEY)
//     npm run local:reset -- --yes                                             # BORRA la base de datos local
//
// Los secretos se generan en deploy/.env.local (fuera de git) y NUNCA se imprimen.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  approveProductFactsByEmail, approveSegment, bootstrapDatabase, saveSegmentDrafts, ensureExtensions, getWorkerHeartbeat, importTerritories, migrate, seedProductFactsDraft, setSourceActive, urlFor,
} from '@turnosala/db';
import pg from 'pg';
import { createAuth } from '../apps/web/src/lib/auth.js';
import { createUser } from '../apps/web/src/lib/users.js';
import { ensureKeys, getKey, randomSecret, setKey, type KeySpec } from './lib/envfile.js';

const ENV_FILE = 'deploy/.env.local';
const COMPOSE_FILE = 'deploy/docker-compose.local.yml';
const DB_PORT = 5434;
const WEB_URL = 'http://localhost:3000';
const DB_NAME = 'prospector';
/** Segmento de PRUEBA, definido a mano (no lo propone el modelo): sirve para validar las fuentes antes de tener clave de IA. */
const DEMO_SEGMENT = {
  slug: 'prueba-salud-y-opticas', name: 'Salud y ópticas (segmento de prueba)', status: 'draft' as const,
  definition: {
    vertical: 'salud', description: 'Segmento de prueba definido a mano para validar fuentes y flujo; no es una propuesta del modelo.', signals: ['varias_consultas', 'sala_espera'],
    decisionMakerRole: 'Gerencia', message: 'Prueba', bestDemo: 'Prueba', fit: { score: 0, provenance: 'inferred' as const, reasoning: 'Segmento de prueba creado a mano por el script local; sin estimación real.' },
    sourceUrls: ['https://turnosala.com'], osmFilters: [['amenity', 'dentist'], ['healthcare', 'dentist'], ['shop', 'optician'], ['healthcare', 'physiotherapist']] as Array<[string, string]>,
  },
};
const DEMO_TERRITORIES = 'ine_code,name,province,region,population\n41091,Sevilla,Sevilla,Andalucía,\n41038,Dos Hermanas,Sevilla,Andalucía,\n41004,Alcalá de Guadaíra,Sevilla,Andalucía,\n';

const SPEC: KeySpec[] = [
  { key: 'POSTGRES_PASSWORD', generate: randomSecret },
  { key: 'MIGRATOR_PASSWORD', generate: randomSecret },
  { key: 'APP_PASSWORD', generate: randomSecret },
  { key: 'BETTER_AUTH_SECRET', generate: randomSecret },
  { key: 'ADMIN_PASSWORD', generate: randomSecret, comment: 'Contraseña del administrador local (solo para entrar en http://localhost:3000)' },
  { key: 'OPENROUTER_API_KEY', value: '', comment: 'Pon aquí tu clave de OpenRouter (la creas tú; nunca la pegues en el chat) y ejecuta «npm run local:ai-on»' },
  { key: 'OPENROUTER_BASE_URL', value: '' },
  { key: 'ENRICH_ENABLED', value: '0', comment: 'Gasto en IA: 0 = apagado. Lo cambia «npm run local:ai-on / local:ai-off»' },
  { key: 'GOOGLE_MAPS_API_KEY', value: '', comment: 'Clave de Google Maps (Places API New), restringida a esa API y con cuota diaria. La creas tú; nunca la pegues en el chat. Luego «npm run local:maps-on»' },
  { key: 'DISCOVER_ENABLED', value: '0', comment: 'Búsqueda de la web de las candidatas sin web (gasto aparte, presupuesto de búsqueda). Lo cambia local:ai-on' },
];

const say = (m: string): void => console.log(m);
function die(m: string): never {
  console.error(m);
  process.exit(1);
}

function readEnv(): string {
  return existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
}
function need(text: string, key: string): string {
  const v = getKey(text, key);
  if (!v) die(`Falta ${key} en ${ENV_FILE}. Ejecuta «npm run local:init» primero.`);
  return v;
}

function compose(args: string[], opts: { capture?: boolean } = {}): { status: number; out: string } {
  const r = spawnSync('docker', ['compose', '-p', 'turnosala-local', '-f', COMPOSE_FILE, '--env-file', ENV_FILE, ...args], {
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8',
  });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function assertDocker(): void {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (r.status !== 0) die('Docker no está en marcha. Abre Docker Desktop y vuelve a intentarlo.');
}

async function waitFor(what: string, probe: () => Promise<boolean>, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  die(`${what} no respondió en ${seconds} s. Mira los registros con «npm run local:logs».`);
}

const dbUrl = (user: string, password: string, db: string): string => `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${DB_PORT}/${db}`;

async function setupDatabase(env: string): Promise<void> {
  const adminUrl = dbUrl('postgres', need(env, 'POSTGRES_PASSWORD'), 'postgres');
  const boot = new pg.Client({ connectionString: adminUrl });
  await waitFor('Postgres', async () => { const c = new pg.Client({ connectionString: adminUrl }); await c.connect(); await c.end(); return true; }, 60);
  await boot.connect();
  await bootstrapDatabase(boot, { dbName: DB_NAME, migratorPassword: need(env, 'MIGRATOR_PASSWORD'), appPassword: need(env, 'APP_PASSWORD') });
  await boot.end();
  const onDb = new pg.Client({ connectionString: urlFor(adminUrl, 'postgres', need(env, 'POSTGRES_PASSWORD'), DB_NAME) });
  await onDb.connect();
  await ensureExtensions(onDb);
  await onDb.end();
  const migrator = new pg.Pool({ connectionString: dbUrl('migrator', need(env, 'MIGRATOR_PASSWORD'), DB_NAME) });
  const applied = await migrate(migrator);
  await migrator.end();
  say(applied.length ? `  Migraciones aplicadas: ${applied.length}.` : '  Base de datos al día.');
}

/** Aplica las migraciones pendientes (repetible): al actualizar el código la base debe quedar al día antes de arrancar el worker. */
async function migrateOnly(env: string): Promise<void> {
  const migrator = new pg.Pool({ connectionString: dbUrl('migrator', need(env, 'MIGRATOR_PASSWORD'), DB_NAME) });
  try {
    const applied = await migrate(migrator);
    if (applied.length) say(`  Migraciones aplicadas: ${applied.join(', ')}`);
  } finally {
    await migrator.end();
  }
}

async function up(): Promise<void> {
  assertDocker();
  if (compose(['up', '-d', 'postgres']).status !== 0) die('No se pudo arrancar PostgreSQL.');
  const env = readEnv();
  const adminUrl = dbUrl('postgres', need(env, 'POSTGRES_PASSWORD'), 'postgres');
  await waitFor('Postgres', async () => { const c = new pg.Client({ connectionString: adminUrl }); await c.connect(); await c.end(); return true; }, 60);
  await migrateOnly(env);
  if (compose(['up', '-d', '--build']).status !== 0) die('No se pudo arrancar.');
  say(`En marcha: ${WEB_URL}`);
}

async function seedDemoSegment(pool: pg.Pool): Promise<void> {
  const product = (await pool.query("select id from products where slug = 'turnosala'")).rows[0] as { id: string };
  await saveSegmentDrafts(pool, product.id, [DEMO_SEGMENT], { actor: 'script:local-init' });
  const seg = (await pool.query('select id, status from segments where product_id = $1 and slug = $2', [product.id, DEMO_SEGMENT.slug])).rows[0] as { id: string; status: string };
  if (seg.status === 'draft') await approveSegment(pool, seg.id, { userId: 'script:local-init', role: 'admin' });
  say('  Segmento de prueba aprobado (definido a mano, no del modelo).');
}

async function seedData(env: string, email: string, name: string, territoriesCsv: string | null, demoSegment: boolean): Promise<void> {
  const pool = new pg.Pool({ connectionString: dbUrl('app', need(env, 'APP_PASSWORD'), DB_NAME) });
  try {
    await seedProductFactsDraft(pool, { actor: 'script:local-init' });
    const exists = (await pool.query('select 1 from "user" where lower(email) = lower($1)', [email])).rowCount;
    if (!exists) {
      const auth = createAuth(pool, { secret: need(env, 'BETTER_AUTH_SECRET'), baseURL: WEB_URL });
      await createUser(auth, pool, { email, name, password: need(env, 'ADMIN_PASSWORD'), role: 'admin' });
      say(`  Administrador creado: ${email}`);
    } else say(`  El usuario ${email} ya existía.`);
    const facts = await approveProductFactsByEmail(pool, { email });
    say(facts.alreadyApproved ? '  product_facts v1 ya estaba aprobado.' : '  product_facts v1 aprobado (el contenido lo aprobó el promotor el 31/10/2026).');
    const src = await setSourceActive(pool, 'osm', true, { actor: 'script:local-init', reason: 'pruebas locales en sandbox (OSM aprobada para el piloto de F1)' });
    say(src.ok && src.changed ? '  Fuente OpenStreetMap activada.' : '  Fuente OpenStreetMap ya activa.');
    if (territoriesCsv) {
      const t = await importTerritories(pool, territoriesCsv);
      if (t.errors.length) die(`No se importaron los municipios:\n${t.errors.map((e) => `  línea ${e.line}: ${e.message}`).join('\n')}`);
      say(`  Municipios cargados: ${t.imported}.`);
    }
    if (demoSegment) await seedDemoSegment(pool);
  } finally {
    await pool.end();
  }
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function init(): Promise<void> {
  const [email, name] = process.argv.slice(3).filter((a) => !a.startsWith('--') && a !== option('territories'));
  if (!email || !name || !email.includes('@')) die('Uso: npm run local:init -- <correo-del-admin> "<Nombre>" [--demo-territories | --territories <archivo.csv>] [--demo-segment]');
  assertDocker();
  const { text, created } = ensureKeys(readEnv(), SPEC);
  writeFileSync(ENV_FILE, text);
  say(created.length ? `1/5 ${ENV_FILE}: ${created.length} valores generados (no se muestran).` : `1/5 ${ENV_FILE} ya estaba completo.`);
  say('2/5 Arrancando PostgreSQL…');
  if (compose(['up', '-d', 'postgres']).status !== 0) die('No se pudo arrancar PostgreSQL.');
  say('3/5 Preparando la base de datos…');
  await setupDatabase(text);
  say('4/5 Datos iniciales…');
  const csvPath = option('territories');
  const csv = csvPath ? readFileSync(csvPath, 'utf8') : flag('demo-territories') ? DEMO_TERRITORIES : null;
  await seedData(text, email, name, csv, flag('demo-segment'));
  say('5/5 Construyendo y arrancando web y worker (la primera vez tarda unos minutos)…');
  if (compose(['up', '-d', '--build', 'web', 'worker']).status !== 0) die('No se pudo construir o arrancar la aplicación.');
  await waitFor('La web', async () => (await fetch(`${WEB_URL}/login`)).ok, 120);
  summary(email, csv !== null);
}

function summary(email: string, hasTerritories: boolean): void {
  say(`\nListo. Abre ${WEB_URL} y entra con ${email}.`);
  say(`La contraseña está en ${ENV_FILE} (ADMIN_PASSWORD). Modo SANDBOX: no se puede contactar con nadie.`);
  if (!hasTerritories) say('Aún no hay municipios: usa --demo-territories o --territories <archivo.csv> (CSV del INE) con «npm run local:init».');
  say('La IA está APAGADA. Para encenderla: pon OPENROUTER_API_KEY en el archivo anterior, ejecuta «npm run llm:check» y después «npm run local:ai-on».');
}

async function status(): Promise<void> {
  const env = readEnv();
  say(compose(['ps'], { capture: true }).out.trim() || 'Nada en marcha.');
  const webOk = await fetch(`${WEB_URL}/login`).then((r) => r.ok).catch(() => false);
  say(`Web: ${webOk ? 'responde' : 'NO responde'} (${WEB_URL})`);
  say(`Clave de OpenRouter: ${getKey(env, 'OPENROUTER_API_KEY') ? 'puesta' : 'sin poner'} · IA: ${getKey(env, 'ENRICH_ENABLED') === '1' ? 'ENCENDIDA' : 'apagada'} · Búsqueda de webs: ${getKey(env, 'DISCOVER_ENABLED') === '1' ? 'ENCENDIDA' : 'apagada'} · Clave de Google Maps: ${getKey(env, 'GOOGLE_MAPS_API_KEY') ? 'puesta' : 'sin poner'}`);
  const appPw = getKey(env, 'APP_PASSWORD');
  if (!appPw) return;
  const pool = new pg.Pool({ connectionString: dbUrl('app', appPw, DB_NAME) });
  try {
    const hb = await getWorkerHeartbeat(pool);
    say(`Worker: ${hb && Date.now() - hb.at.getTime() < 90_000 ? 'en marcha' : 'sin señal'}`);
    const c = (await pool.query(`select (select count(*) from prospects)::int as fichas, (select count(*) from prospects where status = 'approved')::int as aprobadas, (select count(*) from research_jobs)::int as trabajos`)).rows[0] as Record<string, number>;
    say(`Fichas: ${c.fichas} (aprobadas: ${c.aprobadas}) · Trabajos de investigación: ${c.trabajos}`);
  } catch {
    say('Base de datos: no accesible.');
  } finally {
    await pool.end();
  }
}

function setAi(on: boolean): void {
  const env = readEnv();
  if (on && !getKey(env, 'OPENROUTER_API_KEY')) die(`Primero pon tu clave: edita ${ENV_FILE} y escribe OPENROUTER_API_KEY=<tu clave>. Nunca la pegues en el chat.`);
  const search = on && !flag('no-search');
  writeFileSync(ENV_FILE, setKey(setKey(env, 'ENRICH_ENABLED', on ? '1' : '0'), 'DISCOVER_ENABLED', search ? '1' : '0'));
  if (compose(['up', '-d', 'worker']).status !== 0) die('No se pudo reiniciar el worker.');
  say(on ? `IA ENCENDIDA: el worker enriquece candidatas y atiende análisis de mercado (gasto real; tope diario 5 €). ${search ? 'Además busca la web de las candidatas sin web (tope diario 2 €).' : 'Búsqueda de webs apagada (--no-search).'}` : 'IA y búsqueda de webs apagadas.');
}

async function setMaps(on: boolean): Promise<void> {
  const env = readEnv();
  if (on && !getKey(env, 'GOOGLE_MAPS_API_KEY')) die(`Primero pon tu clave: edita ${ENV_FILE} y escribe GOOGLE_MAPS_API_KEY=<tu clave>. Nunca la pegues en el chat.`);
  const pool = new pg.Pool({ connectionString: dbUrl('app', need(env, 'APP_PASSWORD'), DB_NAME) });
  try {
    const r = await setSourceActive(pool, 'google_places', on, {
      actor: 'script:local-maps', reason: on ? 'pruebas locales en sandbox: Google Maps como fuente (decisión del promotor 02/11/2026)' : 'desactivada desde el script local',
    });
    if (!r.ok) die('No se pudo cambiar la fuente google_places.');
  } finally {
    await pool.end();
  }
  if (compose(['up', '-d', 'worker']).status !== 0) die('No se pudo reiniciar el worker.');
  say(on
    ? 'Google Maps ACTIVADO como fuente: aparece en «Fuentes activas» al lanzar una investigación (gasto real: unos 0,035 € por búsqueda de hasta 20 negocios; 1.000 búsquedas gratis al mes).'
    : 'Google Maps desactivado como fuente.');
}

function reset(): void {
  if (!flag('yes')) die('Esto BORRA la base de datos local (fichas, trabajos, usuarios). Repite con --yes si estás seguro.');
  compose(['down', '-v']);
  say('Entorno local borrado. Vuelve a ejecutar «npm run local:init».');
}

const commands: Record<string, () => void | Promise<void>> = {
  init,
  up,
  down: () => { compose(['down']); },
  logs: () => { compose(['logs', '-f', '--tail', '100', ...process.argv.slice(3).filter((a) => !a.startsWith('--'))]); },
  status,
  'ai-on': () => setAi(true),
  'ai-off': () => setAi(false),
  'maps-on': () => setMaps(true),
  'maps-off': () => setMaps(false),
  reset,
};

const cmd = commands[process.argv[2] ?? ''];
if (!cmd) die(`Uso: npm run local:<${Object.keys(commands).join('|')}>`);
await cmd();
