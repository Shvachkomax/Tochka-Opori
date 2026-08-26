-- C2 v0.1 mutation consistency hardening.
-- Advisory locks serialize identical owner/idempotency commands; all writes remain atomic.

CREATE OR REPLACE FUNCTION public.enforce_internal_medication_concept()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.medication_concepts
    WHERE id = NEW.medication_concept_id
      AND source_system = 'internal'
      AND jurisdiction = 'RU'
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Medication concept is unavailable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medication_orders_internal_concept ON public.medication_orders;
CREATE TRIGGER medication_orders_internal_concept
  BEFORE INSERT ON public.medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_internal_medication_concept();

CREATE OR REPLACE FUNCTION public.medication_order_mutation_core(
  p_mode text,
  p_previous_order_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_organization_id uuid,
  p_authorization_id uuid,
  p_medication_concept_id uuid,
  p_medication_name_snapshot text,
  p_formulation_snapshot text,
  p_strength_value numeric,
  p_strength_unit text,
  p_route_code text,
  p_indication_code text,
  p_clinician_instruction text,
  p_issued_at timestamptz,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_schedules jsonb,
  p_permission_keys text[],
  p_decision_text text,
  p_decision_rationale text,
  p_creation_idempotency_key text,
  p_actor_expert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  previous_order public.medication_orders%ROWTYPE;
  existing_order record;
  concept_row record;
  order_id uuid := gen_random_uuid();
  order_group_id uuid := gen_random_uuid();
  decision_id uuid := gen_random_uuid();
  new_event_id uuid := gen_random_uuid();
  old_event_id uuid := gen_random_uuid();
  new_lifecycle_id uuid := gen_random_uuid();
  old_lifecycle_id uuid := gen_random_uuid();
  canonical_schedules jsonb;
  computed_order_hash text;
  item record;
  permission_key text;
  permission_row record;
  permission_ids jsonb;
  version_number integer := 1;
BEGIN
  IF p_mode NOT IN ('activate', 'supersede') THEN
    RAISE EXCEPTION 'Unsupported medication mutation' USING ERRCODE = '22023';
  END IF;
  IF p_creation_idempotency_key IS NULL
     OR length(trim(p_creation_idempotency_key)) < 8
     OR length(p_creation_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'Invalid medication idempotency key' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_mode, p_owner_type, p_owner_id::text, p_creation_idempotency_key), 0
  ));

  IF p_mode = 'supersede' THEN
    SELECT * INTO previous_order
    FROM public.medication_orders
    WHERE id = p_previous_order_id
    FOR UPDATE;
    IF NOT FOUND OR previous_order.owner_type <> p_owner_type
       OR previous_order.owner_id <> p_owner_id
       OR previous_order.module <> 'support'
       OR previous_order.organization_id IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Previous medication order is unavailable' USING ERRCODE = '42501';
    END IF;
    version_number := previous_order.version_number + 1;
    order_group_id := previous_order.order_group_id;
  END IF;

  PERFORM public.assert_medication_prescriber(
    p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id, p_authorization_id
  );
  IF p_valid_from IS NULL OR p_issued_at IS NULL OR p_valid_from < p_issued_at THEN
    RAISE EXCEPTION 'Invalid medication order validity' USING ERRCODE = '22023';
  END IF;
  IF p_decision_text IS NULL OR length(trim(p_decision_text)) < 2 THEN
    RAISE EXCEPTION 'Clinician medication decision text is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, jurisdiction INTO concept_row
  FROM public.medication_concepts
  WHERE id = p_medication_concept_id
    AND source_system = 'internal';
  IF NOT FOUND OR concept_row.status <> 'active' OR concept_row.jurisdiction <> 'RU' THEN
    RAISE EXCEPTION 'Medication concept is unavailable' USING ERRCODE = '22023';
  END IF;

  canonical_schedules := public.validate_medication_schedule(
    p_valid_from, p_valid_until, p_route_code, p_schedules
  );
  IF p_permission_keys IS NULL THEN
    p_permission_keys := ARRAY[]::text[];
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_permission_keys) AS keys(key) WHERE key NOT IN (
    'view_authorized_order', 'explain_authorized_order', 'show_authorized_schedule',
    'remind_authorized_schedule', 'prepare_question_for_clinician'
  )) THEN
    RAISE EXCEPTION 'Unsupported medication AI permission' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_permission_keys) <> (SELECT count(DISTINCT key) FROM unnest(p_permission_keys) AS keys(key)) THEN
    RAISE EXCEPTION 'Duplicate medication AI permission' USING ERRCODE = '22023';
  END IF;

  computed_order_hash := md5(jsonb_build_object(
    'mode', p_mode,
    'owner_type', p_owner_type,
    'owner_id', p_owner_id,
    'organization_id', p_organization_id,
    'authorization_id', p_authorization_id,
    'actor_expert_id', p_actor_expert_id,
    'previous_order_id', CASE WHEN p_mode = 'supersede' THEN previous_order.id ELSE NULL END,
    'version_number', version_number,
    'medication_concept_id', p_medication_concept_id,
    'medication_name_snapshot', trim(p_medication_name_snapshot),
    'formulation_snapshot', p_formulation_snapshot,
    'strength_value', p_strength_value,
    'strength_unit', p_strength_unit,
    'route_code', p_route_code,
    'indication_code', p_indication_code,
    'clinician_instruction', p_clinician_instruction,
    'issued_at', p_issued_at,
    'valid_from', p_valid_from,
    'valid_until', p_valid_until,
    'schedules', canonical_schedules,
    'permission_keys', to_jsonb(p_permission_keys),
    'decision_text', p_decision_text,
    'decision_rationale', p_decision_rationale
  )::text);

  SELECT * INTO existing_order
  FROM public.medication_orders
  WHERE owner_type = p_owner_type
    AND owner_id = p_owner_id
    AND creation_idempotency_key = p_creation_idempotency_key;
  IF FOUND THEN
    IF existing_order.order_hash <> computed_order_hash THEN
      RAISE EXCEPTION 'Medication idempotency key conflicts with another order' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'idempotent_replay', true,
      'order_id', existing_order.id,
      'previous_order_id', existing_order.supersedes_order_id,
      'decision_id', existing_order.source_decision_id,
      'clinical_event_id', existing_order.clinical_event_id,
      'version_number', existing_order.version_number,
      'order_hash', computed_order_hash
    );
  END IF;

  IF p_mode = 'supersede' AND (
    EXISTS (SELECT 1 FROM public.medication_order_lifecycle_events WHERE medication_order_id = previous_order.id AND event_type IN ('revoked', 'completed', 'superseded'))
    OR (previous_order.valid_until IS NOT NULL AND previous_order.valid_until <= now())
    OR previous_order.valid_from > now()
    OR EXISTS (SELECT 1 FROM public.medication_orders WHERE supersedes_order_id = previous_order.id)
  ) THEN
    RAISE EXCEPTION 'Previous medication order is not the current active version' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.clinician_decisions (
    id, module, owner_type, owner_id, organization_id, expert_id,
    decision_type, decision_text, rationale, metadata
  ) VALUES (
    decision_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    CASE WHEN p_mode = 'activate' THEN 'medication_order' ELSE 'medication_change' END,
    p_decision_text, p_decision_rationale,
    jsonb_build_object('medication_order_version', version_number, 'order_hash', computed_order_hash)
  );

  IF p_mode = 'supersede' THEN
    INSERT INTO public.clinical_events (
      id, module, owner_type, owner_id, organization_id, expert_id,
      event_type, occurred_at, source_type, source_id, source_event_key,
      provenance, validation_status, quality_level, payload
    ) VALUES (
      old_event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
      'medication_order_superseded', p_issued_at, 'medication_order', previous_order.id::text,
      'superseded_by:' || order_id::text, 'clinician_ordered', 'clinician_confirmed', 1,
      jsonb_build_object('superseded_by_order_id', order_id, 'version_number', previous_order.version_number)
    );
  END IF;

  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    new_event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_activated', p_issued_at, 'medication_order', order_id::text,
    'activated:v' || version_number::text, 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('order_group_id', order_group_id, 'version_number', version_number,
      'medication_concept_id', p_medication_concept_id, 'route_code', p_route_code,
      'valid_from', p_valid_from, 'valid_until', p_valid_until)
  );

  INSERT INTO public.medication_orders (
    id, module, owner_type, owner_id, organization_id, prescriber_expert_id,
    prescriber_authorization_id, order_group_id, version_number, supersedes_order_id,
    medication_concept_id, medication_name_snapshot, formulation_snapshot, strength_value,
    strength_unit, route_code, indication_code, clinician_instruction, issued_at,
    valid_from, valid_until, source_decision_id, clinical_event_id,
    creation_idempotency_key, order_hash
  ) VALUES (
    order_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    p_authorization_id, order_group_id, version_number,
    CASE WHEN p_mode = 'supersede' THEN previous_order.id ELSE NULL END,
    p_medication_concept_id, trim(p_medication_name_snapshot), p_formulation_snapshot,
    p_strength_value, p_strength_unit, p_route_code, p_indication_code, p_clinician_instruction,
    p_issued_at, p_valid_from, p_valid_until, decision_id, new_event_id,
    p_creation_idempotency_key, computed_order_hash
  );

  FOR item IN SELECT * FROM jsonb_to_recordset(canonical_schedules) AS phases(
    phase_number integer, dosing_mode text, phase_start_at timestamptz, phase_end_at timestamptz,
    dose_amount numeric, dose_unit text, frequency_code text, route_code text,
    administration_time_local time, timezone text, max_daily_dose_amount numeric, max_daily_dose_unit text
  ) ORDER BY phase_number LOOP
    INSERT INTO public.medication_order_schedules (
      medication_order_id, phase_number, dosing_mode, phase_start_at, phase_end_at,
      dose_amount, dose_unit, frequency_code, route_code, administration_time_local,
      timezone, max_daily_dose_amount, max_daily_dose_unit
    ) VALUES (
      order_id, item.phase_number, item.dosing_mode, item.phase_start_at, item.phase_end_at,
      item.dose_amount, item.dose_unit, item.frequency_code, item.route_code,
      item.administration_time_local, item.timezone, item.max_daily_dose_amount, item.max_daily_dose_unit
    );
  END LOOP;

  IF p_mode = 'supersede' THEN
    INSERT INTO public.medication_order_lifecycle_events (
      id, medication_order_id, event_type, related_order_id, actor_type, actor_expert_id,
      occurred_at, idempotency_key
    ) VALUES (
      old_lifecycle_id, previous_order.id, 'superseded', order_id, 'clinician', p_actor_expert_id,
      p_issued_at, p_creation_idempotency_key || ':old-superseded'
    );
  END IF;
  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, related_order_id, actor_type, actor_expert_id,
    occurred_at, idempotency_key
  ) VALUES (
    new_lifecycle_id, order_id, 'activated',
    CASE WHEN p_mode = 'supersede' THEN previous_order.id ELSE NULL END,
    'clinician', p_actor_expert_id, p_issued_at, p_creation_idempotency_key || ':activated'
  );

  IF p_mode = 'supersede' THEN
    FOR permission_row IN
      SELECT g.* FROM public.medication_ai_permissions g
      WHERE g.medication_order_id = previous_order.id
        AND g.permission_action = 'grant'
        AND NOT EXISTS (SELECT 1 FROM public.medication_ai_permissions r WHERE r.revokes_permission_id = g.id)
    LOOP
      INSERT INTO public.medication_ai_permissions (
        medication_order_id, permission_key, permission_action, granted_by_expert_id,
        organization_id, source_decision_id, revokes_permission_id, effective_at,
        expires_at, idempotency_key
      ) VALUES (
        previous_order.id, permission_row.permission_key, 'revoke', p_actor_expert_id,
        p_organization_id, decision_id, permission_row.id, p_issued_at, p_issued_at,
        p_creation_idempotency_key || ':revoke-old:' || permission_row.permission_key
      );
    END LOOP;
  END IF;

  FOREACH permission_key IN ARRAY p_permission_keys LOOP
    INSERT INTO public.medication_ai_permissions (
      medication_order_id, permission_key, permission_action, granted_by_expert_id,
      organization_id, source_decision_id, effective_at, expires_at, idempotency_key
    ) VALUES (
      order_id, permission_key, 'grant', p_actor_expert_id, p_organization_id,
      decision_id, p_valid_from, p_valid_until, p_creation_idempotency_key || ':grant:' || permission_key
    );
  END LOOP;

  SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO permission_ids
  FROM public.medication_ai_permissions
  WHERE medication_order_id = order_id AND permission_action = 'grant';
  RETURN jsonb_build_object(
    'idempotent_replay', false, 'order_id', order_id,
    'previous_order_id', CASE WHEN p_mode = 'supersede' THEN previous_order.id ELSE NULL END,
    'decision_id', decision_id, 'clinical_event_id', new_event_id,
    'version_number', version_number, 'order_hash', computed_order_hash,
    'permission_ids', permission_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_medication_order(
  p_owner_type text, p_owner_id uuid, p_organization_id uuid, p_authorization_id uuid,
  p_medication_concept_id uuid, p_medication_name_snapshot text, p_formulation_snapshot text,
  p_strength_value numeric, p_strength_unit text, p_route_code text, p_indication_code text,
  p_clinician_instruction text, p_issued_at timestamptz, p_valid_from timestamptz,
  p_valid_until timestamptz, p_schedules jsonb, p_permission_keys text[],
  p_decision_text text, p_decision_rationale text, p_creation_idempotency_key text,
  p_actor_expert_id uuid
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.medication_order_mutation_core(
    'activate', NULL, p_owner_type, p_owner_id, p_organization_id, p_authorization_id,
    p_medication_concept_id, p_medication_name_snapshot, p_formulation_snapshot,
    p_strength_value, p_strength_unit, p_route_code, p_indication_code,
    p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until, p_schedules,
    p_permission_keys, p_decision_text, p_decision_rationale, p_creation_idempotency_key,
    p_actor_expert_id
  );
$$;

CREATE OR REPLACE FUNCTION public.supersede_medication_order(
  p_previous_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_medication_concept_id uuid, p_medication_name_snapshot text,
  p_formulation_snapshot text, p_strength_value numeric, p_strength_unit text, p_route_code text,
  p_indication_code text, p_clinician_instruction text, p_issued_at timestamptz,
  p_valid_from timestamptz, p_valid_until timestamptz, p_schedules jsonb,
  p_permission_keys text[], p_decision_text text, p_decision_rationale text,
  p_creation_idempotency_key text, p_actor_expert_id uuid
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.medication_order_mutation_core(
    'supersede', p_previous_order_id, p_owner_type, p_owner_id, p_organization_id,
    p_authorization_id, p_medication_concept_id, p_medication_name_snapshot,
    p_formulation_snapshot, p_strength_value, p_strength_unit, p_route_code,
    p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until,
    p_schedules, p_permission_keys, p_decision_text, p_decision_rationale,
    p_creation_idempotency_key, p_actor_expert_id
  );
$$;

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
  permission_row record;
  revoked_count integer := 0;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 OR length(p_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'Invalid medication idempotency key' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'revoke', p_order_id::text, p_owner_type, p_owner_id::text, p_idempotency_key), 0
  ));
  SELECT * INTO existing_event
  FROM public.medication_order_lifecycle_events
  WHERE medication_order_id = p_order_id AND event_type = 'revoked' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
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
  IF p_reason_code IS NULL OR length(trim(p_reason_code)) = 0 THEN
    RAISE EXCEPTION 'Revocation reason is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clinician_decisions (
    id, module, owner_type, owner_id, organization_id, expert_id,
    decision_type, decision_text, rationale, metadata
  ) VALUES (
    decision_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_stop', coalesce(p_reason_text, 'Назначение отозвано специалистом'), p_reason_text,
    jsonb_build_object('medication_order_id', p_order_id, 'reason_code', p_reason_code)
  );
  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_revoked', now(), 'medication_order', p_order_id::text,
    'revoked:' || lifecycle_id::text, 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('reason_code', p_reason_code)
  );
  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, actor_type, actor_expert_id,
    occurred_at, reason_code, reason_text, idempotency_key
  ) VALUES (
    lifecycle_id, p_order_id, 'revoked', 'clinician', p_actor_expert_id,
    now(), p_reason_code, p_reason_text, p_idempotency_key
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
    'lifecycle_event_id', lifecycle_id, 'revoked_permission_count', revoked_count
  );
END;
$$;

ALTER FUNCTION public.enforce_internal_medication_concept() SET search_path = pg_catalog, public;
ALTER FUNCTION public.medication_order_mutation_core(
  text, uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
) SET search_path = pg_catalog, public;
ALTER FUNCTION public.activate_medication_order(
  text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
) SET search_path = pg_catalog, public;
ALTER FUNCTION public.supersede_medication_order(
  uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
) SET search_path = pg_catalog, public;
ALTER FUNCTION public.revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid)
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.enforce_internal_medication_concept() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.medication_order_mutation_core(
  text, uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_internal_medication_concept() TO service_role;
GRANT EXECUTE ON FUNCTION public.medication_order_mutation_core(
  text, uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text,
  timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid
) TO service_role;
