-- A2: server-side booking (TEST CONTOUR). No production, no real payments.
-- Existing synthetic workspace table is untouched (preview-only)
-- Run against TEST Supabase only (EXPECTED_SUPABASE_PROJECT=eehyehlhiyztciaezaus)
-- Idempotent: safe to re-run. Rollback: drop the 6 tables if empty via a separate maintenance step.
--
-- Authorization model (preserved):
--   expert_id        doctor (public.experts)
--   organization_id  defines access rights (membership); NULL = private practice
--   place_id         doctor-owned reference place ('passport'), NOT a membership
--   owner            existing patient model (sessions/body). Booking never creates patient rows here.
-- Server-side: all writes through api/specialist.js with service-role + membership checks.
-- RLS: enabled everywhere, service-role only (same pattern as synthetic workspaces).

-- ── 1. practice_places — doctor's own reference places (free-text, not licensed clinics) ──
create table if not exists public.practice_places (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  name text not null,
  address text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (name <> '')
);
create index if not exists practice_places_expert_idx on public.practice_places (expert_id);

-- ── 2. practice_services — doctor's own catalog per context ──
create table if not exists public.practice_services (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete set null,
  place_id uuid null references public.practice_places(id) on delete set null,
  name text not null,
  format text not null default 'offline',
  price_kop bigint not null default 0,
  duration_min integer not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (name <> ''),
  check (price_kop >= 0),
  check (duration_min between 15 and 240),
  check (format in ('offline','online','phone','video'))
);
create index if not exists practice_services_expert_idx on public.practice_services (expert_id) where is_active;
create index if not exists practice_services_context_idx on public.practice_services (expert_id, organization_id, place_id);

-- ── 3. practice_availability — weekly working hours + exception blocks ──
create table if not exists public.practice_availability (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete set null,
  weekday integer not null default 1,          -- ISO 1..7 (Mon..Sun); 0 = date-specific exception
  exception_date date,                          -- non-null => vacation/personal block for that date; start/end times still apply
  start_time text not null default '09:00',
  end_time text not null default '18:00',
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (weekday between 0 and 7),
  check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  check (end_time > start_time)
);
create index if not exists practice_availability_expert_idx on public.practice_availability (expert_id, is_active);
create index if not exists practice_availability_date_idx on public.practice_availability (expert_id, exception_date) where exception_date is not null;

-- ── 4. practice_bookings — holds + confirmed + completed + cancelled + expired ──
create table if not exists public.practice_bookings (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  organization_id uuid null references public.organizations(id) on delete set null,
  place_id uuid null references public.practice_places(id) on delete set null,
  service_id uuid not null references public.practice_services(id) on delete restrict,
  owner_type text,                              -- existing patient model: anonymous_case / anonymous_profile
  owner_id uuid,                                -- sessions.anonymous_owner_id
  session_id text,                              -- sessions.session_id
  status text not null default 'held',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  idempotency_key text,
  expires_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('held','confirmed','completed','cancelled','expired')),
  check (ends_at > starts_at),
  check (
    (owner_type is null and owner_id is null)
    or (owner_type is not null and owner_id is not null)
  )
);
create unique index if not exists practice_bookings_idem_idx on public.practice_bookings (idempotency_key) where idempotency_key is not null;
create index if not exists practice_bookings_expert_idx on public.practice_bookings (expert_id, status, starts_at);
create index if not exists practice_bookings_owner_idx on public.practice_bookings (owner_type, owner_id);
create index if not exists practice_bookings_expires_idx on public.practice_bookings (expires_at) where status = 'held';

-- Double-booking protection at DB level: same doctor, overlapping time, active statuses.
-- (busy-vs-booked already enforced client-side in demo; this is the server truth.)
create extension if not exists btree_gist;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'practice_bookings_no_double_booking'
      and conrelid = 'public.practice_bookings'::regclass
  ) then
    alter table public.practice_bookings
      add constraint practice_bookings_no_double_booking
      exclude using gist (
        expert_id with =,
        tstzrange(starts_at, ends_at, '[]') with &&
      ) where (status in ('held','confirmed'));
  end if;
end $$;

