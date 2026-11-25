-- SEC-003-FIX2: atomically create a new Health profile and its possession proof.
--
-- The caller generates a 128-bit internal session ID, a canonical owner UUID,
-- an access-token hash, and a continuation secret hash. This function either
-- creates every bootstrap row or creates none of them. Unique conflicts are
-- deliberately propagated so the server can retry with fresh random material.

CREATE OR REPLACE FUNCTION public.bootstrap_health_intake(
  p_session_id text,
  p_owner_id uuid,
  p_access_token_hash text,
  p_lookup_code text,
  p_secret_hash text,
  p_answers jsonb,
  p_bmi numeric DEFAULT NULL,
  p_source text DEFAULT 'self_signup',
  p_specialist_id text DEFAULT NULL,
  p_specialist_name text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_goal text DEFAULT NULL,
  p_session_json jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  session_id text,
  anonymous_owner_id uuid,
  intake_id uuid,
  wallet_id uuid,
  access_token_hash text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_intake_id uuid;
  v_wallet public.usage_wallets%rowtype;
BEGIN
  IF p_session_id IS NULL
     OR p_session_id !~ '^health_[A-Za-z0-9_-]{22}$'
     OR p_owner_id IS NULL
     OR p_access_token_hash IS NULL
     OR p_access_token_hash !~ '^[0-9A-Fa-f]{64}$'
     OR p_lookup_code IS NULL
     OR p_lookup_code !~ '^HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3}$'
     OR p_secret_hash IS NULL
     OR p_secret_hash !~ '^[0-9A-Fa-f]{64}$'
     OR p_answers IS NULL
     OR jsonb_typeof(p_answers) <> 'object'
     OR p_source IS NULL
     OR btrim(p_source) = ''
     OR p_session_json IS NULL
     OR jsonb_typeof(p_session_json) <> 'object' THEN
    RAISE EXCEPTION 'Invalid Health bootstrap input' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sessions (
    session_id,
    module,
    anonymous_owner_id,
    public_code,
    patient_text,
    conversation_history,
    json_data,
    access_token_hash,
    access_token_generated_at,
    legacy_access
  ) VALUES (
    p_session_id,
    'body',
    p_owner_id,
    p_lookup_code,
    '',
    '[]'::jsonb,
    p_session_json,
    lower(p_access_token_hash),
    now(),
    false
  );

  INSERT INTO public.body_clients (
    session_id,
    anonymous_owner_id,
    display_name,
    source,
    specialist_id,
    specialist_name,
    goal,
    status,
    updated_at
  ) VALUES (
    p_session_id,
    p_owner_id,
    nullif(btrim(p_display_name), ''),
    p_source,
    nullif(btrim(p_specialist_id), ''),
    nullif(btrim(p_specialist_name), ''),
    nullif(btrim(p_goal), ''),
    'active',
    now()
  );

  INSERT INTO public.body_intake_forms (
    session_id,
    module,
    version,
    answers,
    bmi,
    care_recommendation,
    source,
    specialist_id,
    specialist_name
  ) VALUES (
    p_session_id,
    'body',
    'body-intake-v0.1',
    p_answers,
    p_bmi,
    NULL,
    p_source,
    nullif(btrim(p_specialist_id), ''),
    nullif(btrim(p_specialist_name), '')
  )
  RETURNING id INTO v_intake_id;

  INSERT INTO public.continuation_credentials (
    module,
    owner_type,
    owner_id,
    lookup_code,
    secret_hash,
    secret_version,
    created_at
  ) VALUES (
    'body',
    'anonymous_profile',
    p_owner_id,
    p_lookup_code,
    lower(p_secret_hash),
    1,
    now()
  );

  SELECT * INTO v_wallet
  FROM public.ensure_usage_wallet('anonymous_profile', p_owner_id, 'body');

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Health bootstrap wallet creation failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT p_session_id, p_owner_id, v_intake_id, v_wallet.id, lower(p_access_token_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_health_intake(
  text, uuid, text, text, text, jsonb, numeric, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bootstrap_health_intake(
  text, uuid, text, text, text, jsonb, numeric, text, text, text, text, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.bootstrap_health_intake(
  text, uuid, text, text, text, jsonb, numeric, text, text, text, text, text, jsonb
) IS 'Atomically creates a new Health owner, session, intake, continuation credential, and hidden usage wallet.';
