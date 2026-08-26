-- Clinical C2 v0.1: Support-first medication order foundation.
-- Order state is append-only and fail-closed. Patient medication AI remains disabled.

ALTER TABLE public.clinician_decisions
  DROP CONSTRAINT IF EXISTS clinician_decisions_type_check;

ALTER TABLE public.clinician_decisions
  ADD CONSTRAINT clinician_decisions_type_check CHECK (
    decision_type IN (
      'continue_monitoring', 'request_clarification', 'schedule_consultation',
      'change_care_plan', 'refer_to_specialist', 'medication_order',
      'medication_change', 'medication_stop', 'other'
    )
  );

CREATE TABLE public.medication_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_code text NOT NULL,
  source_system text NOT NULL DEFAULT 'internal',
  jurisdiction text NOT NULL DEFAULT 'RU',
  canonical_name text NOT NULL,
  display_name text NOT NULL,
  concept_kind text NOT NULL DEFAULT 'single_ingredient',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_concepts_kind_check CHECK (concept_kind IN ('single_ingredient', 'combination')),
  CONSTRAINT medication_concepts_status_check CHECK (status IN ('active', 'retired')),
  CONSTRAINT medication_concepts_code_check CHECK (length(trim(concept_code)) > 0),
  CONSTRAINT medication_concepts_jurisdiction_check CHECK (jurisdiction = 'RU'),
  UNIQUE (source_system, jurisdiction, concept_code)
);

CREATE TABLE public.medication_concept_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_concept_id uuid NOT NULL
    REFERENCES public.medication_concepts(id) ON DELETE RESTRICT,
  ingredient_code text NOT NULL,
  ingredient_name text NOT NULL,
  strength_value numeric,
  strength_unit text,
  sequence_no integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_concept_ingredients_sequence_check CHECK (sequence_no > 0),
  CONSTRAINT medication_concept_ingredients_strength_check CHECK (strength_value IS NULL OR strength_value > 0),
  CONSTRAINT medication_concept_ingredients_strength_pair_check CHECK (
    (strength_value IS NULL AND strength_unit IS NULL)
    OR (strength_value IS NOT NULL AND strength_unit IS NOT NULL AND length(trim(strength_unit)) > 0)
  ),
  UNIQUE (medication_concept_id, ingredient_code, sequence_no)
);

CREATE TABLE public.clinician_medication_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL
    REFERENCES public.experts(id) ON DELETE RESTRICT,
  organization_id uuid
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  jurisdiction text NOT NULL DEFAULT 'RU',
  authorization_scope text NOT NULL DEFAULT 'prescribe_medications',
  verification_status text NOT NULL DEFAULT 'pending',
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  verification_provenance text NOT NULL,
  verification_reference text,
  verified_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinician_medication_authorizations_jurisdiction_check CHECK (jurisdiction = 'RU'),
  CONSTRAINT clinician_medication_authorizations_scope_check CHECK (authorization_scope = 'prescribe_medications'),
  CONSTRAINT clinician_medication_authorizations_status_check CHECK (
    verification_status IN ('pending', 'verified', 'suspended', 'revoked', 'expired')
  ),
  CONSTRAINT clinician_medication_authorizations_validity_check CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT clinician_medication_authorizations_verified_at_check CHECK (
    verification_status <> 'verified' OR verified_at IS NOT NULL
  ),
  CONSTRAINT clinician_medication_authorizations_revocation_check CHECK (
    (revoked_at IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL AND length(trim(revoked_reason)) > 0)
  )
);

CREATE UNIQUE INDEX clinician_medication_authorizations_effective_idx
  ON public.clinician_medication_authorizations
    (expert_id, organization_id, jurisdiction, authorization_scope)
  NULLS NOT DISTINCT
  WHERE verification_status IN ('verified', 'suspended');

CREATE INDEX clinician_medication_authorizations_expert_idx
  ON public.clinician_medication_authorizations (expert_id, verification_status, valid_from, valid_until);

CREATE INDEX clinician_medication_authorizations_org_idx
  ON public.clinician_medication_authorizations (organization_id, verification_status);

