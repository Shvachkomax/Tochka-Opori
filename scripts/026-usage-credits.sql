-- Usage Credits System
-- Migration 026: wallets, ledger, RPC, owner columns

-- ============================================================
-- 1. ADD anonymous_owner_id TO EXISTING TABLES
-- ============================================================

alter table sessions add column if not exists anonymous_owner_id uuid;

alter table body_clients add column if not exists anonymous_owner_id uuid;

-- ============================================================
-- 2. USAGE WALLETS
-- ============================================================

create table if not exists usage_wallets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_id uuid not null,
  module text not null,
  balance bigint not null default 22000,
  refill_amount bigint not null default 22000,
  refill_mode text not null default 'on_zero',
  cycle_number integer not null default 1,
  total_used bigint not null default 0,
  total_refilled bigint not null default 22000,
  status text not null default 'active',
  visible_to_client boolean not null default false,
  continuation_enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_wallet_owner_module unique (owner_type, owner_id, module),
  constraint chk_wallet_module check (module in ('support', 'body')),
  constraint chk_wallet_refill_mode check (refill_mode in ('on_zero', 'monthly', 'daily', 'manual', 'disabled')),
  constraint chk_wallet_status check (status in ('active', 'paused', 'closed'))
);

create index if not exists idx_wallets_owner_module on usage_wallets(owner_id, module);
create index if not exists idx_wallets_status on usage_wallets(status);
create index if not exists idx_wallets_visible on usage_wallets(visible_to_client) where visible_to_client = true;

-- ============================================================
-- 3. USAGE LEDGER
-- ============================================================

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references usage_wallets(id) on delete restrict,
  entry_type text not null,
  amount bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,
  resource_type text,
  request_id text not null,
  module text not null,
  session_id text,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  audio_seconds integer,
  image_count integer,
  estimated_cost numeric,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint uq_ledger_request_id unique (request_id),
  constraint chk_ledger_entry_type check (entry_type in ('initial_credit', 'usage_debit', 'automatic_refill', 'manual_refill', 'admin_adjustment', 'refund'))
);

create index if not exists idx_ledger_wallet_created on usage_ledger(wallet_id, created_at desc);
create index if not exists idx_ledger_module on usage_ledger(module);
create index if not exists idx_ledger_request_id on usage_ledger(request_id);

-- ============================================================
-- 4. UPDATED_AT TRIGGER FOR WALLETS
-- ============================================================

create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = '';

drop trigger if exists trg_wallets_updated_at on usage_wallets;
create trigger trg_wallets_updated_at
  before update on public.usage_wallets
  for each row execute function trigger_set_updated_at();

-- ============================================================
-- 5. CONSUME_USAGE_CREDITS RPC
-- ============================================================

