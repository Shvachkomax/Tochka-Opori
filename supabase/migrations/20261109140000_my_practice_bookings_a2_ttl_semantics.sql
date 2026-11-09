-- Corrective migration 2 for A2 (TEST contour only). Applied history is NOT edited.
-- 1) p_ttl_minutes integer default 10 replaces p_ttl_hours (hours allowed fractional 0.17 but integer column mismatched)
-- 2) idempotency: replay requires identical essential parameters (service, start)
-- 3) confirm requires status='held' and non-expired hold (expired/held-TTL blocks confirm)
-- 4) expired holds are released lazily: confirm of expired → 409; new reserve re-checks freedom via EXCLUDE after expiry sweep

-- ── Replace reserve signature: drop OLD (p_ttl_hours) THEN create NEW (p_ttl_minutes) ──
drop function if exists public.reserve_practice_booking(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,integer);
create or replace function public.reserve_practice_booking(
  p_expert_id uuid, p_organization_id uuid, p_place_id uuid, p_service_id uuid,
  p_owner_type text, p_owner_id uuid, p_session_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text, p_ttl_minutes integer default 10
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_existing public.practice_bookings%rowtype;
  v_service public.practice_services%rowtype;
  v_ends timestamptz;
  v_ttl_min integer;
  v_day date := (p_starts_at)::date;
  v_day_iso_wd integer := extract(isodow from p_starts_at)::integer;
  v_work integer := 0;
  v_exception integer := 0;
  ok boolean := false;
  r record;
begin
  select * into v_service from public.practice_services where id = p_service_id and expert_id = p_expert_id;
  if not found then
    raise exception using errcode = 'practice_service_mismatch', message = 'Service does not belong to doctor';
  end if;
  if p_starts_at is null then raise exception using errcode = 'invalid_start', message = 'Invalid start time'; end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception using errcode = 'slot_in_past', message = 'Slot start is in the past';
  end if;
  v_ttl_min := least(greatest(coalesce(p_ttl_minutes, 10), 1), 1440);
  if p_ends_at is null then
    v_ends := p_starts_at + (v_service.duration_min * interval '1 minute');
  else
    v_ends := p_ends_at;
  end if;
  if v_ends <= p_starts_at then raise exception using errcode = 'invalid_interval', message = 'Invalid interval'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from public.practice_bookings where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.service_id is distinct from p_service_id
        or v_existing.starts_at is distinct from p_starts_at
        or v_existing.owner_id is distinct from p_owner_id
      then
        raise exception using errcode = 'idempotency_conflict', message = 'Same idempotency key with different parameters';
      end if;
      insert into public.practice_events (booking_id, event, actor, payload)
      values (v_existing.id, 'hold_replayed', p_expert_id::text, jsonb_build_object('status', v_existing.status, 'idempotent_replay', true));
      return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
    end if;
  end if;
  select count(*) into v_work from public.practice_availability
  where expert_id = p_expert_id and is_active and weekday = v_day_iso_wd;
  if v_work = 0 then
    raise exception using errcode = 'slot_unavailable', message = 'No working hours for this day';
  end if;
  select count(*) into v_exception from public.practice_availability
  where expert_id = p_expert_id and is_active and exception_date = v_day;
  if v_exception > 0 then
    raise exception using errcode = 'slot_blocked', message = 'Day is blocked for this doctor';
  end if;
  ok := false;
  for r in select * from public.practice_availability
    where expert_id = p_expert_id and is_active and weekday = v_day_iso_wd loop
    if (p_starts_at at time zone 'UTC')::text >= (v_day)::text || ' ' || r.start_time
      and (v_ends at time zone 'UTC')::text <= (v_day)::text || ' ' || r.end_time then
      ok := true; exit;
    end if;
  end loop;
  if not ok then
    raise exception using errcode = 'slot_unavailable', message = 'Outside working hours';
  end if;
  perform public.expire_practice_holds();
  insert into public.practice_bookings (
    expert_id, organization_id, place_id, service_id,
    owner_type, owner_id, session_id, status,
    starts_at, ends_at, idempotency_key, expires_at
  ) values (
    p_expert_id, p_organization_id, p_place_id, p_service_id,
    p_owner_type, p_owner_id, p_session_id, 'held',
    p_starts_at, v_ends, p_idempotency_key, now() + (v_ttl_min * interval '1 minute')
  ) returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'hold_created', p_expert_id::text,
          jsonb_build_object('service_id', p_service_id, 'starts_at', p_starts_at));
  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

-- confirm: reject expired holds (lazy expiry within confirm too)
create or replace function public.confirm_practice_booking(
  p_booking_id uuid, p_payment_idempotency_key text, p_actor text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
begin
  select * into v_booking from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'booking_not_found', message = 'Booking not found'; end if;
  if v_booking.status = 'held' and v_booking.expires_at is not null and v_booking.expires_at < now() then
    perform public.expire_practice_holds();
    raise exception using errcode = 'hold_expired', message = 'Hold expired';
  end if;
  if v_booking.status = 'confirmed' then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
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

-- EXCLUDE constraint already uses gist half-open semantics for tstzrange(starts_at, ends_at, '[]').
-- PostgreSQL tstzrange '[]' is closed at both ends; for correct adjacency with half-open semantics we recreate
-- the constraint with '[)' — wait, Postgres EXCLUDE with tstzrange overlaps uses default equality on ranges
-- which already implements contains/overlaps logic correctly for adjacent ranges when '[]' boundaries match.
-- Adjacent [10:00,11:00) [11:00,12:00) with tstzrange(...,'[]') — 11:00 is included in both bounds → potential false clash.
-- To guarantee half-open adjacency, recreate constraint with '[)' subtype:
alter table public.practice_bookings drop constraint if exists practice_bookings_no_double_booking;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'practice_bookings_no_double_booking_halfopen' and conrelid = 'public.practice_bookings'::regclass
  ) then
    alter table public.practice_bookings
      add constraint practice_bookings_no_double_booking_halfopen
      exclude using gist (
        expert_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status in ('held','confirmed'));
  end if;
end $$;
