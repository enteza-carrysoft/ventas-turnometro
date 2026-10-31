// Configuración del proceso del worker, solo desde variables de entorno (constitución P5.1: los secretos nunca en el repositorio).
// El gasto en LLM está APAGADO por defecto: solo `ENRICH_ENABLED=1` (valor exacto) lo enciende y entonces exige la clave.

export interface WorkerConfig {
  databaseUrl: string;
  llmEnabled: boolean;
  openRouterApiKey: string | undefined;
  openRouterBaseUrl: string | undefined;
  osmEndpoint: string | undefined;
  intervalMs: number;
  limits: { researchTasks: number; enrich: number };
  userAgent: string;
  workerId: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} debe ser un entero entre 1 y ${max} (valor: «${raw}»)`);
  return n;
}

export function readConfig(env: Env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta la variable de entorno DATABASE_URL');
  const llmEnabled = env.ENRICH_ENABLED === '1';
  if (llmEnabled && !env.OPENROUTER_API_KEY) throw new Error('ENRICH_ENABLED=1 exige OPENROUTER_API_KEY (variable de entorno)');
  return {
    databaseUrl, llmEnabled,
    openRouterApiKey: llmEnabled ? env.OPENROUTER_API_KEY : undefined,
    openRouterBaseUrl: llmEnabled ? env.OPENROUTER_BASE_URL || undefined : undefined,
    osmEndpoint: env.OSM_ENDPOINT || undefined,
    intervalMs: positiveInt(env, 'WORKER_INTERVAL_MS', 15_000, 3_600_000),
    limits: { researchTasks: positiveInt(env, 'WORKER_RESEARCH_TASKS', 20, 500), enrich: positiveInt(env, 'WORKER_ENRICH_BATCH', 5, 50) },
    userAgent: env.CRAWLER_USER_AGENT || 'TurnoSalaProspectorBot/1.0 (+https://turnosala.com/bot)',
    workerId: env.WORKER_ID || `worker-${process.pid}`,
  };
}
