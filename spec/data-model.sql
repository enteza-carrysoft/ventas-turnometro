-- Modelo de datos de referencia — TurnoSala Prospector (PostgreSQL 16)
-- Referencia para el esquema Drizzle de packages/db. Se puede mejorar; si se cambia, actualizar este archivo.
-- Convenciones: uuid v7 como PK generado en la aplicación (PostgreSQL 16 no trae uuidv7()), timestamptz en UTC,
-- enums como text + CHECK (más fáciles de migrar). Imagen de BD: pgvector/pgvector:pg16 (local, CI y despliegue).
-- Orden real de creación en las migraciones: respetar las claves foráneas (p. ej. prospects antes que consents).

create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists vector;
create extension if not exists btree_gist;   -- restricción de exclusión anti-doble-reserva (demos)

-- ───────────── Usuarios y ajustes ─────────────
-- (las tablas de Better Auth las crea su adaptador; aquí solo el rol)
create table app_user_roles (
  user_id     text primary key,
  role        text not null check (role in ('admin','marketing','sales','auditor','voice')),
  created_at  timestamptz not null default now()
);

create table settings (               -- no secretos: kill switch, modo, franjas, cadencias, presupuestos, flags jurídicos
  key         text primary key,
  value       jsonb not null,
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);

create table test_contacts (          -- únicos destinos permitidos en sandbox
  id uuid primary key, kind text not null check (kind in ('phone','email','postal')), value text not null unique,
  label text not null, created_at timestamptz not null default now()
);

-- ───────────── Producto y mercado ─────────────
create table products (id uuid primary key, slug text unique not null, name text not null, website text not null);

create table product_facts (          -- REQ-MKT-01
  id uuid primary key, product_id uuid not null references products, version int not null,
  status text not null check (status in ('draft','approved','retired')),
  facts jsonb not null,               -- planes, precios sin IVA, módulos, prueba, promociones {code, until}, límites
  approved_by text, approved_at timestamptz,
  unique (product_id, version)
);
create unique index one_approved_facts on product_facts(product_id) where status = 'approved';

create table segments (               -- ICP, REQ-MKT-02
  id uuid primary key, product_id uuid not null references products, slug text not null,
  name text not null, status text not null check (status in ('draft','approved','retired')),
  definition jsonb not null,          -- verticales, señales y pesos, cargo decisor, mensaje, demo, fuentes
  scoring_version int not null default 1,
  unique (product_id, slug)
);

create table territories (            -- municipios INE agregables
  ine_code text primary key, name text not null, province text not null, region text not null,
  population int
);

-- ───────────── Investigación ─────────────
create table allowed_sources (
  id text primary key,                -- 'regcess','osm','google_places','web_search','corporate_web',...
  active boolean not null default false, license text not null, storable_fields text[] not null,
  terms_url text, verified_at timestamptz, notes text
);

create table research_jobs (
  id uuid primary key, segment_id uuid not null references segments, territory_filter jsonb not null,
  max_candidates int not null default 200, budget_eur numeric(10,2) not null,
  status text not null check (status in ('queued','running','paused','done','cancelled','failed')),
  stats jsonb not null default '{}', created_by text not null, created_at timestamptz not null default now()
);

create table research_tasks (         -- (fuente × municipio), reanudables
  id uuid primary key, job_id uuid not null references research_jobs, source_id text not null references allowed_sources,
  ine_code text references territories, status text not null, attempts int not null default 0,
  error text, cursor jsonb, updated_at timestamptz not null default now()
);

