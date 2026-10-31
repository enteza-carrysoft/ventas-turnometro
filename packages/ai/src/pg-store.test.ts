import { createTestDb, type TestDb } from '@turnosala/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createGateway } from './gateway.js';
import { createPgLlmStore } from './pg-store.js';
import { createOpenRouterProvider } from './providers/openrouter.js';
import { completion, startTestServer, type TestServer } from './test-server.js';
import { ROUTE_IDS, type UsageRow } from './types.js';

let t: TestDb;
let srv: TestServer | undefined;
const AT = new Date('2026-11-10T10:00:00Z'); // martes 11:00 Madrid
const OPUS = 'anthropic/claude-opus-5.5[1m]';

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);
afterAll(async () => {
  await t.drop();
});
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  route: 'enrich.extract', provider: 'openrouter', requestedModel: OPUS, servedModel: OPUS, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0,
  costEur: 1, costSource: 'provider', status: 'ok', reason: null, fallbackUsed: false, requestId: 'gen-1', at: AT, ...over,
});

describe('configuración sembrada por la migración 0006 (ADR-005, D-15, D-03)', () => {
  it('es válida y completa: las 8 rutas, OpenRouter habilitado por defecto y sin contrato de encargo confirmado', async () => {
    const cfg = await createPgLlmStore(t.app).loadConfig();
    expect(Object.keys(cfg.routes).sort()).toEqual([...ROUTE_IDS].sort());
    expect(cfg).toMatchObject({ enabledProviders: ['openrouter'], dpaConfirmed: {}, appMode: 'sandbox', dailyBudgetEur: 5, usdToEur: 1 });
  });

  it('las rutas de Anthropic (Haiku) están sembradas pero bloqueadas: su proveedor no está habilitado', async () => {
    const cfg = await createPgLlmStore(t.app).loadConfig();
    for (const r of ['inbound.classify', 'voice.dialog'] as const) {
      expect(cfg.routes[r].provider).toBe('anthropic');
      expect(cfg.enabledProviders).not.toContain('anthropic');
    }
  });

  it('el modelo de las rutas de investigación es Opus 5.5 con su id de OpenRouter y el servido sin sufijo también se admite', async () => {
    const cfg = await createPgLlmStore(t.app).loadConfig();
    expect(cfg.routes['enrich.extract'].models.openrouter).toBe(OPUS);
    expect(cfg.routes['enrich.extract'].allowedModels).toContain('anthropic/claude-opus-5.5');
    expect(cfg.prices[OPUS]).toEqual({ input_per_mtok_usd: 4, output_per_mtok_usd: 20, cached_per_mtok_usd: 0.2 });
  });

  it('un ajuste ausente o con forma inválida hace fallar la carga (falla cerrado)', async () => {
    const saved = (await t.app.query(`select key, value from settings where key in ('llm_routes', 'usd_to_eur')`)).rows as Array<{ key: string; value: unknown }>;
    try {
      await t.app.query(`update settings set value = '"no-es-un-objeto"' where key = 'llm_routes'`);
      await expect(createPgLlmStore(t.app).loadConfig()).rejects.toThrow();
      await t.app.query(`update settings set value = '{"market.analyze": {"provider": "inventado"}}' where key = 'llm_routes'`);
      await expect(createPgLlmStore(t.app).loadConfig()).rejects.toThrow();
      await t.migrator.query(`delete from settings where key = 'usd_to_eur'`);
      await expect(createPgLlmStore(t.app).loadConfig()).rejects.toThrow();
    } finally {
      // restaura la semilla: los tests siguientes dependen de ella
      for (const r of saved) await t.migrator.query(`insert into settings (key, value, updated_by) values ($1, $2, 'test') on conflict (key) do update set value = excluded.value`, [r.key, JSON.stringify(r.value)]);
    }
  });
});

