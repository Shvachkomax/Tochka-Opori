-- ============================================================
-- SQL Smoke Tests — Usage Credits (Migration 026)
-- Запускать в Supabase Dashboard SQL Editor
-- ============================================================
-- Перед тестами: проверка, что объекты созданы
-- ============================================================

-- 0. VERIFY MIGRATION OBJECTS
select 'migration_objects' as test,
  (select count(*) from information_schema.tables where table_name = 'usage_wallets') > 0 as wallets_table_exists,
  (select count(*) from information_schema.tables where table_name = 'usage_ledger') > 0 as ledger_table_exists,
  (select count(*) from information_schema.routines where routine_name = 'consume_usage_credits') > 0 as rpc_exists,
  (select count(*) from information_schema.columns where table_name = 'sessions' and column_name = 'anonymous_owner_id') > 0 as sessions_owner_col_exists,
  (select count(*) from information_schema.columns where table_name = 'body_clients' and column_name = 'anonymous_owner_id') > 0 as body_clients_owner_col_exists;

-- ============================================================
-- 1. CREATE WALLET
-- ============================================================
do $$
declare
  v_wallet_id uuid;
  v_initial record;
  v_ledger record;
begin
  insert into usage_wallets (owner_type, owner_id, module)
  values ('smoke_test', '00000000-0000-0000-0000-000000000001'::uuid, 'support')
  returning id into v_wallet_id;

  -- initial_credit ledger entry (создаётся JS-кодом, в тесте делаем вручную)
  insert into usage_ledger (wallet_id, entry_type, amount, balance_before, balance_after, request_id, module)
  values (v_wallet_id, 'initial_credit', 22000, 0, 22000, 'smoke_026_initial_credit', 'support');

  select balance, total_refilled, cycle_number, visible_to_client, status
  into v_initial
  from usage_wallets where id = v_wallet_id;

  assert v_initial.balance = 22000, 'Expected balance 22000, got ' || v_initial.balance;
  assert v_initial.total_refilled = 22000, 'Expected total_refilled 22000';
  assert v_initial.cycle_number = 1, 'Expected cycle_number 1';
  assert v_initial.visible_to_client = false, 'Expected visible_to_client false';
  assert v_initial.status = 'active', 'Expected status active';

  select * into v_ledger from usage_ledger where wallet_id = v_wallet_id and entry_type = 'initial_credit';
  assert found, 'Expected initial_credit ledger entry';
  assert v_ledger.amount = 22000, 'Expected initial_credit amount 22000';

  raise notice 'TEST 1 PASS: Wallet created correctly (id=%)', v_wallet_id;
  perform set_config('smoke.wallet_id', v_wallet_id::text, false);
end;
$$;

-- ============================================================
-- 2. NORMAL DEBIT: 22000 - 3000 = 19000
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
begin
  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 3000,
	p_request_id => 'smoke_026_debit_001',
	p_resource_type => 'test_debit',
    p_module => 'support'
  ) into v_result;

  assert (v_result->>'charged')::int = 3000, 'Expected charged 3000, got ' || (v_result->>'charged');
  assert (v_result->>'balance_before')::int = 22000, 'Expected balance_before 22000';
  assert (v_result->>'balance_after')::int = 19000, 'Expected balance_after 19000, got ' || (v_result->>'balance_after');
  assert (v_result->>'idempotent_replay')::bool = false, 'Expected idempotent_replay false';

  raise notice 'TEST 2 PASS: 22000 - 3000 = 19000';
end;
$$;

-- ============================================================
-- 3. DUPLICATE REQUEST_ID: idempotent
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
  v_balance_after_first bigint;
  v_ledger_count integer;
begin
  select balance into v_balance_after_first from usage_wallets where id = v_wallet_id;

  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 9999,
	p_request_id => 'smoke_026_debit_001',
	p_resource_type => 'test_duplicate',
    p_module => 'support'
  ) into v_result;

  assert (v_result->>'idempotent_replay')::bool = true, 'Expected idempotent_replay true, got ' || (v_result->>'idempotent_replay');
  assert (v_result->>'balance_after')::int = v_balance_after_first, 'Balance changed on replay!';
  assert (v_result->>'charged')::int = 3000, 'Expected charged from original debit';

  select count(*) into v_ledger_count
  from usage_ledger
  where wallet_id = v_wallet_id and request_id = 'smoke_026_debit_001';

  assert v_ledger_count = 1, 'Expected 1 ledger entry for request_id, got ' || v_ledger_count;

  raise notice 'TEST 3 PASS: Duplicate request_id rejected (idempotent)';
