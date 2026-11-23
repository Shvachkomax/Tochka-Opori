\set ON_ERROR_STOP on

begin;

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from (values
    ('public.practice_places'),
    ('public.practice_services'),
    ('public.practice_availability'),
    ('public.practice_bookings'),
    ('public.practice_events'),
    ('public.practice_patient_profile_links'),
    ('public.medical_encounter_versions')
  ) expected(relation_name)
  where to_regclass(expected.relation_name) is null;

  if v_missing <> 0 then
    raise exception 'Missing % target relations', v_missing;
  end if;

  if to_regclass('public.practice_booking_credits') is not null
     or to_regclass('public.practice_payments') is not null
     or to_regclass('public.practice_commissions') is not null then
    raise exception 'Production clinical bundle installed a test financial table';
  end if;

  if to_regprocedure('public.confirm_practice_booking(uuid,text,text)') is not null
     or to_regprocedure('public.complete_practice_booking(uuid,text)') is not null
     or to_regprocedure('public.reserve_practice_booking_with_credits(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)') is not null then
    raise exception 'Production clinical bundle installed a test-payment RPC';
  end if;
end;
$$;

-- Pre-migration synthetic rows must survive unchanged.
do $$
begin
  if (select count(*) from public.organizations where slug like 'r232-synthetic-clinic-%') <> 2 then
    raise exception 'Synthetic clinics were not preserved';
  end if;
  if (select count(*) from public.experts where access_code like 'R232-%') <> 3 then
    raise exception 'Synthetic doctors were not preserved';
  end if;
  if (select count(*) from public.patient_assignments where source = 'r232_pre_migration' and status = 'active') <> 3 then
    raise exception 'Pre-migration patient assignments were changed';
  end if;
  if (select count(*) from public.patient_access where id = 'f0000000-0000-4000-8000-000000000001' and status = 'active') <> 1 then
    raise exception 'Pre-migration shared patient access was changed';
  end if;
  if (select count(*) from public.clinical_events where source_type = 'r232_synthetic_legacy') <> 2 then
    raise exception 'Pre-migration clinical events were changed';
  end if;
  if (select count(*) from public.clinical_observations where source_type = 'r232_synthetic_legacy') <> 2 then
    raise exception 'Pre-migration clinical observations were changed';
  end if;
  if not exists (
    select 1 from public.clinical_observations
     where id = '92000000-0000-4000-8000-000000000001'
       and organization_id = 'a0000000-0000-4000-8000-000000000001'
       and value_text = 'synthetic old record A'
  ) or not exists (
    select 1 from public.clinical_observations
     where id = '92000000-0000-4000-8000-000000000002'
       and organization_id = 'a0000000-0000-4000-8000-000000000002'
       and value_text = 'synthetic old record B'
  ) then
    raise exception 'Pre-migration medical record content/scope changed';
  end if;
end;
$$;

-- RLS is enabled and direct external-role privileges remain absent.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'practice_places', 'practice_services', 'practice_availability',
       'practice_bookings', 'practice_events',
       'practice_patient_profile_links', 'medical_encounter_versions'
     )
     and not c.relrowsecurity;
  if v_bad <> 0 then
    raise exception 'RLS disabled on % target tables', v_bad;
  end if;

  if has_table_privilege('anon', 'public.practice_bookings', 'select')
     or has_table_privilege('authenticated', 'public.practice_bookings', 'select')
     or has_table_privilege('anon', 'public.medical_encounter_versions', 'select')
     or has_table_privilege('authenticated', 'public.medical_encounter_versions', 'select') then
    raise exception 'External roles received direct clinical table access';
  end if;

  if not has_table_privilege('service_role', 'public.practice_bookings', 'select,insert,update,delete')
     or not has_table_privilege('service_role', 'public.medical_encounter_versions', 'select,insert') then
    raise exception 'Service role lacks required target-table privileges';
  end if;

  if has_function_privilege(
       'anon',
       'public.request_practice_booking_without_payment(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.request_practice_booking_without_payment(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.request_practice_booking_without_payment(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)',
       'execute'
     ) then
    raise exception 'Booking RPC grants are not service-role-only';
  end if;
end;
$$;

