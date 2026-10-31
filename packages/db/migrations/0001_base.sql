-- F0.3 — esquema base (derivado de spec/data-model.sql). Se ejecuta como rol `migrator` (propietario de la BD).
-- Las extensiones y los roles los crea bootstrap.ts con un superusuario.

-- Permisos por defecto: el rol `app` recibe CRUD en lo que cree `migrator`; las 4 tablas P4 se restringen más abajo.
alter default privileges for role migrator in schema public grant select, insert, update, delete on tables to app;
alter default privileges for role migrator in schema public grant usage, select on sequences to app;

-- ───────────── Usuarios y ajustes ─────────────
create table app_user_roles (
  user_id     text primary key,
  role        text not null check (role in ('admin','marketing','sales','auditor','voice')),
  created_at  timestamptz not null default now()
);

create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);

create table test_contacts (
  id uuid primary key, kind text not null check (kind in ('phone','email','postal')), value text not null unique,
  label text not null, created_at timestamptz not null default now()
);

-- ───────────── Producto y mercado ─────────────
create table products (id uuid primary key, slug text unique not null, name text not null, website text not null);

create table product_facts (
  id uuid primary key, product_id uuid not null references products, version int not null,
  status text not null check (status in ('draft','approved','retired')),
  facts jsonb not null,
  approved_by text, approved_at timestamptz,
  unique (product_id, version)
);
create unique index one_approved_facts on product_facts(product_id) where status = 'approved';

create table segments (
  id uuid primary key, product_id uuid not null references products, slug text not null,
  name text not null, status text not null check (status in ('draft','approved','retired')),
  definition jsonb not null,
  scoring_version int not null default 1,
  unique (product_id, slug)
);

create table territories (
  ine_code text primary key, name text not null, province text not null, region text not null,
  population int
);

-- ───────────── Fuentes ─────────────
create table allowed_sources (
  id text primary key,
  active boolean not null default false, license text not null, storable_fields text[] not null,
  terms_url text, verified_at timestamptz, notes text
);

-- ───────────── Fichas (mínimo que lee la puerta: CG-07, CG-08, CG-21, CG-50) ─────────────
create table prospects (
  id uuid primary key,
  name text not null, name_norm text not null,
  legal_form text not null default 'unknown' check (legal_form in ('company','sole_trader','public_body','unknown')),
  segment_id uuid references segments, vertical text,
  website text, domain text,
  ine_code text references territories, address jsonb,
  sites_count int,
  status text not null check (status in ('candidate','enriched','pending_review','approved','discarded','blocked','archived')),
  block_reason text,
  score int, tier text check (tier in ('hot','warm','nurture')),
  score_breakdown jsonb, score_reasoning text, scoring_version int,
  embedding vector(1024),
  owner_user_id text,
  reviewed_by text, reviewed_at timestamptz,
  last_evidence_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index prospects_domain_uq on prospects(domain) where domain is not null and status <> 'archived';
create index prospects_name_trgm on prospects using gin (name_norm gin_trgm_ops);
create index prospects_status on prospects(status, ine_code);

create table contact_points (
  id uuid primary key, prospect_id uuid not null references prospects,
  type text not null check (type in ('switchboard_phone','mobile_phone','generic_email','postal_address','web_form','booking_url')),
  value text not null, value_norm text not null,
  evidence_id uuid,                   -- FK a evidences en F1 (la tabla se crea allí)
  valid boolean, checked_at timestamptz,
  unique (type, value_norm, prospect_id)
);

create table robinson_checks (
  id uuid primary key, prospect_id uuid not null references prospects, channel text not null,
  result text not null check (result in ('clear','listed','error')), checked_at timestamptz not null
);

-- ───────────── Consentimiento, exclusión y decisiones (solo inserción, P4) ─────────────
create table consents (
  id uuid primary key, prospect_id uuid references prospects,
  channel text not null check (channel in ('email','human_call','ai_call','sms','whatsapp')),
  purpose text not null, action text not null check (action in ('grant','withdraw')),
  phone text, email text,
  text_version text not null, text_snapshot text not null,
  source_url text not null, ip inet, user_agent text, campaign_id uuid,
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null),
  check (btrim(text_version) <> '' and btrim(text_snapshot) <> '' and btrim(source_url) <> '')
);
create index consents_lookup on consents(channel, phone, email);

