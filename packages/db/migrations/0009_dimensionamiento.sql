-- F1.3 — dimensionamientos guardados (REQ-MKT-03): resultado completo (contado/estimado por municipio) con su fuente y licencia.
create table market_sizings (
  id uuid primary key, segment_id uuid not null references segments,
  territory jsonb not null,                  -- {ine_codes:[...]} o {province:...}
  activity text not null,                    -- actividad estadística usada (p. ej. grupo CNAE)
  result jsonb not null,                     -- SizeResult completo: municipios, totales, avisos y fuente
  created_by text not null, created_at timestamptz not null default now()
);
create index market_sizings_segment on market_sizings(segment_id, created_at desc);