-- ── 5. practice_payments — TEST simulation only, RUB only, separate ledger ──
create table if not exists public.practice_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.practice_bookings(id) on delete cascade,
  amount_kop bigint not null default 0,         -- amount snapshot at confirm time
  currency text not null default 'RUB',
  provider text not null default 'test',        -- NEVER a real acquirer
  status text not null default 'test_paid',     -- test_paid | refunded
  idempotency_key text,
  fee_bps integer not null default 2000,        -- 20% snapshot
  created_at timestamptz not null default now(),
  check (amount_kop >= 0),
  check (fee_bps between 0 and 10000),
  check (status in ('test_paid','refunded'))
);
create unique index if not exists practice_payments_idem_idx on public.practice_payments (idempotency_key) where idempotency_key is not null;
create table if not exists public.practice_commissions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.practice_bookings(id) on delete cascade,
  payment_id uuid null references public.practice_payments(id) on delete set null,
  base_kop bigint not null default 0,
  rate_bps integer not null default 2000,
  fee_kop bigint not null default 0,
  status text not null default 'held',          -- held | payable | reversed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (base_kop >= 0 and fee_kop >= 0),
  check (rate_bps between 0 and 10000),
  check (status in ('held','payable','reversed'))
);

-- ── 6. practice_events — append-only audit ──
create table if not exists public.practice_events (
  id bigint generated always as identity primary key,
  booking_id uuid null references public.practice_bookings(id) on delete set null,
  event text not null,                          -- hold_created|hold_replayed|confirmed|completed|cancelled|expired|payment_tested|commission_held|commission_payable|commission_reversed
  actor text,                                   -- expert_id / owner ref / system
  payload jsonb,
  at timestamptz not null default now()
);
create index if not exists practice_events_booking_idx on public.practice_events (booking_id, at);

-- ── updated_at triggers ──
create or replace function public.practice_set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql set search_path = '';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'practice_services_touch') then
    create trigger practice_services_touch before update on public.practice_services
      for each row execute function public.practice_set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'practice_bookings_touch') then
    create trigger practice_bookings_touch before update on public.practice_bookings
      for each row execute function public.practice_set_updated_at();
  end if;
end $$;

-- ── 7. Atomic reserve RPC + maintenance helpers ──
-- All callers must pass service_role. Performed atomically in one transaction.
-- Returns jsonb {id, status} or raises 23505/400 etc (API maps to 409).
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
  p_ttl_hours integer default 2
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_existing public.practice_bookings%rowtype;
  v_service public.practice_services%rowtype;
  v_ends timestamptz;
begin
  -- test-contour guard: never trust client-supplied amounts
  select * into v_service from public.practice_services where id = p_service_id and expert_id = p_expert_id;
  if not found then
    raise exception using errcode = 'practice_service_mismatch', message = 'Service does not belong to doctor';
  end if;
  if p_ends_at is null then
    v_ends := p_starts_at + (v_service.duration_min * interval '1 minute');
  else
    v_ends := p_ends_at;
  end if;
  -- idempotency: replay returns existing hold
  if p_idempotency_key is not null then
    select * into v_existing from public.practice_bookings where idempotency_key = p_idempotency_key;
    if found then
      insert into public.practice_events (booking_id, event, actor, payload)
      values (v_existing.id, 'hold_replayed', p_expert_id::text, jsonb_build_object('status', v_existing.status, 'idempotent_replay', true));
      return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
    end if;
  end if;
  -- double-booking protection: EXCLUDE constraint fires here on conflict (errcode 23P01)
  insert into public.practice_bookings (
    expert_id, organization_id, place_id, service_id,
    owner_type, owner_id, session_id, status,
    starts_at, ends_at, idempotency_key, expires_at
  ) values (
    p_expert_id, p_organization_id, p_place_id, p_service_id,
    p_owner_type, p_owner_id, p_session_id, 'held',
    p_starts_at, v_ends, p_idempotency_key, now() + (p_ttl_hours * interval '1 hour')
  ) returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'hold_created', p_expert_id::text,
          jsonb_build_object('service_id', p_service_id, 'starts_at', p_starts_at));
  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

create or replace function public.confirm_practice_booking(
  p_booking_id uuid, p_payment_idempotency_key text, p_actor text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_payment public.practice_payments%rowtype;
  v_replay boolean := false;
begin
  select * into v_booking from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'booking_not_found', message = 'Booking not found'; end if;
  if v_booking.status = 'confirmed' then
    select * into v_payment from public.practice_payments where idempotency_key = p_payment_idempotency_key;
    if found then
      insert into public.practice_events (booking_id, event, actor, payload)
      values (v_booking.id, 'hold_replayed', p_actor, jsonb_build_object('payment_idempotent_replay', true));
      return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
    end if;
    raise exception using errcode = 'booking_not_confirmed', message = 'Booking is not confirmable';
  end if;
  if v_booking.status <> 'held' then
    raise exception using errcode = 'booking_not_confirmed', message = 'Booking is not confirmable';
  end if;
  insert into public.practice_payments (booking_id, amount_kop, provider, status, idempotency_key)
  select v_booking.id, s.price_kop, 'test', 'test_paid', p_payment_idempotency_key
  from public.practice_services s where s.id = v_booking.service_id;
  update public.practice_bookings set status = 'confirmed', updated_at = now(), expires_at = null
  where id = v_booking.id returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'payment_tested', p_actor, jsonb_build_object('provider', 'test'));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

