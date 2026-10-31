-- F0.3 — ajustes sembrados (valores seguros por defecto) y fuentes inactivas. Ver compliance.md y decisions.md D-03.
insert into settings (key, value, updated_by) values
  ('kill_switch', 'false', 'system'),
  ('kill_switch_postal_letter', 'false', 'system'),
  ('kill_switch_visit', 'false', 'system'),
  ('kill_switch_human_call', 'false', 'system'),
  ('kill_switch_ai_call', 'false', 'system'),
  ('kill_switch_email_marketing', 'false', 'system'),
  ('kill_switch_email_transactional', 'false', 'system'),
  ('kill_switch_sms_transactional', 'false', 'system'),
  ('kill_switch_whatsapp_transactional', 'false', 'system'),
  ('app_mode', '"sandbox"', 'system'),
  ('b2b_human_calls_approved', 'false', 'system'),
  ('postal_b2b_approved', 'false', 'system'),
  ('lssi_customer_exception_approved', 'false', 'system'),
  ('recording_enabled', 'false', 'system'),
  ('review_decision_max_age_s', '60', 'system'),
  ('robinson_max_age_days', '30', 'system'),
  ('time_windows', '{"timezone":"Europe/Madrid","call":[["10:00","14:00"],["16:00","19:00"]],"visit":[["10:00","13:30"],["17:00","19:30"]],"email":{"blocked_from":"21:00","blocked_until":"08:00","weekends":false}}', 'system'),
  ('cadences', '{"postal_letter":{"max_per_campaign":2,"min_days_between":21},"human_call":{"max_answered_per_campaign":1,"max_unanswered":3},"visit":{"max_per_campaign":1},"ai_call":{"max_per_day":1,"max_attempts_per_consent":2,"min_hours_between":48},"email_marketing":{"max_per_week":1,"max_per_campaign":4},"transactional_demo":{"max":2}}', 'system'),
  ('budget_daily_eur', '{"llm":15,"voice":10,"web_search":5,"email":5}', 'system'),
  ('budget_monthly_total_eur', '600', 'system')
on conflict (key) do nothing;

insert into allowed_sources (id, active, license, storable_fields, terms_url, notes) values
  ('regcess', false, 'pendiente de verificar (F0.4)', '{}', null, 'Registro de centros sanitarios, Ministerio de Sanidad'),
  ('registros_autonomicos', false, 'pendiente de verificar (F0.4)', '{}', null, 'Registros de centros sanitarios de la Junta de Andalucía'),
  ('osm', false, 'ODbL: atribución obligatoria (por verificar en F0.4)', '{}', 'https://www.openstreetmap.org/copyright', 'Overpass'),
  ('open_data', false, 'pendiente de verificar (F0.4)', '{}', null, 'datos.gob.es, IECA, ayuntamientos'),
  ('ine', false, 'pendiente de verificar (F0.4)', '{}', null, 'DIRCE y nomenclátor; uso estadístico'),
  ('google_places', false, 'Condiciones de Google Maps Platform (por verificar en F0.4)', '{place_id}', 'https://cloud.google.com/maps-platform/terms/maps-service-terms/', 'Solo place_id almacenable'),
  ('web_search', false, 'pendiente de verificar (F0.4)', '{}', null, 'Herramienta web_search de Claude'),
  ('corporate_web', false, 'robots.txt y condiciones de cada sitio', '{}', null, 'Fuente principal de la ficha'),
  ('contratacion_sector_publico', false, 'pendiente de verificar (F0.4)', '{}', null, 'Señales de licitaciones')
on conflict (id) do nothing;