CREATE TABLE public.medication_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  organization_id uuid
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  prescriber_expert_id uuid NOT NULL
    REFERENCES public.experts(id) ON DELETE RESTRICT,
  prescriber_authorization_id uuid NOT NULL
    REFERENCES public.clinician_medication_authorizations(id) ON DELETE RESTRICT,
  order_group_id uuid NOT NULL,
  version_number integer NOT NULL,
  supersedes_order_id uuid
    REFERENCES public.medication_orders(id) ON DELETE RESTRICT,
  medication_concept_id uuid NOT NULL
    REFERENCES public.medication_concepts(id) ON DELETE RESTRICT,
  medication_name_snapshot text NOT NULL,
  formulation_snapshot text,
  strength_value numeric NOT NULL,
  strength_unit text NOT NULL,
  route_code text NOT NULL,
  indication_code text,
  clinician_instruction text,
  issued_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  source_decision_id uuid
    REFERENCES public.clinician_decisions(id) ON DELETE RESTRICT,
  clinical_event_id uuid
    REFERENCES public.clinical_events(id) ON DELETE RESTRICT,
  creation_idempotency_key text NOT NULL,
  order_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_orders_owner_scope_check CHECK (
    (module = 'support' AND owner_type = 'anonymous_case')
    OR (module = 'body' AND owner_type = 'anonymous_profile')
  ),
  CONSTRAINT medication_orders_name_check CHECK (length(trim(medication_name_snapshot)) > 0),
  CONSTRAINT medication_orders_strength_check CHECK (strength_value > 0),
  CONSTRAINT medication_orders_strength_unit_check CHECK (
    strength_unit IN ('mg', 'g', 'mcg', 'ml', 'unit', '%')
  ),
  CONSTRAINT medication_orders_route_check CHECK (
    route_code IN ('oral', 'sublingual', 'topical', 'inhaled', 'intramuscular', 'intravenous', 'subcutaneous', 'transdermal')
  ),
  CONSTRAINT medication_orders_validity_check CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT medication_orders_version_check CHECK (version_number > 0),
  CONSTRAINT medication_orders_not_self_superseded_check CHECK (
    supersedes_order_id IS NULL OR supersedes_order_id <> id
  ),
  UNIQUE (order_group_id, version_number),
  UNIQUE (owner_type, owner_id, creation_idempotency_key)
);

CREATE UNIQUE INDEX medication_orders_single_successor_idx
  ON public.medication_orders (supersedes_order_id)
  WHERE supersedes_order_id IS NOT NULL;

CREATE INDEX medication_orders_owner_idx
  ON public.medication_orders (owner_type, owner_id, module, created_at DESC);

CREATE INDEX medication_orders_group_idx
  ON public.medication_orders (order_group_id, version_number DESC);

CREATE INDEX medication_orders_prescriber_idx
  ON public.medication_orders (prescriber_expert_id, created_at DESC);

CREATE INDEX medication_orders_concept_idx
  ON public.medication_orders (medication_concept_id);

CREATE INDEX medication_orders_org_idx
  ON public.medication_orders (organization_id, created_at DESC);

CREATE TABLE public.medication_order_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_order_id uuid NOT NULL
    REFERENCES public.medication_orders(id) ON DELETE RESTRICT,
  phase_number integer NOT NULL,
  dosing_mode text NOT NULL,
  phase_start_at timestamptz NOT NULL,
  phase_end_at timestamptz,
  dose_amount numeric NOT NULL,
  dose_unit text NOT NULL,
  frequency_code text NOT NULL,
  route_code text NOT NULL,
  administration_time_local time,
  timezone text NOT NULL,
  max_daily_dose_amount numeric,
  max_daily_dose_unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_order_schedules_phase_check CHECK (phase_number > 0),
  CONSTRAINT medication_order_schedules_mode_check CHECK (dosing_mode IN ('fixed', 'titration')),
  CONSTRAINT medication_order_schedules_dose_check CHECK (dose_amount > 0),
  CONSTRAINT medication_order_schedules_dose_unit_check CHECK (
    dose_unit IN ('mg', 'g', 'mcg', 'ml', 'unit', '%')
  ),
  CONSTRAINT medication_order_schedules_frequency_check CHECK (
    frequency_code IN ('once_daily', 'twice_daily', 'three_times_daily', 'every_other_day', 'weekly')
  ),
  CONSTRAINT medication_order_schedules_route_check CHECK (
    route_code IN ('oral', 'sublingual', 'topical', 'inhaled', 'intramuscular', 'intravenous', 'subcutaneous', 'transdermal')
  ),
  CONSTRAINT medication_order_schedules_max_dose_check CHECK (
    max_daily_dose_amount IS NULL OR max_daily_dose_amount > 0
  ),
  CONSTRAINT medication_order_schedules_max_dose_pair_check CHECK (
    (max_daily_dose_amount IS NULL AND max_daily_dose_unit IS NULL)
    OR (max_daily_dose_amount IS NOT NULL AND max_daily_dose_unit IS NOT NULL)
  ),
  UNIQUE (medication_order_id, phase_number)
);

CREATE INDEX medication_order_schedules_order_idx
  ON public.medication_order_schedules (medication_order_id, phase_number);

