-- F2.1a — base de las páginas públicas: tokens, textos de consentimiento versionados y límite de envíos por IP.

-- Tokens de las landings personalizadas y de las bajas (REQ-CNS-01, REQ-CNS-03 CA2). 128 bits aleatorios; en BD solo su SHA-256: una fuga de la BD no da enlaces utilizables.
create table public_tokens (
  id uuid primary key,
  kind text not null check (kind in ('landing', 'unsubscribe')),
  token_hash text not null unique,
  prospect_id uuid not null references prospects,
  campaign_id uuid references campaigns,
  contact_email text, contact_phone text,          -- una baja puede ser solo de un contacto
  created_at timestamptz not null default now(),
  expires_at timestamptz, revoked_at timestamptz
);
create index public_tokens_prospect on public_tokens(prospect_id);

-- Textos exactos que ve la persona al consentir, versionados. Una versión aprobada es inmutable; en producción no se muestra el formulario sin textos aprobados (G2).
create table consent_texts (
  id uuid primary key,
  box text not null check (box in ('privacy', 'email', 'human_call', 'ai_call', 'sms_whatsapp')),
  version text not null check (btrim(version) <> ''),
  text text not null check (btrim(text) <> ''),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by text, created_at timestamptz not null default now(),
  approved_by text, approved_at timestamptz,
  check ((status = 'approved') = (approved_at is not null)),
  unique (box, version)
);

create function consent_texts_immutable() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' then
    if tg_op = 'DELETE' then raise exception 'una versión aprobada del texto de consentimiento no se puede borrar'; end if;
    if new.box <> old.box or new.version <> old.version or new.text <> old.text or new.status <> 'approved' then
      raise exception 'una versión aprobada del texto de consentimiento es inmutable (crea una versión nueva)';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger consent_texts_guard before update or delete on consent_texts for each row execute function consent_texts_immutable();

-- BORRADORES (status = 'draft'): marcadores entre corchetes donde falta lo que debe aportar el asesor (D-04). No sirven en producción hasta aprobarse.
insert into consent_texts (id, box, version, text, status, created_by) values
  (gen_random_uuid(), 'privacy', 'borrador-1',
   'Información básica sobre protección de datos. Responsable: [razón social y NIF — pendiente del asesor]. Finalidad: gestionar tu solicitud de demo de TurnoSala y, solo si lo marcas abajo, contactarte por los canales que elijas. Base jurídica: tu solicitud y tu consentimiento. Destinatarios: no se ceden datos a terceros, salvo proveedores que actúan por nuestra cuenta. Derechos: acceso, rectificación, supresión, oposición, limitación y portabilidad en [correo de privacidad — pendiente]. Más información: [enlace a la política de privacidad — pendiente].',
   'draft', 'migración 0013'),
  (gen_random_uuid(), 'email', 'borrador-1', 'Quiero recibir comunicaciones comerciales de TurnoSala por correo electrónico en la dirección que he indicado.', 'draft', 'migración 0013'),
  (gen_random_uuid(), 'human_call', 'borrador-1', 'Autorizo que una persona de TurnoSala me llame al teléfono que he indicado para informarme de TurnoSala y de mi demo.', 'draft', 'migración 0013'),
  (gen_random_uuid(), 'ai_call', 'borrador-1', 'Autorizo que TurnoSala me llame al teléfono que he indicado con un asistente de inteligencia artificial (una voz sintética que se identifica como tal) para informarme de TurnoSala y de mi demo.', 'draft', 'migración 0013'),
  (gen_random_uuid(), 'sms_whatsapp', 'borrador-1', 'Autorizo que me envíen SMS o mensajes de WhatsApp al teléfono que he indicado solo para confirmarme o recordarme mi demo.', 'draft', 'migración 0013');

-- Límite de envíos por IP (REQ-CNS-01 CA3) sin guardar la IP en claro: HMAC con un secreto de la aplicación. La IP en claro solo se guarda en `consents.ip`.
create table public_form_hits (
  id bigserial primary key,
  ip_hmac text not null, kind text not null,
  at timestamptz not null default now()
);
create index public_form_hits_lookup on public_form_hits(ip_hmac, kind, at);

-- Las solicitudes de las landings crean fichas cuya fuente es el propio formulario (el interesado facilita sus datos).
insert into allowed_sources (id, active, license, storable_fields, terms_url, notes) values
  ('inbound_form', true, 'Datos facilitados por la propia persona en el formulario (su solicitud y sus consentimientos)', '{}', null, 'Formularios de las landings (F2.1)')
on conflict (id) do nothing;
