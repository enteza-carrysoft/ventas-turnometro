import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createGateway } from './gateway.js';
import type { LlmConfig, LlmStore, UsageRow } from './types.js';
import type { Capability, LlmProvider, ProviderRequest, ProviderResponse } from './providers/types.js';

const OPUS = 'anthropic/claude-opus-5.5[1m]';
const AT = new Date('2026-11-10T10:00:00Z');

function config(over: Partial<LlmConfig> = {}): LlmConfig {
  const route = { provider: 'openrouter' as const, models: { openrouter: OPUS, anthropic: 'claude-opus-5-5' }, allowedModels: [OPUS, 'anthropic/claude-opus-5.5'],
    requires: ['structured_output' as const], maxTokens: 8000, effort: 'medium' as const, zdr: false };
  return {
    routes: { 'enrich.extract': route, 'market.analyze': route, 'market.size': route, discovery: { ...route, requires: ['web_search' as const] },
      'content.generate': route, 'report.weekly': route, 'inbound.classify': { ...route, provider: 'anthropic' as const, models: { anthropic: 'claude-haiku-5-5' }, allowedModels: ['claude-haiku-5-5'] },
      'voice.dialog': { ...route, provider: 'anthropic' as const, models: { anthropic: 'claude-haiku-5-5' }, allowedModels: ['claude-haiku-5-5'], requires: ['strict_tools' as const] } },
    enabledProviders: ['openrouter'], dpaConfirmed: {}, appMode: 'sandbox', dailyBudgetEur: 5, usdToEur: 1,
    prices: { [OPUS]: { input_per_mtok_usd: 4, output_per_mtok_usd: 20, cached_per_mtok_usd: 0.2 } },
    ...over,
  };
}

function memoryStore(cfg: LlmConfig, spent = 0) {
  const rows: UsageRow[] = [];
  const store: LlmStore = { loadConfig: async () => cfg, spentTodayEur: async () => spent, recordUsage: async (r) => { rows.push(r); } };
  return { store, rows };
}

function fakeProvider(id: 'openrouter' | 'anthropic', respond: Partial<ProviderResponse> = {}, caps: Capability[] = ['structured_output', 'prompt_cache']) {
  const call = vi.fn(async (req: ProviderRequest): Promise<ProviderResponse> => ({
    status: 'ok', text: '{"nombre":"Clínica Sol"}', servedModel: req.model, fallbackUsed: false,
    usage: { input: 1000, output: 200, cachedInput: 0, costUsd: 0.5 }, ...respond,
  }));
  return { provider: { id, capabilities: new Set(caps), call } satisfies LlmProvider, call };
}

const schema = { name: 'ficha', zod: z.object({ nombre: z.string() }) };
const ask = { messages: [{ role: 'user' as const, content: 'PROMPT-SECRETO-DE-LA-WEB' }], schema };

