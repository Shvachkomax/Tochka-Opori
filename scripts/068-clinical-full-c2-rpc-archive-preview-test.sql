-- Full original Support C2 RPC smoke + atomic archive adapters. Synthetic only; entire test ROLLBACK.
BEGIN;
-- Clinical Longitudinal v0.4.2, STAGING CONTRACT. DO NOT APPLY TO PRODUCTION.
-- Requires original Support medical tables and RPCs from Supabase migrations.
-- This is a gated first-party adapter, no patient data copied to Clinical-Test.
-- Atomic wrapper: pre-existing authenticated RPC first; archive second in
-- same transaction. Any archive failure rolls back the prescribed action.
DO $preflight$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY[
 'medication_orders','medication_order_schedules',
 'medication_order_lifecycle_events','clinician_medication_authorizations'
 ] LOOP
   IF to_regclass(format('public.%I',tbl)) IS NULL THEN
     RAISE EXCEPTION 'medical staging schema missing: %', tbl;
   END IF;
 END LOOP;
 IF to_regprocedure('public.activate_medication_order(text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)') IS NULL
    OR to_regprocedure('public.supersede_medication_order(uuid,text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)') IS NULL
    OR to_regprocedure('public.revoke_medication_order(uuid,text,uuid,uuid,uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'medication RPC contract mismatch';
 END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS clinical_medication_archive;
REVOKE ALL ON SCHEMA clinical_medication_archive FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA clinical_medication_archive TO service_role;
CREATE TABLE clinical_medication_archive.order_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_event_id uuid NOT NULL UNIQUE,
 source_order_id uuid NOT NULL,
 group_id uuid NOT NULL,
 version_number integer NOT NULL,
 action text NOT NULL CHECK(action IN ('activate','supersede','revoke')),
 owner_type text NOT NULL CHECK(owner_type='anonymous_case'),
 owner_id uuid NOT NULL,
 organization_id uuid,
 previous_state jsonb,
 new_state jsonb NOT NULL,
 actor_expert_id uuid NOT NULL,
 actor_authorization_id uuid NOT NULL,
 author_status text NOT NULL CHECK(author_status='verified_authorization_checked'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT archive_transition_check CHECK (
  (action='activate' AND version_number=1 AND previous_state IS NULL)
  OR (action='supersede' AND version_number>1 AND previous_state IS NOT NULL)
  OR (action='revoke' AND previous_state IS NOT NULL)
 ),
 UNIQUE(group_id,action,version_number)
);
CREATE INDEX IF NOT EXISTS clinical_medication_archive_group_idx
 ON clinical_medication_archive.order_history(group_id,captured_at,id);
ALTER TABLE clinical_medication_archive.order_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_medication_archive.order_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON clinical_medication_archive.order_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE clinical_medication_archive.order_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION clinical_medication_archive.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $rej$
BEGIN
 RAISE EXCEPTION 'medical_archive_append_only' USING ERRCODE='23514';
END;$rej$;
REVOKE ALL ON FUNCTION clinical_medication_archive.reject_mutation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS medical_archive_immutable ON clinical_medication_archive.order_history;
CREATE TRIGGER medical_archive_immutable BEFORE UPDATE OR DELETE ON
 clinical_medication_archive.order_history FOR EACH ROW
 EXECUTE FUNCTION clinical_medication_archive.reject_mutation();
DROP TRIGGER IF EXISTS medical_archive_no_truncate ON clinical_medication_archive.order_history;
CREATE TRIGGER medical_archive_no_truncate BEFORE TRUNCATE ON
 clinical_medication_archive.order_history FOR EACH STATEMENT
 EXECUTE FUNCTION clinical_medication_archive.reject_mutation();

CREATE OR REPLACE FUNCTION clinical_medication_archive.capture_medication_revision(
 p_order_id uuid,p_action text,p_owner_type text,p_owner_id uuid,
 p_organization_id uuid,p_actor_expert_id uuid,p_authorization_id uuid,
 p_idempotency_key text
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $cap$
DECLARE
 ord record;
 authorization record;
 ev record;
 v_previous jsonb;
 v_current jsonb;
 v_phases jsonb;
 v_id bigint;
BEGIN
 IF p_action NOT IN ('activate','supersede','revoke') OR
    p_owner_type<>'anonymous_case' OR p_order_id IS NULL OR
    p_owner_id IS NULL OR p_actor_expert_id IS NULL OR
    p_authorization_id IS NULL OR p_idempotency_key IS NULL THEN
  RAISE EXCEPTION 'invalid_medication_archive_context' USING ERRCODE='23514';
 END IF;
 SELECT * INTO ord FROM public.medication_orders
 WHERE id=p_order_id AND owner_type=p_owner_type AND owner_id=p_owner_id
   AND organization_id IS NOT DISTINCT FROM p_organization_id AND module='support';
 IF NOT FOUND THEN RAISE EXCEPTION 'medication_archive_owner_scope_mismatch' USING ERRCODE='42501'; END IF;
 SELECT * INTO authorization FROM public.clinician_medication_authorizations
 WHERE id=p_authorization_id AND expert_id=p_actor_expert_id AND
 organization_id IS NOT DISTINCT FROM p_organization_id AND
 jurisdiction='RU' AND authorization_scope='prescribe_medications' AND
 verification_status='verified' AND revoked_at IS NULL AND
 valid_from<=now() AND (valid_until IS NULL OR valid_until>now());
 IF NOT FOUND THEN
  RAISE EXCEPTION 'medication_archive_actor_authorization_invalid' USING ERRCODE='42501';
 END IF;
 IF p_action<>'revoke' AND (ord.prescriber_expert_id<>p_actor_expert_id OR
    ord.prescriber_authorization_id<>p_authorization_id) THEN
   RAISE EXCEPTION 'medication_archive_prescriber_mismatch' USING ERRCODE='42501';
 END IF;
 SELECT * INTO ev FROM public.medication_order_lifecycle_events
 WHERE medication_order_id=p_order_id
   AND event_type=CASE WHEN p_action='revoke' THEN 'revoked' ELSE 'activated' END
   AND actor_type='clinician' AND actor_expert_id=p_actor_expert_id
   AND idempotency_key=CASE WHEN p_action='revoke'
       THEN p_idempotency_key ELSE p_idempotency_key||':activated' END
 ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'medication_archive_lifecycle_event_missing' USING ERRCODE='23514';
 END IF;
 SELECT id INTO v_id FROM clinical_medication_archive.order_history
 WHERE source_event_id=ev.id;
 IF FOUND THEN RETURN v_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('medical-archive:'||ord.order_group_id::text,0));
 SELECT new_state INTO v_previous FROM clinical_medication_archive.order_history
 WHERE group_id=ord.order_group_id ORDER BY id DESC LIMIT 1;
 IF p_action='activate' AND (ord.version_number<>1 OR v_previous IS NOT NULL) THEN
   RAISE EXCEPTION 'medication_archive_initial_group_inconsistent' USING ERRCODE='23514';
 END IF;
 IF p_action='supersede' AND (
   ord.version_number<=1 OR v_previous IS NULL OR
   v_previous->>'state'<>'active' OR
   NOT EXISTS(SELECT 1 FROM public.medication_orders old
     WHERE old.id=ord.supersedes_order_id AND
       old.order_group_id=ord.order_group_id AND
       old.version_number=ord.version_number-1)
 ) THEN RAISE EXCEPTION 'medication_archive_supersession_gap' USING ERRCODE='23514'; END IF;
 IF p_action='revoke' AND (
   v_previous IS NULL OR v_previous->>'state'<>'active' OR
   (v_previous->>'version_number')::integer<>ord.version_number
 ) THEN RAISE EXCEPTION 'medication_archive_revocation_gap' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object(
  'phase_number',phase_number,'dose_amount',dose_amount,'dose_unit',dose_unit,
  'frequency_code',frequency_code,'route_code',route_code,
  'phase_start_at',phase_start_at,'phase_end_at',phase_end_at,
  'dosing_mode',dosing_mode
 ) ORDER BY phase_number) INTO v_phases
 FROM public.medication_order_schedules WHERE medication_order_id=ord.id;
 IF v_phases IS NULL THEN
  RAISE EXCEPTION 'medication_archive_missing_dose_schedule' USING ERRCODE='23514';
 END IF;
 v_current:=jsonb_build_object(
  'version_number',ord.version_number,'medication_name',ord.medication_name_snapshot,
  'formulation',ord.formulation_snapshot,'strength_value',ord.strength_value,
  'strength_unit',ord.strength_unit,'route_code',ord.route_code,
  'issued_at',ord.issued_at,'valid_from',ord.valid_from,
  'valid_until',ord.valid_until,'schedules',v_phases,
  'state',CASE WHEN p_action='revoke' THEN 'revoked' ELSE 'active' END
 );
 IF p_action='revoke' THEN
  v_current:=jsonb_set(v_previous,'{state}','"revoked"'::jsonb);
 END IF;
 INSERT INTO clinical_medication_archive.order_history(
  source_event_id,source_order_id,group_id,version_number,action,
  owner_type,owner_id,organization_id,previous_state,new_state,
  actor_expert_id,actor_authorization_id,author_status
 ) VALUES(
  ev.id,ord.id,ord.order_group_id,ord.version_number,p_action,
  p_owner_type,p_owner_id,p_organization_id,v_previous,v_current,
  p_actor_expert_id,p_authorization_id,'verified_authorization_checked'
 ) RETURNING id INTO v_id;
 RETURN v_id;
