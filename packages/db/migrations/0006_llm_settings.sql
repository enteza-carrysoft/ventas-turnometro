-- F1.1 — configuración de la pasarela de LLM (ADR-005, D-15). Valores seguros por defecto; editables por un admin (audit_log).
--  · Proveedor por defecto: openrouter (decisión D-15). Habilitado, pero en `production` exige contrato de encargo (llm_dpa_confirmed).
--  · `anthropic` directo NO está habilitado ni implementado: lo usan `inbound.classify` y `voice.dialog` (Haiku), que quedan
--    bloqueadas hasta que se implemente y habilite (F5–F6).
--  · `effort` es solo una intención: no se envía al proveedor hasta verificarlo con el modelo real.
--  · `usd_to_eur` = 1: sobrestima el gasto mientras no haya un cambio configurado (lado seguro para el presupuesto).
insert into settings (key, value, updated_by) values
  ('llm_enabled_providers', '["openrouter"]', 'system'),
  ('llm_dpa_confirmed', '{}', 'system'),
  ('usd_to_eur', '1', 'system'),
  ('llm_prices', '{
    "anthropic/claude-opus-5.5[1m]": {"input_per_mtok_usd": 4, "output_per_mtok_usd": 20, "cached_per_mtok_usd": 0.2},
    "anthropic/claude-opus-5.5":     {"input_per_mtok_usd": 4, "output_per_mtok_usd": 20, "cached_per_mtok_usd": 0.2},
    "claude-opus-5-5":               {"input_per_mtok_usd": 4, "output_per_mtok_usd": 20, "cached_per_mtok_usd": 0.2},
    "claude-haiku-5-5":              {"input_per_mtok_usd": 0.1, "output_per_mtok_usd": 0.5, "cached_per_mtok_usd": 0.01}
  }', 'system'),
  ('llm_routes', '{
    "market.analyze":   {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["structured_output"], "maxTokens": 16000, "effort": "high",   "zdr": false},
    "market.size":      {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["structured_output"], "maxTokens": 8000,  "effort": "low",    "zdr": false},
    "discovery":        {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["web_search", "structured_output"], "maxTokens": 8000, "effort": "low", "zdr": false},
    "enrich.extract":   {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["structured_output"], "maxTokens": 8000,  "effort": "medium", "zdr": false},
    "content.generate": {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["structured_output"], "maxTokens": 8000,  "effort": "medium", "zdr": false},
    "report.weekly":    {"provider": "openrouter", "models": {"openrouter": "anthropic/claude-opus-5.5[1m]", "anthropic": "claude-opus-5-5"}, "allowedModels": ["anthropic/claude-opus-5.5[1m]", "anthropic/claude-opus-5.5"], "requires": ["structured_output"], "maxTokens": 16000, "effort": "high",   "zdr": false},
    "inbound.classify": {"provider": "anthropic",  "models": {"anthropic": "claude-haiku-5-5"}, "allowedModels": ["claude-haiku-5-5"], "requires": ["structured_output"], "maxTokens": 1000, "effort": "low", "zdr": false},
    "voice.dialog":     {"provider": "anthropic",  "models": {"anthropic": "claude-haiku-5-5"}, "allowedModels": ["claude-haiku-5-5"], "requires": ["strict_tools"],      "maxTokens": 600,  "effort": "low", "zdr": false}
  }', 'system')
on conflict (key) do nothing;

insert into audit_log (actor, action, entity, entity_id, payload) values
  ('system', 'settings.llm_seed', 'settings', 'llm_routes', '{"decision":"ADR-005/D-15","default_provider":"openrouter","enabled":["openrouter"],"dpa_confirmed":{}}');
