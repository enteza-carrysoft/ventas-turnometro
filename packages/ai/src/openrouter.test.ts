import { afterEach, describe, expect, it } from 'vitest';
import { createOpenRouterProvider } from './providers/openrouter.js';
import { completion, startTestServer, type Reply, type TestServer } from './test-server.js';

let srv: TestServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const KEY = 'sk-or-test-NO-ES-UNA-CLAVE-REAL-0123456789';
const MODEL = 'anthropic/claude-opus-5.5[1m]';
const noSleep = async (): Promise<void> => undefined;

async function setup(handler: (n: number) => Reply, over: Partial<Parameters<typeof createOpenRouterProvider>[0]> = {}) {
  srv = await startTestServer((_req, n) => handler(n));
  const provider = createOpenRouterProvider({ apiKey: KEY, baseUrl: srv.baseUrl, sleep: noSleep, ...over });
  return { provider, srv };
}

const req = (over: Record<string, unknown> = {}) => ({
  model: MODEL, system: 'Eres un extractor.', messages: [{ role: 'user' as const, content: 'Texto de la web' }], maxTokens: 4000, zdr: false, ...over,
});

describe('adaptador openrouter: la petición (privacidad y seguridad, REQ-LLM-02/03)', () => {
  it('declara sus capacidades: salida estructurada, caché de prompt y búsqueda web; NO Batch', async () => {
    const { provider } = await setup(() => ({ json: completion() }));
    expect([...provider.capabilities].sort()).toEqual(['prompt_cache', 'structured_output', 'web_search']);
  });

  it('envía clave en Authorization, cabecera de aplicación y siempre require_parameters y data_collection:deny', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req());
    const r = srv.requests[0]!;
    expect(r.method).toBe('POST');
    expect(r.path).toBe('/api/v1/chat/completions');
    expect(r.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(String(r.headers['x-title'])).toMatch(/TurnoSala/);
    expect(r.body.model).toBe(MODEL);
    expect(r.body.provider).toMatchObject({ require_parameters: true, data_collection: 'deny' });
    expect((r.body.provider as Record<string, unknown>).zdr).toBeUndefined();
  });

  it('con zdr:true lo pide en provider', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req({ zdr: true }));
    expect(srv.requests[0]!.body.provider).toMatchObject({ zdr: true, data_collection: 'deny', require_parameters: true });
  });

  it('NO envía temperature, top_p, budget_tokens ni reasoning (parámetros no verificados con el modelo real)', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req());
    for (const k of ['temperature', 'top_p', 'top_k', 'budget_tokens', 'reasoning', 'include_reasoning']) {
      expect(srv.requests[0]!.body, k).not.toHaveProperty(k);
    }
  });

  it('pone el system primero, respeta max_tokens y usa la salida estructurada estricta cuando hay esquema', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req({ jsonSchema: { name: 'ficha', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } } }));
    const b = srv.requests[0]!.body;
    expect((b.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['system', 'user']);
    expect(b.max_tokens).toBe(4000);
    expect(b.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'ficha', strict: true, schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } },
    });
  });

  it('solo envía la lista de modelos de reserva cuando hay más de uno permitido', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req());
    expect(srv.requests[0]!.body).not.toHaveProperty('models');
    await provider.call(req({ fallbackModels: ['otro/modelo'] }));
    expect(srv.requests[1]!.body.models).toEqual([MODEL, 'otro/modelo']);
  });

  it('exige clave de API: sin ella no se construye el adaptador (nunca hay valores por defecto para secretos)', () => {
    expect(() => createOpenRouterProvider({ apiKey: '' })).toThrow(/OPENROUTER_API_KEY|clave/i);
  });
});

describe('adaptador openrouter: la respuesta', () => {
  it('ok: devuelve texto, modelo servido, tokens, tokens en caché y coste del proveedor', async () => {
    const { provider } = await setup(() => ({ json: completion({ content: '{"x":1}', cost: 0.05, prompt: 2000, completion: 300, cached: 500 }) }));
    const r = await provider.call(req());
    expect(r).toMatchObject({ status: 'ok', text: '{"x":1}', servedModel: MODEL, fallbackUsed: false });
    expect(r.usage).toEqual({ input: 2000, output: 300, cachedInput: 500, costUsd: 0.05 });
  });

  it('sin coste informado: costUsd es null (la pasarela lo calcula con la tabla)', async () => {
    const { provider } = await setup(() => ({ json: completion({ cost: null }) }));
    expect((await provider.call(req())).usage.costUsd).toBeNull();
  });

  it('modelo servido distinto del pedido ⇒ fallbackUsed', async () => {
    const { provider } = await setup(() => ({ json: completion({ model: 'otro/modelo' }) }));
    expect(await provider.call(req())).toMatchObject({ servedModel: 'otro/modelo', fallbackUsed: true });
  });

  it('finish_reason se normaliza: length→truncated, content_filter→refused, error→error', async () => {
    for (const [finish, status] of [['length', 'truncated'], ['content_filter', 'refused'], ['error', 'error']] as const) {
      const { provider } = await setup(() => ({ json: completion({ finish }) }));
      const r = await provider.call(req());
      expect(r.status, finish).toBe(status);
      expect(r.text, `${finish}: el contenido no se lee si no es ok`).toBeUndefined();
      await srv?.close();
    }
  });

  it('un error dentro de un HTTP 200 se detecta (OpenRouter puede fallar a mitad de generación)', async () => {
    const { provider } = await setup(() => ({ json: completion({ error: { code: 502, message: 'el proveedor falló' } }) }));
    expect(await provider.call(req())).toMatchObject({ status: 'error', reason: 'provider_error' });
  });

  it('contenido vacío con parada normal ⇒ error, no «ok»', async () => {
    const { provider } = await setup(() => ({ json: completion({ content: '' }) }));
    expect(await provider.call(req())).toMatchObject({ status: 'error', reason: 'empty_response' });
  });
});

