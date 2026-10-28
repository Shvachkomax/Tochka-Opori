-- Clinical-Test dry-run of archived RPC adapter with synthetic stubs.
-- No public data or production functions are accessed. ROLLBACK required.
BEGIN;
-- Synthetic reproduction of the original RPC signatures in a disposable schema.
CREATE SCHEMA clinical_rpc_test;
CREATE TABLE clinical_rpc_test.medication_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL DEFAULT 'support',
 owner_type text NOT NULL,owner_id uuid NOT NULL,organization_id uuid,
 prescriber_expert_id uuid NOT NULL,prescriber_authorization_id uuid NOT NULL,
 order_group_id uuid NOT NULL,version_number integer NOT NULL,supersedes_order_id uuid,
 medication_name_snapshot text NOT NULL,formulation_snapshot text,
 strength_value numeric NOT NULL,strength_unit text NOT NULL,route_code text NOT NULL,
 issued_at timestamptz NOT NULL,valid_from timestamptz NOT NULL,
 valid_until timestamptz,creation_idempotency_key text NOT NULL,
 UNIQUE(owner_type,owner_id,creation_idempotency_key)
);
CREATE TABLE clinical_rpc_test.medication_order_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),medication_order_id uuid NOT NULL,
 phase_number integer NOT NULL,dose_amount numeric NOT NULL,dose_unit text NOT NULL,
 frequency_code text NOT NULL,route_code text,dosing_mode text,
 phase_start_at timestamptz,phase_end_at timestamptz
);
CREATE TABLE clinical_rpc_test.medication_order_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),medication_order_id uuid NOT NULL,
 event_type text NOT NULL,actor_type text NOT NULL,
 actor_expert_id uuid NOT NULL,idempotency_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE clinical_rpc_test.clinician_medication_authorizations (
 id uuid PRIMARY KEY,expert_id uuid NOT NULL,organization_id uuid,
 jurisdiction text NOT NULL DEFAULT 'RU',
 authorization_scope text NOT NULL DEFAULT 'prescribe_medications',
 verification_status text NOT NULL,revoked_at timestamptz,
 valid_from timestamptz NOT NULL,valid_until timestamptz
);

