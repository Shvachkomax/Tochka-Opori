-- Test-only revenue share. No historical backfill and no money/payout path.
ALTER TABLE public.usage_wallets ADD COLUMN partner_funding_kind text NOT NULL DEFAULT 'test'
  CHECK (partner_funding_kind IN ('test', 'bonus', 'paid'));
ALTER TABLE public.usage_ledger ADD COLUMN reversed_usage_id uuid REFERENCES public.usage_ledger(id);
CREATE INDEX usage_ledger_reversed_usage_idx ON public.usage_ledger(reversed_usage_id)
  WHERE reversed_usage_id IS NOT NULL;

CREATE TABLE public.partner_test_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.usage_wallets(id),
  assignment_id uuid NOT NULL,
  expert_id uuid NOT NULL REFERENCES public.experts(id),
  organization_id uuid,
  module text NOT NULL CHECK (module IN ('support', 'body')),
  pilot_id text NOT NULL,
  rate_bps integer NOT NULL DEFAULT 2500 CHECK (rate_bps = 2500),
  base_credits bigint NOT NULL DEFAULT 0 CHECK (base_credits >= 0),
  earned_credits bigint NOT NULL DEFAULT 0 CHECK (earned_credits >= 0),
  UNIQUE NULLS NOT DISTINCT (wallet_id, assignment_id, expert_id, organization_id, module, pilot_id, rate_bps)
);
CREATE TABLE public.partner_test_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.partner_test_accounts(id),
  usage_ledger_id uuid NOT NULL UNIQUE REFERENCES public.usage_ledger(id),
  base_delta bigint NOT NULL CHECK (base_delta <> 0),
  credit_delta bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_test_accounts_expert_scope_idx
  ON public.partner_test_accounts(expert_id, module, pilot_id, organization_id);
CREATE INDEX partner_test_entries_account_idx ON public.partner_test_entries(account_id, created_at DESC);
ALTER TABLE public.partner_test_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_test_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_test_accounts, public.partner_test_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.partner_test_accounts TO service_role;
GRANT SELECT, INSERT ON public.partner_test_entries TO service_role;

