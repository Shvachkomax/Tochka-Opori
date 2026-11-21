-- A3.8.1: enforce availability in the service's exact practice context.
-- Public slot generation already filters by organization; this keeps the
-- transactional booking guard consistent with that view.

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
    if v_start_min >= (split_part(r.start_time, ':', 1)::integer * 60 + split_part(r.start_time, ':', 2)::integer)
       and v_end_min <= (split_part(r.end_time, ':', 1)::integer * 60 + split_part(r.end_time, ':', 2)::integer) then
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
    p_starts_at, v_ends, p_idempotency_key, now() + (v_ttl_min * interval '1 minute')
  ) returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (v_booking.id, 'hold_created', p_owner_id::text,
          jsonb_build_object('service_id', p_service_id, 'starts_at', p_starts_at,
                            'ttl_minutes', v_ttl_min));
  return jsonb_build_object('id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', false);
end;
$$;

revoke all on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) to service_role;

comment on function public.reserve_practice_booking(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, integer
) is 'Reserves an appointment only inside availability saved for the service organization context.';
