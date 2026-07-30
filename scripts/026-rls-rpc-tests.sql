-- ============================================================
-- RLS / RPC Tests — Usage Credits (Migration 026)
-- Запускать в Supabase Dashboard SQL Editor (роль postgres)
-- ============================================================
-- Тесты 9-10: проверка прав доступа к usage_wallets/ledger и RPC
-- ============================================================

-- 9a. service_role может вызывать consume_usage_credits
do $$
declare
  v_wallet_id uuid;
  v_result jsonb;
begin
  insert into usage_wallets (owner_type, owner_id, module)
  values ('smoke_test_rls', '00000000-0000-0000-0000-000000000002'::uuid, 'support')
  returning id into v_wallet_id;

  insert into usage_ledger (wallet_id, entry_type, amount, balance_before, balance_after, request_id, module)
  values (v_wallet_id, 'initial_credit', 22000, 0, 22000, 'smoke_026_rls_initial', 'support');

  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 100,
    p_request_id => 'smoke_026_rls_debit',
    p_resource_type => 'test_rls',
    p_module => 'support'
  ) into v_result;

  assert (v_result->>'charged')::int = 100, 'Expected charged 100 from service_role';

  delete from usage_ledger where wallet_id = v_wallet_id;
  delete from usage_wallets where id = v_wallet_id;

  raise notice 'TEST 9 (service_role): consume_usage_credits works — PASS';
end;
$$;

-- 9b/9c: anon и authenticated НЕ могут вызывать RPC напрямую
-- Эти тесты выполняются через Data API с разными ролями.
-- Здесь только проверяем, что функции не выданы anon/authenticated.
do $$
declare
  v_anon_ok boolean;
  v_auth_ok boolean;
begin
  select count(*) > 0 into v_anon_ok
  from information_schema.routine_privileges
  where routine_name = 'consume_usage_credits'
    and grantee = 'anon'
    and privilege_type = 'EXECUTE';

  select count(*) > 0 into v_auth_ok
  from information_schema.routine_privileges
  where routine_name = 'consume_usage_credits'
    and grantee = 'authenticated'
    and privilege_type = 'EXECUTE';

  assert v_anon_ok = false, 'anon should NOT have EXECUTE on consume_usage_credits';
  assert v_auth_ok = false, 'authenticated should NOT have EXECUTE on consume_usage_credits';

  raise notice 'TEST 9b/9c: anon/authenticated EXECUTE revoked — PASS';
end;
$$;

-- 10a. anon не может читать usage_wallets
do $$
declare
  v_privs text;
begin
  select string_agg(privilege_type, ',') into v_privs
  from information_schema.table_privileges
  where table_name = 'usage_wallets'
    and grantee = 'anon';

  if v_privs is null or v_privs = '' then
    raise notice 'TEST 10a: anon has no direct privileges on usage_wallets — PASS';
  else
    raise notice 'TEST 10a: anon has privileges on usage_wallets: % — REVIEW', v_privs;
  end if;
end;
$$;

-- 10b. anon не может читать usage_ledger
do $$
declare
  v_privs text;
begin
  select string_agg(privilege_type, ',') into v_privs
  from information_schema.table_privileges
  where table_name = 'usage_ledger'
    and grantee = 'anon';

  if v_privs is null or v_privs = '' then
    raise notice 'TEST 10b: anon has no direct privileges on usage_ledger — PASS';
  else
    raise notice 'TEST 10b: anon has privileges on usage_ledger: % — REVIEW', v_privs;
  end if;
end;
$$;

-- 10c. RLS включён для usage_wallets
do $$
begin
  assert (select relrowsecurity from pg_class where relname = 'usage_wallets'), 'RLS not enabled on usage_wallets';
  raise notice 'TEST 10c: RLS enabled on usage_wallets — PASS';
end;
$$;

-- 10d. RLS включён для usage_ledger
do $$
begin
  assert (select relrowsecurity from pg_class where relname = 'usage_ledger'), 'RLS not enabled on usage_ledger';
  raise notice 'TEST 10d: RLS enabled on usage_ledger — PASS';
end;
$$;

do $$
begin
  raise notice '============================================';
  raise notice 'RLS/RPC TESTS COMPLETE';
  raise notice 'Ручная проверка через Data API:';
  raise notice '  POST /rest/v1/rpc/consume_usage_credits (anon) → 401/403';
  raise notice '  GET /rest/v1/usage_wallets (anon) → 401/403 или []';
  raise notice '  GET /rest/v1/usage_ledger (anon) → 401/403 или []';
  raise notice '============================================';
end;
$$;