create or replace function public.complete_practice_booking(
  p_booking_id uuid, p_actor text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_payment public.practice_payments%rowtype;
  v_fee bigint;
  v_commission_id uuid;
begin
  select * into v_booking from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'booking_not_found', message = 'Booking not found'; end if;
  if v_booking.status = 'completed' then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception using errcode = 'booking_not_confirmed', message = 'Booking must be confirmed to complete';
  end if;
  select * into v_payment from public.practice_payments
  where booking_id = v_booking.id and status = 'test_paid' order by created_at desc limit 1;
  if not found then raise exception using errcode = 'payment_not_found', message = 'No confirmed test payment'; end if;
  v_fee := round(v_payment.amount_kop * v_payment.fee_bps / 10000.0)::bigint;
  insert into public.practice_commissions (booking_id, payment_id, base_kop, rate_bps, fee_kop, status)
  values (v_booking.id, v_payment.id, v_payment.amount_kop, v_payment.fee_bps, v_fee, 'held')
  returning id into v_commission_id;
  update public.practice_bookings set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_booking.id returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'commission_held', p_actor, jsonb_build_object('commission_id', v_commission_id));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'commission_id', v_commission_id);
end;
$$;

create or replace function public.cancel_practice_booking(
  p_booking_id uuid, p_actor text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
begin
  select * into v_booking from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'booking_not_found', message = 'Booking not found'; end if;
  if v_booking.status not in ('held','confirmed') then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
  end if;
  update public.practice_bookings set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = v_booking.id returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'cancelled', p_actor, jsonb_build_object('was', v_booking.status));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

create or replace function public.expire_practice_holds() returns integer language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  with moved as (
    update public.practice_bookings
    set status = 'expired', updated_at = now()
    where status = 'held' and expires_at is not null and expires_at < now()
    returning id, expert_id
  )
  insert into public.practice_events (booking_id, event, actor, payload)
  select id, 'expired', 'system', jsonb_build_object('source','expiry_job') from moved;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 8. RLS + grants (service_role only, API checks authorization) ──
alter table public.practice_places enable row level security;
alter table public.practice_services enable row level security;
alter table public.practice_availability enable row level security;
alter table public.practice_bookings enable row level security;
alter table public.practice_payments enable row level security;
alter table public.practice_commissions enable row level security;
alter table public.practice_events enable row level security;

revoke all on public.practice_places from public, anon, authenticated;
revoke all on public.practice_services from public, anon, authenticated;
revoke all on public.practice_availability from public, anon, authenticated;
revoke all on public.practice_bookings from public, anon, authenticated;
revoke all on public.practice_payments from public, anon, authenticated;
revoke all on public.practice_commissions from public, anon, authenticated;
revoke all on public.practice_events from public, anon, authenticated;
grant select,insert,update,delete on public.practice_places to service_role;
grant select,insert,update,delete on public.practice_services to service_role;
grant select,insert,update,delete on public.practice_availability to service_role;
grant select,insert,update,delete on public.practice_bookings to service_role;
grant select,insert,update,delete on public.practice_payments to service_role;
grant select,insert,update,delete on public.practice_commissions to service_role;
grant select,insert,update,delete on public.practice_events to service_role;

revoke all on function public.reserve_practice_booking(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,integer) from public, anon, authenticated;
revoke all on function public.confirm_practice_booking(uuid,text,text) from public, anon, authenticated;
revoke all on function public.complete_practice_booking(uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_practice_booking(uuid,text) from public, anon, authenticated;
revoke all on function public.expire_practice_holds() from public, anon, authenticated;
grant execute on function public.reserve_practice_booking(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,integer) to service_role;
grant execute on function public.confirm_practice_booking(uuid,text,text) to service_role;
grant execute on function public.complete_practice_booking(uuid,text) to service_role;
grant execute on function public.cancel_practice_booking(uuid,text) to service_role;
grant execute on function public.expire_practice_holds() to service_role;
