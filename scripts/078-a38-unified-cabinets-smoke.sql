-- Transactional TEST-only A3.8 smoke. Every synthetic row is rolled back.
begin;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_expert_a uuid := gen_random_uuid();
  v_expert_b uuid := gen_random_uuid();
  v_support_owner uuid := gen_random_uuid();
  v_health_owner uuid := gen_random_uuid();
  v_place uuid := gen_random_uuid();
  v_service uuid := gen_random_uuid();
  v_invitation_a uuid := gen_random_uuid();
  v_invitation_b uuid := gen_random_uuid();
  v_code text := 'A38-SYN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_start timestamptz := date_trunc('day', now()) + interval '8 days 10 hours';
  v_accept_a jsonb;
  v_accept_b jsonb;
  v_booking jsonb;
  v_cancel jsonb;
  v_revoke jsonb;
begin
  insert into public.organizations(id, name, slug)
  values(v_org, 'A38 Synthetic Organization', 'a38-syn-' || substr(v_org::text, 1, 8));

  insert into public.experts(id, name, role, specialty, city, access_code, is_active, allowed_modules)
  values
    (v_expert_a, 'A38 Synthetic Specialist A', 'doctor', 'Synthetic', 'TEST', 'A38A-' || substr(v_expert_a::text, 1, 8), true, array['support','body']),
    (v_expert_b, 'A38 Synthetic Specialist B', 'doctor', 'Synthetic', 'TEST', 'A38B-' || substr(v_expert_b::text, 1, 8), true, array['support']);

  insert into public.expert_organization_memberships(organization_id, expert_id, role, status)
  values(v_org, v_expert_a, 'doctor', 'active'), (v_org, v_expert_b, 'doctor', 'active');

  insert into public.patient_specialist_invitations(
    id, token_hash, direction, module, inviter_expert_id, organization_id, status, expires_at
  ) values
    (v_invitation_a, replace(gen_random_uuid()::text, '-', ''), 'specialist_to_patient', 'support', v_expert_a, v_org, 'pending', now() + interval '1 day'),
    (v_invitation_b, replace(gen_random_uuid()::text, '-', ''), 'specialist_to_patient', 'support', v_expert_b, v_org, 'pending', now() + interval '1 day');

  select public.accept_specialist_invitation(token_hash, v_support_owner, v_code)
  into v_accept_a from public.patient_specialist_invitations where id = v_invitation_a;
  select public.accept_specialist_invitation(token_hash, v_support_owner, v_code)
  into v_accept_b from public.patient_specialist_invitations where id = v_invitation_b;

  if v_accept_a->>'relationship' <> 'primary' or v_accept_b->>'relationship' <> 'shared' then
    raise exception 'A3.8 invitation relationships failed: %, %', v_accept_a, v_accept_b;
  end if;
  if (select count(*) from public.patient_assignments where owner_id = v_support_owner and status = 'active') <> 1
     or (select count(*) from public.patient_access where owner_id = v_support_owner and status = 'active') <> 1 then
    raise exception 'A3.8 canonical link counts failed';
  end if;

  insert into public.patient_assignments(
    owner_type, owner_id, organization_id, primary_expert_id, assigned_by_expert_id,
    assigned_by_expert_name, source, status, module
  ) values('anonymous_profile', v_health_owner, v_org, v_expert_a, v_expert_a, 'A38 synthetic', 'a38_smoke', 'active', 'body');

  insert into public.practice_places(id, expert_id, name, address)
  values(v_place, v_expert_a, 'A38 Synthetic Place', 'TEST');
  insert into public.practice_services(
    id, expert_id, organization_id, place_id, name, format, price_kop, duration_min, is_active
  ) values(v_service, v_expert_a, v_org, v_place, 'A38 Synthetic Zero-Price Visit', 'offline', 0, 60, true);
  insert into public.practice_availability(expert_id, organization_id, weekday, start_time, end_time, is_active)
  values(v_expert_a, v_org, extract(isodow from v_start)::integer, '09:00', '18:00', true);

  perform public.ensure_usage_wallet('anonymous_case', v_support_owner, 'support');
  select public.reserve_practice_booking_with_credits(
    v_expert_a, v_org, v_place, v_service, 'anonymous_case', v_support_owner,
    'a38-synthetic-session', v_start, null, 'a38-' || v_support_owner::text, 0, '12h-20-v1'
  ) into v_booking;
  if v_booking->>'status' <> 'confirmed' then
    raise exception 'A3.8 zero-price booking failed: %', v_booking;
  end if;
  if not exists (
    select 1 from public.practice_bookings
    where id = (v_booking->>'id')::uuid and expert_id = v_expert_a
      and owner_id = v_support_owner and organization_id = v_org and status = 'confirmed'
  ) then
    raise exception 'A3.8 booking visibility tuple failed';
  end if;

  select public.cancel_practice_booking_with_credits((v_booking->>'id')::uuid, v_support_owner::text, 0)
  into v_cancel;
  if v_cancel->>'status' <> 'cancelled' then
    raise exception 'A3.8 cancellation failed: %', v_cancel;
  end if;

  select public.revoke_patient_specialist_link(
    'anonymous_case', v_support_owner, v_code, 'support', v_expert_b, v_org
  ) into v_revoke;
  if (v_revoke->>'revoked')::integer <> 1
     or exists(select 1 from public.patient_access where owner_id = v_support_owner and expert_id = v_expert_b and status = 'active') then
    raise exception 'A3.8 symmetric revoke failed: %', v_revoke;
  end if;
  if not exists(select 1 from public.patient_assignments where owner_id = v_health_owner and module = 'body' and status = 'active') then
    raise exception 'A3.8 Support revoke crossed into Health';
  end if;
end;
$$;

rollback;
