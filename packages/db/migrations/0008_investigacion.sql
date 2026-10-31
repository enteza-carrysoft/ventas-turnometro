-- F1.4 — trabajos de investigación reanudables (REQ-RES-01). La propia tabla de tareas es la cola: cada tarea (fuente × municipio) se
-- reclama con `for update skip locked` y un arrendamiento (`lease_until`); si el worker muere, el arrendamiento caduca y otro la retoma.

create table research_jobs (
  id uuid primary key, segment_id uuid not null references segments, territory_filter jsonb not null,
  max_candidates int not null default 200 check (max_candidates between 1 and 200),
  budget_eur numeric(10,2) not null check (budget_eur > 0),
  status text not null check (status in ('queued','running','paused','done','cancelled','failed')),
  stats jsonb not null default '{}',               -- candidates, cost_eur, stop_reason
  created_by text not null, created_at timestamptz not null default now()
);

create table research_tasks (
  id uuid primary key, job_id uuid not null references research_jobs, source_id text not null references allowed_sources,
  ine_code text references territories,
  status text not null default 'pending' check (status in ('pending','running','done','failed','skipped')),
  attempts int not null default 0, error text, cursor jsonb,
  lease_until timestamptz, worker text,
  stats jsonb not null default '{}',               -- candidates, cost_eur de esta tarea
  updated_at timestamptz not null default now()
);
create unique index research_tasks_unique on research_tasks(job_id, source_id, coalesce(ine_code, ''));
create index research_tasks_claim on research_tasks(status, lease_until);
create index research_tasks_job on research_tasks(job_id, status);