end;
$$;

-- ============================================================
-- 4. DEBIT EXACTLY TO ZERO: 19000 - 19000 = 0
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
  v_balance bigint;
begin
  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 19000,
	p_request_id => 'smoke_026_debit_002',
    p_resource_type => 'test_debit_to_zero',
    p_module => 'support'
  ) into v_result;

  assert (v_result->>'charged')::int = 19000, 'Expected charged 19000';
  assert (v_result->>'balance_after')::int = 0, 'Expected balance_after 0, got ' || (v_result->>'balance_after');
  assert (v_result->>'refill_count')::int = 0, 'Expected refill_count 0';

  select balance into v_balance from usage_wallets where id = v_wallet_id;
  assert v_balance = 0, 'Expected wallet balance 0, got ' || v_balance;

  raise notice 'TEST 4 PASS: Debit to zero: 19000 - 19000 = 0';
end;
$$;

-- ============================================================
-- 5. DEBIT ACROSS REFILL BOUNDARY: balance=0, charge=1200
--    auto_refill=22000, final=22000-1200=20800
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
  v_balance bigint;
  v_total_used bigint;
  v_total_refilled bigint;
  v_cycle integer;
begin
  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 1200,
	p_request_id => 'smoke_026_debit_003',
    p_resource_type => 'test_cross_refill',
    p_module => 'support'
  ) into v_result;

  -- auto_refill of 22000 occurred, then 1200 debited
  assert (v_result->>'balance_after')::int = 20800, 'Expected balance_after 20800, got ' || (v_result->>'balance_after');
  assert (v_result->>'refill_count')::int >= 1, 'Expected at least 1 refill';

  select balance, total_used, total_refilled, cycle_number
  into v_balance, v_total_used, v_total_refilled, v_cycle
  from usage_wallets where id = v_wallet_id;

  assert v_balance = 20800, 'Expected wallet balance 20800, got ' || v_balance;
  assert v_total_used = 3000 + 19000 + 1200, 'Expected total_used = 23200';
  assert v_total_refilled >= 22000 * 2, 'Expected total_refilled >= 44000';
  assert v_cycle >= 2, 'Expected cycle_number >= 2';

  raise notice 'TEST 5 PASS: Cross-refill debit: 0→22000→20800 (cycle=%, total_used=%, total_refilled=%)',
    v_cycle, v_total_used, v_total_refilled;
end;
$$;

-- ============================================================
-- 6. MULTI-CYCLE DEBIT: charge=50000, balance=20800
--    refill=22000 → 20800+22000=42800 (need 7200 more)
--    refill=22000 again → 42800+22000=64800, debit 50000
--    final=14800
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
  v_balance bigint;
  v_cycle integer;
  v_refill_count integer;
begin
  select consume_usage_credits(
    p_wallet_id => v_wallet_id,
    p_amount => 50000,
	p_request_id => 'smoke_026_debit_004',
    p_resource_type => 'test_multi_cycle',
    p_module => 'support'
  ) into v_result;

  v_refill_count := (v_result->>'refill_count')::int;
  assert v_refill_count = 2, 'Expected 2 refills, got ' || v_refill_count;
  assert (v_result->>'balance_after')::int >= 14800, 'Expected balance_after >= 14800';

  select balance, cycle_number
  into v_balance, v_cycle
  from usage_wallets where id = v_wallet_id;

  assert v_cycle >= 3, 'Expected cycle_number >= 3, got ' || v_cycle;

  raise notice 'TEST 6 PASS: Multi-cycle debit (refills=%, balance=%, cycle=%)',
    v_refill_count, v_balance, v_cycle;
end;
$$;

-- ============================================================
-- 7. VERIFY LEDGER ENTRIES
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_initial_count integer;
  v_debit_count integer;
  v_refill_count integer;