describe('registro de uso y gasto del día (P6.3, REQ-OBS-01)', () => {
  it('recordUsage guarda en usage_costs con proveedor «llm», ruta, coste y el detalle SIN contenido de prompts', async () => {
    const store = createPgLlmStore(t.app);
    await store.recordUsage(row());
    const r = (await t.app.query(`select provider, route, cost_eur, units, created_at from usage_costs where provider = 'llm'`)).rows[0];
    expect(r).toMatchObject({ provider: 'llm', route: 'enrich.extract' });
    expect(Number(r.cost_eur)).toBe(1);
    expect(r.units).toMatchObject({ provider: 'openrouter', requestedModel: OPUS, servedModel: OPUS, inputTokens: 100, costSource: 'provider', status: 'ok', fallbackUsed: false });
    expect(new Date(r.created_at).toISOString()).toBe(AT.toISOString());
  });

  it('spentTodayEur suma solo el día local de Madrid y solo el proveedor «llm»', async () => {
    const store = createPgLlmStore(t.app);
    await store.recordUsage(row({ costEur: 2, at: new Date('2026-11-10T09:00:00Z') }));            // hoy
    await store.recordUsage(row({ costEur: 100, at: new Date('2026-11-09T22:59:00Z') }));           // 23:59 de ayer en Madrid
    await store.recordUsage(row({ costEur: 100, at: new Date('2026-11-10T23:00:00Z') }));           // 00:00 de mañana en Madrid
    await t.app.query(`insert into usage_costs (provider, route, units, cost_eur, created_at) values ('voice', 'x', '{}', 100, '2026-11-10T09:00:00Z')`);
    expect(await store.spentTodayEur(AT)).toBeCloseTo(3, 6); // 1 (primera prueba) + 2
  });
});

describe('recorrido completo: pasarela + Postgres + adaptador + servidor simulado', () => {
  it('ejecuta la ruta, registra el gasto real y se detiene al agotar el presupuesto', async () => {
    srv = await startTestServer(() => ({ json: completion({ content: '{"nombre":"Clínica Sol"}', cost: 4.5 }) }));
    const store = createPgLlmStore(t.app);
    await t.app.query(`delete from usage_costs`);
    const gw = createGateway({ store, providers: { openrouter: createOpenRouterProvider({ apiKey: 'sk-or-test', baseUrl: srv.baseUrl }) }, clock: () => AT });
    const ask = { messages: [{ role: 'user' as const, content: 'x' }], schema: { name: 'ficha', zod: z.object({ nombre: z.string() }) } };

    const first = await gw.run('enrich.extract', ask);
    expect(first).toMatchObject({ status: 'ok', data: { nombre: 'Clínica Sol' }, servedModel: OPUS });
    expect(await store.spentTodayEur(AT)).toBeCloseTo(4.5, 6);
    expect(srv.requests[0]!.body.provider).toMatchObject({ data_collection: 'deny', require_parameters: true });

    const second = await gw.run('enrich.extract', ask); // 4,5 < 5: aún cabe
    expect(second.status).toBe('ok');
    const third = await gw.run('enrich.extract', ask);  // 9 ≥ 5: tope diario
    expect(third).toMatchObject({ status: 'error', reason: 'budget' });
    expect(srv.requests).toHaveLength(2); // la tercera no llegó al proveedor
  });

  it('si un admin deshabilita el proveedor, la siguiente llamada se rechaza sin tocar la red', async () => {
    srv = await startTestServer(() => ({ json: completion() }));
    await t.app.query(`update settings set value = '[]' where key = 'llm_enabled_providers'`);
    const gw = createGateway({ store: createPgLlmStore(t.app), providers: { openrouter: createOpenRouterProvider({ apiKey: 'sk-or-test', baseUrl: srv.baseUrl }) }, clock: () => AT });
    expect(await gw.run('enrich.extract', { messages: [{ role: 'user', content: 'x' }] })).toMatchObject({ status: 'error', reason: 'provider_disabled' });
    expect(srv.requests).toHaveLength(0);
  });
});
