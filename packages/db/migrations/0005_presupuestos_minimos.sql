-- D-03 (31/10/2026): el promotor elige presupuestos MÍNIMOS mientras no haya tráfico real.
--   LLM 5 €/día · búsqueda web 2 €/día · email 2 €/día · voz 0 €/día (bloqueada por CG-04 hasta F5) · tope mensual 150 €.
-- Los ajustes son editables (settings); la decisión queda en audit_log (solo inserción).
update settings
   set value = '{"llm":5,"voice":0,"web_search":2,"email":2}', updated_by = 'promotor (D-03, 31/10/2026)', updated_at = now()
 where key = 'budget_daily_eur';

update settings
   set value = '150', updated_by = 'promotor (D-03, 31/10/2026)', updated_at = now()
 where key = 'budget_monthly_total_eur';

insert into audit_log (actor, action, entity, entity_id, payload) values
  ('promotor', 'settings.budget', 'settings', 'budget_daily_eur',
   '{"decision":"D-03","fecha":"2026-10-31","daily_eur":{"llm":5,"voice":0,"web_search":2,"email":2},"monthly_total_eur":150}');
