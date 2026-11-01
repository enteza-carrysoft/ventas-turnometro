import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

const BASE = { DATABASE_URL: 'postgres://app@localhost/db' };

describe('readConfig (variables de entorno del worker)', () => {
  it('valores por defecto seguros: LLM desactivado, ciclo de 15 s, límites pequeños, User-Agent identificable', () => {
    expect(readConfig(BASE)).toEqual({
      databaseUrl: 'postgres://app@localhost/db', llmEnabled: false, discoverEnabled: false, openRouterApiKey: undefined, openRouterBaseUrl: undefined, osmEndpoint: undefined,
      intervalMs: 15_000, limits: { researchTasks: 20, enrich: 5, discover: 3 }, userAgent: 'TurnoSalaProspectorBot/1.0 (+https://turnosala.com/bot)', workerId: expect.stringMatching(/^worker-/),
    });
  });

  it('falta DATABASE_URL ⇒ error claro', () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
  });

  it('el LLM solo se activa con ENRICH_ENABLED=1 y exige OPENROUTER_API_KEY (nunca se activa a medias)', () => {
    expect(readConfig({ ...BASE, ENRICH_ENABLED: '0' }).llmEnabled).toBe(false);
    expect(readConfig({ ...BASE, ENRICH_ENABLED: 'true' }).llmEnabled).toBe(false); // solo el valor exacto «1» activa el gasto
    expect(() => readConfig({ ...BASE, ENRICH_ENABLED: '1' })).toThrow(/OPENROUTER_API_KEY/);
    const c = readConfig({ ...BASE, ENRICH_ENABLED: '1', OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: 'https://proxy.ejemplo.test/v1' });
    expect(c).toMatchObject({ llmEnabled: true, openRouterApiKey: 'k', openRouterBaseUrl: 'https://proxy.ejemplo.test/v1' });
  });

  it('la búsqueda de webs es otro gasto: solo con DISCOVER_ENABLED=1, y exige tener la IA encendida', () => {
    const ai = { ...BASE, ENRICH_ENABLED: '1', OPENROUTER_API_KEY: 'k' };
    expect(readConfig(ai).discoverEnabled).toBe(false);
    expect(readConfig({ ...ai, DISCOVER_ENABLED: '1' }).discoverEnabled).toBe(true);
    expect(readConfig({ ...ai, DISCOVER_ENABLED: 'si' }).discoverEnabled).toBe(false);
    expect(() => readConfig({ ...BASE, DISCOVER_ENABLED: '1' })).toThrow(/ENRICH_ENABLED/);
  });

  it('WORKER_DISCOVER_BATCH: entero entre 1 y 20', () => {
    expect(readConfig({ ...BASE, WORKER_DISCOVER_BATCH: '7' }).limits.discover).toBe(7);
    for (const bad of ['0', '21', 'x']) expect(() => readConfig({ ...BASE, WORKER_DISCOVER_BATCH: bad })).toThrow(/WORKER_DISCOVER_BATCH/);
  });

  it('la clave sin ENRICH_ENABLED no activa nada', () => {
    expect(readConfig({ ...BASE, OPENROUTER_API_KEY: 'k' })).toMatchObject({ llmEnabled: false });
  });

  it('intervalos y límites se leen como enteros positivos; un valor absurdo es un error, no un valor por defecto silencioso', () => {
    const c = readConfig({ ...BASE, WORKER_INTERVAL_MS: '2000', WORKER_RESEARCH_TASKS: '3', WORKER_ENRICH_BATCH: '8', CRAWLER_USER_AGENT: 'MiBot/2', WORKER_ID: 'w-7' });
    expect(c).toMatchObject({ intervalMs: 2000, limits: { researchTasks: 3, enrich: 8 }, userAgent: 'MiBot/2', workerId: 'w-7' });
    for (const bad of ['0', '-1', 'abc', '1.5']) expect(() => readConfig({ ...BASE, WORKER_ENRICH_BATCH: bad })).toThrow(/WORKER_ENRICH_BATCH/);
    expect(() => readConfig({ ...BASE, WORKER_ENRICH_BATCH: '1000' })).toThrow(/WORKER_ENRICH_BATCH/); // tope duro: no se enriquecen 1000 a la vez
  });
});