CREATE TABLE public.medication_order_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_order_id uuid NOT NULL
    REFERENCES public.medication_orders(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  related_order_id uuid
    REFERENCES public.medication_orders(id) ON DELETE RESTRICT,
  actor_type text NOT NULL,
  actor_expert_id uuid
    REFERENCES public.experts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  reason_code text,
  reason_text text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_order_lifecycle_type_check CHECK (
    event_type IN ('activated', 'superseded', 'revoked', 'expired', 'completed')
  ),
  CONSTRAINT medication_order_lifecycle_actor_check CHECK (
    actor_type IN ('clinician', 'admin', 'system')
  ),
  UNIQUE (medication_order_id, event_type, idempotency_key)
);

CREATE INDEX medication_order_lifecycle_order_idx
  ON public.medication_order_lifecycle_events (medication_order_id, created_at DESC);

CREATE INDEX medication_order_lifecycle_related_idx
  ON public.medication_order_lifecycle_events (related_order_id)
  WHERE related_order_id IS NOT NULL;

CREATE TABLE public.medication_ai_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_order_id uuid NOT NULL
    REFERENCES public.medication_orders(id) ON DELETE RESTRICT,
  permission_key text NOT NULL,
  permission_action text NOT NULL,
  granted_by_expert_id uuid
    REFERENCES public.experts(id) ON DELETE RESTRICT,
  organization_id uuid
    REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_decision_id uuid
    REFERENCES public.clinician_decisions(id) ON DELETE RESTRICT,
  revokes_permission_id uuid
    REFERENCES public.medication_ai_permissions(id) ON DELETE RESTRICT,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_ai_permissions_key_check CHECK (
    permission_key IN (
      'view_authorized_order',
      'explain_authorized_order',
      'show_authorized_schedule',
      'remind_authorized_schedule',
      'prepare_question_for_clinician'
    )
  ),
  CONSTRAINT medication_ai_permissions_action_check CHECK (permission_action IN ('grant', 'revoke')),
  CONSTRAINT medication_ai_permissions_expiry_check CHECK (
    permission_action = 'revoke' OR expires_at IS NULL OR expires_at > effective_at
  ),
  CONSTRAINT medication_ai_permissions_reference_check CHECK (
    (permission_action = 'grant' AND revokes_permission_id IS NULL)
    OR (permission_action = 'revoke' AND revokes_permission_id IS NOT NULL)
  ),
  UNIQUE (medication_order_id, permission_key, permission_action, idempotency_key)
);

CREATE INDEX medication_ai_permissions_order_idx
  ON public.medication_ai_permissions (medication_order_id, permission_key, created_at DESC);

CREATE INDEX medication_ai_permissions_revoked_idx
  ON public.medication_ai_permissions (revokes_permission_id)
  WHERE revokes_permission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_medication_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Medication history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER medication_orders_append_only
  BEFORE UPDATE OR DELETE ON public.medication_orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medication_history_mutation();

CREATE TRIGGER medication_order_schedules_append_only
  BEFORE UPDATE OR DELETE ON public.medication_order_schedules
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medication_history_mutation();

CREATE TRIGGER medication_order_lifecycle_append_only
  BEFORE UPDATE OR DELETE ON public.medication_order_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medication_history_mutation();

CREATE TRIGGER medication_ai_permissions_append_only
  BEFORE UPDATE OR DELETE ON public.medication_ai_permissions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_medication_history_mutation();

