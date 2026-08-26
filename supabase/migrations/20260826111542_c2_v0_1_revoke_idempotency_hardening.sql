-- C2 v0.1 revoke idempotency: preserve semantic command identity.

ALTER TABLE public.medication_order_lifecycle_events
  ADD COLUMN command_hash text;

CREATE OR REPLACE FUNCTION public.revoke_medication_order(
  p_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_reason_code text, p_reason_text text,
  p_idempotency_key text, p_actor_expert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  order_row public.medication_orders%ROWTYPE;
  existing_event record;
  decision_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  lifecycle_id uuid := gen_random_uuid();
  command_hash text;
  permission_row record;
  revoked_count integer := 0;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'Invalid medication idempotency key' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code IS NULL OR length(trim(p_reason_code)) = 0 THEN
    RAISE EXCEPTION 'Revocation reason is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'revoke', p_order_id::text, p_owner_type, p_owner_id::text, p_idempotency_key), 0
  ));
  command_hash := md5(jsonb_build_object(
    'operation', 'revoke', 'order_id', p_order_id, 'owner_type', p_owner_type,
    'owner_id', p_owner_id, 'organization_id', p_organization_id,
    'authorization_id', p_authorization_id, 'actor_expert_id', p_actor_expert_id,
    'reason_code', p_reason_code, 'reason_text', p_reason_text
  )::text);

  SELECT * INTO existing_event
  FROM public.medication_order_lifecycle_events
  WHERE medication_order_id = p_order_id
    AND event_type = 'revoked'
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF existing_event.command_hash IS NULL OR existing_event.command_hash <> command_hash THEN
      RAISE EXCEPTION 'Medication revoke idempotency key conflicts with another command' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('idempotent_replay', true, 'order_id', p_order_id, 'lifecycle_event_id', existing_event.id);
  END IF;

  SELECT * INTO order_row FROM public.medication_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR order_row.owner_type <> p_owner_type OR order_row.owner_id <> p_owner_id
     OR order_row.organization_id IS DISTINCT FROM p_organization_id OR order_row.module <> 'support' THEN
    RAISE EXCEPTION 'Medication order is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_medication_prescriber(
    p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id, p_authorization_id
  );
  IF EXISTS (SELECT 1 FROM public.medication_order_lifecycle_events WHERE medication_order_id = p_order_id AND event_type IN ('revoked', 'completed', 'superseded'))
     OR (order_row.valid_until IS NOT NULL AND order_row.valid_until <= now())
     OR order_row.valid_from > now()
     OR EXISTS (SELECT 1 FROM public.medication_orders WHERE supersedes_order_id = p_order_id) THEN
    RAISE EXCEPTION 'Medication order is not the current active version' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.clinician_decisions (
    id, module, owner_type, owner_id, organization_id, expert_id,
    decision_type, decision_text, rationale, metadata
  ) VALUES (
    decision_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_stop', coalesce(p_reason_text, 'Назначение отозвано специалистом'), p_reason_text,
    jsonb_build_object('medication_order_id', p_order_id, 'reason_code', p_reason_code, 'command_hash', command_hash)
  );
  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_revoked', now(), 'medication_order', p_order_id::text,
    'revoked:' || lifecycle_id::text, 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('reason_code', p_reason_code, 'command_hash', command_hash)
  );
  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, actor_type, actor_expert_id,
    occurred_at, reason_code, reason_text, idempotency_key, command_hash
  ) VALUES (
    lifecycle_id, p_order_id, 'revoked', 'clinician', p_actor_expert_id,
    now(), p_reason_code, p_reason_text, p_idempotency_key, command_hash
  );
  FOR permission_row IN
    SELECT g.* FROM public.medication_ai_permissions g
    WHERE g.medication_order_id = p_order_id
      AND g.permission_action = 'grant'
      AND NOT EXISTS (SELECT 1 FROM public.medication_ai_permissions r WHERE r.revokes_permission_id = g.id)
  LOOP
    INSERT INTO public.medication_ai_permissions (
      medication_order_id, permission_key, permission_action, granted_by_expert_id,
      organization_id, source_decision_id, revokes_permission_id, effective_at,
      expires_at, idempotency_key
    ) VALUES (
      p_order_id, permission_row.permission_key, 'revoke', p_actor_expert_id,
      p_organization_id, decision_id, permission_row.id, now(), now(),
      p_idempotency_key || ':revoke:' || permission_row.permission_key
    );
    revoked_count := revoked_count + 1;
  END LOOP;
  RETURN jsonb_build_object(
    'idempotent_replay', false, 'order_id', p_order_id,
    'decision_id', decision_id, 'clinical_event_id', event_id,
    'lifecycle_event_id', lifecycle_id, 'revoked_permission_count', revoked_count,
    'command_hash', command_hash
  );
END;
$$;

ALTER FUNCTION public.revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid)
  SET search_path = pg_catalog, public;