create table suppressions (
  id uuid primary key, kind text not null check (kind in ('phone','email','domain','prospect')),
  value text not null, reason text not null, origin text not null,
  created_by text, created_at timestamptz not null default now()
);
create index suppressions_lookup on suppressions(kind, value);

create table compliance_decisions (
  id uuid primary key, input jsonb not null,
  prospect_id uuid references prospects, channel text not null, direction text not null, destination text,
  decision text not null check (decision in ('ALLOW','BLOCK','REVIEW')),
  rule_ids text[] not null, reasons text[] not null, consent_id uuid references consents,
  created_at timestamptz not null default now()
);
create index compliance_decisions_recent on compliance_decisions(prospect_id, channel, created_at desc);

create table audit_log (
  id bigserial primary key, actor text not null, action text not null, entity text not null, entity_id text,
  payload jsonb, created_at timestamptz not null default now()
);

create function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'tabla de solo inserción: %', tg_table_name; end $$;

create trigger consents_ro before update or delete on consents for each row execute function forbid_mutation();
create trigger suppressions_ro before update or delete on suppressions for each row execute function forbid_mutation();
create trigger decisions_ro before update or delete on compliance_decisions for each row execute function forbid_mutation();
create trigger audit_ro before update or delete on audit_log for each row execute function forbid_mutation();
create trigger consents_no_trunc before truncate on consents for each statement execute function forbid_mutation();
create trigger suppressions_no_trunc before truncate on suppressions for each statement execute function forbid_mutation();
create trigger decisions_no_trunc before truncate on compliance_decisions for each statement execute function forbid_mutation();
create trigger audit_no_trunc before truncate on audit_log for each statement execute function forbid_mutation();

-- Defensa en profundidad: la aplicación ni siquiera tiene permiso de modificar estas tablas.
revoke update, delete, truncate on consents, suppressions, compliance_decisions, audit_log from app;

-- ───────────── Campañas, lotes y ejecución (mínimo para REVIEW, 60 s y cadencias) ─────────────
create table campaigns (
  id uuid primary key, product_id uuid not null references products, segment_id uuid not null references segments,
  name text not null, wave text not null,
  territory_filter jsonb not null, sequence jsonb not null,
  budget_eur numeric(10,2) not null, starts_on date, ends_on date,
  status text not null check (status in ('draft','active','paused','closed')),
  utm jsonb not null
);

create table send_batches (
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
  content_item_id uuid,               -- FK a content_items en F4
  status text not null check (status in ('planned','sending','sent','delivered','failed','cancelled','returned')),
  provider text, provider_ref text, cost_eur numeric(10,4), idempotency_key text unique not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table usage_costs (
  id bigserial primary key, provider text not null, route text not null, campaign_id uuid,
  units jsonb not null, cost_eur numeric(10,4) not null, created_at timestamptz not null default now()
);
create index usage_costs_day on usage_costs(provider, created_at);

-- ───────────── Demos (sin CRM todavía: solo para CG-40/51; la FK a deals llega en F2) ─────────────
create table demos (
  id uuid primary key, prospect_id uuid not null references prospects,
  deal_id uuid,
  host_user_id text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  booked_via text not null check (booked_via in ('form','voice','sales')),
  requester_name text not null, requester_email text, requester_phone text,
  status text not null check (status in ('booked','confirmed','cancelled','held','no_show','rescheduled')),
  manage_token text unique not null, meeting_url text, ics_sequence int not null default 0,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (requester_email is not null or requester_phone is not null),
  exclude using gist (host_user_id with =, during with &&) where (status in ('booked','confirmed'))
);
