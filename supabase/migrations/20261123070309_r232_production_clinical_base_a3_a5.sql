-- R2.3.2 Production-compatible clinical base for My Practice A3/A5.
-- Forward-only: creates only the clinical booking and encounter surface.
-- It intentionally does not create or mutate wallets, credits, payments,
-- commissions, synthetic workspaces, or any test-payment RPC.

create extension if not exists btree_gist with schema extensions;

create table public.practice_places (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  name text not null,
  address text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_places_name_check check (name <> '')
);

create index practice_places_expert_idx
  on public.practice_places (expert_id);

create table public.practice_services (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  place_id uuid references public.practice_places(id) on delete set null,
  name text not null,
  format text not null default 'offline',
  price_kop bigint not null default 0,
  duration_min integer not null default 60,
  is_active boolean not null default true,
  modules text[] not null default array['support', 'body']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_services_name_check check (name <> ''),
  constraint practice_services_price_check check (price_kop >= 0),
  constraint practice_services_duration_check check (duration_min between 15 and 240),
  constraint practice_services_format_check check (format in ('offline', 'online', 'phone', 'video')),
  constraint practice_services_modules_check check (
    cardinality(modules) > 0
    and modules <@ array['support', 'body']::text[]
  )
);

create index practice_services_expert_idx
  on public.practice_services (expert_id) where is_active;
create index practice_services_context_idx
  on public.practice_services (expert_id, organization_id, place_id);
create index practice_services_active_modules_idx
  on public.practice_services using gin (modules) where is_active;

comment on column public.practice_services.modules is
  'Patient cabinet modules allowed to show the published service: support and/or body (Health).';

create table public.practice_availability (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  weekday integer not null default 1,
  exception_date date,
  start_time text not null default '09:00',
  end_time text not null default '18:00',
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint practice_availability_weekday_check check (weekday between 0 and 7),
  constraint practice_availability_start_check check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint practice_availability_end_check check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint practice_availability_range_check check (end_time > start_time)
);

create index practice_availability_expert_idx
  on public.practice_availability (expert_id, is_active);
create index practice_availability_date_idx
  on public.practice_availability (expert_id, exception_date)
  where exception_date is not null;

create table public.practice_bookings (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  place_id uuid references public.practice_places(id) on delete set null,
  service_id uuid not null references public.practice_services(id) on delete restrict,
  owner_type text,
  owner_id uuid,
  session_id text,
  status text not null default 'held',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  idempotency_key text,
  expires_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_bookings_status_check
    check (status in ('held', 'confirmed', 'completed', 'cancelled', 'expired')),
  constraint practice_bookings_interval_check check (ends_at > starts_at),
  constraint practice_bookings_owner_pair_check check (
    (owner_type is null and owner_id is null)
    or (owner_type is not null and owner_id is not null)
  ),
  constraint practice_bookings_owner_type_check check (
    owner_type is null or owner_type in ('anonymous_case', 'anonymous_profile')
  ),
  constraint practice_bookings_no_double_booking
    exclude using gist (
      expert_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (status in ('held', 'confirmed'))
);

create unique index practice_bookings_idem_idx
  on public.practice_bookings (idempotency_key)
  where idempotency_key is not null;
create index practice_bookings_expert_idx
  on public.practice_bookings (expert_id, status, starts_at);
create index practice_bookings_owner_idx
  on public.practice_bookings (owner_type, owner_id);
create index practice_bookings_expires_idx
  on public.practice_bookings (expires_at) where status = 'held';

create table public.practice_events (
  id bigint generated always as identity primary key,
  booking_id uuid references public.practice_bookings(id) on delete set null,
  event text not null,
  actor text,
  payload jsonb,
  at timestamptz not null default now()
);

create index practice_events_booking_idx
  on public.practice_events (booking_id, at);

create table public.practice_patient_profile_links (
  support_owner_id uuid primary key,
  health_owner_id uuid not null unique,
  created_at timestamptz not null default now()
);

create table public.medical_encounter_versions (
  revision_id bigint generated always as identity primary key,
  encounter_id uuid not null,
  version integer not null check (version > 0),
  author_id uuid not null references public.experts(id),
  owner_type text not null check (owner_type in ('anonymous_case', 'anonymous_profile')),
  owner_id uuid not null,
  module text not null check (module in ('support', 'body')),
  organization_id uuid references public.organizations(id),
  encounter_at timestamptz not null,
  status text not null check (status in ('draft', 'confirmed')),
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and octet_length(content::text) <= 120000
  ),
  amendment_reason text not null default '',
  recorded_at timestamptz not null default clock_timestamp(),
  unique (encounter_id, version),
  check (
    (module = 'support' and owner_type = 'anonymous_case')
    or (module = 'body' and owner_type = 'anonymous_profile')
  )
);

