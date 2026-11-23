\set ON_ERROR_STOP on

begin;

insert into public.organizations (id, name, slug, type, status)
values (
  'a1000000-0000-4000-8000-000000000001',
  'R232 Test Credits Synthetic Clinic',
  'r232-test-credits-synthetic-clinic',
  'clinic',
  'active'
);

insert into public.experts (
  id, name, role, specialty, access_code, is_active, allowed_modules
)
values (
  'b1000000-0000-4000-8000-000000000001',
  'R232 Test Credits Synthetic Doctor',
  'doctor',
  'synthetic',
  'R232-TEST-CREDITS',
  true,
  array['support', 'body']::text[]
);

insert into public.expert_organization_memberships (
  id, organization_id, expert_id, role, status
)
values (
  'd1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'doctor',
  'active'
);

insert into public.usage_wallets (
  id, owner_type, owner_id, module, balance, refill_amount, refill_mode,
  cycle_number, total_used, total_refilled, status, partner_funding_kind
)
values (
  '71000000-0000-4000-8000-000000000001',
  'anonymous_case',
  'c1000000-0000-4000-8000-000000000001',
  'support',
  50000,
  0,
  'disabled',
  1,
  0,
  0,
  'active',
  'test'
);

insert into public.practice_places (id, expert_id, name)
values (
  '11000000-0000-4000-8000-000000000011',
  'b1000000-0000-4000-8000-000000000001',
  'R232 Test Credits Synthetic Place'
);

insert into public.practice_services (
  id, expert_id, organization_id, place_id, name, format,
  price_kop, duration_min, is_active, modules
)
values (
  '12000000-0000-4000-8000-000000000011',
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000011',
  'R232 Test Credits Synthetic Consultation',
  'offline',
  100000,
  60,
  true,
  array['support']::text[]
);

select public.ensure_default_practice_availability(
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001'
);

set local role service_role;

select public.reserve_practice_booking_with_credits(
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000011',
  '12000000-0000-4000-8000-000000000011',
  'anonymous_case',
  'c1000000-0000-4000-8000-000000000001',
  'r232-test-credits-session',
  date_trunc('day', now()) + interval '14 days 10 hours',
  null,
  'r232-test-credits-booking',
  10000,
  '12h-20-v1'
);

-- The second call is an idempotent replay and must not debit again.
select public.reserve_practice_booking_with_credits(
  'b1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000011',
  '12000000-0000-4000-8000-000000000011',
  'anonymous_case',
  'c1000000-0000-4000-8000-000000000001',
  'r232-test-credits-session',
  date_trunc('day', now()) + interval '14 days 10 hours',
  null,
  'r232-test-credits-booking',
  10000,
  '12h-20-v1'
);

select public.cancel_practice_booking_with_credits(
  (select id from public.practice_bookings where idempotency_key = 'r232-test-credits-booking'),
  'r232-synthetic-patient',
  0
);

reset role;

do $$
declare
  v_booking_id uuid;
begin
  select id into v_booking_id
    from public.practice_bookings
   where idempotency_key = 'r232-test-credits-booking';

  if not exists (
    select 1
      from public.practice_bookings
     where id = v_booking_id
       and status = 'cancelled'
  ) then
    raise exception 'test_credits booking did not reach cancelled after confirmed';
  end if;

  if not exists (
    select 1
      from public.practice_booking_credits
     where booking_id = v_booking_id
       and price_kop = 100000
       and charged_credits = 10000
       and refunded_credits = 10000
       and cancellation_fee_credits = 0
  ) then
    raise exception 'test_credits snapshot/debit/refund is incorrect';
  end if;

  if (select balance from public.usage_wallets where id = '71000000-0000-4000-8000-000000000001') <> 50000 then
    raise exception 'test_credits wallet did not return to original balance';
  end if;

  if (select count(*) from public.usage_ledger where wallet_id = '71000000-0000-4000-8000-000000000001' and entry_type = 'usage_debit') <> 1
     or (select count(*) from public.usage_ledger where wallet_id = '71000000-0000-4000-8000-000000000001' and entry_type = 'refund') <> 1 then
    raise exception 'test_credits ledger idempotency/refund entries are incorrect';
  end if;

  if (select count(*) from public.practice_payments) <> 0
     or (select count(*) from public.practice_commissions) <> 0 then
    raise exception 'Credit flow unexpectedly used simulated payment/commission tables';
  end if;

  if has_function_privilege(
       'anon',
       'public.reserve_practice_booking_with_credits(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,bigint,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.reserve_practice_booking_with_credits(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text,bigint,text)',
       'execute'
     ) then
    raise exception 'test_credits RPC grants are incorrect';
  end if;
end;
$$;

commit;

select 'PASS' as result,
       (select count(*) from public.practice_booking_credits) as credit_snapshots,
       (select count(*) from public.usage_ledger where wallet_id = '71000000-0000-4000-8000-000000000001') as wallet_ledger_rows,
       (select balance from public.usage_wallets where id = '71000000-0000-4000-8000-000000000001') as final_balance;
