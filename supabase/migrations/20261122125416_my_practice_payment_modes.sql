-- R2.2: payment-mode separation for My Practice.
--
-- This forward-only migration preserves A2's test-credit workflow and its
-- historical records. It adds the independent, explicitly unpaid request
-- state required when Production has no acquirer. No wallet, credit, test
-- payment, commission, or real-payment record is created by the new RPCs.

-- A request reserves the slot and is intentionally neither confirmed nor paid.
-- Locate the prior unnamed status CHECK defensively before replacing it.
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.practice_bookings'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%'
   order by conname
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.practice_bookings drop constraint %I', v_constraint);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.practice_bookings'::regclass
       and conname = 'practice_bookings_status_check'
  ) then
    alter table public.practice_bookings
      add constraint practice_bookings_status_check
      check (status in ('held', 'requested', 'confirmed', 'completed', 'cancelled', 'expired'));
  end if;
end
$$;

-- An unpaid request must block the exact slot just as a payment hold or a
-- confirmed booking does. Existing held/confirmed rows already satisfy the
-- old exclusion constraint, so this replacement cannot admit an overlap.
alter table public.practice_bookings
  drop constraint if exists practice_bookings_no_double_booking;
alter table public.practice_bookings
  drop constraint if exists practice_bookings_no_double_booking_halfopen;
alter table public.practice_bookings
  add constraint practice_bookings_no_double_booking_halfopen
  exclude using gist (
    expert_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held', 'requested', 'confirmed'));

-- Reuse the existing atomic service/context/availability/idempotency guard,
-- then turn only its short hold into a durable unpaid request. The wrapper is
-- service-role only; the API independently verifies the patient session.
create or replace function public.request_practice_booking_without_payment(
  p_expert_id uuid,
  p_organization_id uuid,
  p_place_id uuid,
  p_service_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_session_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
  v_booking public.practice_bookings%rowtype;
  v_booking_id uuid;
begin
  v_result := public.reserve_practice_booking(
    p_expert_id,
    p_organization_id,
    p_place_id,
    p_service_id,
    p_owner_type,
    p_owner_id,
    p_session_id,
    p_starts_at,
    p_ends_at,
    p_idempotency_key,
    10
  );
  v_booking_id := (v_result ->> 'id')::uuid;

  select * into v_booking
    from public.practice_bookings
   where id = v_booking_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Booking not found after reservation';
  end if;
  if v_booking.status = 'requested' then
    return jsonb_build_object(
      'id', v_booking.id,
      'status', v_booking.status,
      'idempotent_replay', true,
      'payment_required', true
    );
  end if;
  if v_booking.status <> 'held' then
    raise exception using errcode = 'P0003', message = 'Booking is not requestable';
  end if;

  update public.practice_bookings
     set status = 'requested',
         expires_at = null,
         updated_at = now()
   where id = v_booking.id
   returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (
    v_booking.id,
    'requested_without_payment',
    p_owner_id::text,
    jsonb_build_object('service_id', p_service_id, 'payment_required', true)
  );
  return jsonb_build_object(
    'id', v_booking.id,
    'status', v_booking.status,
    'idempotent_replay', false,
    'payment_required', true
  );
end;
$$;

create or replace function public.cancel_practice_booking_request(
  p_booking_id uuid,
  p_actor text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.practice_bookings%rowtype;
begin
  select * into v_booking
    from public.practice_bookings
   where id = p_booking_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Booking not found';
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('booking_id', v_booking.id, 'status', v_booking.status, 'idempotent_replay', true);
  end if;
  if v_booking.status <> 'requested' then
    raise exception using errcode = 'P0003', message = 'Only an unpaid request can be cancelled by this path';
  end if;

  update public.practice_bookings
     set status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   where id = v_booking.id
   returning * into v_booking;
  insert into public.practice_events (booking_id, event, actor, payload)
  values (
    v_booking.id,
    'request_cancelled_without_payment',
    coalesce(p_actor, 'patient'),
    jsonb_build_object('payment_performed', false)
  );
  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'idempotent_replay', false,
    'payment_performed', false
  );
end;
$$;

revoke all on function public.request_practice_booking_without_payment(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.cancel_practice_booking_request(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_practice_booking_without_payment(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text
) to service_role;
grant execute on function public.cancel_practice_booking_request(uuid, text)
  to service_role;

-- The trigger function is not an application RPC. Removing its broad EXECUTE
-- grant prevents direct use without affecting the table-owned triggers.
revoke all on function public.practice_set_updated_at()
  from public, anon, authenticated, service_role;

comment on function public.request_practice_booking_without_payment(
  uuid, uuid, uuid, uuid, text, uuid, text, timestamptz, timestamptz, text
) is 'Creates a durable explicitly unpaid practice booking request without wallet, credit, payment, or commission mutation.';
comment on function public.cancel_practice_booking_request(uuid, text)
  is 'Cancels an explicitly unpaid booking request without a refund or financial mutation.';
