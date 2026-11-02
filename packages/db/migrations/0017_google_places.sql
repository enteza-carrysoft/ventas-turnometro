-- Google Places API (New) como fuente de descubrimiento (decisión del promotor, 02/11/2026). Condiciones y precios comprobados ese día en
-- developers.google.com/maps/documentation/places/web-service/policies, …/text-search y …/billing-and-pricing/pricing (spec/research/fuentes.md §6).
-- Sigue INACTIVA: la activa un admin (setSourceActive, queda en audit_log). Solo se almacena el place_id (REQ-RES-02 CA1).
update allowed_sources
   set license = 'Google Maps Platform: el place_id se puede guardar indefinidamente; el resto del contenido de Places no se almacena. Atribución «Google Maps» si se muestra contenido de Google',
       storable_fields = '{place_id}',
       terms_url = 'https://developers.google.com/maps/documentation/places/web-service/policies',
       verified_at = '2026-11-02T00:00:00Z',
       notes = 'Text Search (New), máscara id+displayName+websiteUri (nivel Enterprise: 1.000 peticiones/mes gratis, luego 35 $/1.000). Google solo sugiere: la candidata se acepta si su nombre aparece en la web de la empresa, que es la fuente de la ficha'
 where id = 'google_places';
