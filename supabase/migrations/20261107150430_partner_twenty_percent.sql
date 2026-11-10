-- New debits use 20%; historical 25% buckets and source-linked refunds remain unchanged.
ALTER TABLE public.partner_test_accounts DROP CONSTRAINT partner_test_accounts_rate_bps_check;
ALTER TABLE public.partner_test_accounts ADD CONSTRAINT partner_test_accounts_rate_bps_check CHECK(rate_bps IN (2000,2500));
ALTER TABLE public.partner_test_accounts ALTER COLUMN rate_bps SET DEFAULT 2000;
ALTER TABLE public.usage_wallets ALTER COLUMN balance SET DEFAULT 20000;
ALTER TABLE public.usage_wallets ALTER COLUMN refill_amount SET DEFAULT 20000;
ALTER TABLE public.usage_wallets ALTER COLUMN total_refilled SET DEFAULT 20000;
-- Preserve existing balances and ledger; only future automatic refills change.
UPDATE public.usage_wallets SET refill_amount=20000 WHERE partner_funding_kind='test' AND refill_mode='on_zero';
CREATE OR REPLACE FUNCTION public.record_partner_test_usage(p_usage public.usage_ledger) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  w public.usage_wallets%rowtype;
  a public.patient_assignments%rowtype;
  bucket public.partner_test_accounts%rowtype;
  original public.usage_ledger%rowtype;
  org uuid;
  code text;
  pilot text;
  candidate_ids uuid[];
  delta bigint;
  next_base bigint;
  next_earned bigint;
  refunded bigint;
