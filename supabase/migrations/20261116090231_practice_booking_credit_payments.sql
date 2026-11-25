-- Appointments are charged atomically from the existing available credit balance.
-- 10 credits = 1 RUB. Existing bookings retain their original payment method.
alter table public.practice_services add column price_credits bigint
  generated always as (ceil(price_kop::numeric / 10)::bigint) stored;

create table public.practice_booking_credits (
  booking_id uuid primary key references public.practice_bookings(id),
  wallet_id uuid not null references public.usage_wallets(id),
  price_kop bigint not null check (price_kop >= 0),
  charged_credits bigint not null check (charged_credits >= 0),
  debit_ledger_id uuid references public.usage_ledger(id),
  refunded_credits bigint not null default 0 check (refunded_credits >= 0),
  cancellation_fee_credits bigint not null default 0 check (cancellation_fee_credits >= 0),
  service_fee_credits bigint not null default 0 check (service_fee_credits >= 0),
  policy_version text not null default '12h-20-v1',
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  refunded_at timestamptz,
  check (refunded_credits + cancellation_fee_credits <= charged_credits),
  check (service_fee_credits <= charged_credits)
);
alter table public.practice_booking_credits enable row level security;
revoke all on public.practice_booking_credits from public, anon, authenticated;
grant select, insert, update on public.practice_booking_credits to service_role;

-- Caller already owns a lock on the booking. Debit, ledger and confirmation
-- commit together. This function never invokes automatic wallet replenishment.
create function public.pay_practice_booking_credits(
  p_booking_id uuid, p_expected_credits bigint, p_policy_version text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  b public.practice_bookings%rowtype;
  s public.practice_services%rowtype;
  w public.usage_wallets%rowtype;
  c public.practice_booking_credits%rowtype;
  debit_id uuid;
  module_name text;
begin
  select * into b from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  select * into c from public.practice_booking_credits where booking_id = b.id;
  if found then
    return jsonb_build_object('booking_id', b.id, 'status', b.status, 'charged_credits', c.charged_credits, 'idempotent_replay', true);
  end if;
  if b.status <> 'held' or b.expires_at <= clock_timestamp() or b.starts_at <= clock_timestamp() then
    raise exception 'Booking is not payable' using errcode = '22023';
  end if;
  select * into s from public.practice_services where id = b.service_id for share;
  if s.price_credits is distinct from p_expected_credits or p_policy_version is distinct from '12h-20-v1' then
    raise exception 'Price or cancellation policy changed' using errcode = 'P0011';
  end if;
  module_name := case b.owner_type when 'anonymous_case' then 'support' when 'anonymous_profile' then 'body' end;
  if module_name is null then raise exception 'Invalid owner' using errcode = '22023'; end if;
  select * into w from public.usage_wallets
    where owner_type = b.owner_type and owner_id = b.owner_id and module = module_name for update;
  if not found or w.status <> 'active' then
    raise exception 'Wallet unavailable' using errcode = 'P0012';
  end if;
  if w.balance < s.price_credits then
    raise exception 'Insufficient credits' using errcode = 'P0010',
      detail = jsonb_build_object('required_credits', s.price_credits, 'available_credits', w.balance,
                                 'missing_credits', s.price_credits - w.balance)::text;
  end if;
  if s.price_credits > 0 then
    update public.usage_wallets set balance = balance - s.price_credits,
      total_used = total_used + s.price_credits, updated_at = now() where id = w.id;
    insert into public.usage_ledger(
      wallet_id, entry_type, amount, balance_before, balance_after, resource_type, request_id, module, session_id, metadata
    ) values (
      w.id, 'usage_debit', s.price_credits, w.balance, w.balance - s.price_credits,
      'practice_booking', 'practice-booking-debit-' || b.id::text, w.module, b.session_id,
      jsonb_build_object('booking_id', b.id, 'policy_version', p_policy_version, 'credits_per_ruble', 10)
    ) returning id into debit_id;
  end if;
  insert into public.practice_booking_credits(booking_id, wallet_id, price_kop, charged_credits, debit_ledger_id)
    values (b.id, w.id, s.price_kop, s.price_credits, debit_id);
  update public.practice_bookings set status = 'confirmed', expires_at = null, updated_at = now() where id = b.id;
  insert into public.practice_events(booking_id, event, actor, payload)
    values (b.id, 'credits_paid', b.owner_id::text, jsonb_build_object('charged_credits', s.price_credits, 'policy_version', p_policy_version));
  return jsonb_build_object('booking_id', b.id, 'status', 'confirmed', 'charged_credits', s.price_credits,
                           'available_credits', w.balance - s.price_credits, 'idempotent_replay', false);
end;
$$;

create function public.reserve_practice_booking_with_credits(
  p_expert_id uuid, p_organization_id uuid, p_place_id uuid, p_service_id uuid,
  p_owner_type text, p_owner_id uuid, p_session_id text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_idempotency_key text,
  p_expected_credits bigint, p_policy_version text
) returns jsonb language plpgsql set search_path = '' as $$
declare
  previous public.practice_bookings%rowtype;
  reserved jsonb;
  paid jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'Idempotency key required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-credit:' || p_idempotency_key, 0));
  select * into previous from public.practice_bookings where idempotency_key = p_idempotency_key;
  if found then
    if previous.owner_type is distinct from p_owner_type or previous.owner_id is distinct from p_owner_id
      or previous.service_id is distinct from p_service_id or previous.starts_at is distinct from p_starts_at then
      raise exception 'Idempotency conflict' using errcode = '23505';
    end if;
    if exists(select 1 from public.practice_booking_credits where booking_id = previous.id) then
      return jsonb_build_object('id', previous.id, 'status', previous.status, 'idempotent_replay', true);
    end if;
    raise exception 'Legacy reservation requires explicit confirmation' using errcode = '22023';
  end if;
  reserved := public.reserve_practice_booking(
    p_expert_id, p_organization_id, p_place_id, p_service_id, p_owner_type, p_owner_id, p_session_id,
    p_starts_at, p_ends_at, p_idempotency_key, 10
  );
  -- Any payment exception rolls back the newly created slot and all ledger writes.
  paid := public.pay_practice_booking_credits((reserved->>'id')::uuid, p_expected_credits, p_policy_version);
  return paid || jsonb_build_object('id', reserved->>'id');
