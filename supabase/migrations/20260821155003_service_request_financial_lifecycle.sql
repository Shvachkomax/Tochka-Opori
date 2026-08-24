-- Phase 11D: atomic service-request reserve/capture/release.
-- Option A: usage_wallets.balance is the available balance.

CREATE TABLE IF NOT EXISTS public.usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.usage_wallets(id) ON DELETE RESTRICT,
  service_request_id uuid NOT NULL UNIQUE REFERENCES public.service_requests(id) ON DELETE RESTRICT,
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('active', 'captured', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  released_at timestamptz,
  metadata jsonb,
  CONSTRAINT usage_reservations_status_timestamps_check CHECK (
    (status = 'active' AND captured_at IS NULL AND released_at IS NULL)
    OR (status = 'captured' AND captured_at IS NOT NULL AND released_at IS NULL)
    OR (status = 'released' AND captured_at IS NULL AND released_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS usage_reservations_wallet_idx
  ON public.usage_reservations (wallet_id);

CREATE INDEX IF NOT EXISTS usage_reservations_wallet_status_idx
  ON public.usage_reservations (wallet_id, status);

CREATE INDEX IF NOT EXISTS usage_reservations_status_idx
  ON public.usage_reservations (status);

CREATE INDEX IF NOT EXISTS usage_reservations_created_idx
  ON public.usage_reservations (created_at DESC);

ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.usage_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.usage_reservations TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'usage_reservations'
      AND policyname = 'usage_reservations_service_role_only'
  ) THEN
    CREATE POLICY usage_reservations_service_role_only
      ON public.usage_reservations
      USING (current_setting('role') = 'service_role');
  END IF;
END
$$;

-- Fail before adding the FK rather than leaving an unclear migration error for
-- a legacy orphan. The whole migration remains atomic in either case.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.usage_ledger l
    LEFT JOIN public.usage_wallets w ON w.id = l.wallet_id
    WHERE w.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot add usage_ledger.wallet_id FK: orphan ledger rows exist';
  END IF;
END
$$;

ALTER TABLE public.usage_ledger
  DROP CONSTRAINT IF EXISTS chk_ledger_entry_type;

ALTER TABLE public.usage_ledger
  ADD CONSTRAINT chk_ledger_entry_type CHECK (entry_type = ANY (ARRAY[
    'initial_credit',
    'usage_debit',
    'automatic_refill',
    'manual_refill',
    'admin_adjustment',
    'refund',
    'service_request_reserve',
    'service_request_capture',
    'service_request_release'
  ]));

-- A wallet may receive its starting grant only once, independently of the
-- request_id convention used for idempotent retries.
DO $$
BEGIN
  IF EXISTS (
    SELECT wallet_id
    FROM public.usage_ledger
    WHERE entry_type = 'initial_credit'
    GROUP BY wallet_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one initial_credit per wallet: duplicate historical grants exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_one_initial_credit_per_wallet_idx
  ON public.usage_ledger (wallet_id)
  WHERE entry_type = 'initial_credit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usage_ledger'::regclass
      AND conname = 'usage_ledger_wallet_id_fkey'
  ) THEN
    ALTER TABLE public.usage_ledger
      ADD CONSTRAINT usage_ledger_wallet_id_fkey
      FOREIGN KEY (wallet_id)
      REFERENCES public.usage_wallets(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

-- Wallet creation is deliberately a separate reusable database operation from
-- the service-request decision. It commits as part of the caller's transaction
-- and serializes first-writer races with the same owner-scoped advisory lock.
CREATE OR REPLACE FUNCTION public.ensure_usage_wallet(
  p_owner_type text,
  p_owner_id uuid,
  p_module text
)
RETURNS public.usage_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.usage_wallets%rowtype;
  v_created boolean := false;
  v_initial_balance bigint := 22000;
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

-- Privileged wallet adjustments must take the same wallet-row lock as reserve
-- and AI debit operations. Otherwise a read-then-write admin operation can
-- overwrite a concurrent balance change or leave its ledger entry inaccurate.
CREATE OR REPLACE FUNCTION public.adjust_usage_wallet(
  p_wallet_id uuid,
  p_amount bigint,
  p_entry_type text,
  p_request_id text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.usage_wallets%rowtype;
  v_existing public.usage_ledger%rowtype;
  v_balance_after bigint;
BEGIN
  IF p_amount IS NULL
     OR p_amount = 0
     OR p_request_id IS NULL
     OR pg_catalog.btrim(p_request_id) = ''
     OR p_entry_type IS NULL
     OR p_entry_type NOT IN ('manual_refill', 'admin_adjustment') THEN
    RAISE EXCEPTION 'Invalid wallet adjustment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wallet
  FROM public.usage_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WALLET_NOT_FOUND', 'error', 'Кошелёк не найден');
  END IF;

  SELECT * INTO v_existing
  FROM public.usage_ledger
  WHERE wallet_id = p_wallet_id AND request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'balance_before', v_existing.balance_before,
      'balance_after', v_existing.balance_after
    );
  END IF;

  v_balance_after := v_wallet.balance + p_amount;
  IF v_balance_after < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CREDITS', 'error', 'Недостаточно кредитов', 'balance', v_wallet.balance);
  END IF;

  UPDATE public.usage_wallets
  SET balance = v_balance_after,
      total_refilled = CASE WHEN p_amount > 0 THEN total_refilled + p_amount ELSE total_refilled END,
      total_used = CASE WHEN p_amount < 0 THEN total_used + pg_catalog.abs(p_amount) ELSE total_used END,
      updated_at = pg_catalog.now()
  WHERE id = p_wallet_id;

  INSERT INTO public.usage_ledger (
    wallet_id, entry_type, amount, balance_before, balance_after,
    module, request_id, metadata
  ) VALUES (
    p_wallet_id, p_entry_type, p_amount, v_wallet.balance, v_balance_after,
    v_wallet.module, p_request_id,
    jsonb_build_object('reason', p_reason, 'admin', true)
  );

  RETURN jsonb_build_object('ok', true, 'balance_before', v_wallet.balance, 'balance_after', v_balance_after);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_usage_wallet(uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_usage_wallet(uuid, bigint, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_service_request(
  p_request_id uuid,
  p_transition text,
  p_specialist_response text DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_scheduled_place text DEFAULT NULL,
  p_scheduled_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.service_requests%rowtype;
  v_wallet public.usage_wallets%rowtype;
  v_reservation public.usage_reservations%rowtype;
  v_existing_reservation public.usage_reservations%rowtype;
  v_reservation_wallet_id uuid;
  v_canonical boolean;
  v_amount bigint := 0;
  v_balance_before bigint;
  v_now timestamptz := pg_catalog.now();
BEGIN
  SELECT *
  INTO v_request
  FROM public.service_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND', 'error', 'Запрос не найден');
  END IF;

  IF v_request.owner_type IS NULL OR v_request.owner_id IS NULL
     OR v_request.module NOT IN ('support', 'body') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OWNER_INVALID', 'error', 'У запроса некорректный владелец');
  END IF;

  IF (v_request.module = 'support' AND v_request.owner_type <> 'anonymous_case')
     OR (v_request.module = 'body' AND v_request.owner_type <> 'anonymous_profile') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OWNER_INVALID', 'error', 'У запроса некорректный владелец');
  END IF;

  IF (v_request.service_code IS NULL AND v_request.price_credits IS NOT NULL)
     OR (v_request.service_code IS NOT NULL AND (
       pg_catalog.btrim(v_request.service_code) = ''
       OR v_request.price_credits IS NULL
       OR v_request.price_credits <= 0
     )) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние запроса некорректно');
  END IF;

  v_canonical := v_request.service_code IS NOT NULL AND v_request.price_credits > 0;
  v_amount := CASE WHEN v_canonical THEN v_request.price_credits ELSE 0 END;

  -- Idempotent retries after a committed transition.
  IF p_transition = 'accept' AND v_request.status = 'accepted' THEN
    SELECT * INTO v_existing_reservation
    FROM public.usage_reservations
    WHERE service_request_id = v_request.id;
    IF NOT v_canonical OR (
      v_existing_reservation.status = 'active'
      AND v_existing_reservation.amount = v_amount
      AND v_request.reserved_credits = v_amount
      AND v_request.charged_credits = 0
    ) THEN
      RETURN jsonb_build_object('ok', true, 'status', 'accepted', 'idempotent_replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние запроса некорректно');
  END IF;

  IF p_transition = 'complete' AND v_request.status = 'completed' THEN
    IF NOT v_canonical THEN
      RETURN jsonb_build_object('ok', true, 'status', 'completed', 'idempotent_replay', true);
    END IF;
    SELECT * INTO v_existing_reservation
    FROM public.usage_reservations
    WHERE service_request_id = v_request.id;
    IF v_existing_reservation.status = 'captured'
       AND v_existing_reservation.amount = v_amount
       AND v_request.reserved_credits = 0
       AND v_request.charged_credits = v_amount THEN
      RETURN jsonb_build_object('ok', true, 'status', 'completed', 'idempotent_replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние запроса некорректно');
  END IF;

  IF p_transition = 'cancel' AND v_request.status = 'cancelled' THEN
    IF NOT v_canonical
       AND COALESCE(v_request.reserved_credits, 0) = 0
       AND COALESCE(v_request.charged_credits, 0) = 0 THEN
      RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'idempotent_replay', true);
    END IF;
    SELECT * INTO v_existing_reservation
    FROM public.usage_reservations
    WHERE service_request_id = v_request.id;
    IF NOT FOUND THEN
      IF COALESCE(v_request.reserved_credits, 0) = 0
         AND COALESCE(v_request.charged_credits, 0) = 0 THEN
        RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'idempotent_replay', true);
      END IF;
    ELSIF v_existing_reservation.status = 'released'
       AND v_existing_reservation.amount = v_amount
       AND COALESCE(v_request.reserved_credits, 0) = 0
       AND COALESCE(v_request.charged_credits, 0) = 0 THEN
      RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'idempotent_replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние запроса некорректно');
  END IF;

  IF p_transition = 'accept' THEN
    IF v_request.status <> 'submitted' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Невозможно принять запрос в текущем статусе');
    END IF;

    IF v_canonical THEN
      IF COALESCE(v_request.reserved_credits, 0) <> 0 OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние запроса некорректно');
      END IF;
      -- This function returns an expected insufficient-credit result instead
      -- of raising, so wallet initialization survives the RPC transaction.
      SELECT * INTO v_wallet
      FROM public.ensure_usage_wallet(v_request.owner_type, v_request.owner_id, v_request.module);

      IF v_wallet.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'WALLET_NOT_ACTIVE', 'error', 'Кошелёк клиента недоступен');
      END IF;
      IF v_wallet.balance < v_amount THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'INSUFFICIENT_CREDITS',
          'error', 'Недостаточно кредитов у клиента для принятия запроса',
          'available_credits', v_wallet.balance,
          'required_credits', v_amount
        );
      END IF;

      SELECT * INTO v_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id
      FOR UPDATE;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Для запроса уже существует reservation');
      END IF;

      v_balance_before := v_wallet.balance;
      UPDATE public.usage_wallets
      SET balance = balance - v_amount,
          updated_at = v_now
      WHERE id = v_wallet.id;

      INSERT INTO public.usage_reservations (
        wallet_id, service_request_id, amount, status, metadata
      ) VALUES (
        v_wallet.id, v_request.id, v_amount, 'active',
        jsonb_build_object('service_code', v_request.service_code, 'actor_type', 'service_request_transition')
      )
      RETURNING * INTO v_reservation;

      UPDATE public.service_requests
      SET status = 'accepted',
          reserved_credits = v_amount,
          charged_credits = 0,
          updated_at = v_now
      WHERE id = v_request.id;

      INSERT INTO public.usage_ledger (
        wallet_id, entry_type, amount, balance_before, balance_after,
        resource_type, request_id, module, session_id, metadata
      ) VALUES (
        v_wallet.id, 'service_request_reserve', v_amount,
        v_balance_before, v_balance_before - v_amount,
        'service_request', 'service-request-' || v_request.id::text || ':reserve',
        v_request.module, v_request.session_id,
        jsonb_build_object('service_request_id', v_request.id, 'service_code', v_request.service_code, 'reservation_id', v_reservation.id)
      );
    ELSE
      UPDATE public.service_requests
      SET status = 'accepted', updated_at = v_now
      WHERE id = v_request.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'status', 'accepted', 'reserved_credits', v_amount, 'charged_credits', 0);
  END IF;

  IF p_transition = 'needs_clarification' THEN
    IF v_request.status <> 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Сначала примите запрос');
    END IF;
    IF v_canonical THEN
      SELECT * INTO v_existing_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id;
      IF NOT FOUND OR v_existing_reservation.status <> 'active'
         OR v_existing_reservation.amount <> v_amount
         OR COALESCE(v_request.reserved_credits, 0) <> v_amount
         OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;
    END IF;
    IF p_specialist_response IS NULL OR pg_catalog.btrim(p_specialist_response) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'RESPONSE_REQUIRED', 'error', 'Укажите, что нужно уточнить');
    END IF;
    UPDATE public.service_requests
    SET status = 'needs_clarification',
        specialist_response = pg_catalog.btrim(p_specialist_response),
        updated_at = v_now
    WHERE id = v_request.id;
    RETURN jsonb_build_object('ok', true, 'status', 'needs_clarification', 'reserved_credits', v_request.reserved_credits, 'charged_credits', v_request.charged_credits);
  END IF;

  IF p_transition = 'schedule' THEN
    IF v_request.status NOT IN ('accepted', 'needs_clarification') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Невозможно запланировать запрос в текущем статусе');
    END IF;
    IF p_scheduled_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SCHEDULE_REQUIRED', 'error', 'Укажите дату и время');
    END IF;
    IF v_canonical THEN
      SELECT * INTO v_existing_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id;
      IF NOT FOUND OR v_existing_reservation.status <> 'active'
         OR v_existing_reservation.amount <> v_amount
         OR COALESCE(v_request.reserved_credits, 0) <> v_amount
         OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;
    END IF;
    UPDATE public.service_requests
    SET status = 'scheduled',
        scheduled_at = p_scheduled_at,
        scheduled_place = p_scheduled_place,
        scheduled_comment = p_scheduled_comment,
        updated_at = v_now
    WHERE id = v_request.id;
    RETURN jsonb_build_object('ok', true, 'status', 'scheduled', 'reserved_credits', v_request.reserved_credits, 'charged_credits', v_request.charged_credits);
  END IF;

  IF p_transition = 'answer' THEN
    IF v_request.status NOT IN ('accepted', 'needs_clarification') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Сначала примите запрос');
    END IF;
    IF p_specialist_response IS NULL OR pg_catalog.btrim(p_specialist_response) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'RESPONSE_REQUIRED', 'error', 'Укажите ответ');
    END IF;
    IF v_canonical THEN
      SELECT * INTO v_existing_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id;
      IF NOT FOUND OR v_existing_reservation.status <> 'active'
         OR v_existing_reservation.amount <> v_amount
         OR COALESCE(v_request.reserved_credits, 0) <> v_amount
         OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;
    END IF;
    UPDATE public.service_requests
    SET status = 'answered',
        specialist_response = pg_catalog.btrim(p_specialist_response),
        answered_at = v_now,
        updated_at = v_now
    WHERE id = v_request.id;
    RETURN jsonb_build_object('ok', true, 'status', 'answered', 'reserved_credits', v_request.reserved_credits, 'charged_credits', v_request.charged_credits);
  END IF;

  IF p_transition = 'complete' THEN
    IF v_request.status NOT IN ('scheduled', 'answered') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Невозможно завершить запрос в текущем статусе');
    END IF;

    IF v_canonical THEN
      SELECT wallet_id INTO v_reservation_wallet_id
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESERVATION_NOT_FOUND', 'error', 'Активная reservation не найдена');
      END IF;

      SELECT * INTO v_wallet
      FROM public.usage_wallets
      WHERE id = v_reservation_wallet_id
      FOR UPDATE;
      SELECT * INTO v_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id
      FOR UPDATE;
      IF v_wallet.id IS NULL
         OR v_wallet.owner_type <> v_request.owner_type
         OR v_wallet.owner_id <> v_request.owner_id
         OR v_wallet.module <> v_request.module
         OR v_reservation.status <> 'active'
         OR v_reservation.amount <> v_amount
         OR COALESCE(v_request.reserved_credits, 0) <> v_amount
         OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;

      UPDATE public.usage_reservations
      SET status = 'captured', captured_at = v_now, metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('capture_actor', 'service_request_transition')
      WHERE id = v_reservation.id AND status = 'active';
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;

      UPDATE public.usage_wallets
      SET total_used = total_used + v_amount, updated_at = v_now
      WHERE id = v_wallet.id;

      UPDATE public.service_requests
      SET status = 'completed', reserved_credits = 0, charged_credits = v_amount, completed_at = v_now, updated_at = v_now
      WHERE id = v_request.id;

      INSERT INTO public.usage_ledger (
        wallet_id, entry_type, amount, balance_before, balance_after,
        resource_type, request_id, module, session_id, metadata
      ) VALUES (
        v_wallet.id, 'service_request_capture', v_amount,
        v_wallet.balance, v_wallet.balance,
        'service_request', 'service-request-' || v_request.id::text || ':capture',
        v_request.module, v_request.session_id,
        jsonb_build_object('service_request_id', v_request.id, 'service_code', v_request.service_code, 'reservation_id', v_reservation.id)
      );
    ELSE
      UPDATE public.service_requests
      SET status = 'completed', completed_at = v_now, updated_at = v_now
      WHERE id = v_request.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'completed', 'reserved_credits', 0, 'charged_credits', CASE WHEN v_canonical THEN v_amount ELSE 0 END);
  END IF;

  IF p_transition = 'cancel' THEN
    IF v_request.status NOT IN ('submitted', 'accepted', 'needs_clarification', 'scheduled') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'error', 'Невозможно отменить запрос в текущем статусе');
    END IF;

    IF v_canonical AND v_request.status <> 'submitted' THEN
      SELECT wallet_id INTO v_reservation_wallet_id
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'RESERVATION_NOT_FOUND', 'error', 'Активная reservation не найдена');
      END IF;

      SELECT * INTO v_wallet
      FROM public.usage_wallets
      WHERE id = v_reservation_wallet_id
      FOR UPDATE;
      SELECT * INTO v_reservation
      FROM public.usage_reservations
      WHERE service_request_id = v_request.id
      FOR UPDATE;
      IF v_wallet.id IS NULL
         OR v_wallet.owner_type <> v_request.owner_type
         OR v_wallet.owner_id <> v_request.owner_id
         OR v_wallet.module <> v_request.module
         OR v_reservation.status <> 'active'
         OR v_reservation.amount <> COALESCE(v_request.reserved_credits, 0)
         OR COALESCE(v_request.charged_credits, 0) <> 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;

      v_balance_before := v_wallet.balance;
      UPDATE public.usage_wallets
      SET balance = balance + v_reservation.amount, updated_at = v_now
      WHERE id = v_wallet.id;

      UPDATE public.usage_reservations
      SET status = 'released', released_at = v_now, metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('release_actor', 'service_request_transition')
      WHERE id = v_reservation.id AND status = 'active';
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FINANCIAL_INCONSISTENCY', 'error', 'Финансовое состояние reservation некорректно');
      END IF;

      UPDATE public.service_requests
      SET status = 'cancelled', reserved_credits = 0, charged_credits = 0, cancelled_at = v_now, updated_at = v_now
      WHERE id = v_request.id;

      INSERT INTO public.usage_ledger (
        wallet_id, entry_type, amount, balance_before, balance_after,
        resource_type, request_id, module, session_id, metadata
      ) VALUES (
        v_wallet.id, 'service_request_release', v_reservation.amount,
        v_balance_before, v_balance_before + v_reservation.amount,
        'service_request', 'service-request-' || v_request.id::text || ':release',
        v_request.module, v_request.session_id,
        jsonb_build_object('service_request_id', v_request.id, 'service_code', v_request.service_code, 'reservation_id', v_reservation.id)
      );
    ELSE
      UPDATE public.service_requests
      SET status = 'cancelled', cancelled_at = v_now, updated_at = v_now
      WHERE id = v_request.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'cancelled', 'reserved_credits', 0, 'charged_credits', 0);
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'UNKNOWN_TRANSITION', 'error', 'Неизвестный переход');
END;
$$;

REVOKE ALL ON FUNCTION public.transition_service_request(uuid, text, text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_service_request(uuid, text, text, timestamptz, text, text) TO service_role;

COMMENT ON TABLE public.usage_reservations IS 'Atomic internal credit reservations for canonical paid service requests.';

NOTIFY pgrst, 'reload schema';
