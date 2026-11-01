-- F2.1b — solicitudes de demo recibidas por los formularios de las landings (REQ-CNS-01). Guarda lo que la persona facilitó para que el comercial pueda contactarla;
-- los consentimientos van aparte, en `consents`, uno por casilla y destino. No se guarda la IP aquí (solo en `consents.ip`, donde la exige REQ-CNS-01 CA1).
create table demo_requests (
  id uuid primary key,
  prospect_id uuid not null references prospects,
  deal_id uuid references deals,
  requester_name text not null check (btrim(requester_name) <> ''),
  requester_email text, requester_phone text,
  company text, sector text,
  source_url text not null check (btrim(source_url) <> ''),
  campaign_id uuid references campaigns,
  created_at timestamptz not null default now(),
  check (requester_email is not null or requester_phone is not null)
);
create index demo_requests_prospect on demo_requests(prospect_id, created_at desc);