BEGIN
  IF p_usage.entry_type NOT IN ('usage_debit', 'refund') THEN RETURN; END IF;
  SELECT * INTO w FROM public.usage_wallets WHERE id = p_usage.wallet_id FOR UPDATE;
  IF NOT FOUND OR w.module <> p_usage.module THEN RAISE EXCEPTION 'Invalid usage wallet scope'; END IF;

  IF p_usage.entry_type = 'refund' THEN
    -- Unlinked legacy adjustments are not silently interpreted as usage refunds.
    IF p_usage.reversed_usage_id IS NULL THEN RETURN; END IF;
    SELECT * INTO original FROM public.usage_ledger WHERE id = p_usage.reversed_usage_id;
    IF NOT FOUND OR original.entry_type <> 'usage_debit' OR original.wallet_id <> p_usage.wallet_id
       OR original.module <> p_usage.module OR p_usage.amount <= 0 THEN
      RAISE EXCEPTION 'Invalid usage refund';
    END IF;
    SELECT coalesce(sum(amount), 0) INTO refunded FROM public.usage_ledger
      WHERE reversed_usage_id = original.id AND entry_type = 'refund';
    IF refunded > original.amount THEN RAISE EXCEPTION 'Refund exceeds original debit'; END IF;
    SELECT b.* INTO bucket FROM public.partner_test_accounts b
      JOIN public.partner_test_entries e ON e.account_id = b.id
      WHERE e.usage_ledger_id = original.id FOR UPDATE OF b;
    IF NOT FOUND THEN RETURN; END IF;
    delta := -p_usage.amount;
  ELSE
    IF w.partner_funding_kind <> 'test' THEN RETURN; END IF;
    IF p_usage.amount <= 0 THEN RAISE EXCEPTION 'Invalid usage amount'; END IF;
    -- Explicit allowlist excludes consultation fees, reservations and adjustments.
    IF p_usage.resource_type IS NULL OR p_usage.resource_type NOT IN
      ('support_analyze', 'transcription', 'voice_analysis', 'body_intake_analyze',
       'body_diary_analyze', 'body_diary_ai_analysis', 'plate_analysis', 'support_chat', 'body_chat', 'live_settled') THEN RETURN; END IF;
    IF p_usage.module = 'support' THEN
      IF w.owner_type <> 'anonymous_case' THEN RAISE EXCEPTION 'Invalid owner type'; END IF;
      SELECT s.organization_id, s.public_code, coalesce(nullif(s.json_data->>'pilot_id', ''), 'main')
        INTO org, code, pilot FROM public.sessions s
        WHERE s.session_id = p_usage.session_id AND s.anonymous_owner_id = w.owner_id AND s.module = 'support';
      IF NOT FOUND THEN RETURN; END IF;
      -- Server metadata must agree with the canonical session's pilot.
      IF pilot <> coalesce(nullif(p_usage.metadata->>'pilot_id', ''), 'main') THEN RETURN; END IF;
    ELSE
      IF w.owner_type <> 'anonymous_profile' THEN RAISE EXCEPTION 'Invalid owner type'; END IF;
      PERFORM 1 FROM public.body_clients WHERE session_id = p_usage.session_id AND anonymous_owner_id = w.owner_id;
      IF NOT FOUND THEN RETURN; END IF;
      -- Existing dedicated pilots are Support-only. Health has no pilot identity yet.
      pilot := coalesce(nullif(p_usage.metadata->>'pilot_id', ''), 'main');
      IF pilot <> 'main' THEN RETURN; END IF;
    END IF;
    SELECT array_agg(pa.id) INTO candidate_ids FROM public.patient_assignments pa
      JOIN public.experts e ON e.id = pa.primary_expert_id AND e.is_active = true
      WHERE pa.status = 'active' AND pa.module = p_usage.module
        AND p_usage.module = ANY(e.allowed_modules)
        AND ((pa.owner_type = w.owner_type AND pa.owner_id = w.owner_id)
          OR (p_usage.module = 'support' AND pa.public_code = code AND pa.owner_id IS NULL))
        AND (p_usage.module = 'body' OR pa.organization_id IS NOT DISTINCT FROM org);
    -- Ambiguous relationships must be resolved explicitly, never paid twice.
    IF coalesce(cardinality(candidate_ids), 0) <> 1 THEN RETURN; END IF;
    -- Recheck scope after acquiring locks: a concurrent reassignment may have
    -- changed the row since candidate discovery.
    SELECT pa.* INTO a FROM public.patient_assignments pa
      JOIN public.experts e ON e.id = pa.primary_expert_id AND e.is_active = true
      WHERE pa.id = candidate_ids[1] AND pa.status = 'active' AND pa.module = p_usage.module
        AND p_usage.module = ANY(e.allowed_modules)
        AND ((pa.owner_type = w.owner_type AND pa.owner_id = w.owner_id)
          OR (p_usage.module = 'support' AND pa.public_code = code AND pa.owner_id IS NULL))
        AND (p_usage.module = 'body' OR pa.organization_id IS NOT DISTINCT FROM org)
      FOR SHARE OF pa;
    IF NOT FOUND THEN RETURN; END IF;
    INSERT INTO public.partner_test_accounts(wallet_id, assignment_id, expert_id, organization_id, module, pilot_id)
      VALUES(w.id, a.id, a.primary_expert_id, a.organization_id, p_usage.module, pilot)
      ON CONFLICT DO NOTHING;
    SELECT * INTO bucket FROM public.partner_test_accounts
      WHERE wallet_id = w.id AND assignment_id = a.id AND expert_id = a.primary_expert_id
        AND organization_id IS NOT DISTINCT FROM a.organization_id AND module = p_usage.module
        AND pilot_id = pilot AND rate_bps = 2000 FOR UPDATE;
    delta := p_usage.amount;
  END IF;
  next_base := bucket.base_credits + delta;
  next_earned := floor(next_base::numeric * bucket.rate_bps / 10000)::bigint;
  INSERT INTO public.partner_test_entries(account_id, usage_ledger_id, base_delta, credit_delta)
    VALUES(bucket.id, p_usage.id, delta, next_earned - bucket.earned_credits);
  UPDATE public.partner_test_accounts SET base_credits = next_base, earned_credits = next_earned WHERE id = bucket.id;
  RETURN;