-- ───────────── Fichas ─────────────
create table prospects (
  id uuid primary key,
  name text not null, name_norm text not null,
  legal_form text not null default 'unknown' check (legal_form in ('company','sole_trader','public_body','unknown')),
  segment_id uuid references segments, vertical text,
  website text, domain text,
  ine_code text references territories, address jsonb,           -- normalizada
  sites_count int,
  status text not null check (status in ('candidate','enriched','pending_review','approved','discarded','blocked','archived')),
  block_reason text,
  score int, tier text check (tier in ('hot','warm','nurture')),
  score_breakdown jsonb, score_reasoning text, scoring_version int,
  embedding vector(1024),                                        -- REQ-MKT-04 (S)
  owner_user_id text,                                            -- comercial asignado (opcional antes de la oportunidad)
  reviewed_by text, reviewed_at timestamptz,
  last_evidence_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index prospects_domain_uq on prospects(domain) where domain is not null and status <> 'archived';
create index prospects_name_trgm on prospects using gin (name_norm gin_trgm_ops);
create index prospects_status on prospects(status, ine_code);

create table prospect_sources (prospect_id uuid references prospects, source_id text references allowed_sources,
  external_id text, primary key (prospect_id, source_id, external_id));      -- p. ej. place_id, id OSM

create table evidences (              -- P2.2
  id uuid primary key, prospect_id uuid not null references prospects,
  field text not null,                -- 'phone','sites_count','signal:varias_consultas',...
  value text, provenance text not null check (provenance in ('observed','inferred')),
  explanation text,                   -- obligatoria si inferred
  source_url text not null, quote text, fetched_at timestamptz not null,
  extractor_version text not null,
  check (provenance = 'observed' or explanation is not null)
);

create table contact_points (
  id uuid primary key, prospect_id uuid not null references prospects,
  type text not null check (type in ('switchboard_phone','mobile_phone','generic_email','postal_address','web_form','booking_url')),
  value text not null, value_norm text not null, evidence_id uuid references evidences,
  valid boolean, checked_at timestamptz,
  unique (type, value_norm, prospect_id)
);

create table robinson_checks (        -- CG-08
  id uuid primary key, prospect_id uuid not null references prospects, channel text not null,
  result text not null check (result in ('clear','listed','error')), checked_at timestamptz not null
);

-- ───────────── Consentimiento, exclusión y decisiones (solo inserción) ─────────────
create table consents (
  id uuid primary key, prospect_id uuid references prospects,
  channel text not null check (channel in ('email','human_call','ai_call','sms','whatsapp')),
  purpose text not null, action text not null check (action in ('grant','withdraw')),
  phone text, email text,
  text_version text not null, text_snapshot text not null,
  source_url text not null, ip inet, user_agent text, campaign_id uuid,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  check (btrim(text_version) <> '' and btrim(text_snapshot) <> '' and btrim(source_url) <> '')   -- REQ-CNS-02 / T-13
);

create table suppressions (
  id uuid primary key, kind text not null check (kind in ('phone','email','domain','prospect')),
  value text not null, reason text not null, origin text not null,   -- 'unsubscribe','call','email_reply','crm','sales','letter_return'
  created_by text, created_at timestamptz not null default now()
);
create index suppressions_lookup on suppressions(kind, value);

create table compliance_decisions (
  id uuid primary key, input jsonb not null,
  prospect_id uuid references prospects, channel text not null, direction text not null, destination text,  -- para la regla de 60 s (T-20)
  decision text not null check (decision in ('ALLOW','BLOCK','REVIEW')),
  rule_ids text[] not null, reasons text[] not null, consent_id uuid references consents,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key, actor text not null, action text not null, entity text not null, entity_id text,
  payload jsonb, created_at timestamptz not null default now()
);

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'tabla de solo inserción: %', tg_table_name; end $$;
create trigger consents_ro before update or delete on consents for each row execute function forbid_mutation();
create trigger suppressions_ro before update or delete on suppressions for each row execute function forbid_mutation();
create trigger decisions_ro before update or delete on compliance_decisions for each row execute function forbid_mutation();
create trigger audit_ro before update or delete on audit_log for each row execute function forbid_mutation();
-- TRUNCATE no dispara triggers de fila: se bloquea aparte (T-19). Además el rol de la aplicación NO recibe UPDATE/DELETE/TRUNCATE
-- sobre estas cuatro tablas (defensa en profundidad; los triggers cubren también al propietario y a superusuarios no migradores).
create trigger consents_no_trunc before truncate on consents for each statement execute function forbid_mutation();
create trigger suppressions_no_trunc before truncate on suppressions for each statement execute function forbid_mutation();
create trigger decisions_no_trunc before truncate on compliance_decisions for each statement execute function forbid_mutation();
create trigger audit_no_trunc before truncate on audit_log for each statement execute function forbid_mutation();
-- La retención (REQ-RET-01) usa una función SECURITY DEFINER propia que desactiva el trigger en su transacción y audita.

-- ───────────── Campañas y ejecución ─────────────
create table campaigns (
  id uuid primary key, product_id uuid not null references products, segment_id uuid not null references segments,
  name text not null, wave text not null,             -- 'sevilla','andalucia','espana'
  territory_filter jsonb not null, sequence jsonb not null,   -- pasos [{channel, wait_days, condition}]
  budget_eur numeric(10,2) not null, starts_on date, ends_on date,
  status text not null check (status in ('draft','active','paused','closed')),
  utm jsonb not null
);

create table campaign_members (
  campaign_id uuid references campaigns, prospect_id uuid references prospects,
  step int not null default 0, state text not null,    -- 'active','research_only','responded','demo','stopped'
  next_action_at timestamptz, primary key (campaign_id, prospect_id)
);

create table content_items (          -- cartas, guiones, landings, anuncios
  id uuid primary key, kind text not null, campaign_id uuid references campaigns, prospect_id uuid references prospects,
  product_facts_id uuid not null references product_facts, prompt_version text not null,
  body jsonb not null, claims_check jsonb not null,    -- resultado del verificador de afirmaciones
  status text not null check (status in ('draft','approved','rejected','published')),
  approved_by text, created_at timestamptz not null default now()
);

create table send_batches (           -- REQ-OUT-03
  id uuid primary key, campaign_id uuid not null references campaigns, channel text not null,
  size int not null, est_cost_eur numeric(10,2) not null,
  status text not null check (status in ('pending_approval','approved','rejected','executing','done','cancelled')),
  created_at timestamptz not null default now()
);

create table review_approvals (
  id uuid primary key, batch_id uuid not null references send_batches, approved_by text not null,
  role text not null, note text, created_at timestamptz not null default now()
);

create table contact_attempts (
  id uuid primary key, batch_id uuid references send_batches, prospect_id uuid not null references prospects,
  channel text not null, purpose text not null, destination text not null,
  decision_id uuid not null references compliance_decisions,
  content_item_id uuid references content_items,
  status text not null check (status in ('planned','sending','sent','delivered','failed','cancelled','returned')),
  provider text, provider_ref text, cost_eur numeric(10,4), idempotency_key text unique not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public_tokens (          -- /c/<token> y /baja/<token>
  token text primary key, kind text not null check (kind in ('landing','unsubscribe')),
  prospect_id uuid references prospects, campaign_id uuid references campaigns, contact_attempt_id uuid,
  expires_at timestamptz, created_at timestamptz not null default now()
);

create table landing_events (id bigserial primary key, token text references public_tokens, kind text not null,
  created_at timestamptz not null default now());                     -- 'scan','view','form_submit' (sin IP guardada)

create table inbound_messages (
  id uuid primary key, channel text not null, from_value text not null, prospect_id uuid references prospects,
  subject text, body_text text, intent text, handled_by text, created_at timestamptz not null default now()
);

create table calls (
  id uuid primary key, prospect_id uuid references prospects, direction text not null,
  twilio_sid text unique, consent_id uuid references consents, decision_id uuid references compliance_decisions,
  outcome text check (outcome in ('demo_booked','callback','not_interested','opt_out','no_answer','voicemail','transferred','error')),
  started_at timestamptz, ended_at timestamptz, duration_s int, cost_eur numeric(10,4),
  summary text, transcript jsonb
);

-- ───────────── Integraciones y costes ─────────────
create table sync_outbox (            -- llamadas a la API de plataforma de TurnoSala (REQ-TRI-01)
  id uuid primary key, target text not null check (target in ('turnosala')), op text not null,
  payload jsonb not null, idempotency_key text unique not null,
  status text not null check (status in ('pending','done','failed','dead')), attempts int not null default 0,
  last_error text, next_attempt_at timestamptz not null default now(), created_at timestamptz not null default now()
);

create table usage_costs (
  id bigserial primary key, provider text not null, route text not null, campaign_id uuid,
  units jsonb not null, cost_eur numeric(10,4) not null, created_at timestamptz not null default now()
);

create table turnosala_customers (    -- clientes actuales: no se prospectan (REQ-VER-02 CA2, D-13)
  org_id text primary key, name text not null, name_norm text not null, domain text, phone_e164 text,
  prospect_id uuid references prospects, refreshed_at timestamptz not null
);

-- ───────────── CRM (ADR-004) ─────────────
create table deal_stages (
  id text primary key,                -- 'new','interested','demo_booked','demo_held','trial','won','lost'
  name text not null, sort int not null, probability int not null check (probability between 0 and 100),
  is_won boolean not null default false, is_lost boolean not null default false
);

create table lost_reasons (
  id text primary key, name text not null,
  applies_opposition boolean not null default false   -- 'opposition' = true → applyOpposition() (REQ-CRM-05)
);

create table deals (                  -- oportunidades (REQ-CRM-01)
  id uuid primary key, prospect_id uuid not null references prospects,
  stage_id text not null references deal_stages, owner_user_id text,
  campaign_id uuid references campaigns, source_channel text, utm jsonb,
  proposed_plan text, est_value_eur numeric(10,2),
  lost_reason_id text references lost_reasons, lost_note text,
  trial_org_id text, trial_ends_at timestamptz,
  opened_at timestamptz not null default now(), closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((closed_at is null) or stage_id in ('won','lost'))
);
create unique index one_open_deal_per_prospect on deals(prospect_id) where closed_at is null;
create index deals_board on deals(stage_id, owner_user_id) where closed_at is null;

create table tasks (                  -- REQ-CRM-03
  id uuid primary key, prospect_id uuid references prospects, deal_id uuid references deals,
  kind text not null check (kind in ('call','email','visit','follow_up','other')),
  title text not null, note text, assignee_user_id text not null, due_at timestamptz not null,
  status text not null check (status in ('open','done','cancelled')), done_at timestamptz,
  created_by text not null, created_at timestamptz not null default now(),
  check (prospect_id is not null or deal_id is not null)
);
create index tasks_inbox on tasks(assignee_user_id, due_at) where status = 'open';

create table notes (                  -- REQ-CRM-04
  id uuid primary key, prospect_id uuid not null references prospects, deal_id uuid references deals,
  body text not null, author_user_id text not null, created_at timestamptz not null default now()
);

-- ───────────── Agenda de demos (ADR-004) ─────────────
create table availability_rules (     -- REQ-AGE-01: franjas semanales en hora local
  id uuid primary key, user_id text not null, weekday int not null check (weekday between 1 and 7),
  start_local time not null, end_local time not null, timezone text not null default 'Europe/Madrid',
  check (start_local < end_local)
);

create table availability_settings (
  user_id text primary key, duration_min int not null default 15, buffer_min int not null default 10,
  min_notice_min int not null default 240, horizon_days int not null default 30,
  meeting_url text, active boolean not null default true
);

create table availability_exceptions (
  id uuid primary key, user_id text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  reason text, check (starts_at < ends_at)
);

create table external_calendars (     -- REQ-AGE-03: suscripción ICS de solo lectura
  id uuid primary key, user_id text not null, ics_url_secret_ref text not null,  -- referencia a secreto, no la URL en claro
  last_sync_at timestamptz, last_error text
);

create table busy_blocks (            -- solo inicio y fin, nunca título ni asistentes
  calendar_id uuid not null references external_calendars, starts_at timestamptz not null, ends_at timestamptz not null,
  primary key (calendar_id, starts_at, ends_at)
);

create table demos (                  -- REQ-DEM-01..03; demoId de CG-40/51
  id uuid primary key, prospect_id uuid not null references prospects,
  deal_id uuid,                       -- FK a deals añadida en la migración de F2 (F0 crea demos sin CRM)
  host_user_id text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  booked_via text not null check (booked_via in ('form','voice','sales')),
  requester_name text not null, requester_email text, requester_phone text,   -- los facilita el interesado
  status text not null check (status in ('booked','confirmed','cancelled','held','no_show','rescheduled')),
  manage_token text unique not null, meeting_url text, ics_sequence int not null default 0,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (requester_email is not null or requester_phone is not null),
  exclude using gist (host_user_id with =, during with &&) where (status in ('booked','confirmed'))
);

create table calendar_feeds (         -- feed ICS privado por comercial
  user_id text primary key, token text unique not null, rotated_at timestamptz not null default now()
);

-- Línea de tiempo (REQ-CRM-04): vista, no tabla. Esquema orientativo:
-- create view timeline_events as
--   select prospect_id, created_at as at, 'note' as kind, id::text as ref from notes
--   union all select prospect_id, created_at, 'contact', id::text from contact_attempts
--   union all select prospect_id, started_at, 'call', id::text from calls
--   union all select prospect_id, created_at, 'consent', id::text from consents
--   union all select prospect_id, starts_at, 'demo', id::text from demos
--   union all select (payload->>'prospect_id')::uuid, created_at, action, entity_id from audit_log
--             where entity in ('deal','prospect');