CREATE OR REPLACE FUNCTION public.validate_medication_schedule(
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_route_code text,
  p_schedules jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
  phase_count integer;
  distinct_phase_count integer;
  min_phase integer;
  max_phase integer;
  expected_phase integer := 1;
  previous_end timestamptz;
  first_dose_unit text;
  canonical jsonb;
BEGIN
  IF jsonb_typeof(p_schedules) <> 'array' OR jsonb_array_length(p_schedules) = 0 THEN
    RAISE EXCEPTION 'At least one medication schedule phase is required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_schedules) AS element(value)
    WHERE jsonb_typeof(element.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Schedule phases must be objects' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_schedules) AS element(value)
    CROSS JOIN LATERAL jsonb_object_keys(element.value) AS key_name(key)
    WHERE key_name.key NOT IN (
      'phase_number', 'dosing_mode', 'phase_start_at', 'phase_end_at',
      'dose_amount', 'dose_unit', 'frequency_code', 'route_code',
      'administration_time_local', 'timezone',
      'max_daily_dose_amount', 'max_daily_dose_unit'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported medication schedule field' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT phase_number), min(phase_number), max(phase_number)
  INTO phase_count, distinct_phase_count, min_phase, max_phase
  FROM jsonb_to_recordset(p_schedules) AS phases(
    phase_number integer,
    dosing_mode text,
    phase_start_at timestamptz,
    phase_end_at timestamptz,
    dose_amount numeric,
    dose_unit text,
    frequency_code text,
    route_code text,
    administration_time_local time,
    timezone text,
    max_daily_dose_amount numeric,
    max_daily_dose_unit text
  );

  IF min_phase IS NULL OR min_phase <> 1 OR max_phase <> phase_count OR distinct_phase_count <> phase_count THEN
    RAISE EXCEPTION 'Medication schedule phases must be sequential starting at 1' USING ERRCODE = '22023';
  END IF;

  IF phase_count > 1 AND EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_schedules) AS phases(
      phase_number integer, dosing_mode text, phase_start_at timestamptz,
      phase_end_at timestamptz, dose_amount numeric, dose_unit text,
      frequency_code text, route_code text, administration_time_local time,
      timezone text, max_daily_dose_amount numeric, max_daily_dose_unit text
    )
    WHERE dosing_mode = 'fixed'
  ) THEN
    RAISE EXCEPTION 'Multiple phases must use deterministic titration mode' USING ERRCODE = '22023';
  END IF;

  FOR item IN
    SELECT *
    FROM jsonb_to_recordset(p_schedules) AS phases(
      phase_number integer,
      dosing_mode text,
      phase_start_at timestamptz,
      phase_end_at timestamptz,
      dose_amount numeric,
      dose_unit text,
      frequency_code text,
      route_code text,
      administration_time_local time,
      timezone text,
      max_daily_dose_amount numeric,
      max_daily_dose_unit text
    )
    ORDER BY phase_number
  LOOP
    IF item.phase_number <> expected_phase THEN
      RAISE EXCEPTION 'Medication schedule phase sequence is invalid' USING ERRCODE = '22023';
    END IF;
    IF item.phase_start_at IS NULL THEN
      RAISE EXCEPTION 'Medication phase start is required' USING ERRCODE = '22023';
    END IF;
    IF item.phase_start_at IS NULL OR item.phase_start_at <> p_valid_from THEN
      IF item.phase_number = 1 THEN
        RAISE EXCEPTION 'First medication phase must start at valid_from' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF item.phase_number > 1 AND previous_end IS NULL THEN
      RAISE EXCEPTION 'Only the final medication phase may be open-ended' USING ERRCODE = '22023';
    END IF;
    IF item.phase_number > 1 AND item.phase_start_at <> previous_end THEN
      RAISE EXCEPTION 'Medication schedule phases must have no gaps or overlaps' USING ERRCODE = '22023';
    END IF;
    IF item.phase_end_at IS NOT NULL AND item.phase_end_at <= item.phase_start_at THEN
      RAISE EXCEPTION 'Medication phase end must be after phase start' USING ERRCODE = '22023';
    END IF;
    IF item.phase_number < max_phase AND item.phase_end_at IS NULL THEN
      RAISE EXCEPTION 'Non-final medication phase cannot be open-ended' USING ERRCODE = '22023';
    END IF;
    IF p_valid_until IS NOT NULL AND item.phase_end_at IS NOT NULL AND item.phase_end_at > p_valid_until THEN
      RAISE EXCEPTION 'Medication phase exceeds order validity' USING ERRCODE = '22023';
    END IF;
    IF item.dose_amount IS NULL OR item.dose_amount <= 0 THEN
      RAISE EXCEPTION 'Medication dose must be positive' USING ERRCODE = '22023';
    END IF;
    IF item.route_code IS DISTINCT FROM p_route_code THEN
      RAISE EXCEPTION 'Medication route must remain consistent across phases' USING ERRCODE = '22023';
    END IF;
    IF first_dose_unit IS NULL THEN
      first_dose_unit := item.dose_unit;
    ELSIF item.dose_unit IS DISTINCT FROM first_dose_unit THEN
      RAISE EXCEPTION 'Medication dose unit must remain consistent across phases' USING ERRCODE = '22023';
    END IF;
    IF item.frequency_code NOT IN ('once_daily', 'twice_daily', 'three_times_daily', 'every_other_day', 'weekly') THEN
      RAISE EXCEPTION 'Unsupported medication frequency' USING ERRCODE = '22023';
    END IF;
    IF item.timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = item.timezone) THEN
      RAISE EXCEPTION 'Medication schedule timezone is invalid' USING ERRCODE = '22023';
    END IF;
    IF (item.max_daily_dose_amount IS NULL) <> (item.max_daily_dose_unit IS NULL) THEN
      RAISE EXCEPTION 'Maximum daily dose must include amount and unit' USING ERRCODE = '22023';
    END IF;
    previous_end := item.phase_end_at;
    expected_phase := expected_phase + 1;
  END LOOP;

  SELECT jsonb_agg(
    jsonb_build_object(
      'phase_number', phase_number,
      'dosing_mode', dosing_mode,
      'phase_start_at', phase_start_at,
      'phase_end_at', phase_end_at,
      'dose_amount', dose_amount,
      'dose_unit', dose_unit,
      'frequency_code', frequency_code,
      'route_code', route_code,
      'administration_time_local', administration_time_local,
      'timezone', timezone,
      'max_daily_dose_amount', max_daily_dose_amount,
      'max_daily_dose_unit', max_daily_dose_unit
    ) ORDER BY phase_number
  )
  INTO canonical
  FROM jsonb_to_recordset(p_schedules) AS phases(
    phase_number integer, dosing_mode text, phase_start_at timestamptz,
    phase_end_at timestamptz, dose_amount numeric, dose_unit text,
    frequency_code text, route_code text, administration_time_local time,
    timezone text, max_daily_dose_amount numeric, max_daily_dose_unit text
  );

  RETURN canonical;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_medication_prescriber(
  p_owner_type text,
  p_owner_id uuid,
  p_organization_id uuid,
  p_actor_expert_id uuid,
  p_authorization_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  expert_row record;
  authorization_row record;
  has_assignment boolean;
BEGIN
  IF p_owner_type <> 'anonymous_case' OR p_actor_expert_id IS NULL THEN
    RAISE EXCEPTION 'Medication prescribing is available only for Support owners' USING ERRCODE = '42501';
  END IF;

  SELECT id, is_active, allowed_modules INTO expert_row
  FROM public.experts
  WHERE id = p_actor_expert_id;
  IF NOT FOUND OR expert_row.is_active IS NOT TRUE OR coalesce('support' = ANY(expert_row.allowed_modules), false) = false THEN
    RAISE EXCEPTION 'Prescriber is not authorized for Support' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO authorization_row
  FROM public.clinician_medication_authorizations
  WHERE id = p_authorization_id
    AND expert_id = p_actor_expert_id
    AND organization_id IS NOT DISTINCT FROM p_organization_id
    AND jurisdiction = 'RU'
    AND authorization_scope = 'prescribe_medications'
    AND verification_status = 'verified'
    AND valid_from <= now()
    AND (valid_until IS NULL OR valid_until > now())
    AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified medication authorization is required' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.expert_organization_memberships
    WHERE expert_id = p_actor_expert_id
      AND organization_id = p_organization_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Prescriber is not an active organization member' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sessions s
    JOIN public.patient_assignments pa
      ON pa.module = 'support'
     AND pa.status = 'active'
     AND pa.public_code = s.public_code
     AND pa.primary_expert_id = p_actor_expert_id
     AND pa.organization_id IS NOT DISTINCT FROM p_organization_id
    WHERE s.module = 'support'
      AND s.anonymous_owner_id = p_owner_id
      AND s.public_code IS NOT NULL
  )
  OR EXISTS (
    SELECT 1
    FROM public.sessions s
    JOIN public.patient_access pacc
      ON pacc.module = 'support'
     AND pacc.status = 'active'
     AND pacc.public_code = s.public_code
     AND pacc.expert_id = p_actor_expert_id
     AND pacc.organization_id IS NOT DISTINCT FROM p_organization_id
     AND pacc.access_role IN ('owner', 'clinician', 'supervisor', 'admin')
    WHERE s.module = 'support'
      AND s.anonymous_owner_id = p_owner_id
      AND s.public_code IS NOT NULL
  ) INTO has_assignment;

  IF NOT has_assignment THEN
    RAISE EXCEPTION 'Active Support patient access is required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_medication_order(
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
  existing_order record;
  concept_row record;
  order_id uuid := gen_random_uuid();
  order_group_id uuid := gen_random_uuid();
  decision_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  lifecycle_id uuid := gen_random_uuid();
  canonical_schedules jsonb;
  item record;
  permission_key text;
  permission_ids jsonb;
  computed_order_hash text;
