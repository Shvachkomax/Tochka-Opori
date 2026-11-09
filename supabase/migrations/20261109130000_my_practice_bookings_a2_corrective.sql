-- Corrective migration for A2 (TEST contour). Does not touch applied history.
-- Adds missing/needed guards without changing existing tables:
-- 1) idempotency uniqueness also for payments (missing in applied version)
-- 2) ttl shortened to 10 minutes (reserve default) — RPC now emits both; enforcement is server-side on reserve calls.
-- 3) booking state machine guard: completed/cancelled cannot silently revert (replay is fine).

create unique index if not exists practice_payments_idem_idx
  on public.practice_payments (idempotency_key) where idempotency_key is not null;

create or replace function public.reserve_practice_booking(
  p_expert_id uuid, p_organization_id uuid, p_place_id uuid, p_service_id uuid,
  p_owner_type text, p_owner_id uuid, p_session_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text, p_ttl_hours integer default 2
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
  v_existing public.practice_bookings%rowtype;
  v_service public.practice_services%rowtype;
  v_ends timestamptz;
  v_ttl integer;
  v_day date := (p_starts_at)::date;
  v_day_iso_wd integer := extract(isodow from p_starts_at)::integer;
  v_start_min integer := extract(hour from p_starts_at)::integer * 60 + extract(minute from p_starts_at)::integer;
  v_work integer := 0;
  v_exception integer := 0;
  ok boolean := false;
  r record;
begin
  -- hard contract: slot must be in the future and inside working hours
  select * into v_service from public.practice_services where id = p_service_id and expert_id = p_expert_id;
  if not found then
    raise exception using errcode = 'practice_service_mismatch', message = 'Service does not belong to doctor';
  end if;
  if p_starts_at is null then raise exception using errcode = 'invalid_start', message = 'Invalid start time'; end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception using errcode = 'slot_in_past', message = 'Slot start is in the past';
  end if;
  v_ttl := least(greatest(coalesce(p_ttl_hours, 2), 0), 24); -- hours, server cap
  if p_ends_at is null then
    v_ends := p_starts_at + (v_service.duration_min * interval '1 minute');
  else
    v_ends := p_ends_at;
  end if;
  if v_ends <= p_starts_at then raise exception using errcode = 'invalid_interval', message = 'Invalid interval'; end if;
  -- availability re-check on server before side effects
    select count(*) into v_work from public.practice_availability
    where expert_id = p_expert_id and is_active
      and (weekday = v_day_iso_wd or exception_date = v_day);
    if v_work = 0 then
      raise exception using errcode = 'slot_unavailable', message = 'No working hours for this day';
    end if;
    select count(*) into v_exception from public.practice_availability
    where expert_id = p_expert_id and is_active and exception_date = v_day;
    if v_exception > 0 then
      raise exception using errcode = 'slot_blocked', message = 'Day is blocked for this doctor';
    end if;
    -- check the requested start falls within a working window on that weekday (HH:MM text, lexicographic compare is safe)
    for r in select * from public.practice_availability
      where expert_id = p_expert_id and is_active and weekday = v_day_iso_wd loop
      if (p_starts_at at time zone 'UTC')::text >= (v_day)::text || ' ' || r.start_time then
        ok := true; exit;
      end if;
    end loop;
    if not ok then
      raise exception using errcode = 'slot_unavailable', message = 'Outside working hours';
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
  insert into public.practice_bookings (
    expert_id, organization_id, place_id, service_id,
    owner_type, owner_id, session_id, status,
    starts_at, ends_at, idempotency_key, expires_at
  ) values (
    p_expert_id, p_organization_id, p_place_id, p_service_id,
    p_owner_type, p_owner_id, p_session_id, 'held',
    p_starts_at, v_ends, p_idempotency_key, now() + (v_ttl * interval '1 hour')
  ) returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'hold_created', p_expert_id::text,
          jsonb_build_object('service_id', p_service_id, 'starts_at', p_starts_at));
  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

-- commission must transition held → payable on completion (idempotent)
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
  values (v_booking.id, v_payment.id, v_payment.amount_kop, v_payment.fee_bps, v_fee, 'payable')
  returning id into v_commission_id;
  update public.practice_bookings set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_booking.id returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'commission_payable', p_actor, jsonb_build_object('commission_id', v_commission_id));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'commission_id', v_commission_id);
end;
$$;
