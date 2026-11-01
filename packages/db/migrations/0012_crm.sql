-- F2.0 — CRM propio (ADR-004): etapas, motivos de pérdida, oportunidades, tareas y notas. Deriva de spec/data-model.sql con restricciones más estrictas:
-- el cierre de una oportunidad es coherente en los dos sentidos, perder exige motivo y los usuarios referidos existen.

create table deal_stages (
  id text primary key,                 -- 'new','interested','demo_booked','demo_held','trial','won','lost'
  name text not null, sort int not null unique,
  probability int not null check (probability between 0 and 100),
  is_won boolean not null default false, is_lost boolean not null default false,
  check (not (is_won and is_lost))
);
insert into deal_stages (id, name, sort, probability, is_won, is_lost) values
  ('new', 'Nuevo', 1, 5, false, false),
  ('interested', 'Interesado', 2, 15, false, false),
  ('demo_booked', 'Demo reservada', 3, 30, false, false),
  ('demo_held', 'Demo realizada', 4, 50, false, false),
  ('trial', 'Prueba activa', 5, 70, false, false),
  ('won', 'Ganado', 6, 100, true, false),
  ('lost', 'Perdido', 7, 0, false, true);

create table lost_reasons (
  id text primary key, name text not null,
  applies_opposition boolean not null default false   -- true ⇒ aplicar applyOpposition() en la misma transacción (REQ-CRM-05)
);
insert into lost_reasons (id, name, applies_opposition) values
  ('opposition', 'Oposición / no contactar', true),
  ('no_interest', 'Sin interés', false),
  ('no_budget', 'Sin presupuesto', false),
  ('competitor', 'Se queda con la competencia', false),
  ('not_target', 'No es nuestro perfil', false),
  ('no_response', 'Sin respuesta', false),
  ('other', 'Otro motivo', false);

create table deals (                   -- oportunidades (REQ-CRM-01)
  id uuid primary key, prospect_id uuid not null references prospects,
  stage_id text not null references deal_stages,
  owner_user_id text references "user" ("id") on delete set null,
  campaign_id uuid references campaigns, source_channel text, utm jsonb,
  proposed_plan text, est_value_eur numeric(10,2) check (est_value_eur is null or est_value_eur >= 0),
  lost_reason_id text references lost_reasons, lost_note text,
  trial_org_id text, trial_ends_at timestamptz,
  created_by text,
  opened_at timestamptz not null default now(), closed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- cerrada (ganada o perdida) ⇔ tiene fecha de cierre
  constraint deals_closed_consistent check ((closed_at is null) = (stage_id not in ('won', 'lost'))),
  -- perder exige motivo, y solo una oportunidad perdida lo lleva
  constraint deals_lost_needs_reason check ((stage_id = 'lost') = (lost_reason_id is not null))
);
create unique index one_open_deal_per_prospect on deals(prospect_id) where closed_at is null;   -- REQ-CRM-01 CA1
create index deals_board on deals(stage_id, owner_user_id) where closed_at is null;
create index deals_prospect on deals(prospect_id, opened_at desc);

create table tasks (                   -- REQ-CRM-03
  id uuid primary key, prospect_id uuid references prospects, deal_id uuid references deals,
  kind text not null check (kind in ('call', 'email', 'visit', 'follow_up', 'other')),
  title text not null check (btrim(title) <> ''), note text,
  assignee_user_id text not null references "user" ("id"),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_at timestamptz,
  created_by text not null, created_at timestamptz not null default now(),
  check (prospect_id is not null or deal_id is not null),
  check ((status = 'done') = (done_at is not null))
);
create index tasks_inbox on tasks(assignee_user_id, due_at) where status = 'open';
create index tasks_prospect on tasks(prospect_id) where prospect_id is not null;
create index tasks_deal on tasks(deal_id) where deal_id is not null;

create table notes (                   -- REQ-CRM-04
  id uuid primary key, prospect_id uuid not null references prospects, deal_id uuid references deals,
  body text not null check (btrim(body) <> '' and char_length(body) <= 4000),
  author_user_id text not null references "user" ("id"),
  created_at timestamptz not null default now()
);
create index notes_prospect on notes(prospect_id, created_at);

-- La FK que F0 dejó pendiente: una demo puede colgar de una oportunidad.
alter table demos add constraint demos_deal_fk foreign key (deal_id) references deals (id);