end;
$$;

create function public.practice_cancellation_fee(
  p_amount bigint, p_starts_at timestamptz, p_cancelled_at timestamptz
) returns bigint language sql immutable set search_path = '' as $$
  select case when p_starts_at - p_cancelled_at < interval '12 hours'
    then round(p_amount::numeric * 0.20)::bigint else 0 end;
$$;

create function public.quote_practice_booking_cancellation(p_booking_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  b public.practice_bookings%rowtype;
  c public.practice_booking_credits%rowtype;
  fee bigint := 0;
  amount bigint := 0;
begin
  select * into b from public.practice_bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  select * into c from public.practice_booking_credits where booking_id = b.id;
  if found then
    amount := c.charged_credits;
    fee := public.practice_cancellation_fee(amount, b.starts_at, clock_timestamp());
  end if;
  if b.status = 'cancelled' and c.booking_id is not null then
    fee := c.cancellation_fee_credits;
  end if;
  return jsonb_build_object('booking_id', b.id, 'charged_credits', amount,
    'cancellation_fee_credits', fee, 'refund_credits', amount - fee,
    'free_cancellation_until', b.starts_at - interval '12 hours',
    'can_cancel', b.status in ('held', 'confirmed') and b.starts_at > clock_timestamp());
end;
$$;

create function public.cancel_practice_booking_with_credits(
  p_booking_id uuid, p_actor text, p_expected_fee_credits bigint
) returns jsonb language plpgsql set search_path = '' as $$
declare
  b public.practice_bookings%rowtype;
  c public.practice_booking_credits%rowtype;
  w public.usage_wallets%rowtype;
  fee bigint;
  refund bigint;
  v_cancelled_at timestamptz;
begin
  select * into b from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  select * into c from public.practice_booking_credits where booking_id = b.id;
  if not found then return public.cancel_practice_booking(p_booking_id, p_actor); end if;
  if b.status = 'cancelled' then
    return jsonb_build_object('booking_id', b.id, 'status', b.status, 'refund_credits', c.refunded_credits,
      'cancellation_fee_credits', c.cancellation_fee_credits, 'idempotent_replay', true);
  end if;
  if b.status <> 'confirmed' then raise exception 'Booking is not cancellable' using errcode = '22023'; end if;
  select * into w from public.usage_wallets where id = c.wallet_id for update;
  if not found then raise exception 'Wallet missing' using errcode = 'P0012'; end if;
  v_cancelled_at := clock_timestamp();
  if b.starts_at <= v_cancelled_at then raise exception 'Appointment already started' using errcode = '22023'; end if;
  fee := public.practice_cancellation_fee(c.charged_credits, b.starts_at, v_cancelled_at);
  if p_expected_fee_credits is null or fee > p_expected_fee_credits then
    raise exception 'Cancellation quote changed' using errcode = 'P0013';
  end if;
  refund := c.charged_credits - fee;
  if refund > 0 then
    update public.usage_wallets set balance = balance + refund, total_used = greatest(0, total_used - refund),
      updated_at = now() where id = w.id;
    insert into public.usage_ledger(
      wallet_id, entry_type, amount, balance_before, balance_after, resource_type, request_id, module, session_id,
      reversed_usage_id, metadata
    ) values (
      w.id, 'refund', refund, w.balance, w.balance + refund, 'practice_booking',
      'practice-booking-refund-' || b.id::text, w.module, b.session_id, c.debit_ledger_id,
      jsonb_build_object('booking_id', b.id, 'cancellation_fee_credits', fee, 'policy_version', c.policy_version)
    );
  end if;
  update public.practice_booking_credits set refunded_credits = refund, cancellation_fee_credits = fee,
    refunded_at = v_cancelled_at where booking_id = b.id;
  update public.practice_bookings set status = 'cancelled', cancelled_at = v_cancelled_at, updated_at = now() where id = b.id;
  insert into public.practice_events(booking_id, event, actor, payload) values (
    b.id, 'credits_refunded', p_actor, jsonb_build_object('refund_credits', refund, 'cancellation_fee_credits', fee));
  return jsonb_build_object('booking_id', b.id, 'status', 'cancelled', 'refund_credits', refund,
    'cancellation_fee_credits', fee, 'available_credits', w.balance + refund);
end;
$$;

create function public.complete_practice_booking_with_credits(p_booking_id uuid, p_actor text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  b public.practice_bookings%rowtype;
  c public.practice_booking_credits%rowtype;
  fee bigint;
begin
  select * into b from public.practice_bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  select * into c from public.practice_booking_credits where booking_id = b.id;
  if not found then return public.complete_practice_booking(p_booking_id, p_actor); end if;
  if b.status = 'completed' then
    return jsonb_build_object('booking_id', b.id, 'status', b.status, 'service_fee_credits', c.service_fee_credits, 'idempotent_replay', true);
  end if;
  if b.status <> 'confirmed' then raise exception 'Booking must be confirmed' using errcode = '22023'; end if;
  fee := round(c.charged_credits::numeric * 0.20)::bigint;
  update public.practice_booking_credits set service_fee_credits = fee, settled_at = now() where booking_id = b.id;
  update public.practice_bookings set status = 'completed', completed_at = now(), updated_at = now() where id = b.id;
  insert into public.practice_events(booking_id, event, actor, payload) values (
    b.id, 'credits_settled', p_actor, jsonb_build_object('service_fee_credits', fee, 'specialist_credits', c.charged_credits - fee));
  return jsonb_build_object('booking_id', b.id, 'status', 'completed', 'service_fee_credits', fee);
end;
$$;

revoke all on function public.pay_practice_booking_credits(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.reserve_practice_booking_with_credits(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,bigint,text) from public, anon, authenticated;
revoke all on function public.practice_cancellation_fee(bigint,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.quote_practice_booking_cancellation(uuid) from public, anon, authenticated;
revoke all on function public.cancel_practice_booking_with_credits(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.complete_practice_booking_with_credits(uuid,text) from public, anon, authenticated;
grant execute on function public.pay_practice_booking_credits(uuid,bigint,text) to service_role;
grant execute on function public.reserve_practice_booking_with_credits(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,bigint,text) to service_role;
grant execute on function public.practice_cancellation_fee(bigint,timestamptz,timestamptz) to service_role;
grant execute on function public.quote_practice_booking_cancellation(uuid) to service_role;
grant execute on function public.cancel_practice_booking_with_credits(uuid,text,bigint) to service_role;
grant execute on function public.complete_practice_booking_with_credits(uuid,text) to service_role;
