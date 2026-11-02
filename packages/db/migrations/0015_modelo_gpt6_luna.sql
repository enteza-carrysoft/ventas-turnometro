-- Decisión del promotor (02/11/2026): el análisis de mercado y la investigación pasan de Opus 5.5 (4 $/20 $ por Mtok) a GPT-6 Luna por OpenRouter
-- (0,10 $/0,50 $ por Mtok). Comprobado ese día en https://openrouter.ai/api/v1/models: id `openai/gpt-6-luna`, contexto 1.050.000, admite
-- `response_format`/`structured_outputs`, `tools` y búsqueda web (0,01 $ por búsqueda). `content.generate` y `report.weekly` siguen en Opus.
-- Se cambian solo modelo y modelos admitidos: `requires`, `maxTokens` y lo de la 0011 (discovery solo `web_search`) se conservan.

update settings
   set value = value
     || jsonb_build_object('market.analyze', value->'market.analyze' || '{"models": {"openrouter": "openai/gpt-6-luna"}, "allowedModels": ["openai/gpt-6-luna"]}'::jsonb)
     || jsonb_build_object('market.size',    value->'market.size'    || '{"models": {"openrouter": "openai/gpt-6-luna"}, "allowedModels": ["openai/gpt-6-luna"]}'::jsonb)
     || jsonb_build_object('discovery',      value->'discovery'      || '{"models": {"openrouter": "openai/gpt-6-luna"}, "allowedModels": ["openai/gpt-6-luna"]}'::jsonb)
     || jsonb_build_object('enrich.extract', value->'enrich.extract' || '{"models": {"openrouter": "openai/gpt-6-luna"}, "allowedModels": ["openai/gpt-6-luna"]}'::jsonb),
       updated_by = 'migración 0015', updated_at = now()
 where key = 'llm_routes';

update settings
   set value = value || '{"openai/gpt-6-luna": {"input_per_mtok_usd": 0.1, "output_per_mtok_usd": 0.5, "cached_per_mtok_usd": 0.01}}'::jsonb,
       updated_by = 'migración 0015', updated_at = now()
 where key = 'llm_prices';

insert into audit_log (actor, action, entity, entity_id, payload) values
  ('migración 0015', 'settings.llm_routes', 'settings', 'llm_routes',
   '{"cambio":"market.analyze, market.size, discovery, enrich.extract → openai/gpt-6-luna","antes":"anthropic/claude-opus-5.5[1m]","motivo":"coste; decisión del promotor 02/11/2026"}');