END;
$cap$;
REVOKE ALL ON FUNCTION clinical_medication_archive.capture_medication_revision(uuid,text,text,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION clinical_medication_archive.capture_medication_revision(uuid,text,text,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.clinical_activate_medication_order(p_owner_type text, p_owner_id uuid, p_organization_id uuid, p_authorization_id uuid,
  p_medication_concept_id uuid, p_medication_name_snapshot text, p_formulation_snapshot text,
  p_strength_value numeric, p_strength_unit text, p_route_code text, p_indication_code text,
  p_clinician_instruction text, p_issued_at timestamptz, p_valid_from timestamptz,
  p_valid_until timestamptz, p_schedules jsonb, p_permission_keys text[],
  p_decision_text text, p_decision_rationale text, p_creation_idempotency_key text,
  p_actor_expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $wrap$
DECLARE v_result jsonb; v_captured bigint;
BEGIN
  v_result := public.activate_medication_order(p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_medication_concept_id, p_medication_name_snapshot, p_formulation_snapshot, p_strength_value, p_strength_unit, p_route_code, p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until, p_schedules, p_permission_keys, p_decision_text, p_decision_rationale, p_creation_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_medication_archive.capture_medication_revision(
     (v_result->>'order_id')::uuid,'activate',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_creation_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION public.clinical_activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinical_activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clinical_supersede_medication_order(p_previous_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_medication_concept_id uuid, p_medication_name_snapshot text,
  p_formulation_snapshot text, p_strength_value numeric, p_strength_unit text, p_route_code text,
  p_indication_code text, p_clinician_instruction text, p_issued_at timestamptz,
  p_valid_from timestamptz, p_valid_until timestamptz, p_schedules jsonb,
  p_permission_keys text[], p_decision_text text, p_decision_rationale text,
  p_creation_idempotency_key text, p_actor_expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $wrap$
DECLARE v_result jsonb; v_captured bigint;
BEGIN
  v_result := public.supersede_medication_order(p_previous_order_id, p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_medication_concept_id, p_medication_name_snapshot, p_formulation_snapshot, p_strength_value, p_strength_unit, p_route_code, p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until, p_schedules, p_permission_keys, p_decision_text, p_decision_rationale, p_creation_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_medication_archive.capture_medication_revision(
     (v_result->>'order_id')::uuid,'supersede',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_creation_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION public.clinical_supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinical_supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.clinical_revoke_medication_order(p_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_reason_code text, p_reason_text text,
  p_idempotency_key text, p_actor_expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $wrap$
DECLARE v_result jsonb; v_captured bigint;
BEGIN
  v_result := public.revoke_medication_order(p_order_id, p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_reason_code, p_reason_text, p_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_medication_archive.capture_medication_revision(
     (v_result->>'order_id')::uuid,'revoke',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION public.clinical_revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinical_revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) TO service_role;

COMMENT ON TABLE clinical_medication_archive.order_history IS
 'Restricted clinician-authorized medication snapshots; not research data. Requires separate lawful retention and Russian medical infrastructure.';

-- C2 v0.1 synthetic TEST smoke. Everything is rolled back at the end.

DO $$
DECLARE
  expert_id uuid := '11111111-1111-4111-8111-111111111111';
  unauthorized_expert_id uuid := '22222222-2222-4222-8222-222222222222';
  owner_id uuid := '33333333-3333-4333-8333-333333333333';
  concept_id uuid := '44444444-4444-4444-8444-444444444444';
  auth_id uuid := '55555555-5555-4555-8555-555555555555';
  order_v1 uuid;
  order_v2 uuid;
  retry_order uuid;
  conflict_raised boolean := false;
  supersede_conflict_raised boolean := false;
  revoke_conflict_raised boolean := false;
  unauthorized_raised boolean := false;
  body_raised boolean := false;
  stale_raised boolean := false;
  update_raised boolean := false;
  delete_raised boolean := false;
  invalid_schedule_raised boolean := false;
  invalid_permission_raised boolean := false;
  issued_at timestamptz := now() - interval '1 hour';
  valid_from timestamptz := now() - interval '1 hour';
  valid_until timestamptz := now() + interval '30 days';
  phase_end timestamptz := now() + interval '30 days';
  v2_issued_at timestamptz := now() - interval '30 minutes';
  v2_valid_from timestamptz := now() - interval '30 minutes';
  v2_phase_end timestamptz := now() + interval '7 days';
  v1_schedule jsonb;
  v2_schedule jsonb;
  result jsonb;
BEGIN
  INSERT INTO public.experts (id, name, access_code, is_active, allowed_modules)
  VALUES (expert_id, 'C2 synthetic prescriber', 'C2-SYNTH-PRESCRIBER', true, ARRAY['support']::text[]);

  INSERT INTO public.experts (id, name, access_code, is_active, allowed_modules)
  VALUES (unauthorized_expert_id, 'C2 synthetic non-prescriber', 'C2-SYNTH-NON-PRESCRIBER', true, ARRAY['support']::text[]);

  INSERT INTO public.sessions (id, public_code, session_id, module, anonymous_owner_id)
  VALUES ('66666666-6666-4666-8666-666666666666', 'C2-SYNTH-PUBLIC', 'c2-synthetic-session', 'support', owner_id);

  INSERT INTO public.patient_assignments (public_code, primary_expert_id, status, module)
  VALUES ('C2-SYNTH-PUBLIC', expert_id, 'active', 'support');

  INSERT INTO public.medication_concepts (
    id, concept_code, source_system, jurisdiction, canonical_name, display_name, concept_kind, status
  ) VALUES (
    concept_id, 'c2.synthetic.medication', 'internal', 'RU', 'Synthetic medication', 'Тестовый препарат', 'single_ingredient', 'active'
  );

  INSERT INTO public.medication_concept_ingredients (
    medication_concept_id, ingredient_code, ingredient_name, strength_value, strength_unit, sequence_no
  ) VALUES (concept_id, 'c2.synthetic.ingredient', 'Synthetic active ingredient', 25, 'mg', 1);

  INSERT INTO public.clinician_medication_authorizations (
    id, expert_id, organization_id, jurisdiction, authorization_scope, verification_status,
    valid_from, valid_until, verification_provenance, verification_reference, verified_at
  ) VALUES (
    auth_id, expert_id, NULL, 'RU', 'prescribe_medications', 'verified',
    issued_at - interval '1 day', valid_until, 'operator_manual_test', 'c2-synthetic-auth', issued_at - interval '1 day'
  );

  v1_schedule := jsonb_build_array(jsonb_build_object(
    'phase_number', 1,
    'dosing_mode', 'fixed',
    'phase_start_at', valid_from,
    'phase_end_at', phase_end,
    'dose_amount', 25,
    'dose_unit', 'mg',
    'frequency_code', 'once_daily',
    'route_code', 'oral',
    'administration_time_local', NULL,
    'timezone', 'Europe/Moscow',
    'max_daily_dose_amount', NULL,
    'max_daily_dose_unit', NULL
  ));

  SELECT public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  ) INTO result;
  order_v1 := (result->>'order_id')::uuid;

  IF (SELECT count(*) FROM public.medication_orders WHERE id = order_v1) <> 1
     OR (SELECT count(*) FROM public.medication_order_schedules WHERE medication_order_id = order_v1) <> 1
     OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v1 AND event_type = 'activated') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v1 AND permission_action = 'grant') <> 2
     OR (SELECT count(*) FROM public.clinician_decisions WHERE id = (SELECT source_decision_id FROM public.medication_orders WHERE id = order_v1)) <> 1
     OR (SELECT count(*) FROM public.clinical_events WHERE id = (SELECT clinical_event_id FROM public.medication_orders WHERE id = order_v1)) <> 1 THEN
    RAISE EXCEPTION 'activation aggregate is incomplete';
  END IF;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v1) <> 'Тестовый препарат' THEN
    RAISE EXCEPTION 'activation did not bind medication name to catalog';
  END IF;

  UPDATE public.medication_concepts SET display_name = 'Тестовый препарат B' WHERE id = concept_id;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v1) <> 'Тестовый препарат' THEN
    RAISE EXCEPTION 'historical medication snapshot changed with catalog';
  END IF;

  SELECT (public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Drug B spoof', 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  )->>'order_id')::uuid INTO retry_order;
  IF retry_order <> order_v1 OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-activate-v1') <> 1 THEN
    RAISE EXCEPTION 'activation idempotency failed';
  END IF;
  SELECT (public.clinical_activate_medication_order(
    'anonymous_case', owner_id, NULL, auth_id, concept_id,
    NULL, 'tablet', 25, 'mg', 'oral', NULL,
    'Принимать по назначению специалиста.', issued_at, valid_from, valid_until,
    v1_schedule, ARRAY['view_authorized_order', 'show_authorized_schedule']::text[],
    'Назначить тестовое лечение.', 'Основание для synthetic smoke.', 'c2-smoke-activate-v1', expert_id
  )->>'order_id')::uuid INTO retry_order;
  IF retry_order <> order_v1 THEN RAISE EXCEPTION 'empty browser medication name changed replay'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 50, 'mg', 'oral', NULL,
      'Другая инструкция.', issued_at, valid_from, valid_until,
      v1_schedule, ARRAY['view_authorized_order']::text[],
      'Конфликтующий запрос.', NULL, 'c2-smoke-activate-v1', expert_id
    );
    RAISE EXCEPTION 'idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    conflict_raised := true;
  END;
  IF NOT conflict_raised THEN RAISE EXCEPTION 'idempotency conflict was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['view_authorized_order']::text[], 'Unauthorized test.', NULL,
      'c2-smoke-unauthorized', unauthorized_expert_id
    );
    RAISE EXCEPTION 'unauthorized prescriber was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    unauthorized_raised := true;
  END;
  IF NOT unauthorized_raised THEN RAISE EXCEPTION 'unauthorized prescriber was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_profile', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['view_authorized_order']::text[], 'Body test.', NULL,
      'c2-smoke-body', expert_id
    );
    RAISE EXCEPTION 'Body runtime was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    body_raised := true;
  END;
  IF NOT body_raised THEN RAISE EXCEPTION 'Body runtime was not rejected'; END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until,
      jsonb_build_array(jsonb_build_object(
        'phase_number', 1, 'dosing_mode', 'fixed', 'phase_start_at', valid_from,
        'phase_end_at', phase_end, 'dose_amount', 25, 'dose_unit', 'mg',
        'frequency_code', 'prn', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
      )), ARRAY['view_authorized_order']::text[], 'Invalid schedule.', NULL,
      'c2-smoke-invalid-schedule', expert_id
    );
    RAISE EXCEPTION 'invalid schedule was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_schedule_raised := true;
  END;
  IF NOT invalid_schedule_raised OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-invalid-schedule') <> 0 THEN
    RAISE EXCEPTION 'invalid schedule was not atomically rejected';
  END IF;

  BEGIN
    PERFORM public.clinical_activate_medication_order(
      'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 25, 'mg', 'oral', NULL,
      NULL, issued_at, valid_from, valid_until, v1_schedule,
      ARRAY['change_dose']::text[], 'Invalid permission.', NULL,
      'c2-smoke-invalid-permission', expert_id
    );
    RAISE EXCEPTION 'invalid permission was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    invalid_permission_raised := true;
  END;
  IF NOT invalid_permission_raised OR (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key = 'c2-smoke-invalid-permission') <> 0 THEN
    RAISE EXCEPTION 'invalid permission was not atomically rejected';
  END IF;

  BEGIN
    UPDATE public.medication_orders SET clinician_instruction = 'forbidden update' WHERE id = order_v1;
    RAISE EXCEPTION 'order update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    update_raised := true;
  END;
  IF NOT update_raised THEN RAISE EXCEPTION 'order immutability trigger did not fire'; END IF;

  BEGIN
    DELETE FROM public.medication_orders WHERE id = order_v1;
    RAISE EXCEPTION 'order delete was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    delete_raised := true;
  END;
  IF NOT delete_raised THEN RAISE EXCEPTION 'order delete immutability trigger did not fire'; END IF;

  BEGIN
    UPDATE public.medication_order_schedules SET dose_amount = 99 WHERE medication_order_id = order_v1;
    RAISE EXCEPTION 'schedule update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE public.medication_ai_permissions SET permission_key = 'change_dose' WHERE medication_order_id = order_v1;
    RAISE EXCEPTION 'permission update was accepted';
  EXCEPTION WHEN sqlstate '55000' THEN
    NULL;
  END;

  v2_schedule := jsonb_build_array(
    jsonb_build_object(
      'phase_number', 1, 'dosing_mode', 'titration', 'phase_start_at', v2_valid_from,
      'phase_end_at', v2_phase_end, 'dose_amount', 25, 'dose_unit', 'mg',
      'frequency_code', 'once_daily', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
    ),
    jsonb_build_object(
      'phase_number', 2, 'dosing_mode', 'titration', 'phase_start_at', v2_phase_end,
      'phase_end_at', NULL, 'dose_amount', 50, 'dose_unit', 'mg',
      'frequency_code', 'once_daily', 'route_code', 'oral', 'timezone', 'Europe/Moscow'
    )
  );

  SELECT public.clinical_supersede_medication_order(
    order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
    'Drug B spoof', 'tablet', 50, 'mg', 'oral', NULL,
    'Новая версия назначения.', v2_issued_at, v2_valid_from, valid_until,
    v2_schedule, ARRAY['view_authorized_order', 'explain_authorized_order']::text[],
    'Изменить тестовое лечение.', 'Новая clinical decision.', 'c2-smoke-supersede-v2', expert_id
  ) INTO result;
  order_v2 := (result->>'order_id')::uuid;

  IF (SELECT supersedes_order_id FROM public.medication_orders WHERE id = order_v2) <> order_v1
     OR (SELECT count(*) FROM public.medication_order_schedules WHERE medication_order_id = order_v2) <> 2
     OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v1 AND event_type = 'superseded') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v1 AND permission_action = 'revoke') <> 2
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v2 AND permission_action = 'grant') <> 2
     OR (SELECT count(*) FROM public.clinical_events WHERE event_type IN ('medication_order_superseded', 'medication_order_activated') AND source_id IN (order_v1::text, order_v2::text)) <> 3 THEN
    RAISE EXCEPTION 'supersession aggregate is incomplete';
  END IF;
  IF (SELECT medication_name_snapshot FROM public.medication_orders WHERE id = order_v2) <> 'Тестовый препарат B' THEN
    RAISE EXCEPTION 'supersession did not bind medication name to catalog';
  END IF;

  BEGIN
    PERFORM public.clinical_supersede_medication_order(
      order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 55, 'mg', 'oral', NULL,
      'Изменённая версия.', v2_issued_at, v2_valid_from, valid_until,
      v2_schedule, ARRAY['view_authorized_order']::text[],
      'Изменённое решение.', NULL, 'c2-smoke-supersede-v2', expert_id
    );
    RAISE EXCEPTION 'supersede idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    supersede_conflict_raised := true;
  END;
  IF NOT supersede_conflict_raised OR (SELECT count(*) FROM public.medication_orders WHERE order_group_id = (SELECT order_group_id FROM public.medication_orders WHERE id = order_v1)) <> 2 THEN
    RAISE EXCEPTION 'supersede idempotency conflict was not rejected';
  END IF;

  BEGIN
    PERFORM public.clinical_supersede_medication_order(
      order_v1, 'anonymous_case', owner_id, NULL, auth_id, concept_id,
      'Тестовый препарат', 'tablet', 60, 'mg', 'oral', NULL,
      'Stale version.', v2_issued_at, v2_valid_from, valid_until,
      v2_schedule, ARRAY['view_authorized_order']::text[],
      'Stale decision.', NULL, 'c2-smoke-stale-v1', expert_id
    );
    RAISE EXCEPTION 'stale supersession was accepted';
  EXCEPTION WHEN raise_exception THEN
    stale_raised := true;
  END;
  IF NOT stale_raised THEN RAISE EXCEPTION 'stale supersession was not rejected'; END IF;

  SELECT public.clinical_revoke_medication_order(
    order_v2, 'anonymous_case', owner_id, NULL, auth_id,
    'clinician_decision', 'Отозвано для synthetic smoke.', 'c2-smoke-revoke-v2', expert_id
  ) INTO result;
  IF (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v2 AND event_type = 'revoked') <> 1
     OR (SELECT count(*) FROM public.medication_ai_permissions WHERE medication_order_id = order_v2 AND permission_action = 'revoke') <> 2 THEN
    RAISE EXCEPTION 'revocation aggregate is incomplete';
  END IF;

  BEGIN
    PERFORM public.clinical_revoke_medication_order(
      order_v2, 'anonymous_case', owner_id, NULL, auth_id,
      'different_reason', 'Другой смысл операции.', 'c2-smoke-revoke-v2', expert_id
    );
    RAISE EXCEPTION 'revoke idempotency conflict was accepted';
  EXCEPTION WHEN unique_violation THEN
    revoke_conflict_raised := true;
  END;
  IF NOT revoke_conflict_raised OR (SELECT count(*) FROM public.medication_order_lifecycle_events WHERE medication_order_id = order_v2 AND event_type = 'revoked') <> 1 THEN
    RAISE EXCEPTION 'revoke idempotency conflict was not rejected';
  END IF;

  SELECT public.clinical_revoke_medication_order(
    order_v2, 'anonymous_case', owner_id, NULL, auth_id,
    'clinician_decision', 'Отозвано для synthetic smoke.', 'c2-smoke-revoke-v2', expert_id
  ) INTO result;
  IF result->>'idempotent_replay' <> 'true' THEN RAISE EXCEPTION 'revocation idempotency failed'; END IF;

  RAISE NOTICE 'C2 medication smoke passed';
