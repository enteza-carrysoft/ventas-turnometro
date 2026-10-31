-- Cola de trabajo del worker.
-- 1) Enriquecimiento de candidatas: intentos con espera creciente para no reintentar eternamente (ni gastar de más) una web que falla.
alter table prospects add column enrich_attempts int not null default 0;
alter table prospects add column enrich_next_at timestamptz;
alter table prospects add column enrich_error text;
create index prospects_enrich on prospects(enrich_next_at) where status = 'candidate';

-- 2) Peticiones del panel al worker (p. ej. «analizar el mercado»): el panel no llama al modelo; encola y el worker ejecuta.
create table worker_requests (
  id uuid primary key,
  kind text not null check (kind in ('market.analyze')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  result jsonb, error text,
  requested_by text not null,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, lease_until timestamptz
);
create index worker_requests_queue on worker_requests(status, created_at);
