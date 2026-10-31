-- F1.7 — evidencias, fuentes de cada ficha y lista de clientes actuales (REQ-ENR-01, REQ-VER-02, P2.2). Tomado de spec/data-model.sql.

create table evidences (
  id uuid primary key, prospect_id uuid not null references prospects,
  field text not null,                -- 'phone','sites_count','legal_form','signal:varias_consultas',...
  value text, provenance text not null check (provenance in ('observed','inferred')),
  explanation text,                   -- obligatoria si inferred
  source_url text not null check (btrim(source_url) <> ''),
  quote text check (quote is null or char_length(quote) <= 300),   -- fragmento literal ≤ 300 caracteres (REQ-ENR-01 CA1)
  fetched_at timestamptz not null,
  extractor_version text not null,
  check (provenance = 'observed' or (explanation is not null and btrim(explanation) <> ''))
);
create index evidences_prospect on evidences(prospect_id, field);
-- una misma evidencia (campo + valor + URL) no se guarda dos veces al fusionar fichas
create unique index evidences_unique on evidences(prospect_id, field, coalesce(value, ''), source_url);

create table prospect_sources (
  prospect_id uuid not null references prospects, source_id text not null references allowed_sources,
  external_id text not null default '', primary key (prospect_id, source_id, external_id)
);                                    -- p. ej. id de OSM; para place_id de Google, el único dato almacenable

alter table contact_points add constraint contact_points_evidence_fk foreign key (evidence_id) references evidences(id);
alter table contact_points add column invalid_reason text;   -- p. ej. 'not_callable', 'web_unreachable', 'no_mx'

-- Clientes actuales de TurnoSala: no se prospectan (REQ-VER-02 CA2, D-13). Se cargan por CSV hasta tener el endpoint de la API.
create table turnosala_customers (
  org_id text primary key, name text not null, name_norm text not null, domain text, phone_e164 text,
  prospect_id uuid references prospects, refreshed_at timestamptz not null
);
create index turnosala_customers_domain on turnosala_customers(domain) where domain is not null;
create index turnosala_customers_phone on turnosala_customers(phone_e164) where phone_e164 is not null;
create index turnosala_customers_name_trgm on turnosala_customers using gin (name_norm gin_trgm_ops);
