import { dayStartMadrid } from '@turnosala/core';
import type pg from 'pg';
import { z } from 'zod';
import { PROVIDER_IDS } from './providers/types.js';
import { priceSchema, ROUTE_IDS, routeConfigSchema, type LlmConfig, type LlmStore, type UsageRow } from './types.js';

const KEYS = ['llm_routes', 'llm_enabled_providers', 'llm_dpa_confirmed', 'llm_prices', 'usd_to_eur', 'app_mode', 'budget_daily_eur'] as const;

const providerId = z.enum(PROVIDER_IDS);
const settingsSchema = z.object({
  llm_routes: z.object(Object.fromEntries(ROUTE_IDS.map((id) => [id, routeConfigSchema])) as Record<(typeof ROUTE_IDS)[number], typeof routeConfigSchema>),
  llm_enabled_providers: z.array(providerId),
  llm_dpa_confirmed: z.object({ openrouter: z.boolean().optional(), anthropic: z.boolean().optional() }),
  llm_prices: z.record(z.string(), priceSchema),
  usd_to_eur: z.number().positive(),
  app_mode: z.enum(['sandbox', 'production']),
  budget_daily_eur: z.object({ llm: z.number().nonnegative() }).passthrough(),
});

const DAY_PLUS = 26 * 3_600_000; // desde el inicio de un día local, +26 h siempre cae dentro del día siguiente (los días miden 23–25 h)

/**
 * Configuración y gasto de la pasarela sobre Postgres. Cualquier ajuste ausente o con forma inválida lanza (la pasarela
 * lo convierte en `no_config` y no llama a ningún proveedor).
 */
export function createPgLlmStore(pool: pg.Pool): LlmStore {
  return {
    async loadConfig(): Promise<LlmConfig> {
      const rows = (await pool.query('select key, value from settings where key = any($1::text[])', [KEYS])).rows as Array<{ key: string; value: unknown }>;
      const s = settingsSchema.parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
      return {
        routes: s.llm_routes, enabledProviders: s.llm_enabled_providers, dpaConfirmed: s.llm_dpa_confirmed, appMode: s.app_mode,
        dailyBudgetEur: s.budget_daily_eur.llm, usdToEur: s.usd_to_eur, prices: s.llm_prices,
      };
    },

    async spentTodayEur(at: Date): Promise<number> {
      const start = dayStartMadrid(at);
      const end = dayStartMadrid(new Date(start.getTime() + DAY_PLUS));
      const r = await pool.query(
        `select coalesce(sum(cost_eur), 0) as spent from usage_costs where provider = 'llm' and created_at >= $1 and created_at < $2`,
        [start, end],
      );
      return Number((r.rows[0] as { spent: string }).spent);
    },

    async recordUsage(u: UsageRow): Promise<void> {
      // Solo metadatos de uso: nunca el contenido de los mensajes ni de la respuesta (minimización de datos).
      const units = {
        provider: u.provider, requestedModel: u.requestedModel, servedModel: u.servedModel, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
        cachedInputTokens: u.cachedInputTokens, webSearches: u.webSearches, costSource: u.costSource, status: u.status, reason: u.reason, fallbackUsed: u.fallbackUsed, requestId: u.requestId,
      };
      await pool.query(`insert into usage_costs (provider, route, units, cost_eur, created_at) values ('llm', $1, $2, $3, $4)`, [u.route, JSON.stringify(units), u.costEur, u.at]);
    },
  };
}
