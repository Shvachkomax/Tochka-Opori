-- A2 hardening (TEST Supabase only: eehyehlhiyztciaezaus).
-- Keeps the existing booking contract, but fixes invalid PostgreSQL SQLSTATE
-- names, makes expired holds persist as expired, and prevents duplicate fees.

create unique index if not exists practice_commissions_booking_idx
  on public.practice_commissions (booking_id);

create or replace function public.reserve_practice_booking(
  p_expert_id uuid, p_organization_id uuid, p_place_id uuid, p_service_id uuid,
  p_owner_type text, p_owner_id uuid, p_session_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text,
  p_ttl_minutes integer default 10
) returns jsonb language plpgsql set search_path = '' as $$
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

  -- Same idempotency key is a replay only when its semantic inputs match.
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
    values (v_existing.id, 'hold_replayed', p_owner_id::text,
            jsonb_build_object('status', v_existing.status, 'idempotent_replay', true));
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'idempotent_replay', true);
  end if;

  select count(*) into v_work
    from public.practice_availability
   where expert_id = p_expert_id and is_active and weekday = v_day_iso_wd;
  if v_work = 0 then
    raise exception using errcode = '22023', message = 'No working hours for this day';
  end if;
  select count(*) into v_exception
    from public.practice_availability
   where expert_id = p_expert_id and is_active and exception_date = v_day;
  if v_exception > 0 then
    raise exception using errcode = '22023', message = 'Day is blocked for this doctor';
  end if;
  for r in
    select start_time, end_time
      from public.practice_availability
     where expert_id = p_expert_id and is_active and weekday = v_day_iso_wd
  loop
    if v_start_min >= (split_part(r.start_time, ':', 1)::integer * 60 + split_part(r.start_time, ':', 2)::integer)
       and v_end_min <= (split_part(r.end_time, ':', 1)::integer * 60 + split_part(r.end_time, ':', 2)::integer) then
      v_in_window := true;
      exit;
    end if;
  end loop;
  if not v_in_window then
    raise exception using errcode = '22023', message = 'Outside working hours';
  end if;

  -- Expiry is lazy, but it runs in the same transaction as the new hold.
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
  values (v_booking.id, 'hold_created', p_owner_id::text,
          jsonb_build_object('service_id', p_service_id, 'starts_at', p_starts_at,
                             'ttl_minutes', v_ttl_min));
  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

create or replace function public.confirm_practice_booking(
  p_booking_id uuid, p_payment_idempotency_key text, p_actor text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_booking public.practice_bookings%rowtype;
begin
  if p_payment_idempotency_key is null or btrim(p_payment_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Payment idempotency key is required';
  end if;
  select * into v_booking from public.practice_bookings where id = p_booking_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Booking not found';
  end if;
  if v_booking.status = 'held' and v_booking.expires_at is not null and v_booking.expires_at <= now() then
    -- Do not raise after this update: an exception would roll the expiry back.
    update public.practice_bookings
       set status = 'expired', updated_at = now()
     where id = v_booking.id;
    insert into public.practice_events (booking_id, event, actor, payload)
    values (v_booking.id, 'expired', coalesce(p_actor, 'system'), jsonb_build_object('source', 'confirm'));
    return jsonb_build_object('booking_id', v_booking.id, 'status', 'expired', 'expired', true);
  end if;
  if v_booking.status = 'confirmed' then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
  end if;
  if v_booking.status <> 'held' then
    raise exception using errcode = 'P0003', message = 'Booking is not confirmable';
  end if;
  insert into public.practice_payments (booking_id, amount_kop, provider, status, idempotency_key)
  select v_booking.id, s.price_kop, 'test', 'test_paid', p_payment_idempotency_key
    from public.practice_services s where s.id = v_booking.service_id;
  update public.practice_bookings
     set status = 'confirmed', updated_at = now(), expires_at = null
   where id = v_booking.id
  returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'payment_tested', coalesce(p_actor, 'patient_test'), jsonb_build_object('provider', 'test'));
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
  if not found then
    raise exception using errcode = 'P0002', message = 'Booking not found';
  end if;
  if v_booking.status = 'completed' then
    select id into v_commission_id from public.practice_commissions where booking_id = v_booking.id;
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status,
                              'commission_id', v_commission_id, 'idempotent_replay', true);
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception using errcode = 'P0003', message = 'Booking must be confirmed to complete';
  end if;
  select * into v_payment from public.practice_payments
   where booking_id = v_booking.id and status = 'test_paid'
   order by created_at desc limit 1;
  if not found then
    raise exception using errcode = 'P0004', message = 'No confirmed test payment';
  end if;
  v_fee := round(v_payment.amount_kop * v_payment.fee_bps / 10000.0)::bigint;
  insert into public.practice_commissions (booking_id, payment_id, base_kop, rate_bps, fee_kop, status)
  values (v_booking.id, v_payment.id, v_payment.amount_kop, v_payment.fee_bps, v_fee, 'payable')
  returning id into v_commission_id;
  update public.practice_bookings
     set status = 'completed', completed_at = now(), updated_at = now()
   where id = v_booking.id
  returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'commission_payable', coalesce(p_actor, 'expert'), jsonb_build_object('commission_id', v_commission_id));
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
  if not found then
    raise exception using errcode = 'P0002', message = 'Booking not found';
  end if;
  if v_booking.status = 'held' and v_booking.expires_at is not null and v_booking.expires_at <= now() then
    update public.practice_bookings set status = 'expired', updated_at = now() where id = v_booking.id;
    insert into public.practice_events (booking_id, event, actor, payload)
    values (v_booking.id, 'expired', coalesce(p_actor, 'system'), jsonb_build_object('source', 'cancel'));
    return jsonb_build_object('booking_id', v_booking.id, 'status', 'expired', 'idempotent_replay', true);
  end if;
  if v_booking.status not in ('held', 'confirmed') then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
  end if;
  update public.practice_bookings
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = v_booking.id
  returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'cancelled', coalesce(p_actor, 'patient_test'), jsonb_build_object('was', v_booking.status));
  return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

create or replace function public.expire_practice_holds() returns integer language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  with moved as (
    update public.practice_bookings
       set status = 'expired', updated_at = now()
     where status = 'held' and expires_at is not null and expires_at <= now()
     returning id, expert_id
  )
  insert into public.practice_events (booking_id, event, actor, payload)
  select id, 'expired', 'system', jsonb_build_object('source', 'expiry_job') from moved;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