insert into public.practice_places (id, expert_id, name, address)
values
  ('11000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'R232 Synthetic Place A', 'Synthetic address A'),
  ('11000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'R232 Synthetic Place B', 'Synthetic address B');

insert into public.practice_services (
  id, expert_id, organization_id, place_id, name, format,
  price_kop, duration_min, is_active, modules
)
values
  (
    '12000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'R232 Synthetic Consultation A', 'offline', 100000, 60, true,
    array['support', 'body']::text[]
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    'R232 Synthetic Consultation B', 'offline', 200000, 60, true,
    array['support']::text[]
  );

do $$
begin
  if public.ensure_default_practice_availability(
       'b0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001'
     ) <> 7 then
    raise exception 'Clinic A default availability was not created';
  end if;
  if public.ensure_default_practice_availability(
       'b0000000-0000-4000-8000-000000000003',
       'a0000000-0000-4000-8000-000000000002'
     ) <> 7 then
    raise exception 'Clinic B default availability was not created';
  end if;
  if public.ensure_default_practice_availability(
       'b0000000-0000-4000-8000-000000000001',
       'a0000000-0000-4000-8000-000000000001'
     ) <> 0 then
    raise exception 'Default availability is not idempotent';
  end if;
end;
$$;

insert into public.practice_patient_profile_links (
  support_owner_id, health_owner_id
)
values (
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002'
);

do $$
declare
  v_result jsonb;
  v_booking_id uuid;
  v_wallets_before bigint;
  v_ledger_before bigint;
  v_slot timestamptz := date_trunc('day', now()) + interval '14 days 10 hours';
begin
  select count(*) into v_wallets_before from public.usage_wallets;
  select count(*) into v_ledger_before from public.usage_ledger;

  v_result := public.request_practice_booking_without_payment(
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'anonymous_case',
    'c0000000-0000-4000-8000-000000000001',
    'r232-synthetic-session-a',
    v_slot,
    null,
    'r232-payments-disabled-a'
  );
  v_booking_id := (v_result ->> 'id')::uuid;

  if v_result ->> 'status' <> 'requested'
     or (v_result ->> 'idempotent_replay')::boolean then
    raise exception 'payments_disabled did not create a new requested booking: %', v_result;
  end if;
  if not exists (
    select 1 from public.practice_bookings
     where id = v_booking_id
       and status = 'requested'
       and expires_at is null
  ) then
    raise exception 'Requested booking was not persisted correctly';
  end if;

  v_result := public.request_practice_booking_without_payment(
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'anonymous_case',
    'c0000000-0000-4000-8000-000000000001',
    'r232-synthetic-session-a',
    v_slot,
    null,
    'r232-payments-disabled-a'
  );
  if not (v_result ->> 'idempotent_replay')::boolean
     or v_result ->> 'status' <> 'requested' then
    raise exception 'Booking idempotency replay failed: %', v_result;
  end if;

  begin
    perform public.request_practice_booking_without_payment(
      'b0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      'anonymous_profile',
      'c0000000-0000-4000-8000-000000000002',
      'r232-synthetic-session-conflict',
      v_slot + interval '30 minutes',
      null,
      'r232-payments-disabled-overlap'
    );
    raise exception 'Overlapping booking unexpectedly succeeded';
  exception
    when exclusion_violation then null;
  end;

  v_result := public.request_practice_booking_without_payment(
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'anonymous_profile',
    'c0000000-0000-4000-8000-000000000002',
    'r232-synthetic-session-adjacent',
    v_slot + interval '1 hour',
    null,
    'r232-payments-disabled-adjacent'
  );
  if v_result ->> 'status' <> 'requested' then
    raise exception 'Adjacent half-open booking failed: %', v_result;
  end if;

  begin
    perform public.request_practice_booking_without_payment(
      'b0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      'anonymous_case',
      'c0000000-0000-4000-8000-000000000003',
      'r232-synthetic-cross-clinic',
      v_slot + interval '4 hours',
      null,
      'r232-cross-clinic-denied'
    );
    raise exception 'Cross-clinic service-context booking unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  if (select count(*) from public.usage_wallets) <> v_wallets_before
     or (select count(*) from public.usage_ledger) <> v_ledger_before then
    raise exception 'payments_disabled mutated wallet/ledger state';
  end if;

  v_result := public.cancel_practice_booking_request(v_booking_id, 'r232-synthetic-patient');
  if v_result ->> 'status' <> 'cancelled'
     or (v_result ->> 'payment_performed')::boolean then
    raise exception 'Unpaid cancellation failed: %', v_result;
  end if;
end;
$$;

do $$
declare
  v_encounter uuid := '93000000-0000-4000-8000-000000000001';
  v_result jsonb;
begin
  v_result := public.save_medical_encounter_version(
    v_encounter, 0,
    'b0000000-0000-4000-8000-000000000001',
    'anonymous_profile', 'c0000000-0000-4000-8000-000000000002', 'body',
    'a0000000-0000-4000-8000-000000000001',
    now() - interval '1 day', 'confirmed',
    '{"synthetic":true,"version":1}'::jsonb, ''
  );
  if (v_result ->> 'version')::integer <> 1 then
    raise exception 'Medical version 1 was not saved: %', v_result;
  end if;

  begin
    perform public.save_medical_encounter_version(
      v_encounter, 1,
      'b0000000-0000-4000-8000-000000000001',
      'anonymous_profile', 'c0000000-0000-4000-8000-000000000002', 'body',
      'a0000000-0000-4000-8000-000000000002',
      now() - interval '1 day', 'draft',
      '{"synthetic":true,"version":2,"wrong_clinic":true}'::jsonb,
      'synthetic correction'
    );
    raise exception 'Cross-clinic medical version unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  v_result := public.save_medical_encounter_version(
    v_encounter, 1,
    'b0000000-0000-4000-8000-000000000001',
    'anonymous_profile', 'c0000000-0000-4000-8000-000000000002', 'body',
    'a0000000-0000-4000-8000-000000000001',
    now() - interval '1 day', 'draft',
    '{"synthetic":true,"version":2}'::jsonb,
    'synthetic correction after confirmation'
  );
  if (v_result ->> 'version')::integer <> 2
     or (select count(*) from public.medical_encounter_versions where encounter_id = v_encounter) <> 2 then
    raise exception 'Medical version 2 or immutability check failed: %', v_result;
  end if;
end;
$$;

commit;

select 'PASS' as result,
       (select count(*) from public.practice_bookings) as booking_rows,
       (select count(*) from public.medical_encounter_versions) as encounter_versions,
       (select count(*) from public.clinical_observations where source_type = 'r232_synthetic_legacy') as preserved_legacy_observations;