END;
$$;


DO $archive_verify$
DECLARE
  v1 record;
  v2 record;
  v3 record;
  n integer;
  first_order record;
  v_failed uuid;
  v_auth uuid := '55555555-5555-4555-8555-555555555555';
  v_exp uuid := '11111111-1111-4111-8111-111111111111';
  v_owner uuid := '33333333-3333-4333-8333-333333333333';
  v_concept uuid := '44444444-4444-4444-8444-444444444444';
  v_time timestamptz := now()-interval '35 minutes';
  v_end timestamptz := now()+interval '14 days';
  v_schedule jsonb;
BEGIN
 SELECT * INTO v1 FROM clinical_medication_archive.order_history WHERE action='activate';
 SELECT * INTO v2 FROM clinical_medication_archive.order_history WHERE action='supersede';
 SELECT * INTO v3 FROM clinical_medication_archive.order_history WHERE action='revoke';
 SELECT count(*) INTO n FROM clinical_medication_archive.order_history;
 IF n<>3 OR v1.id IS NULL OR v2.id IS NULL OR v3.id IS NULL THEN
   RAISE EXCEPTION 'archive should hold exactly 3 lifecycle versions, got %',n;
 END IF;
 IF v1.owner_id<>v_owner OR v2.owner_id<>v_owner OR v3.owner_id<>v_owner
    OR v1.organization_id IS NOT NULL
    OR v2.group_id<>v1.group_id OR v3.group_id<>v1.group_id
    OR v2.version_number<>2 OR v3.version_number<>2
    OR v3.new_state->>'state'<>'revoked' THEN
   RAISE EXCEPTION 'archive scope or treatment lineage mismatch';
 END IF;
 IF (v1.new_state->'schedules'->0->>'dose_amount')::numeric<>25
  OR (v2.new_state->'schedules'->1->>'dose_amount')::numeric<>50
  OR jsonb_array_length(v2.new_state->'schedules')<>2
  OR v2.previous_state->>'state'<>'active'
  OR v3.previous_state->>'state'<>'active' THEN
  RAISE EXCEPTION 'titration, 2 phases or before/after state missing';
 END IF;
 IF v1.author_status<>'verified_authorization_checked'
   OR v1.actor_authorization_id<>v_auth
   OR v2.actor_expert_id<>v_exp
   OR v3.actor_expert_id<>v_exp THEN
  RAISE EXCEPTION 'verified prescriber provenance not recorded';
 END IF;
 IF has_function_privilege('anon', 'public.clinical_activate_medication_order(text,uuid,uuid,uuid,uuid,text,text,numeric,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text[],text,text,text,uuid)', 'EXECUTE')
  OR has_table_privilege('authenticated','clinical_medication_archive.order_history','SELECT') THEN
  RAISE EXCEPTION 'archive or mutation callable by browser';
 END IF;

 v_schedule:=jsonb_build_array(jsonb_build_object(
 'phase_number',1,'dosing_mode','fixed','phase_start_at',v_time,
 'phase_end_at',v_end,'dose_amount',25,'dose_unit','mg',
 'frequency_code','once_daily','route_code','oral','timezone','Europe/Moscow'
 ));
 -- Refuse to archive a new v2 for an existing course that has no verified v1 snapshot.
 SELECT * INTO first_order FROM public.medication_orders
 WHERE creation_idempotency_key='c2-smoke-activate-v1';
 SELECT id INTO v_failed FROM public.medication_orders
 WHERE creation_idempotency_key='c2-real-rpc-legacy-v1';
 IF v_failed IS NOT NULL THEN RAISE EXCEPTION 'unexpected test collision'; END IF;
 -- A separate new course is created outside the archive to simulate a legacy group.
 PERFORM public.activate_medication_order(
  'anonymous_case',v_owner,NULL,v_auth,v_concept,
  NULL,'tablet',25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
  v_schedule,ARRAY[]::text[],'Учебное решение',NULL,
  'c2-real-rpc-legacy-v1',v_exp
 );
 SELECT * INTO first_order FROM public.medication_orders
 WHERE creation_idempotency_key='c2-real-rpc-legacy-v1';
 BEGIN
   PERFORM public.clinical_supersede_medication_order(
     first_order.id,'anonymous_case',v_owner,NULL,v_auth,v_concept,
     NULL,'tablet',25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
     v_schedule,ARRAY[]::text[],'Изменение учебной схемы',NULL,
     'c2-real-rpc-legacy-v2',v_exp
   );
   RAISE EXCEPTION 'archiving v2 without v1 was allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM public.medication_orders
   WHERE creation_idempotency_key='c2-real-rpc-legacy-v2') THEN
   RAISE EXCEPTION 'failed archive did not roll back original RPC';
 END IF;
 -- Force the archive insert to fail, not the medication RPC itself.
 ALTER TABLE clinical_medication_archive.order_history
 ADD CONSTRAINT integration_write_failure CHECK(action<>'activate') NOT VALID;
 BEGIN
   PERFORM public.clinical_activate_medication_order(
    'anonymous_case',v_owner,NULL,v_auth,v_concept,NULL,'tablet',
    25,'mg','oral',NULL,NULL,v_time,v_time,v_end,
    v_schedule,ARRAY[]::text[],'Тест отказа архива',NULL,
    'c2-real-rpc-archive-fail',v_exp
   );
   RAISE EXCEPTION 'archive write failure went unnoticed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM public.medication_orders
   WHERE creation_idempotency_key='c2-real-rpc-archive-fail') THEN
   RAISE EXCEPTION 'failed archive left a medication order';
 END IF;
 ALTER TABLE clinical_medication_archive.order_history DROP CONSTRAINT integration_write_failure;
END;
$archive_verify$;

ROLLBACK;
SELECT (SELECT count(*) FROM public.medication_orders WHERE creation_idempotency_key LIKE 'c2-smoke-%' OR creation_idempotency_key LIKE 'c2-real-rpc-%') remaining_synthetic_orders,
 to_regnamespace('clinical_medication_archive') IS NULL archive_schema_rolled_back;