describe('adaptador openrouter: errores HTTP y reintentos (máx. 3 intentos)', () => {
  const err = (code: number, extra: Record<string, string> = {}): Reply => ({ status: code, headers: extra, json: { error: { code, message: `fallo ${code}` } } });

  it('402 → credits, 401 → auth, 400 → bad_request, 403 → forbidden: sin reintentos', async () => {
    for (const [code, reason] of [[402, 'credits'], [401, 'auth'], [400, 'bad_request'], [403, 'forbidden']] as const) {
      const { provider, srv } = await setup(() => err(code));
      expect(await provider.call(req())).toMatchObject({ status: 'error', reason });
      expect(srv.requests, `${code} no se reintenta`).toHaveLength(1);
      await srv.close();
    }
  });

  it('429 se reintenta respetando Retry-After y acaba bien al tercer intento', async () => {
    const sleeps: number[] = [];
    const { provider, srv } = await setup((n) => (n < 3 ? err(429, { 'retry-after': '2' }) : { json: completion() }), { sleep: async (ms) => { sleeps.push(ms); } });
    expect((await provider.call(req())).status).toBe('ok');
    expect(srv.requests).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('503 y 502 se reintentan con espera exponencial y, agotados los 3 intentos, devuelven error', async () => {
    const sleeps: number[] = [];
    const { provider, srv } = await setup(() => err(503), { sleep: async (ms) => { sleeps.push(ms); } });
    expect(await provider.call(req())).toMatchObject({ status: 'error', reason: 'unavailable' });
    expect(srv.requests).toHaveLength(3);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it('la clave de API nunca aparece en el resultado ni en el motivo del error', async () => {
    const { provider } = await setup(() => err(401));
    const r = await provider.call(req());
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('una caída de red devuelve error network (sin lanzar) tras reintentar', async () => {
    const provider = createOpenRouterProvider({ apiKey: KEY, baseUrl: 'http://127.0.0.1:1/api/v1', sleep: noSleep });
    expect(await provider.call(req())).toMatchObject({ status: 'error', reason: 'network' });
  });
});

describe('adaptador openrouter: búsqueda web (herramienta de servidor, documentación consultada el 01/11/2026)', () => {
  const search = { maxResults: 5, maxUses: 2, excludedDomains: ['linkedin.com', 'facebook.com'] };

  it('sin búsqueda no envía ninguna herramienta', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req());
    expect(srv.requests[0]!.body).not.toHaveProperty('tools');
  });

  it('con búsqueda añade la herramienta openrouter:web_search con sus límites y dominios excluidos, y mantiene la privacidad', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req({ webSearch: search }));
    const b = srv.requests[0]!.body;
    expect(b.tools).toEqual([{ type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: 2, excluded_domains: ['linkedin.com', 'facebook.com'] } }]);
    expect(b.provider).toMatchObject({ require_parameters: true, data_collection: 'deny' });
  });

  it('con motor indicado lo envía como parameters.engine (con «exa» OpenRouter devuelve citas url_citation y respeta max_uses)', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req({ webSearch: { maxResults: 3, maxUses: 1, engine: 'exa' } }));
    expect((srv.requests[0]!.body.tools as Array<{ parameters: Record<string, unknown> }>)[0]!.parameters).toEqual({ engine: 'exa', max_results: 3, max_uses: 1 });
  });

  it('sin dominios excluidos no envía la lista vacía', async () => {
    const { provider, srv } = await setup(() => ({ json: completion() }));
    await provider.call(req({ webSearch: { maxResults: 3, maxUses: 1 } }));
    expect((srv.requests[0]!.body.tools as Array<{ parameters: Record<string, unknown> }>)[0]!.parameters).toEqual({ max_results: 3, max_uses: 1 });
  });

  it('devuelve las citas (url_citation) sin duplicados y solo http(s), y el número de búsquedas que informa el proveedor', async () => {
    const annotations = [
      { type: 'url_citation', url_citation: { url: 'https://clinicasol.es/', title: 'Clínica Sol', content: 'x', start_index: 0, end_index: 5 } },
      { type: 'url_citation', url_citation: { url: 'https://clinicasol.es/', title: 'otra vez' } },
      { type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'malo' } },
      { type: 'url_citation', url_citation: { title: 'sin url' } },
      { type: 'otra_cosa', url_citation: { url: 'https://no.es/' } },
      { type: 'url_citation', url_citation: { url: 'http://otra.es/contacto', title: 'Otra' } },
    ];
    const { provider } = await setup(() => ({ json: completion({ annotations, searches: 2 }) }));
    const r = await provider.call(req({ webSearch: search }));
    expect(r.status).toBe('ok');
    expect(r.citations).toEqual([{ url: 'https://clinicasol.es/', title: 'Clínica Sol' }, { url: 'http://otra.es/contacto', title: 'Otra' }]);
    expect(r.webSearches).toBe(2);
  });

  it('sin anotaciones ni contadores: lista vacía y 0 búsquedas (no se inventa nada)', async () => {
    const { provider } = await setup(() => ({ json: completion() }));
    const r = await provider.call(req({ webSearch: search }));
    expect(r.citations ?? []).toEqual([]);
    expect(r.webSearches ?? 0).toBe(0);
  });
});
