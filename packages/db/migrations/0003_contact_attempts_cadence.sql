-- F0.5 — la puerta necesita saber a qué campaña y demo pertenece cada intento y cómo terminó (CG-06).
alter table contact_attempts
  add column campaign_id uuid references campaigns,
  add column demo_id uuid references demos,
  add column outcome text check (outcome in ('answered','unanswered','not_interested'));
create index contact_attempts_prospect on contact_attempts(prospect_id, channel, created_at);
