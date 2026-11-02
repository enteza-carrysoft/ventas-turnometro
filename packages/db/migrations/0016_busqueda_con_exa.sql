-- Comprobado el 02/11/2026 con llamadas reales: con GPT-6 Luna y el motor nativo de búsqueda (por defecto), OpenRouter no devuelve citas `url_citation`
-- ni respeta `max_uses` (hizo 3 búsquedas con límite 1; su documentación dice que `max_uses` solo se reenvía a Anthropic). Sin citas, la ruta `discovery`
-- no puede aceptar ninguna web (solo se fía de las fuentes citadas). Con `engine: "exa"` llegan las citas, se hace 1 búsqueda y cuesta menos.
update settings
   set value = jsonb_set(value, '{discovery,searchEngine}', '"exa"'::jsonb),
       updated_by = 'migración 0016', updated_at = now()
 where key = 'llm_routes';

insert into audit_log (actor, action, entity, entity_id, payload) values
  ('migración 0016', 'settings.llm_routes', 'settings', 'llm_routes',
   '{"cambio":"discovery.searchEngine = exa","motivo":"con el motor nativo de OpenAI no llegan citas url_citation ni se respeta max_uses (comprobado 02/11/2026)"}');