END;
$$;
CREATE OR REPLACE FUNCTION public.accrue_partner_test_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM public.record_partner_test_usage(NEW); RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION public.record_partner_test_usage(public.usage_ledger) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_test_usage(public.usage_ledger) TO service_role;
REVOKE ALL ON FUNCTION public.accrue_partner_test_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_partner_test_usage() TO service_role;

CREATE OR REPLACE FUNCTION public.partner_test_summary(p_expert_id uuid, p_module text, p_organization_id uuid, p_pilot_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('rate_bps', 2000, 'test_only', true,
    'base_credits', coalesce(sum(base_credits), 0), 'earned_credits', coalesce(sum(earned_credits), 0),
    'contributing_patients', count(DISTINCT wallet_id) FILTER (WHERE base_credits > 0))
  FROM public.partner_test_accounts WHERE expert_id = p_expert_id AND module = p_module
    AND organization_id IS NOT DISTINCT FROM p_organization_id AND pilot_id = p_pilot_id;
$$;

CREATE OR REPLACE FUNCTION public.ensure_usage_wallet(
  p_owner_type text,
  p_owner_id uuid,
  p_module text
)
RETURNS public.usage_wallets
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.usage_wallets%rowtype;
  v_created boolean := false;
  v_initial_balance bigint := 20000;
BEGIN
  IF p_owner_type IS NULL
     OR p_owner_id IS NULL
     OR p_module IS NULL
     OR p_module NOT IN ('support', 'body')
     OR (p_module = 'support' AND p_owner_type <> 'anonymous_case')
     OR (p_module = 'body' AND p_owner_type <> 'anonymous_profile') THEN
    RAISE EXCEPTION 'Invalid canonical wallet scope' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_type || ':' || p_owner_id::text || ':' || p_module, 0)
  );

  SELECT * INTO v_wallet
  FROM public.usage_wallets
  WHERE owner_type = p_owner_type
    AND owner_id = p_owner_id
    AND module = p_module
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.usage_wallets (
      owner_type, owner_id, module, balance, refill_amount,
      total_refilled, visible_to_client
    ) VALUES (
      p_owner_type, p_owner_id, p_module, v_initial_balance,
      v_initial_balance, v_initial_balance, false
    )
    ON CONFLICT (owner_type, owner_id, module) DO NOTHING
    RETURNING * INTO v_wallet;
    v_created := FOUND;

    IF NOT v_created THEN
      SELECT * INTO v_wallet
      FROM public.usage_wallets
      WHERE owner_type = p_owner_type
        AND owner_id = p_owner_id
        AND module = p_module
      FOR UPDATE;
    END IF;
  END IF;

  IF v_created THEN
    INSERT INTO public.usage_ledger (
      wallet_id, entry_type, amount, balance_before, balance_after,
      module, request_id, metadata
    ) VALUES (
      v_wallet.id, 'initial_credit', v_initial_balance, 0,
      v_initial_balance, p_module, 'initial-wallet-' || v_wallet.id::text,
      jsonb_build_object('source', 'canonical_wallet_creation')
    );
  END IF;

  RETURN v_wallet;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_usage_wallet(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_usage_wallet(text, uuid, text) TO service_role;
-- Scoped pseudonyms disclose no owner ID, continuation code, or clinical data.
CREATE OR REPLACE FUNCTION public.partner_test_patients(p_expert_id uuid,p_module text,p_organization_id uuid,p_pilot_id text)
RETURNS TABLE(patient_ref text,base_credits bigint,earned_credits bigint,rate_bps integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT md5(a.expert_id::text||':'||a.wallet_id::text||':'||coalesce(a.organization_id::text,'private')||':'||a.pilot_id),
 sum(a.base_credits)::bigint,sum(a.earned_credits)::bigint,a.rate_bps
 FROM public.partner_test_accounts a
 WHERE a.expert_id=p_expert_id AND a.module=p_module AND a.organization_id IS NOT DISTINCT FROM p_organization_id AND a.pilot_id=p_pilot_id
 GROUP BY a.expert_id,a.wallet_id,a.organization_id,a.pilot_id,a.rate_bps
 ORDER BY sum(a.earned_credits) DESC, a.wallet_id LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.partner_test_patients(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.partner_test_patients(uuid,text,uuid,text) TO service_role;

create or replace function public.consume_usage_credits(
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
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.usage_wallets%rowtype; old public.usage_ledger%rowtype; before_balance bigint; refill bigint:=0; cycles bigint:=0;
begin
 if p_amount is null or p_amount<=0 or p_amount>10000000 or nullif(trim(p_request_id),'') is null then raise exception 'Invalid debit'; end if;
 select * into w from public.usage_wallets where id=p_wallet_id for update;
 if not found or w.status<>'active' or w.module<>p_module then raise exception 'Invalid wallet scope'; end if;
 select * into old from public.usage_ledger where request_id=p_request_id;
 if found then
   if old.wallet_id<>p_wallet_id or old.entry_type<>'usage_debit' or old.amount<>p_amount or old.module<>p_module
     or old.session_id is distinct from p_session_id or old.resource_type is distinct from p_resource_type then raise exception 'Debit idempotency conflict'; end if;
   return jsonb_build_object('ok',true,'charged',old.amount,'balance_after',w.balance,'idempotent_replay',true);
 end if;
 before_balance=w.balance;
 if w.balance<p_amount then
   if w.partner_funding_kind<>'test' or w.refill_mode<>'on_zero' or w.refill_amount<=0 then raise exception 'Insufficient credits'; end if;
   cycles=ceil((p_amount-w.balance)::numeric/w.refill_amount)::bigint;
   refill=cycles*w.refill_amount;
   insert into public.usage_ledger(wallet_id,entry_type,amount,balance_before,balance_after,request_id,module)
     values(w.id,'automatic_refill',refill,w.balance,w.balance+refill,'refill-before:'||p_request_id,p_module);
   w.balance=w.balance+refill;
 end if;
 insert into public.usage_ledger(wallet_id,entry_type,amount,balance_before,balance_after,resource_type,request_id,module,session_id,
 provider,model,input_tokens,output_tokens,audio_seconds,image_count,estimated_cost,metadata)
 values(w.id,'usage_debit',p_amount,w.balance,w.balance-p_amount,p_resource_type,p_request_id,p_module,p_session_id,
 p_provider,p_model,p_input_tokens,p_output_tokens,p_audio_seconds,p_image_count,p_estimated_cost,p_metadata);
 w.balance=w.balance-p_amount;
 if w.balance=0 and w.partner_funding_kind='test' and w.refill_mode='on_zero' and w.refill_amount>0 then
   insert into public.usage_ledger(wallet_id,entry_type,amount,balance_before,balance_after,request_id,module)
     values(w.id,'automatic_refill',w.refill_amount,0,w.refill_amount,'refill-after:'||p_request_id,p_module);
   w.balance=w.refill_amount; refill=refill+w.refill_amount; cycles=cycles+1;
 end if;
 update public.usage_wallets set balance=w.balance,total_used=total_used+p_amount,total_refilled=total_refilled+refill,
 cycle_number=cycle_number+cycles,updated_at=now() where id=w.id;
 return jsonb_build_object('ok',true,'charged',p_amount,'balance_before',before_balance,'balance_after',w.balance,'refill_count',cycles,'idempotent_replay',false);
end;
$$;
REVOKE ALL ON FUNCTION public.consume_usage_credits(uuid,bigint,text,text,text,text,text,text,integer,integer,integer,integer,numeric,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_usage_credits(uuid,bigint,text,text,text,text,text,text,integer,integer,integer,integer,numeric,jsonb) TO service_role;

-- Voice commission is recorded only on confirmed settlement, never on a reserve.
-- The original reserve ledger ID is the unique accounting source; wallet is not debited again.
CREATE OR REPLACE FUNCTION public.accrue_partner_live_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry public.usage_ledger%rowtype; canonical record; scopes integer;
BEGIN
 IF NEW.state<>'settled' OR OLD.state IN ('settled','uncertain') OR coalesce(NEW.charged_microusd,0)<=0 THEN RETURN NEW; END IF;
 SELECT * INTO entry FROM public.usage_ledger WHERE request_id='live-reserve-'||NEW.id::text AND wallet_id=NEW.wallet_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- Refuse ambiguous organization/pilot attribution instead of choosing a recipient.
 SELECT count(*) INTO scopes FROM (SELECT DISTINCT organization_id,coalesce(nullif(json_data->>'pilot_id',''),'main')
   FROM public.sessions WHERE anonymous_owner_id=NEW.owner_id AND module=NEW.module) s;
 IF scopes<>1 THEN RETURN NEW; END IF;
 SELECT session_id,coalesce(nullif(json_data->>'pilot_id',''),'main') AS pilot INTO canonical
   FROM public.sessions WHERE anonymous_owner_id=NEW.owner_id AND module=NEW.module ORDER BY created_at DESC,session_id LIMIT 1;
 entry.amount=ceil(NEW.charged_microusd::numeric/50)::bigint;
 entry.resource_type='live_settled'; entry.session_id=canonical.session_id;
 entry.metadata=jsonb_build_object('pilot_id',canonical.pilot);
 PERFORM public.record_partner_test_usage(entry);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accrue_partner_live_settlement() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_partner_live_settlement() TO service_role;
CREATE TRIGGER accrue_partner_live_settlement AFTER UPDATE OF state ON public.live_test_reservations
FOR EACH ROW EXECUTE FUNCTION public.accrue_partner_live_settlement();

CREATE OR REPLACE FUNCTION public.refund_partner_test_usage(p_usage_id uuid, p_amount bigint, p_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  original public.usage_ledger%rowtype;
  w public.usage_wallets%rowtype;
  replay public.usage_ledger%rowtype;
  result_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR nullif(trim(p_request_id), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid refund input';
  END IF;
  SELECT * INTO original FROM public.usage_ledger WHERE id = p_usage_id AND entry_type = 'usage_debit';
  IF NOT FOUND THEN RAISE EXCEPTION 'Usage debit not found'; END IF;
  IF original.resource_type='live_reserve' THEN RAISE EXCEPTION 'Voice refunds require live settlement'; END IF;
  SELECT * INTO w FROM public.usage_wallets WHERE id = original.wallet_id FOR UPDATE;
  IF w.partner_funding_kind <> 'test' THEN RAISE EXCEPTION 'Only test refunds are supported'; END IF;
  SELECT * INTO replay FROM public.usage_ledger WHERE request_id = p_request_id;
  IF FOUND THEN
    IF replay.entry_type <> 'refund' OR replay.reversed_usage_id IS DISTINCT FROM p_usage_id OR replay.amount <> p_amount THEN
      RAISE EXCEPTION 'Refund idempotency conflict';
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'ledger_id', replay.id);
  END IF;
  INSERT INTO public.usage_ledger(wallet_id, entry_type, amount, balance_before, balance_after,
    resource_type, request_id, module, session_id, metadata, reversed_usage_id)
    VALUES(w.id, 'refund', p_amount, w.balance, w.balance + p_amount,
      original.resource_type, p_request_id, original.module, original.session_id, original.metadata, original.id)
    RETURNING id INTO result_id;
  UPDATE public.usage_wallets SET balance = balance + p_amount, total_used = total_used - p_amount, updated_at = now()
    WHERE id = w.id;
  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false, 'ledger_id', result_id);
END;
$$;
REVOKE ALL ON FUNCTION public.refund_partner_test_usage(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_partner_test_usage(uuid, bigint, text) TO service_role;