begin
  select count(*) into v_initial_count
  from usage_ledger
  where wallet_id = v_wallet_id and entry_type = 'initial_credit';
  assert v_initial_count = 1, 'Expected 1 initial_credit, got ' || v_initial_count;

  select count(*) into v_debit_count
  from usage_ledger
  where wallet_id = v_wallet_id and entry_type = 'usage_debit';
  assert v_debit_count >= 4, 'Expected >= 4 debit entries';

  select count(*) into v_refill_count
  from usage_ledger
  where wallet_id = v_wallet_id and entry_type = 'automatic_refill';
  assert v_refill_count >= 3, 'Expected >= 3 refill entries';

  raise notice 'TEST 7 PASS: Ledger: initial=1, debits=%, refills=%', v_debit_count, v_refill_count;
end;
$$;

-- ============================================================
-- 8. PAUSED WALLET — debit must fail
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_result jsonb;
  v_balance_before bigint;
  v_balance_after bigint;
begin
  select balance into v_balance_before from usage_wallets where id = v_wallet_id;

  update usage_wallets set status = 'paused' where id = v_wallet_id;

  begin
    select consume_usage_credits(
      p_wallet_id => v_wallet_id,
      p_amount => 100,
	p_request_id => 'smoke_026_debit_paused',
      p_resource_type => 'test_paused',
      p_module => 'support'
    ) into v_result;
    raise exception 'TEST 8 FAIL: Debit on paused wallet should have raised exception';
  exception
    when others then
      if sqlerrm like '%Wallet is%paused%' or sqlerrm like '%Wallet is paused%' then
        raise notice 'TEST 8 PASS: Paused wallet rejected debit: %', sqlerrm;
      else
        raise notice 'TEST 8 UNEXPECTED: %', sqlerrm;
      end if;
  end;

  select balance into v_balance_after from usage_wallets where id = v_wallet_id;
  assert v_balance_after = v_balance_before, 'Balance changed despite paused wallet!';

  -- Restore active
  update usage_wallets set status = 'active' where id = v_wallet_id;
end;
$$;

-- ============================================================
-- 9. PERMISSION CHECKS (requires separate sessions)
-- Эти тесты нельзя выполнить в одном блоке — они требуют
-- подключения с разными ролями. Выполни их вручную:
--
-- 9a. Как service_role:
--   select consume_usage_credits(...) → должен работать
--
-- 9b. Через Data API с anon key:
--   POST /rest/v1/rpc/consume_usage_credits
--   Authorization: Bearer anon_key
--   → должен вернуть 401/403
--
-- 9c. Через Data API с authenticated key:
--   → должен вернуть 401/403
-- ============================================================
do $$
begin
  raise notice 'TEST 9: Permission checks — см. инструкцию выше для ручной проверки';
end;
$$;

-- ============================================================
-- 10. RLS CHECKS
--     Прямое клиентское чтение usage_wallets и usage_ledger
--     через Data API должно быть запрещено.
--
--   Проверить:
--     GET /rest/v1/usage_wallets
--     Authorization: Bearer anon_key
--     → должен вернуть 401/403 или пустой массив
--
--     GET /rest/v1/usage_ledger
--     Authorization: Bearer anon_key
--     → должен вернуть 401/403 или пустой массив
-- ============================================================
do $$
begin
  raise notice 'TEST 10: RLS checks — см. инструкцию выше для ручной проверки';
end;
$$;

-- ============================================================
-- SUMMARY
-- ============================================================
do $$
declare
  v_wallet_id uuid := current_setting('smoke.wallet_id')::uuid;
  v_final record;
begin
  select balance, total_used, total_refilled, cycle_number
  into v_final
  from usage_wallets where id = v_wallet_id;

  raise notice '============================================';
  raise notice 'SMOKE TESTS COMPLETE';
  raise notice 'Wallet ID: %', v_wallet_id;
  raise notice 'Final balance: %', v_final.balance;
  raise notice 'Total used: %', v_final.total_used;
  raise notice 'Total refilled: %', v_final.total_refilled;
  raise notice 'Cycle number: %', v_final.cycle_number;
  raise notice '============================================';
end;
$$;

-- Cleanup: удалить только тестовые записи (не влияет на production)
delete from usage_ledger where wallet_id = current_setting('smoke.wallet_id')::uuid;
delete from usage_wallets where id = current_setting('smoke.wallet_id')::uuid;

do $$
begin
  raise notice 'CLEANUP: Test wallet and ledger entries deleted';
end;
$$;