describe('pasarela de LLM: camino feliz (REQ-LLM-01/04)', () => {
  it('ejecuta la ruta, valida la salida con Zod y registra proveedor, modelos, tokens y coste', async () => {
    const { store, rows } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter');
    const gw = createGateway({ store, providers: { openrouter: provider }, clock: () => AT });
    const r = await gw.run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'ok', data: { nombre: 'Clínica Sol' }, provider: 'openrouter', requestedModel: OPUS, servedModel: OPUS, fallbackUsed: false });
    expect(call.mock.calls[0]![0]).toMatchObject({ model: OPUS, maxTokens: 8000, zdr: false, jsonSchema: { name: 'ficha' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: 'enrich.extract', provider: 'openrouter', requestedModel: OPUS, servedModel: OPUS, inputTokens: 1000, outputTokens: 200, costSource: 'provider', status: 'ok' });
    expect(rows[0]!.costEur).toBeCloseTo(0.5, 6);
  });

  it('el JSON Schema enviado al proveedor sale del esquema Zod', async () => {
    const { store } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter');
    await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    const sent = call.mock.calls[0]![0].jsonSchema!.schema as { type?: string; properties?: Record<string, unknown> };
    expect(sent.type).toBe('object');
    expect(Object.keys(sent.properties ?? {})).toEqual(['nombre']);
  });

  it('el aviso de coste: en euros, con el cambio configurado', async () => {
    const { store, rows } = memoryStore(config({ usdToEur: 0.9 }));
    const { provider } = fakeProvider('openrouter');
    await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(rows[0]!.costEur).toBeCloseTo(0.45, 6);
  });

  it('sin coste del proveedor, lo calcula con la tabla de precios; sin tabla, queda marcado como desconocido', async () => {
    const a = memoryStore(config());
    await createGateway({ store: a.store, providers: { openrouter: fakeProvider('openrouter', { usage: { input: 1_000_000, output: 100_000, cachedInput: 0, costUsd: null } }).provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(a.rows[0]).toMatchObject({ costSource: 'table' });
    expect(a.rows[0]!.costEur).toBeCloseTo(4 + 2, 6); // 1M entrada a 4 $ + 0,1M salida a 20 $
    const b = memoryStore(config({ prices: {} }));
    await createGateway({ store: b.store, providers: { openrouter: fakeProvider('openrouter', { usage: { input: 10, output: 10, cachedInput: 0, costUsd: null } }).provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(b.rows[0]).toMatchObject({ costSource: 'unknown', costEur: 0 });
  });

  it('los mensajes (contenido de las webs) NO se guardan en el registro de uso', async () => {
    const { store, rows } = memoryStore(config());
    await createGateway({ store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(JSON.stringify(rows)).not.toContain('PROMPT-SECRETO-DE-LA-WEB');
    expect(JSON.stringify(rows)).not.toContain('Clínica Sol');
  });
});

describe('pasarela: proveedores cerrados por defecto (constitución P5.6, REQ-LLM-03)', () => {
  it('un proveedor no habilitado no recibe nada', async () => {
    const { store, rows } = memoryStore(config({ enabledProviders: [] }));
    const { provider, call } = fakeProvider('openrouter');
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'provider_disabled' });
    expect(call).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('en production sin contrato de encargo confirmado → dpa_missing; con él, funciona; en sandbox no se exige', async () => {
    const run = async (cfg: LlmConfig) => {
      const { provider, call } = fakeProvider('openrouter');
      const r = await createGateway({ store: memoryStore(cfg).store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
      return { r, called: call.mock.calls.length };
    };
    expect(await run(config({ appMode: 'production' }))).toMatchObject({ r: { status: 'error', reason: 'dpa_missing' }, called: 0 });
    expect((await run(config({ appMode: 'production', dpaConfirmed: { openrouter: true } }))).r.status).toBe('ok');
    expect((await run(config({ appMode: 'sandbox' }))).r.status).toBe('ok');
  });

  it('la clave dpaConfirmed de otro proveedor no vale', async () => {
    const r = await createGateway({ store: memoryStore(config({ appMode: 'production', dpaConfirmed: { anthropic: true } })).store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r.reason).toBe('dpa_missing');
  });
});

describe('pasarela: no degrada capacidades en silencio (REQ-LLM-02)', () => {
  it('una ruta que exige una capacidad que el proveedor no tiene se niega (y no llama)', async () => {
    const { store } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter');
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('discovery', { messages: [{ role: 'user', content: 'x' }] });
    expect(r).toMatchObject({ status: 'error', reason: 'capability_unsupported' });
    expect(call).not.toHaveBeenCalled();
  });

  it('pedir salida estructurada en una ruta cuyo proveedor no la tiene se niega aunque la ruta no la declare', async () => {
    const { store } = memoryStore(config());
    const { provider } = fakeProvider('openrouter', {}, ['prompt_cache']);
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r.reason).toBe('capability_unsupported');
  });

  it('proveedor sin adaptador (p. ej. anthropic aún no implementado) → provider_unavailable', async () => {
    const { store } = memoryStore(config({ enabledProviders: ['openrouter', 'anthropic'] }));
    const r = await createGateway({ store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('voice.dialog', { messages: [{ role: 'user', content: 'x' }] });
    expect(r).toMatchObject({ status: 'error', reason: 'provider_unavailable' });
  });

  it('una ruta sin modelo para su proveedor → no_model_for_provider', async () => {
    const cfg = config();
    cfg.routes['enrich.extract'] = { ...cfg.routes['enrich.extract'], models: { anthropic: 'claude-opus-5-5' } };
    const r = await createGateway({ store: memoryStore(cfg).store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r.reason).toBe('no_model_for_provider');
  });
});

describe('pasarela: intercambiabilidad (ADR-005)', () => {
  it('cambiar `provider` en la configuración de la ruta basta: otro adaptador, su propio id de modelo, sin tocar código', async () => {
    const cfg = config({ enabledProviders: ['openrouter', 'anthropic'] });
    cfg.routes['enrich.extract'] = { ...cfg.routes['enrich.extract'], provider: 'anthropic', allowedModels: ['claude-opus-5-5'] };
    const a = fakeProvider('anthropic');
    const o = fakeProvider('openrouter');
    const r = await createGateway({ store: memoryStore(cfg).store, providers: { openrouter: o.provider, anthropic: a.provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'ok', provider: 'anthropic', requestedModel: 'claude-opus-5-5' });
    expect(a.call).toHaveBeenCalledOnce();
    expect(o.call).not.toHaveBeenCalled();
  });
});

describe('pasarela: presupuesto diario (P6, REQ-OBS-01)', () => {
  it('con el presupuesto agotado no llama al proveedor ni registra uso', async () => {
    const { store, rows } = memoryStore(config(), 5);
    const { provider, call } = fakeProvider('openrouter');
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'budget' });
    expect(call).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
  it('justo por debajo del tope, sí se ejecuta', async () => {
    const r = await createGateway({ store: memoryStore(config(), 4.99).store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r.status).toBe('ok');
  });
});

describe('pasarela: modelo servido y salida del modelo (REQ-LLM-04 CA2/CA3, P5.4)', () => {
  it('un modelo servido FUERA de la lista permitida descarta la respuesta, pero el coste se registra', async () => {
    const { store, rows } = memoryStore(config());
    const { provider } = fakeProvider('openrouter', { servedModel: 'otro/modelo-no-aprobado', fallbackUsed: true });
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'model_not_allowed', servedModel: 'otro/modelo-no-aprobado' });
    expect(r.data).toBeUndefined();
    expect(rows[0]).toMatchObject({ servedModel: 'otro/modelo-no-aprobado', status: 'error', fallbackUsed: true });
  });

  it('un fallback a un modelo de la lista permitida se acepta y queda anotado', async () => {
    const { store, rows } = memoryStore(config());
    const { provider } = fakeProvider('openrouter', { servedModel: 'anthropic/claude-opus-5.5', fallbackUsed: true });
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'ok', fallbackUsed: true });
    expect(rows[0]!.fallbackUsed).toBe(true);
  });

  it('sin modelo servido informado no se puede verificar → error', async () => {
    const r = await createGateway({ store: memoryStore(config()).store, providers: { openrouter: fakeProvider('openrouter', { servedModel: null }).provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'model_not_allowed' });
  });

  it('rechazo y truncado se propagan como tales, sin datos, y su coste se registra', async () => {
    for (const status of ['refused', 'truncated'] as const) {
      const { store, rows } = memoryStore(config());
      const { provider } = fakeProvider('openrouter', { status, text: undefined });
      const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
      expect(r.status).toBe(status);
      expect(r.data).toBeUndefined();
      expect(rows[0]!.status).toBe(status);
    }
  });

  it('salida que no es JSON o no cumple el esquema → invalid_output (nunca «ok»)', async () => {
    for (const text of ['esto no es JSON', '{"otra":"cosa"}', '{"nombre":123}']) {
      const r = await createGateway({ store: memoryStore(config()).store, providers: { openrouter: fakeProvider('openrouter', { text }).provider }, clock: () => AT }).run('enrich.extract', ask);
      expect(r, text).toMatchObject({ status: 'error', reason: 'invalid_output' });
      expect(r.data).toBeUndefined();
    }
  });

  it('sin esquema devuelve el texto', async () => {
    const r = await createGateway({ store: memoryStore(config()).store, providers: { openrouter: fakeProvider('openrouter', { text: 'hola' }).provider }, clock: () => AT }).run('enrich.extract', { messages: [{ role: 'user', content: 'x' }] });
    expect(r).toMatchObject({ status: 'ok', text: 'hola' });
  });

  it('un error del proveedor se propaga con su motivo y no lanza excepción', async () => {
    const { provider } = fakeProvider('openrouter', { status: 'error', reason: 'rate_limited', text: undefined });
    const r = await createGateway({ store: memoryStore(config()).store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'rate_limited' });
  });

  it('si el adaptador lanza una excepción, la pasarela devuelve error y no la propaga', async () => {
    const provider: LlmProvider = { id: 'openrouter', capabilities: new Set(['structured_output']), call: async () => { throw new Error('boom con datos'); } };
    const r = await createGateway({ store: memoryStore(config()).store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'provider_exception' });
    expect(JSON.stringify(r)).not.toContain('boom');
  });
});

describe('pasarela: el gasto nunca se escapa del registro (P6.3)', () => {
  it('si no se puede registrar el uso, falla cerrado: error y sin datos', async () => {
    const store: LlmStore = { loadConfig: async () => config(), spentTodayEur: async () => 0, recordUsage: async () => { throw new Error('BD caída'); } };
    const r = await createGateway({ store, providers: { openrouter: fakeProvider('openrouter').provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'usage_not_recorded' });
    expect(r.data).toBeUndefined();
  });

  it('si no se puede leer la configuración, falla cerrado: no_config y no se llama a nadie', async () => {
    const store: LlmStore = { loadConfig: async () => { throw new Error('falta un ajuste'); }, spentTodayEur: async () => 0, recordUsage: async () => undefined };
    const { provider, call } = fakeProvider('openrouter');
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'no_config' });
    expect(call).not.toHaveBeenCalled();
  });

  it('si no se puede leer el gasto del día, también falla cerrado (budget_unknown)', async () => {
    const store: LlmStore = { loadConfig: async () => config(), spentTodayEur: async () => { throw new Error('BD caída'); }, recordUsage: async () => undefined };
    const { provider, call } = fakeProvider('openrouter');
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', ask);
    expect(r).toMatchObject({ status: 'error', reason: 'budget_unknown' });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('pasarela de LLM: búsqueda web (ruta discovery)', () => {
  const askSearch = { messages: [{ role: 'user' as const, content: 'Busca la web de Clínica Sol, Sevilla' }], webSearch: { maxResults: 5, maxUses: 2, excludedDomains: ['linkedin.com'] } };
  const withSearch = (): Capability[] => ['structured_output', 'prompt_cache', 'web_search'];

  it('pasa la búsqueda al proveedor y devuelve texto, citas y nº de búsquedas; todo queda registrado', async () => {
    const { store, rows } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter', { text: 'Su web es https://clinicasol.es', citations: [{ url: 'https://clinicasol.es/', title: 'Clínica Sol' }], webSearches: 2 }, withSearch());
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('discovery', askSearch);
    expect(r).toMatchObject({ status: 'ok', text: 'Su web es https://clinicasol.es', citations: [{ url: 'https://clinicasol.es/', title: 'Clínica Sol' }], webSearches: 2 });
    expect(call.mock.calls[0]![0].webSearch).toEqual({ maxResults: 5, maxUses: 2, excludedDomains: ['linkedin.com'] });
    expect(rows[0]).toMatchObject({ route: 'discovery', webSearches: 2 });
  });

  it('si el proveedor no ofrece búsqueda web, la petición con búsqueda se niega y no se llama a nadie (no se degrada en silencio)', async () => {
    const { store, rows } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter', {}, ['structured_output', 'prompt_cache']);
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('enrich.extract', askSearch);
    expect(r).toMatchObject({ status: 'error', reason: 'capability_unsupported' });
    expect(call).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it('sin búsqueda en la petición no se envía ninguna al proveedor y no hay citas', async () => {
    const { store } = memoryStore(config());
    const { provider, call } = fakeProvider('openrouter', { text: 'ok' }, withSearch());
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('discovery', { messages: [{ role: 'user', content: 'hola' }] });
    expect(call.mock.calls[0]![0].webSearch).toBeUndefined();
    expect(r.citations ?? []).toEqual([]);
  });

  it('una búsqueda que termina mal registra igualmente su coste y sus búsquedas (se facturan aunque falle la salida)', async () => {
    const { store, rows } = memoryStore(config());
    const { provider } = fakeProvider('openrouter', { status: 'truncated', text: undefined, webSearches: 3, usage: { input: 10, output: 10, cachedInput: 0, costUsd: 0.04 } }, withSearch());
    const r = await createGateway({ store, providers: { openrouter: provider }, clock: () => AT }).run('discovery', askSearch);
    expect(r.status).toBe('truncated');
    expect(rows[0]).toMatchObject({ status: 'truncated', webSearches: 3, costEur: 0.04 });
  });
});