BEGIN
  IF p_creation_idempotency_key IS NULL OR length(trim(p_creation_idempotency_key)) = 0 OR length(p_creation_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'Invalid medication idempotency key' USING ERRCODE = '22023';
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
  WHERE id = p_medication_concept_id;
  IF NOT FOUND OR concept_row.status <> 'active' OR concept_row.jurisdiction <> 'RU' THEN
    RAISE EXCEPTION 'Medication concept is unavailable' USING ERRCODE = '22023';
  END IF;
  canonical_schedules := public.validate_medication_schedule(
    p_valid_from, p_valid_until, p_route_code, p_schedules
  );
  computed_order_hash := md5(jsonb_build_object(
    'module', 'support', 'owner_type', p_owner_type, 'owner_id', p_owner_id,
    'organization_id', p_organization_id, 'medication_concept_id', p_medication_concept_id,
    'medication_name_snapshot', trim(p_medication_name_snapshot),
    'formulation_snapshot', p_formulation_snapshot, 'strength_value', p_strength_value,
    'strength_unit', p_strength_unit, 'route_code', p_route_code,
    'indication_code', p_indication_code, 'clinician_instruction', p_clinician_instruction,
    'issued_at', p_issued_at, 'valid_from', p_valid_from, 'valid_until', p_valid_until,
    'schedules', canonical_schedules
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
    SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO permission_ids
    FROM public.medication_ai_permissions
    WHERE medication_order_id = existing_order.id
      AND permission_action = 'grant';
    RETURN jsonb_build_object(
      'idempotent_replay', true,
      'order_id', existing_order.id,
      'decision_id', existing_order.source_decision_id,
      'clinical_event_id', existing_order.clinical_event_id,
      'version_number', existing_order.version_number,
      'order_hash', computed_order_hash,
      'permission_ids', permission_ids
    );
  END IF;

  IF p_permission_keys IS NULL THEN
    p_permission_keys := ARRAY[]::text[];
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_permission_keys) AS keys(key)
    WHERE key NOT IN (
      'view_authorized_order', 'explain_authorized_order',
      'show_authorized_schedule', 'remind_authorized_schedule',
      'prepare_question_for_clinician'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported medication AI permission' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_permission_keys) <> (SELECT count(DISTINCT key) FROM unnest(p_permission_keys) AS keys(key)) THEN
    RAISE EXCEPTION 'Duplicate medication AI permission' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clinician_decisions (
    id, module, owner_type, owner_id, organization_id, expert_id,
    decision_type, decision_text, rationale, quality_level, metadata
  ) VALUES (
    decision_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order', p_decision_text, p_decision_rationale, NULL,
    jsonb_build_object('medication_order_version', 1, 'order_hash', computed_order_hash)
  );

  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_activated', coalesce(p_issued_at, now()), 'medication_order', order_id::text,
    'activated:v1', 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('order_group_id', order_group_id, 'version_number', 1,
      'medication_concept_id', p_medication_concept_id, 'route_code', p_route_code,
      'valid_from', p_valid_from, 'valid_until', p_valid_until)
  );

  INSERT INTO public.medication_orders (
    id, module, owner_type, owner_id, organization_id, prescriber_expert_id,
    prescriber_authorization_id, order_group_id, version_number, medication_concept_id,
    medication_name_snapshot, formulation_snapshot, strength_value, strength_unit,
    route_code, indication_code, clinician_instruction, issued_at, valid_from, valid_until,
    source_decision_id, clinical_event_id, creation_idempotency_key, order_hash
  ) VALUES (
    order_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    p_authorization_id, order_group_id, 1, p_medication_concept_id,
    trim(p_medication_name_snapshot), p_formulation_snapshot, p_strength_value, p_strength_unit,
    p_route_code, p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until,
    decision_id, event_id, p_creation_idempotency_key, computed_order_hash
  );

  FOR item IN
    SELECT * FROM jsonb_to_recordset(canonical_schedules) AS phases(
      phase_number integer, dosing_mode text, phase_start_at timestamptz,
      phase_end_at timestamptz, dose_amount numeric, dose_unit text,
      frequency_code text, route_code text, administration_time_local time,
      timezone text, max_daily_dose_amount numeric, max_daily_dose_unit text
    ) ORDER BY phase_number
  LOOP
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

  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, actor_type, actor_expert_id,
    occurred_at, idempotency_key
  ) VALUES (
    lifecycle_id, order_id, 'activated', 'clinician', p_actor_expert_id,
    p_issued_at, p_creation_idempotency_key || ':activated'
  );

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
    'idempotent_replay', false,
    'order_id', order_id,
    'decision_id', decision_id,
    'clinical_event_id', event_id,
    'version_number', 1,
    'order_hash', computed_order_hash,
    'permission_ids', permission_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.supersede_medication_order(
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
  new_order_id uuid := gen_random_uuid();
  decision_id uuid := gen_random_uuid();
  new_event_id uuid := gen_random_uuid();
  old_event_id uuid := gen_random_uuid();
  new_lifecycle_id uuid := gen_random_uuid();
  old_lifecycle_id uuid := gen_random_uuid();
  canonical_schedules jsonb;
  item record;
  permission_key text;
  permission_row record;
  permission_ids jsonb;
  computed_order_hash text;
BEGIN
  SELECT * INTO previous_order
  FROM public.medication_orders
  WHERE id = p_previous_order_id
  FOR UPDATE;
  IF NOT FOUND OR previous_order.owner_type <> p_owner_type OR previous_order.owner_id <> p_owner_id
     OR previous_order.module <> 'support'
     OR previous_order.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Previous medication order is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_medication_prescriber(
    p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id, p_authorization_id
  );
  IF EXISTS (SELECT 1 FROM public.medication_order_lifecycle_events WHERE medication_order_id = previous_order.id AND event_type IN ('revoked', 'completed', 'superseded'))
     OR (previous_order.valid_until IS NOT NULL AND previous_order.valid_until <= now())
     OR previous_order.valid_from > now()
     OR EXISTS (SELECT 1 FROM public.medication_orders WHERE supersedes_order_id = previous_order.id) THEN
    RAISE EXCEPTION 'Previous medication order is not the current active version' USING ERRCODE = 'P0001';
  END IF;
  IF p_valid_from IS NULL OR p_issued_at IS NULL OR p_valid_from < p_issued_at THEN
    RAISE EXCEPTION 'Invalid medication order validity' USING ERRCODE = '22023';
  END IF;
  IF p_decision_text IS NULL OR length(trim(p_decision_text)) < 2 THEN
    RAISE EXCEPTION 'Clinician medication decision text is required' USING ERRCODE = '22023';
  END IF;
  SELECT id, status, jurisdiction INTO concept_row
  FROM public.medication_concepts WHERE id = p_medication_concept_id;
  IF NOT FOUND OR concept_row.status <> 'active' OR concept_row.jurisdiction <> 'RU' THEN
    RAISE EXCEPTION 'Medication concept is unavailable' USING ERRCODE = '22023';
  END IF;
  canonical_schedules := public.validate_medication_schedule(p_valid_from, p_valid_until, p_route_code, p_schedules);
  computed_order_hash := md5(jsonb_build_object(
    'module', 'support', 'owner_type', p_owner_type, 'owner_id', p_owner_id,
    'organization_id', p_organization_id, 'previous_order_id', previous_order.id,
    'version_number', previous_order.version_number + 1, 'medication_concept_id', p_medication_concept_id,
    'medication_name_snapshot', trim(p_medication_name_snapshot),
    'formulation_snapshot', p_formulation_snapshot, 'strength_value', p_strength_value,
    'strength_unit', p_strength_unit, 'route_code', p_route_code,
    'indication_code', p_indication_code, 'clinician_instruction', p_clinician_instruction,
    'issued_at', p_issued_at, 'valid_from', p_valid_from, 'valid_until', p_valid_until,
    'schedules', canonical_schedules
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
    RETURN jsonb_build_object('idempotent_replay', true, 'order_id', existing_order.id,
      'decision_id', existing_order.source_decision_id, 'clinical_event_id', existing_order.clinical_event_id,
      'version_number', existing_order.version_number, 'order_hash', computed_order_hash);
  END IF;
  IF p_permission_keys IS NULL THEN p_permission_keys := ARRAY[]::text[]; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_permission_keys) AS keys(key) WHERE key NOT IN (
    'view_authorized_order', 'explain_authorized_order', 'show_authorized_schedule',
    'remind_authorized_schedule', 'prepare_question_for_clinician'
  )) THEN
    RAISE EXCEPTION 'Unsupported medication AI permission' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_permission_keys) <> (SELECT count(DISTINCT key) FROM unnest(p_permission_keys) AS keys(key)) THEN
    RAISE EXCEPTION 'Duplicate medication AI permission' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clinician_decisions (
    id, module, owner_type, owner_id, organization_id, expert_id,
    decision_type, decision_text, rationale, metadata
  ) VALUES (
    decision_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_change', p_decision_text, p_decision_rationale,
    jsonb_build_object('supersedes_order_id', previous_order.id, 'order_hash', computed_order_hash)
  );

  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    old_event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_superseded', p_issued_at, 'medication_order', previous_order.id::text,
    'superseded_by:' || new_order_id::text, 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('superseded_by_order_id', new_order_id, 'version_number', previous_order.version_number)
  );

  INSERT INTO public.clinical_events (
    id, module, owner_type, owner_id, organization_id, expert_id,
    event_type, occurred_at, source_type, source_id, source_event_key,
    provenance, validation_status, quality_level, payload
  ) VALUES (
    new_event_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    'medication_order_activated', p_issued_at, 'medication_order', new_order_id::text,
    'activated:v' || (previous_order.version_number + 1)::text, 'clinician_ordered', 'clinician_confirmed', 1,
    jsonb_build_object('order_group_id', previous_order.order_group_id, 'version_number', previous_order.version_number + 1,
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
    new_order_id, 'support', p_owner_type, p_owner_id, p_organization_id, p_actor_expert_id,
    p_authorization_id, previous_order.order_group_id, previous_order.version_number + 1,
    previous_order.id, p_medication_concept_id, trim(p_medication_name_snapshot), p_formulation_snapshot,
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
      new_order_id, item.phase_number, item.dosing_mode, item.phase_start_at, item.phase_end_at,
      item.dose_amount, item.dose_unit, item.frequency_code, item.route_code,
      item.administration_time_local, item.timezone, item.max_daily_dose_amount, item.max_daily_dose_unit
    );
  END LOOP;

  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, related_order_id, actor_type, actor_expert_id,
    occurred_at, idempotency_key
  ) VALUES (
    old_lifecycle_id, previous_order.id, 'superseded', new_order_id, 'clinician', p_actor_expert_id,
    p_issued_at, p_creation_idempotency_key || ':old-superseded'
  );
  INSERT INTO public.medication_order_lifecycle_events (
    id, medication_order_id, event_type, related_order_id, actor_type, actor_expert_id,
    occurred_at, idempotency_key
  ) VALUES (
    new_lifecycle_id, new_order_id, 'activated', previous_order.id, 'clinician', p_actor_expert_id,
    p_issued_at, p_creation_idempotency_key || ':activated'
  );

  FOR permission_row IN
    SELECT g.* FROM public.medication_ai_permissions g
    WHERE g.medication_order_id = previous_order.id
      AND g.permission_action = 'grant'
      AND NOT EXISTS (
        SELECT 1 FROM public.medication_ai_permissions r
        WHERE r.revokes_permission_id = g.id
      )
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

  FOREACH permission_key IN ARRAY p_permission_keys LOOP
    INSERT INTO public.medication_ai_permissions (
      medication_order_id, permission_key, permission_action, granted_by_expert_id,
      organization_id, source_decision_id, effective_at, expires_at, idempotency_key
    ) VALUES (
      new_order_id, permission_key, 'grant', p_actor_expert_id, p_organization_id,
      decision_id, p_valid_from, p_valid_until, p_creation_idempotency_key || ':grant:' || permission_key
    );
  END LOOP;

  SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO permission_ids
  FROM public.medication_ai_permissions
  WHERE medication_order_id = new_order_id AND permission_action = 'grant';
  RETURN jsonb_build_object(
    'idempotent_replay', false, 'order_id', new_order_id, 'previous_order_id', previous_order.id,
    'decision_id', decision_id, 'clinical_event_id', new_event_id,
    'version_number', previous_order.version_number + 1, 'order_hash', computed_order_hash,
    'permission_ids', permission_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_medication_order(
  p_order_id uuid,
  p_owner_type text,
  p_owner_id uuid,
  p_organization_id uuid,
  p_authorization_id uuid,
  p_reason_code text,
  p_reason_text text,
  p_idempotency_key text,
  p_actor_expert_id uuid
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
  SELECT * INTO existing_event
  FROM public.medication_order_lifecycle_events
  WHERE medication_order_id = p_order_id
    AND event_type = 'revoked'
    AND idempotency_key = p_idempotency_key;
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
      AND NOT EXISTS (
        SELECT 1 FROM public.medication_ai_permissions r
        WHERE r.revokes_permission_id = g.id
      )
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

ALTER TABLE public.medication_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_concept_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinician_medication_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_order_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_order_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_ai_permissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.medication_concepts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.medication_concept_ingredients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.clinician_medication_authorizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.medication_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.medication_order_schedules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.medication_order_lifecycle_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.medication_ai_permissions FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.medication_concepts TO service_role;
GRANT ALL ON TABLE public.medication_concept_ingredients TO service_role;
GRANT ALL ON TABLE public.clinician_medication_authorizations TO service_role;
GRANT ALL ON TABLE public.medication_orders TO service_role;
GRANT ALL ON TABLE public.medication_order_schedules TO service_role;
GRANT ALL ON TABLE public.medication_order_lifecycle_events TO service_role;
GRANT ALL ON TABLE public.medication_ai_permissions TO service_role;

REVOKE ALL ON FUNCTION public.validate_medication_schedule(timestamptz, timestamptz, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_medication_prescriber(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_medication_schedule(timestamptz, timestamptz, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_medication_prescriber(text, uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) TO service_role;

COMMENT ON TABLE public.medication_concepts IS 'Curated RU medication concepts for C2 v0.1; no patient or AI writes.';
COMMENT ON TABLE public.medication_concept_ingredients IS 'Normalized active ingredients for curated medication concepts.';
COMMENT ON TABLE public.clinician_medication_authorizations IS 'Manually verified prescribing capability; not inferred from expert role or specialty.';
COMMENT ON TABLE public.medication_orders IS 'Immutable medication order versions. Clinical changes create a superseding version.';
COMMENT ON TABLE public.medication_order_schedules IS 'Immutable deterministic fixed/titration schedule phases.';
COMMENT ON TABLE public.medication_order_lifecycle_events IS 'Append-only medication order lifecycle and audit events.';
COMMENT ON TABLE public.medication_ai_permissions IS 'Append-only positive safe AI permissions; patient medication AI is disabled in C2 v0.1.';