create index medical_encounter_owner_idx
  on public.medical_encounter_versions (
    author_id, owner_type, owner_id, module, organization_id, revision_id desc
  );

create or replace function public.practice_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger practice_services_touch
before update on public.practice_services
for each row execute function public.practice_set_updated_at();

create trigger practice_bookings_touch
before update on public.practice_bookings
for each row execute function public.practice_set_updated_at();

create or replace function public.expire_practice_holds()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with moved as (
    update public.practice_bookings
       set status = 'expired', updated_at = now()
     where status = 'held'
       and expires_at is not null
       and expires_at < now()
    returning id
  )
  insert into public.practice_events (booking_id, event, actor, payload)
  select id, 'expired', 'system', jsonb_build_object('source', 'expiry_job')
    from moved;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.reserve_practice_booking(
  p_expert_id uuid,
  p_organization_id uuid,
  p_place_id uuid,
  p_service_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_session_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_ttl_minutes integer default 10
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_existing public.practice_bookings%rowtype;
  v_service public.practice_services%rowtype;
  v_ends timestamptz;
  v_ttl_min integer;
  v_day date;
  v_day_iso_wd integer;
  v_start_min integer;
  v_end_min integer;
  v_work integer := 0;
  v_exception integer := 0;
  v_in_window boolean := false;
  r record;
begin
  if p_expert_id is null or p_service_id is null or p_owner_id is null
     or p_session_id is null or btrim(p_session_id) = ''
     or p_owner_type not in ('anonymous_case', 'anonymous_profile') then
    raise exception using errcode = '22023', message = 'Invalid booking owner or service context';
  end if;
  if p_starts_at is null then
    raise exception using errcode = '22023', message = 'Invalid start time';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;

  select * into v_service
    from public.practice_services
   where id = p_service_id
     and expert_id = p_expert_id
     and is_active;
  if not found then
    raise exception using errcode = '42501', message = 'Service does not belong to doctor';
  end if;
  if v_service.organization_id is distinct from p_organization_id
     or v_service.place_id is distinct from p_place_id then
    raise exception using errcode = '42501', message = 'Service context does not match';
  end if;

  if p_starts_at <= now() then
    raise exception using errcode = '22023', message = 'Slot start is in the past';
  end if;
  v_ends := p_starts_at + (v_service.duration_min * interval '1 minute');
  if p_ends_at is not null and p_ends_at is distinct from v_ends then
    raise exception using errcode = '22023', message = 'Invalid booking interval';
  end if;

  v_ttl_min := least(greatest(coalesce(p_ttl_minutes, 10), 1), 1440);
  v_day := p_starts_at::date;
  v_day_iso_wd := extract(isodow from p_starts_at)::integer;
  v_start_min := extract(hour from (p_starts_at at time zone 'UTC'))::integer * 60
    + extract(minute from (p_starts_at at time zone 'UTC'))::integer;
  v_end_min := extract(hour from (v_ends at time zone 'UTC'))::integer * 60
    + extract(minute from (v_ends at time zone 'UTC'))::integer;

  select * into v_existing
    from public.practice_bookings
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.service_id is distinct from p_service_id
       or v_existing.starts_at is distinct from p_starts_at
       or v_existing.owner_type is distinct from p_owner_type
       or v_existing.owner_id is distinct from p_owner_id then
      raise exception using errcode = '23505', message = 'Same idempotency key with different parameters';
    end if;
    insert into public.practice_events (booking_id, event, actor, payload)
    values (
      v_existing.id,
      'hold_replayed',
      p_owner_id::text,
      jsonb_build_object('status', v_existing.status, 'idempotent_replay', true)
    );
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'idempotent_replay', true
    );
  end if;

  select count(*) into v_work
    from public.practice_availability
   where expert_id = p_expert_id
     and organization_id is not distinct from p_organization_id
     and is_active
     and weekday = v_day_iso_wd;
  if v_work = 0 then
    raise exception using errcode = '22023', message = 'No working hours for this day';
  end if;

  select count(*) into v_exception
    from public.practice_availability
   where expert_id = p_expert_id
     and organization_id is not distinct from p_organization_id
     and is_active
     and exception_date = v_day;
  if v_exception > 0 then
    raise exception using errcode = '22023', message = 'Day is blocked for this doctor';
  end if;

  for r in
    select start_time, end_time
      from public.practice_availability
     where expert_id = p_expert_id
       and organization_id is not distinct from p_organization_id
       and is_active
       and weekday = v_day_iso_wd
  loop
    if v_start_min >= (
         split_part(r.start_time, ':', 1)::integer * 60
         + split_part(r.start_time, ':', 2)::integer
       )
       and v_end_min <= (
         split_part(r.end_time, ':', 1)::integer * 60
         + split_part(r.end_time, ':', 2)::integer
       ) then
      v_in_window := true;
      exit;
    end if;
  end loop;
  if not v_in_window then
    raise exception using errcode = '22023', message = 'Outside working hours';
  end if;

  perform public.expire_practice_holds();

  insert into public.practice_bookings (
    expert_id, organization_id, place_id, service_id,
    owner_type, owner_id, session_id, status,
    starts_at, ends_at, idempotency_key, expires_at
  ) values (
    p_expert_id, p_organization_id, p_place_id, p_service_id,
    p_owner_type, p_owner_id, p_session_id, 'held',
    p_starts_at, v_ends, p_idempotency_key,
    now() + (v_ttl_min * interval '1 minute')
  )
  returning * into v_booking;

  insert into public.practice_events (booking_id, event, actor, payload)
  values (
    v_booking.id,
    'hold_created',
    p_owner_id::text,
    jsonb_build_object(
      'service_id', p_service_id,
      'starts_at', p_starts_at,
      'ttl_minutes', v_ttl_min
    )
  );

  return jsonb_build_object(
    'id', v_booking.id,
    'status', v_booking.status,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.ensure_default_practice_availability(
  p_expert_id uuid,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_expert_id is null or not exists (
    select 1 from public.experts where id = p_expert_id
  ) then
    raise exception 'Specialist not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'practice-availability:' || p_expert_id::text || ':'
        || coalesce(p_organization_id::text, 'private'),
      0
    )
  );

  if exists (
    select 1
      from public.practice_availability
     where expert_id = p_expert_id
       and organization_id is not distinct from p_organization_id
  ) then
    return 0;
  end if;

  insert into public.practice_availability (
    expert_id, organization_id, weekday, exception_date,
    start_time, end_time, note, is_active
  )
  select p_expert_id, p_organization_id, weekday, null,
         '09:00', '18:00', null, true
    from generate_series(1, 7) as weekday;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.reset_default_practice_availability(
  p_expert_id uuid,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_expert_id is null or not exists (
    select 1 from public.experts where id = p_expert_id
  ) then
    raise exception 'Specialist not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'practice-availability:' || p_expert_id::text || ':'
        || coalesce(p_organization_id::text, 'private'),
      0
    )
  );

  update public.practice_availability
     set is_active = false
   where expert_id = p_expert_id
     and organization_id is not distinct from p_organization_id
     and is_active;

  insert into public.practice_availability (
    expert_id, organization_id, weekday, exception_date,
    start_time, end_time, note, is_active
  )
  select p_expert_id, p_organization_id, weekday, null,
         '09:00', '18:00', null, true
    from generate_series(1, 7) as weekday;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.accept_specialist_invitation(
  p_token_hash text,
  p_owner_id uuid,
  p_public_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation record;
  v_expert record;
  v_primary record;
  v_additional record;
  v_expert_id uuid;
  v_owner_type text;
  v_now timestamptz := pg_catalog.now();
begin
  select id, direction, module, target_owner_type, target_owner_id,
         target_expert_id, inviter_owner_type, inviter_owner_id,
         inviter_expert_id, organization_id, status, expires_at
    into v_invitation
    from public.patient_specialist_invitations
   where token_hash = p_token_hash
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Приглашение не найдено', 'code', 'NOT_FOUND');
  end if;
  if v_invitation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Приглашение уже обработано', 'code', 'ALREADY_PROCESSED');
  end if;
  if v_invitation.expires_at < v_now then
    return jsonb_build_object('ok', false, 'error', 'Приглашение истекло', 'code', 'EXPIRED');
  end if;

  v_owner_type := case v_invitation.module
    when 'support' then 'anonymous_case'
    when 'body' then 'anonymous_profile'
    else null
  end;
  if v_owner_type is null then
    return jsonb_build_object('ok', false, 'error', 'Несоответствие модуля', 'code', 'MODULE_MISMATCH');
  end if;
  if v_invitation.module = 'support'
     and nullif(pg_catalog.btrim(p_public_code), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Не найдена Support-сессия пациента', 'code', 'OWNER_MISMATCH');
  end if;

  if v_invitation.direction = 'specialist_to_patient' then
    if v_invitation.target_owner_id is not null
       and (
         v_invitation.target_owner_id <> p_owner_id
         or v_invitation.target_owner_type is distinct from v_owner_type
       ) then
      return jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'FORBIDDEN');
    end if;
    v_expert_id := v_invitation.inviter_expert_id;
  elsif v_invitation.direction = 'patient_to_specialist' then
    if v_invitation.inviter_owner_type is distinct from v_owner_type
       or v_invitation.inviter_owner_id is distinct from p_owner_id then
      return jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'OWNER_MISMATCH');
    end if;
    v_expert_id := v_invitation.target_expert_id;
  else
    return jsonb_build_object('ok', false, 'error', 'Некорректное приглашение', 'code', 'INVALID_DIRECTION');
  end if;

  if v_expert_id is null then
    return jsonb_build_object('ok', false, 'error', 'Специалист ещё не подключён', 'code', 'EXPERT_UNAVAILABLE');
  end if;

  select id, is_active, allowed_modules
    into v_expert
    from public.experts
   where id = v_expert_id;
  if not found or not v_expert.is_active then
    return jsonb_build_object('ok', false, 'error', 'Специалист недоступен', 'code', 'EXPERT_UNAVAILABLE');
  end if;
  if not coalesce(v_expert.allowed_modules @> array[v_invitation.module]::text[], false) then
    return jsonb_build_object('ok', false, 'error', 'Специалист не имеет доступа к данному модулю', 'code', 'NO_MODULE_ENTITLEMENT');
  end if;
  if v_invitation.organization_id is not null and not exists (
    select 1
      from public.expert_organization_memberships membership
     where membership.expert_id = v_expert_id
       and membership.organization_id = v_invitation.organization_id
       and membership.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Специалист не состоит в этой организации', 'code', 'ORGANIZATION_MISMATCH');
  end if;

  select id, primary_expert_id
    into v_primary
    from public.patient_assignments
   where module = v_invitation.module
     and status = 'active'
     and organization_id is not distinct from v_invitation.organization_id
     and (
       (owner_type = v_owner_type and owner_id = p_owner_id)
       or (v_invitation.module = 'support' and public_code = p_public_code)
     )
   order by created_at desc
   limit 1
   for update;

  if found and v_primary.primary_expert_id <> v_expert_id then
    select id
      into v_additional
      from public.patient_access
     where module = v_invitation.module
       and status = 'active'
       and organization_id is not distinct from v_invitation.organization_id
       and expert_id = v_expert_id
       and (
         (owner_type = v_owner_type and owner_id = p_owner_id)
         or (v_invitation.module = 'support' and public_code = p_public_code)
       )
     order by created_at desc
     limit 1
     for update;

    if not found then
      insert into public.patient_access (
        public_code, owner_type, owner_id, organization_id, expert_id,
        access_role, granted_by_expert_id, granted_by_expert_name, module, status
      ) values (
        case when v_invitation.module = 'support' then p_public_code else null end,
        v_owner_type, p_owner_id, v_invitation.organization_id, v_expert_id,
        'clinician', v_expert_id, 'invitation', v_invitation.module, 'active'
      );
    end if;
  elsif found then
    update public.patient_access
       set status = 'revoked'
     where status = 'active'
       and module = v_invitation.module
       and organization_id is not distinct from v_invitation.organization_id
       and expert_id = v_expert_id
       and (
         (owner_type = v_owner_type and owner_id = p_owner_id)
         or (v_invitation.module = 'support' and public_code = p_public_code)
       );
  else
    insert into public.patient_assignments (
      public_code, owner_type, owner_id, organization_id, primary_expert_id,
      assigned_by_expert_id, assigned_by_expert_name, module, status, source
    ) values (
      case when v_invitation.module = 'support' then p_public_code else null end,
      v_owner_type, p_owner_id, v_invitation.organization_id, v_expert_id,
      v_expert_id, 'invitation', v_invitation.module, 'active',
      'patient_invitation_accept'
    );

    update public.patient_access
       set status = 'revoked'
     where status = 'active'
       and module = v_invitation.module
       and organization_id is not distinct from v_invitation.organization_id
       and expert_id = v_expert_id
       and (
         (owner_type = v_owner_type and owner_id = p_owner_id)
         or (v_invitation.module = 'support' and public_code = p_public_code)
       );
  end if;

  update public.patient_specialist_invitations
     set status = 'accepted',
         accepted_at = v_now,
         target_owner_id = case
           when direction = 'specialist_to_patient' then p_owner_id
           else target_owner_id
         end,
         target_owner_type = case
           when direction = 'specialist_to_patient' then v_owner_type
           else target_owner_type
         end,
         updated_at = v_now
   where id = v_invitation.id
     and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'message', case
      when v_primary.id is null then 'Специалист назначен'
      else 'Специалист подключён'
    end,
    'relationship', case
      when v_primary.id is null or v_primary.primary_expert_id = v_expert_id then 'primary'
      else 'shared'
    end
  );
