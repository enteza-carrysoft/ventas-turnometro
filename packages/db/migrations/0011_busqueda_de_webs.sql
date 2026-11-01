-- Búsqueda de la web de las candidatas que no la tienen (F1.5: web_search). OpenStreetMap trae web en pocas fichas (≈ 1 de cada 4 en la prueba de Sevilla) y el
-- enriquecimiento necesita web. El modelo solo SUGIERE páginas (con la búsqueda del proveedor); el código decide si la página corresponde al negocio.

alter table prospects add column discover_attempts int not null default 0;
alter table prospects add column discover_next_at timestamptz;
alter table prospects add column discover_error text;
create index prospects_discover on prospects(discover_next_at) where status = 'candidate' and website is null;

-- La ruta `discovery` pedía también salida estructurada, pero no está verificado que el proveedor la admita junto con la búsqueda web (su documentación no
-- lo indica). Se usa búsqueda + texto + citas, y la respuesta es corta.
update settings
   set value = jsonb_set(jsonb_set(value, '{discovery,requires}', '["web_search"]'::jsonb), '{discovery,maxTokens}', '1000'::jsonb),
       updated_by = 'migración 0011', updated_at = now()
 where key = 'llm_routes';

insert into audit_log (actor, action, entity, entity_id, payload) values
  ('migración 0011', 'settings.llm_routes', 'settings', 'llm_routes',
   '{"cambio":"discovery.requires = [web_search]; discovery.maxTokens = 1000","motivo":"salida estructurada junto con búsqueda web sin verificar"}');