CREATE OR REPLACE FUNCTION clinical_rpc_test.activate_medication_order(p_owner_type text, p_owner_id uuid, p_organization_id uuid, p_authorization_id uuid,
  p_medication_concept_id uuid, p_medication_name_snapshot text, p_formulation_snapshot text,
  p_strength_value numeric, p_strength_unit text, p_route_code text, p_indication_code text,
  p_clinician_instruction text, p_issued_at timestamptz, p_valid_from timestamptz,
  p_valid_until timestamptz, p_schedules jsonb, p_permission_keys text[],
  p_decision_text text, p_decision_rationale text, p_creation_idempotency_key text,
  p_actor_expert_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,clinical_rpc_test AS $mock$
DECLARE prev clinical_rpc_test.medication_orders%ROWTYPE; v_id uuid; v_group uuid; v_version integer;
BEGIN
 SELECT * INTO prev FROM clinical_rpc_test.medication_orders
 WHERE owner_id=p_owner_id AND creation_idempotency_key=p_creation_idempotency_key LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('order_id',prev.id,'idempotent_replay',true); END IF;
 v_id:=gen_random_uuid();v_group:=gen_random_uuid();v_version:=1;
 INSERT INTO clinical_rpc_test.medication_orders(
  id,owner_type,owner_id,organization_id,prescriber_expert_id,prescriber_authorization_id,
  order_group_id,version_number,medication_name_snapshot,formulation_snapshot,
  strength_value,strength_unit,route_code,issued_at,valid_from,valid_until,creation_idempotency_key
 ) VALUES(v_id,p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,p_authorization_id,
  v_group,v_version,'Препарат А (учебный)',p_formulation_snapshot,
  p_strength_value,p_strength_unit,p_route_code,p_issued_at,p_valid_from,p_valid_until,p_creation_idempotency_key);
 INSERT INTO clinical_rpc_test.medication_order_schedules(
   medication_order_id,phase_number,dose_amount,dose_unit,frequency_code,route_code,dosing_mode,phase_start_at,phase_end_at)
 SELECT v_id,coalesce(t.phase_number,1),t.dose_amount,t.dose_unit,t.frequency_code,
 p_route_code,t.dosing_mode,t.phase_start_at,t.phase_end_at
 FROM jsonb_to_recordset(p_schedules) AS t(phase_number integer,dose_amount numeric,dose_unit text,
 frequency_code text,dosing_mode text,phase_start_at timestamptz,phase_end_at timestamptz);
 INSERT INTO clinical_rpc_test.medication_order_lifecycle_events
 (medication_order_id,event_type,actor_type,actor_expert_id,idempotency_key)
 VALUES(v_id,'activated','clinician',p_actor_expert_id,p_creation_idempotency_key||':activated');
 RETURN jsonb_build_object('order_id',v_id,'idempotent_replay',false);
END
$mock$;
CREATE OR REPLACE FUNCTION clinical_rpc_test.supersede_medication_order(p_previous_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_medication_concept_id uuid, p_medication_name_snapshot text,
  p_formulation_snapshot text, p_strength_value numeric, p_strength_unit text, p_route_code text,
  p_indication_code text, p_clinician_instruction text, p_issued_at timestamptz,
  p_valid_from timestamptz, p_valid_until timestamptz, p_schedules jsonb,
  p_permission_keys text[], p_decision_text text, p_decision_rationale text,
  p_creation_idempotency_key text, p_actor_expert_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,clinical_rpc_test AS $mock$
DECLARE prev clinical_rpc_test.medication_orders%ROWTYPE; v_id uuid; v_group uuid; v_version integer;
BEGIN
 SELECT * INTO prev FROM clinical_rpc_test.medication_orders
 WHERE owner_id=p_owner_id AND creation_idempotency_key=p_creation_idempotency_key LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('order_id',prev.id,'idempotent_replay',true); END IF;
 v_id:=gen_random_uuid();SELECT * INTO prev FROM clinical_rpc_test.medication_orders WHERE id=p_previous_order_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'missing previous synthetic order'; END IF;
 v_group:=prev.order_group_id;v_version:=prev.version_number+1;
 INSERT INTO clinical_rpc_test.medication_orders(
  id,owner_type,owner_id,organization_id,prescriber_expert_id,prescriber_authorization_id,
  order_group_id,version_number,supersedes_order_id,medication_name_snapshot,formulation_snapshot,
  strength_value,strength_unit,route_code,issued_at,valid_from,valid_until,creation_idempotency_key
 ) VALUES(v_id,p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,p_authorization_id,
  v_group,v_version,p_previous_order_id,'Препарат А (учебный)',p_formulation_snapshot,
  p_strength_value,p_strength_unit,p_route_code,p_issued_at,p_valid_from,p_valid_until,p_creation_idempotency_key);
 INSERT INTO clinical_rpc_test.medication_order_schedules(
   medication_order_id,phase_number,dose_amount,dose_unit,frequency_code,route_code,dosing_mode,phase_start_at,phase_end_at)
 SELECT v_id,coalesce(t.phase_number,1),t.dose_amount,t.dose_unit,t.frequency_code,
 p_route_code,t.dosing_mode,t.phase_start_at,t.phase_end_at
 FROM jsonb_to_recordset(p_schedules) AS t(phase_number integer,dose_amount numeric,dose_unit text,
 frequency_code text,dosing_mode text,phase_start_at timestamptz,phase_end_at timestamptz);
 INSERT INTO clinical_rpc_test.medication_order_lifecycle_events
 (medication_order_id,event_type,actor_type,actor_expert_id,idempotency_key)
 VALUES(v_id,'activated','clinician',p_actor_expert_id,p_creation_idempotency_key||':activated');
 INSERT INTO clinical_rpc_test.medication_order_lifecycle_events
 (medication_order_id,event_type,actor_type,actor_expert_id,idempotency_key)
 VALUES(p_previous_order_id,'superseded','clinician',p_actor_expert_id,p_creation_idempotency_key||':old-superseded');
 RETURN jsonb_build_object('order_id',v_id,'idempotent_replay',false);
END
$mock$;
CREATE OR REPLACE FUNCTION clinical_rpc_test.revoke_medication_order(p_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_reason_code text, p_reason_text text,
  p_idempotency_key text, p_actor_expert_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,clinical_rpc_test AS $mock$
DECLARE ev record;
BEGIN
 SELECT id INTO ev FROM clinical_rpc_test.medication_order_lifecycle_events
 WHERE medication_order_id=p_order_id AND event_type='revoked' AND idempotency_key=p_idempotency_key LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('order_id',p_order_id,'idempotent_replay',true); END IF;
 INSERT INTO clinical_rpc_test.medication_order_lifecycle_events
 (medication_order_id,event_type,actor_type,actor_expert_id,idempotency_key)
 VALUES(p_order_id,'revoked','clinician',p_actor_expert_id,p_idempotency_key);
 RETURN jsonb_build_object('order_id',p_order_id,'idempotent_replay',false);
END
$mock$;
-- Clinical Longitudinal v0.4.2, STAGING CONTRACT. DO NOT APPLY TO PRODUCTION.
-- Requires original Support medical tables and RPCs from Supabase migrations.
-- This is a gated first-party adapter, no patient data copied to Clinical-Test.
-- Atomic wrapper: pre-existing authenticated RPC first; archive second in
-- same transaction. Any archive failure rolls back the prescribed action.
BEGIN;


CREATE SCHEMA IF NOT EXISTS clinical_rpc_archive_test;
REVOKE ALL ON SCHEMA clinical_rpc_archive_test FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA clinical_rpc_archive_test TO service_role;
CREATE TABLE clinical_rpc_archive_test.order_history (
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
 ON clinical_rpc_archive_test.order_history(group_id,captured_at,id);
ALTER TABLE clinical_rpc_archive_test.order_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_rpc_archive_test.order_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON clinical_rpc_archive_test.order_history TO service_role;
GRANT USAGE,SELECT ON SEQUENCE clinical_rpc_archive_test.order_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION clinical_rpc_archive_test.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $rej$
BEGIN
 RAISE EXCEPTION 'medical_archive_append_only' USING ERRCODE='23514';
END;$rej$;
REVOKE ALL ON FUNCTION clinical_rpc_archive_test.reject_mutation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS medical_archive_immutable ON clinical_rpc_archive_test.order_history;
CREATE TRIGGER medical_archive_immutable BEFORE UPDATE OR DELETE ON
 clinical_rpc_archive_test.order_history FOR EACH ROW
 EXECUTE FUNCTION clinical_rpc_archive_test.reject_mutation();
DROP TRIGGER IF EXISTS medical_archive_no_truncate ON clinical_rpc_archive_test.order_history;
CREATE TRIGGER medical_archive_no_truncate BEFORE TRUNCATE ON
 clinical_rpc_archive_test.order_history FOR EACH STATEMENT
 EXECUTE FUNCTION clinical_rpc_archive_test.reject_mutation();

CREATE OR REPLACE FUNCTION clinical_rpc_archive_test.capture_medication_revision(
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
 SELECT * INTO ord FROM clinical_rpc_test.medication_orders
 WHERE id=p_order_id AND owner_type=p_owner_type AND owner_id=p_owner_id
   AND organization_id IS NOT DISTINCT FROM p_organization_id AND module='support';
 IF NOT FOUND THEN RAISE EXCEPTION 'medication_archive_owner_scope_mismatch' USING ERRCODE='42501'; END IF;
 SELECT * INTO authorization FROM clinical_rpc_test.clinician_medication_authorizations
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
 SELECT * INTO ev FROM clinical_rpc_test.medication_order_lifecycle_events
 WHERE medication_order_id=p_order_id
   AND event_type=CASE WHEN p_action='revoke' THEN 'revoked' ELSE 'activated' END
   AND actor_type='clinician' AND actor_expert_id=p_actor_expert_id
   AND idempotency_key=CASE WHEN p_action='revoke'
       THEN p_idempotency_key ELSE p_idempotency_key||':activated' END
 ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'medication_archive_lifecycle_event_missing' USING ERRCODE='23514';
 END IF;
 SELECT id INTO v_id FROM clinical_rpc_archive_test.order_history
 WHERE source_event_id=ev.id;
 IF FOUND THEN RETURN v_id; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('medical-archive:'||ord.order_group_id::text,0));
 SELECT new_state INTO v_previous FROM clinical_rpc_archive_test.order_history
 WHERE group_id=ord.order_group_id ORDER BY id DESC LIMIT 1;
 IF p_action='activate' AND (ord.version_number<>1 OR v_previous IS NOT NULL) THEN
   RAISE EXCEPTION 'medication_archive_initial_group_inconsistent' USING ERRCODE='23514';
 END IF;
 IF p_action='supersede' AND (
   ord.version_number<=1 OR v_previous IS NULL OR
   v_previous->>'state'<>'active' OR
   NOT EXISTS(SELECT 1 FROM clinical_rpc_test.medication_orders old
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
 FROM clinical_rpc_test.medication_order_schedules WHERE medication_order_id=ord.id;
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
 INSERT INTO clinical_rpc_archive_test.order_history(
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
REVOKE ALL ON FUNCTION clinical_rpc_archive_test.capture_medication_revision(uuid,text,text,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION clinical_rpc_archive_test.capture_medication_revision(uuid,text,text,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION clinical_rpc_test.clinical_activate_medication_order(p_owner_type text, p_owner_id uuid, p_organization_id uuid, p_authorization_id uuid,
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
  v_result := clinical_rpc_test.activate_medication_order(p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_medication_concept_id, p_medication_name_snapshot, p_formulation_snapshot, p_strength_value, p_strength_unit, p_route_code, p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until, p_schedules, p_permission_keys, p_decision_text, p_decision_rationale, p_creation_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_rpc_archive_test.capture_medication_revision(
     (v_result->>'order_id')::uuid,'activate',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_creation_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION clinical_rpc_test.clinical_activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION clinical_rpc_test.clinical_activate_medication_order(text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION clinical_rpc_test.clinical_supersede_medication_order(p_previous_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
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
  v_result := clinical_rpc_test.supersede_medication_order(p_previous_order_id, p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_medication_concept_id, p_medication_name_snapshot, p_formulation_snapshot, p_strength_value, p_strength_unit, p_route_code, p_indication_code, p_clinician_instruction, p_issued_at, p_valid_from, p_valid_until, p_schedules, p_permission_keys, p_decision_text, p_decision_rationale, p_creation_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_rpc_archive_test.capture_medication_revision(
     (v_result->>'order_id')::uuid,'supersede',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_creation_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION clinical_rpc_test.clinical_supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION clinical_rpc_test.clinical_supersede_medication_order(uuid, text, uuid, uuid, uuid, uuid, text, text, numeric, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text[], text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION clinical_rpc_test.clinical_revoke_medication_order(p_order_id uuid, p_owner_type text, p_owner_id uuid, p_organization_id uuid,
  p_authorization_id uuid, p_reason_code text, p_reason_text text,
  p_idempotency_key text, p_actor_expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $wrap$
DECLARE v_result jsonb; v_captured bigint;
BEGIN
  v_result := clinical_rpc_test.revoke_medication_order(p_order_id, p_owner_type, p_owner_id, p_organization_id, p_authorization_id, p_reason_code, p_reason_text, p_idempotency_key, p_actor_expert_id);
  IF v_result IS NULL OR v_result->>'order_id' IS NULL THEN
    RAISE EXCEPTION 'existing_medication_rpc_missing_order_id' USING ERRCODE='23514';
  END IF;
  v_captured := clinical_rpc_archive_test.capture_medication_revision(
     (v_result->>'order_id')::uuid,'revoke',
     p_owner_type,p_owner_id,p_organization_id,p_actor_expert_id,
     p_authorization_id,p_idempotency_key);
  RETURN v_result;
END;
$wrap$;
REVOKE ALL ON FUNCTION clinical_rpc_test.clinical_revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION clinical_rpc_test.clinical_revoke_medication_order(uuid, text, uuid, uuid, uuid, text, text, text, uuid) TO service_role;

COMMENT ON TABLE clinical_rpc_archive_test.order_history IS
 'Restricted clinician-authorized medication snapshots; not research data. Requires separate lawful retention and Russian medical infrastructure.';

DO $verify$
DECLARE v1 jsonb; v2 jsonb; v3 jsonb; replay jsonb; n integer;
  patient_id uuid:='11111111-1111-4111-8111-111111111111';
  expert_id uuid:='22222222-2222-4222-8222-222222222222';
  auth_id uuid:='33333333-3333-4333-8333-333333333333';
  org_id uuid:='44444444-4444-4444-8444-444444444444';
  other_org uuid:='55555555-5555-4555-8555-555555555555';
  concept_id uuid:='66666666-6666-4666-8666-666666666666';
BEGIN
 INSERT INTO clinical_rpc_test.clinician_medication_authorizations
 (id,expert_id,organization_id,verification_status,valid_from)
 VALUES(auth_id,expert_id,org_id,'verified',now()-interval '1 day');
 SELECT clinical_rpc_test.clinical_activate_medication_order(
 'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
 NULL,NULL,now(),now(),NULL,
 '[{"phase_number":1,"dose_amount":5,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
 ARRAY[]::text[],'Синтетическое назначение',NULL,'SYN-ADAPTER-ISSUE-01',expert_id
 ) INTO v1;
 SELECT clinical_rpc_test.clinical_activate_medication_order(
 'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
 NULL,NULL,now(),now(),NULL,
 '[{"phase_number":1,"dose_amount":5,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
 ARRAY[]::text[],'Синтетическое назначение',NULL,'SYN-ADAPTER-ISSUE-01',expert_id
 ) INTO replay;
 IF replay->>'order_id'<>v1->>'order_id' THEN RAISE EXCEPTION 'replay returned different order'; END IF;
 SELECT clinical_rpc_test.clinical_supersede_medication_order(
 (v1->>'order_id')::uuid,'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
 NULL,NULL,now(),now(),NULL,
 '[{"phase_number":1,"dose_amount":10,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
 ARRAY[]::text[],'Синтетическое изменение',NULL,'SYN-ADAPTER-CHANGE-02',expert_id
 ) INTO v2;
 SELECT clinical_rpc_test.clinical_revoke_medication_order(
 (v2->>'order_id')::uuid,'anonymous_case',patient_id,org_id,auth_id,
 'clinical_decision','Учебная отмена','SYN-ADAPTER-REVOKE-03',expert_id
 ) INTO v3;
 IF v3->>'order_id'<>v2->>'order_id' THEN RAISE EXCEPTION 'revoke identity mismatch'; END IF;
 SELECT count(*) INTO n FROM clinical_rpc_archive_test.order_history;
 IF n<>3 THEN RAISE EXCEPTION 'expected 3 captured versions got %',n; END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_rpc_archive_test.order_history
 WHERE action='supersede' AND previous_state->'schedules'->0->>'dose_amount'='5'
 AND new_state->'schedules'->0->>'dose_amount'='10') THEN
  RAISE EXCEPTION 'dose history lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_rpc_archive_test.order_history
 WHERE action='revoke' AND previous_state->>'state'='active'
 AND new_state->>'state'='revoked') THEN
  RAISE EXCEPTION 'revocation snapshot missing'; END IF;
 BEGIN
  PERFORM clinical_rpc_test.clinical_revoke_medication_order(
   (v2->>'order_id')::uuid,'anonymous_case',patient_id,other_org,auth_id,
   'clinical_decision',NULL,'SYN-ADAPTER-BAD-04',expert_id);
  RAISE EXCEPTION 'cross-organization modification succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE clinical_rpc_test.clinician_medication_authorizations SET verification_status='suspended'
 WHERE id=auth_id;
 BEGIN
  PERFORM clinical_rpc_test.clinical_activate_medication_order(
   'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
   NULL,NULL,now(),now(),NULL,
   '[{"phase_number":1,"dose_amount":5,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
   ARRAY[]::text[],'Недопустимое решение',NULL,'SYN-ADAPTER-BAD-05',expert_id);
  RAISE EXCEPTION 'suspended prescriber succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT count(*) INTO n FROM clinical_rpc_test.medication_orders;
 IF n<>2 THEN RAISE EXCEPTION 'invalid operation left persisted orders, count %',n; END IF;
 -- A new snapshot cannot begin in the middle of an existing treatment without
 -- controlled historical backfill. The base RPC change must roll back too.
 UPDATE clinical_rpc_test.clinician_medication_authorizations SET verification_status='verified'
 WHERE id=auth_id;
 SELECT clinical_rpc_test.activate_medication_order(
  'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
  NULL,NULL,now(),now(),NULL,
  '[{"phase_number":1,"dose_amount":5,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
  ARRAY[]::text[],'До включения архива',NULL,'SYN-LEGACY-ORDER-01',expert_id
 ) INTO replay;
 BEGIN
  PERFORM clinical_rpc_test.clinical_supersede_medication_order(
   (replay->>'order_id')::uuid,'anonymous_case',patient_id,org_id,auth_id,concept_id,
   NULL,NULL,20,'mg','oral',NULL,NULL,now(),now(),NULL,
   '[{"phase_number":1,"dose_amount":12,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
   ARRAY[]::text[],'Попытка без базовой версии',NULL,'SYN-LEGACY-CHANGE-02',expert_id);
  RAISE EXCEPTION 'unarchived group was allowed';
 EXCEPTION WHEN check_violation THEN NULL; END;
 SELECT count(*) INTO n FROM clinical_rpc_test.medication_orders
  WHERE creation_idempotency_key='SYN-LEGACY-CHANGE-02';
 IF n<>0 THEN RAISE EXCEPTION 'failed archive did not roll back legacy group change'; END IF;

 -- Failure after a real base mutation must roll back its medication order,
 -- schedule and lifecycle; not only the archive entry.
 ALTER TABLE clinical_rpc_archive_test.order_history ADD CONSTRAINT
  synthetic_archive_write_failure CHECK(action<>'activate');
 BEGIN
  PERFORM clinical_rpc_test.clinical_activate_medication_order(
   'anonymous_case',patient_id,org_id,auth_id,concept_id,NULL,NULL,20,'mg','oral',
   NULL,NULL,now(),now(),NULL,
   '[{"phase_number":1,"dose_amount":5,"dose_unit":"mg","frequency_code":"once_daily","dosing_mode":"fixed"}]'::jsonb,
   ARRAY[]::text[],'Архив намеренно недоступен',NULL,'SYN-ARCHIVE-FAIL-01',expert_id);
  RAISE EXCEPTION 'archive failure did not roll back clinical order';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM clinical_rpc_test.medication_orders
    WHERE creation_idempotency_key='SYN-ARCHIVE-FAIL-01') OR
    EXISTS(SELECT 1 FROM clinical_rpc_test.medication_order_lifecycle_events e
    JOIN clinical_rpc_test.medication_orders o ON e.medication_order_id=o.id
    WHERE o.creation_idempotency_key='SYN-ARCHIVE-FAIL-01') THEN
  RAISE EXCEPTION 'archive failure left partial clinical mutation';
 END IF;
 ALTER TABLE clinical_rpc_archive_test.order_history
  DROP CONSTRAINT synthetic_archive_write_failure;
END;
$verify$;
ROLLBACK;