end;
$$;

create or replace function public.revoke_patient_specialist_link(
  p_owner_type text,
  p_owner_id uuid,
  p_public_code text,
  p_module text,
  p_expert_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_assignment_count integer := 0;
  v_access_count integer := 0;
begin
  if not (p_module = any (array['support', 'body']))
     or p_owner_type is distinct from (
       case p_module
         when 'support' then 'anonymous_case'
         else 'anonymous_profile'
       end
     )
     or p_owner_id is null
     or p_expert_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LINK', 'error', 'Некорректная связь');
  end if;

  update public.patient_assignments
     set status = 'revoked', updated_at = v_now
   where status = 'active'
     and module = p_module
     and organization_id is not distinct from p_organization_id
     and primary_expert_id = p_expert_id
     and (
       (owner_type = p_owner_type and owner_id = p_owner_id)
       or (p_module = 'support' and public_code = p_public_code)
     );
  get diagnostics v_assignment_count = row_count;

  update public.patient_access
     set status = 'revoked'
   where status = 'active'
     and module = p_module
     and organization_id is not distinct from p_organization_id
     and expert_id = p_expert_id
     and (
       (owner_type = p_owner_type and owner_id = p_owner_id)
       or (p_module = 'support' and public_code = p_public_code)
     );
  get diagnostics v_access_count = row_count;

  update public.patient_specialist_invitations
     set status = 'revoked', revoked_at = v_now, updated_at = v_now
   where status = 'accepted'
     and module = p_module
     and organization_id is not distinct from p_organization_id
     and (
       (
         inviter_expert_id = p_expert_id
         and target_owner_type = p_owner_type
         and target_owner_id = p_owner_id
       )
       or (
         target_expert_id = p_expert_id
         and inviter_owner_type = p_owner_type
         and inviter_owner_id = p_owner_id
       )
     );

  return jsonb_build_object(
    'ok', true,
    'revoked', v_assignment_count + v_access_count,
    'idempotent', v_assignment_count + v_access_count = 0
  );
end;
$$;

create or replace function public.sync_support_assignment_label_from_invitation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_type text;
  v_owner_id uuid;
  v_expert_id uuid;
begin
  if new.status <> 'accepted'
     or new.module <> 'support'
     or nullif(pg_catalog.btrim(new.patient_label), '') is null then
    return new;
  end if;

  if new.direction = 'specialist_to_patient' then
    v_owner_type := new.target_owner_type;
    v_owner_id := new.target_owner_id;
    v_expert_id := new.inviter_expert_id;
  elsif new.direction = 'patient_to_specialist' then
    v_owner_type := new.inviter_owner_type;
    v_owner_id := new.inviter_owner_id;
    v_expert_id := new.target_expert_id;
  end if;

  if v_owner_type is null or v_owner_id is null or v_expert_id is null then
    return new;
  end if;

  update public.patient_assignments assignment
     set patient_label = coalesce(
           assignment.patient_label,
           pg_catalog.btrim(new.patient_label)
         ),
         updated_at = pg_catalog.now()
   where assignment.status = 'active'
     and assignment.module = new.module
     and assignment.organization_id is not distinct from new.organization_id
     and assignment.primary_expert_id = v_expert_id
     and assignment.owner_type = v_owner_type
     and assignment.owner_id = v_owner_id;

  return new;
end;
$$;

drop trigger if exists sync_support_assignment_label_from_invitation
  on public.patient_specialist_invitations;
create trigger sync_support_assignment_label_from_invitation
after insert or update of status, patient_label, target_owner_type, target_owner_id
on public.patient_specialist_invitations
for each row execute function public.sync_support_assignment_label_from_invitation();

create or replace function public.save_medical_encounter_version(
  p_encounter_id uuid,
  p_expected_version integer,
  p_author_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_module text,
  p_organization_id uuid,
  p_encounter_at timestamptz,
  p_status text,
  p_content jsonb,
  p_amendment_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  previous public.medical_encounter_versions%rowtype;
  saved public.medical_encounter_versions%rowtype;
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid version' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('medical-encounter:' || p_encounter_id::text, 0)
  );

  select * into previous
    from public.medical_encounter_versions
   where encounter_id = p_encounter_id
   order by version desc
   limit 1;

  if found then
    if previous.author_id is distinct from p_author_id
       or previous.owner_type is distinct from p_owner_type
       or previous.owner_id is distinct from p_owner_id
       or previous.module is distinct from p_module
       or previous.organization_id is distinct from p_organization_id then
      raise exception 'Scope mismatch' using errcode = '42501';
    end if;
    if previous.version <> p_expected_version then
      raise exception 'Revision conflict' using errcode = '40001';
    end if;
    if exists (
      select 1
        from public.medical_encounter_versions
       where encounter_id = p_encounter_id
         and status = 'confirmed'
    )
       and length(btrim(coalesce(p_amendment_reason, ''))) = 0 then
      raise exception 'Correction reason required' using errcode = '22023';
    end if;
  elsif p_expected_version <> 0 then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;

  insert into public.medical_encounter_versions (
    encounter_id, version, author_id, owner_type, owner_id, module,
    organization_id, encounter_at, status, content, amendment_reason
  ) values (
    p_encounter_id, p_expected_version + 1, p_author_id, p_owner_type,
    p_owner_id, p_module, p_organization_id, p_encounter_at, p_status,
    p_content, coalesce(p_amendment_reason, '')
  )
  returning * into saved;

  return jsonb_build_object(
    'encounter_id', saved.encounter_id,
    'version', saved.version,
    'status', saved.status
  );
end;
$$;

alter table public.practice_places enable row level security;
alter table public.practice_services enable row level security;
alter table public.practice_availability enable row level security;
alter table public.practice_bookings enable row level security;
alter table public.practice_events enable row level security;
alter table public.practice_patient_profile_links enable row level security;
alter table public.medical_encounter_versions enable row level security;

revoke all on table public.practice_places from public, anon, authenticated;
revoke all on table public.practice_services from public, anon, authenticated;
revoke all on table public.practice_availability from public, anon, authenticated;
revoke all on table public.practice_bookings from public, anon, authenticated;
revoke all on table public.practice_events from public, anon, authenticated;
revoke all on table public.practice_patient_profile_links from public, anon, authenticated, service_role;
revoke all on table public.medical_encounter_versions from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.practice_places to service_role;
grant select, insert, update, delete on table public.practice_services to service_role;
grant select, insert, update, delete on table public.practice_availability to service_role;
grant select, insert, update, delete on table public.practice_bookings to service_role;
grant select, insert, update, delete on table public.practice_events to service_role;
grant select, insert, delete on table public.practice_patient_profile_links to service_role;
grant select, insert on table public.medical_encounter_versions to service_role;
grant usage, select on sequence public.medical_encounter_versions_revision_id_seq to service_role;

revoke all on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.expire_practice_holds()
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_default_practice_availability(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_default_practice_availability(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.accept_specialist_invitation(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sync_support_assignment_label_from_invitation()
  from public, anon, authenticated, service_role;
revoke all on function public.save_medical_encounter_version(
  uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.practice_set_updated_at()
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) to service_role;
grant execute on function public.expire_practice_holds() to service_role;
grant execute on function public.ensure_default_practice_availability(uuid, uuid)
  to service_role;
grant execute on function public.reset_default_practice_availability(uuid, uuid)
  to service_role;
grant execute on function public.accept_specialist_invitation(text, uuid, text)
  to service_role;
grant execute on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid)
  to service_role;
grant execute on function public.save_medical_encounter_version(
  uuid, integer, uuid, text, uuid, text, uuid, timestamptz, text, jsonb, text
) to service_role;

comment on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) is 'Reserves an appointment only inside availability saved for the service organization context.';
comment on function public.ensure_default_practice_availability(uuid, uuid) is
  'Creates seven 09:00-18:00 rows only when the specialist context has no saved availability.';
comment on function public.reset_default_practice_availability(uuid, uuid) is
  'After explicit specialist confirmation, deactivates current availability and creates the seven-row default.';
comment on function public.accept_specialist_invitation(text, uuid, text) is
  'Accepts a Support or Health invitation atomically. Creates one primary assignment or one additional access row without duplicates.';
comment on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid) is
  'Revokes exactly one patient-specialist link in one organization and module. Caller identity is verified by the server API.';
comment on function public.sync_support_assignment_label_from_invitation() is
  'Copies the explicit non-clinical patient label from an accepted Support invitation to its canonical assignment.';