CREATE FUNCTION public.accrue_partner_test_usage() RETURNS trigger
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
  IF NEW.entry_type NOT IN ('usage_debit', 'refund') THEN RETURN NEW; END IF;
  SELECT * INTO w FROM public.usage_wallets WHERE id = NEW.wallet_id FOR UPDATE;
  IF NOT FOUND OR w.module <> NEW.module THEN RAISE EXCEPTION 'Invalid usage wallet scope'; END IF;

  IF NEW.entry_type = 'refund' THEN
    -- Unlinked legacy adjustments are not silently interpreted as usage refunds.
    IF NEW.reversed_usage_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO original FROM public.usage_ledger WHERE id = NEW.reversed_usage_id;
    IF NOT FOUND OR original.entry_type <> 'usage_debit' OR original.wallet_id <> NEW.wallet_id
       OR original.module <> NEW.module OR NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Invalid usage refund';
    END IF;
    SELECT coalesce(sum(amount), 0) INTO refunded FROM public.usage_ledger
      WHERE reversed_usage_id = original.id AND entry_type = 'refund';
    IF refunded > original.amount THEN RAISE EXCEPTION 'Refund exceeds original debit'; END IF;
    SELECT b.* INTO bucket FROM public.partner_test_accounts b
      JOIN public.partner_test_entries e ON e.account_id = b.id
      WHERE e.usage_ledger_id = original.id FOR UPDATE OF b;
    IF NOT FOUND THEN RETURN NEW; END IF;
    delta := -NEW.amount;
  ELSE
    IF w.partner_funding_kind <> 'test' THEN RETURN NEW; END IF;
    IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Invalid usage amount'; END IF;
    -- Explicit allowlist excludes consultation fees, reservations and adjustments.
    IF NEW.resource_type IS NULL OR NEW.resource_type NOT IN
      ('support_analyze', 'transcription', 'voice_analysis', 'body_intake_analyze',
       'body_diary_analyze', 'body_diary_ai_analysis', 'plate_analysis') THEN RETURN NEW; END IF;
    IF NEW.module = 'support' THEN
      IF w.owner_type <> 'anonymous_case' THEN RAISE EXCEPTION 'Invalid owner type'; END IF;
      SELECT s.organization_id, s.public_code, coalesce(nullif(s.json_data->>'pilot_id', ''), 'main')
        INTO org, code, pilot FROM public.sessions s
        WHERE s.session_id = NEW.session_id AND s.anonymous_owner_id = w.owner_id AND s.module = 'support';
      IF NOT FOUND THEN RETURN NEW; END IF;
      -- Server metadata must agree with the canonical session's pilot.
      IF pilot <> coalesce(nullif(NEW.metadata->>'pilot_id', ''), 'main') THEN RETURN NEW; END IF;
    ELSE
      IF w.owner_type <> 'anonymous_profile' THEN RAISE EXCEPTION 'Invalid owner type'; END IF;
      PERFORM 1 FROM public.body_clients WHERE session_id = NEW.session_id AND anonymous_owner_id = w.owner_id;
      IF NOT FOUND THEN RETURN NEW; END IF;
      -- Existing dedicated pilots are Support-only. Health has no pilot identity yet.
      pilot := coalesce(nullif(NEW.metadata->>'pilot_id', ''), 'main');
      IF pilot <> 'main' THEN RETURN NEW; END IF;
    END IF;
    SELECT array_agg(pa.id) INTO candidate_ids FROM public.patient_assignments pa
      JOIN public.experts e ON e.id = pa.primary_expert_id AND e.is_active = true
      WHERE pa.status = 'active' AND pa.module = NEW.module
        AND NEW.module = ANY(e.allowed_modules)
        AND ((pa.owner_type = w.owner_type AND pa.owner_id = w.owner_id)
          OR (NEW.module = 'support' AND pa.public_code = code AND pa.owner_id IS NULL))
        AND (NEW.module = 'body' OR pa.organization_id IS NOT DISTINCT FROM org);
    -- Ambiguous relationships must be resolved explicitly, never paid twice.
    IF coalesce(cardinality(candidate_ids), 0) <> 1 THEN RETURN NEW; END IF;
    -- Recheck scope after acquiring locks: a concurrent reassignment may have
    -- changed the row since candidate discovery.
    SELECT pa.* INTO a FROM public.patient_assignments pa
      JOIN public.experts e ON e.id = pa.primary_expert_id AND e.is_active = true
      WHERE pa.id = candidate_ids[1] AND pa.status = 'active' AND pa.module = NEW.module
        AND NEW.module = ANY(e.allowed_modules)
        AND ((pa.owner_type = w.owner_type AND pa.owner_id = w.owner_id)
          OR (NEW.module = 'support' AND pa.public_code = code AND pa.owner_id IS NULL))
        AND (NEW.module = 'body' OR pa.organization_id IS NOT DISTINCT FROM org)
      FOR SHARE OF pa;
    IF NOT FOUND THEN RETURN NEW; END IF;
    INSERT INTO public.partner_test_accounts(wallet_id, assignment_id, expert_id, organization_id, module, pilot_id)
      VALUES(w.id, a.id, a.primary_expert_id, a.organization_id, NEW.module, pilot)
      ON CONFLICT DO NOTHING;
    SELECT * INTO bucket FROM public.partner_test_accounts
      WHERE wallet_id = w.id AND assignment_id = a.id AND expert_id = a.primary_expert_id
        AND organization_id IS NOT DISTINCT FROM a.organization_id AND module = NEW.module
        AND pilot_id = pilot AND rate_bps = 2500 FOR UPDATE;
    delta := NEW.amount;
  END IF;
  next_base := bucket.base_credits + delta;
  next_earned := floor(next_base::numeric * bucket.rate_bps / 10000)::bigint;
  INSERT INTO public.partner_test_entries(account_id, usage_ledger_id, base_delta, credit_delta)
    VALUES(bucket.id, NEW.id, delta, next_earned - bucket.earned_credits);
  UPDATE public.partner_test_accounts SET base_credits = next_base, earned_credits = next_earned WHERE id = bucket.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accrue_partner_test_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_partner_test_usage() TO service_role;
CREATE TRIGGER accrue_partner_test_usage AFTER INSERT ON public.usage_ledger
  FOR EACH ROW EXECUTE FUNCTION public.accrue_partner_test_usage();

-- Service-only refund primitive. Wallet, source-linked refund and reversal are atomic.
CREATE FUNCTION public.refund_partner_test_usage(p_usage_id uuid, p_amount bigint, p_request_id text)
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

-- Entire history totals are aggregated in PostgreSQL, not limited by API row caps.
CREATE FUNCTION public.partner_test_summary(p_expert_id uuid, p_module text, p_organization_id uuid, p_pilot_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('rate_bps', 2500, 'test_only', true,
    'base_credits', coalesce(sum(base_credits), 0), 'earned_credits', coalesce(sum(earned_credits), 0),
    'contributing_patients', count(DISTINCT wallet_id) FILTER (WHERE base_credits > 0))
  FROM public.partner_test_accounts WHERE expert_id = p_expert_id AND module = p_module
    AND organization_id IS NOT DISTINCT FROM p_organization_id AND pilot_id = p_pilot_id;
$$;
CREATE FUNCTION public.partner_test_history(p_expert_id uuid, p_module text, p_organization_id uuid, p_pilot_id text)
RETURNS TABLE(id uuid, created_at timestamptz, base_delta bigint, credit_delta bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT e.id, e.created_at, e.base_delta, e.credit_delta FROM public.partner_test_entries e
    JOIN public.partner_test_accounts a ON a.id = e.account_id
    WHERE a.expert_id = p_expert_id AND a.module = p_module
      AND a.organization_id IS NOT DISTINCT FROM p_organization_id AND a.pilot_id = p_pilot_id
    ORDER BY e.created_at DESC, e.id DESC LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.partner_test_summary(uuid, text, uuid, text),
  public.partner_test_history(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_test_summary(uuid, text, uuid, text),
  public.partner_test_history(uuid, text, uuid, text) TO service_role;
