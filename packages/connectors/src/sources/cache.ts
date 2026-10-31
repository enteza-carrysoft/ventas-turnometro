/** Caché de respuestas de una fuente: no se repite una consulta idéntica dentro del plazo (cortesía con servidores públicos). */
export interface QueryCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

export function createMemoryCache(now: () => number = Date.now): QueryCache {
  const store = new Map<string, { value: unknown; expires: number }>();
  return {
    get: async (key) => {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now()) { store.delete(key); return undefined; }
      return hit.value;
    },
    set: async (key, value, ttlMs) => { store.set(key, { value, expires: now() + ttlMs }); },
  };
}