create or replace function consume_usage_credits(
  p_wallet_id uuid,
  p_amount bigint,
  p_request_id text,
  p_resource_type text default null,
  p_module text default 'support',
  p_session_id text default null,
  p_provider text default null,
  p_model text default null,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_audio_seconds integer default null,
  p_image_count integer default null,
  p_estimated_cost numeric default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_wallet public.usage_wallets%rowtype;
  v_balance_before bigint;
  v_remaining bigint;
  v_charged bigint := 0;
  v_refill_count integer := 0;
  v_existing record;
begin
  -- Idempotency check
  select id, entry_type, amount, balance_before, balance_after
  into v_existing
  from public.usage_ledger
  where request_id = p_request_id
  limit 1;

  if found then
    return jsonb_build_object(
      'balance_before', v_existing.balance_before,
      'charged', v_existing.amount,
      'balance_after', v_existing.balance_after,
      'refill_count', 0,
      'cycle_number', 0,
      'total_used', 0,
      'idempotent_replay', true
    );
  end if;

  if p_amount <= 0 then
    return jsonb_build_object(
      'balance_before', 0,
      'charged', 0,
      'balance_after', 0,
      'refill_count', 0,
      'cycle_number', 0,
      'total_used', 0,
      'idempotent_replay', false
    );
  end if;

  -- Lock wallet row
  select * into v_wallet
  from public.usage_wallets
  where id = p_wallet_id
  for update;

  if not found then
    raise exception 'Wallet not found: %', p_wallet_id;
  end if;

  if v_wallet.status = 'paused' or v_wallet.status = 'closed' then
    raise exception 'Wallet is %', v_wallet.status;
  end if;

  v_balance_before := v_wallet.balance;
  v_remaining := v_wallet.balance;

  -- Main loop: debit, refill on zero, repeat until fully charged
  while p_amount > v_charged loop
    if v_remaining = 0 then
      if v_wallet.refill_mode = 'on_zero' then
        v_remaining := v_wallet.refill_amount;
        v_refill_count := v_refill_count + 1;
        v_wallet.cycle_number := v_wallet.cycle_number + 1;
        v_wallet.total_refilled := v_wallet.total_refilled + v_wallet.refill_amount;

        insert into public.usage_ledger (
          wallet_id, entry_type, amount, balance_before, balance_after,
          resource_type, request_id, module, session_id,
          provider, model, input_tokens, output_tokens, audio_seconds, image_count,
          estimated_cost, metadata
        ) values (
          p_wallet_id, 'automatic_refill', v_wallet.refill_amount, v_balance_before, v_remaining,
          null, p_request_id || '-refill-' || v_refill_count,
          p_module, null, null, null,
          null, null, null, null,
          null, jsonb_build_object('refill_reason', 'on_zero', 'cycle', v_wallet.cycle_number)
        );
      else
        raise exception 'Insufficient credits and refill_mode is not on_zero';
      end if;
    end if;

    if v_remaining > 0 then
      declare
        v_debit bigint;
        v_after bigint;
        v_req_id text;
      begin
        v_debit := least(p_amount - v_charged, v_remaining);
        v_after := v_remaining - v_debit;

        if v_refill_count = 0 then
          v_req_id := p_request_id;
        else
          v_req_id := p_request_id || '-r' || v_refill_count || '-' || v_charged;
        end if;

        insert into public.usage_ledger (
          wallet_id, entry_type, amount, balance_before, balance_after,
          resource_type, request_id, module, session_id,
          provider, model, input_tokens, output_tokens, audio_seconds, image_count,
          estimated_cost, metadata
        ) values (
          p_wallet_id, 'usage_debit', v_debit, v_remaining, v_after,
          p_resource_type, v_req_id,
          p_module, p_session_id, p_provider, p_model,
          p_input_tokens, p_output_tokens, p_audio_seconds, p_image_count,
          p_estimated_cost, p_metadata
        );

        v_remaining := v_after;
        v_charged := v_charged + v_debit;
      end;
    end if;
  end loop;

  -- Final wallet update
  update public.usage_wallets set
    balance = v_remaining,
    cycle_number = v_wallet.cycle_number,
    total_used = total_used + v_charged,
    total_refilled = v_wallet.total_refilled
  where id = p_wallet_id;

  return jsonb_build_object(
    'balance_before', v_balance_before,
    'charged', v_charged,
    'balance_after', v_remaining,
    'refill_count', v_refill_count,
    'cycle_number', v_wallet.cycle_number,
    'total_used', (select total_used from public.usage_wallets where id = p_wallet_id),
    'idempotent_replay', false
  );
end;
$$;

-- Grant access
revoke all on function consume_usage_credits(uuid, bigint, text, text, text, text, text, text, integer, integer, integer, integer, numeric, jsonb) from public;
revoke all on function consume_usage_credits(uuid, bigint, text, text, text, text, text, text, integer, integer, integer, integer, numeric, jsonb) from anon;
revoke all on function consume_usage_credits(uuid, bigint, text, text, text, text, text, text, integer, integer, integer, integer, numeric, jsonb) from authenticated;
grant execute on function consume_usage_credits(uuid, bigint, text, text, text, text, text, text, integer, integer, integer, integer, numeric, jsonb) to service_role;

-- ============================================================
-- 6. RLS
-- ============================================================

alter table usage_wallets enable row level security;
alter table usage_ledger enable row level security;

create policy "usage_wallets_service_role_only" on usage_wallets
  using (current_setting('role') = 'service_role');

create policy "usage_ledger_service_role_only" on usage_ledger
  using (current_setting('role') = 'service_role');
