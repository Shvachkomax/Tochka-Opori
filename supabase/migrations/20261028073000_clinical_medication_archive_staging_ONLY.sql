-- Clinical Longitudinal v0.4.2, STAGING CONTRACT. DO NOT APPLY TO PRODUCTION.
-- Requires original Support medical tables and RPCs from Supabase migrations.
-- This is a gated first-party adapter, no patient data copied to Clinical-Test.
-- Atomic wrapper: pre-existing authenticated RPC first; archive second in
-- same transaction. Any archive failure rolls back the prescribed action.
BEGIN;
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
COMMIT;
