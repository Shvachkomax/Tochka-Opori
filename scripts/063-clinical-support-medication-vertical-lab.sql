-- Clinical Longitudinal v0.4: synthetic Support medication workflow laboratory.
-- DO NOT APPLY TO MEDICAL PRODUCTION. No data beyond synthetic identifiers.
-- Mirrors activate / supersede / revoke domain operations already used by Support.
BEGIN;
CREATE SCHEMA IF NOT EXISTS clinical_support_lab;
REVOKE ALL ON SCHEMA clinical_support_lab FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE clinical_support_lab.medication_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_key text NOT NULL,
 owner_type text NOT NULL CHECK (owner_type='anonymous_case'),
 owner_key text NOT NULL,
 organization_key text,
 medication_name text NOT NULL,
 strength_value numeric NOT NULL CHECK(strength_value>0),
 strength_unit text NOT NULL,
 prescriber_claim text NOT NULL,
 version_no integer NOT NULL CHECK(version_no>=1),
 supersedes_order_id uuid REFERENCES clinical_support_lab.medication_orders(id),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(group_key,version_no)
);
CREATE TABLE clinical_support_lab.medication_order_schedules(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 medication_order_id uuid NOT NULL REFERENCES clinical_support_lab.medication_orders(id),
 dose_amount numeric NOT NULL CHECK(dose_amount>0),
 dose_unit text NOT NULL,
 frequency_code text NOT NULL
);
CREATE TABLE clinical_support_lab.medication_order_lifecycle_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 medication_order_id uuid NOT NULL REFERENCES clinical_support_lab.medication_orders(id),
 event_type text NOT NULL CHECK(event_type IN ('activated','superseded','revoked')),
 actor_claim text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE clinical_support_lab.medication_group_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 outbox_id bigint NOT NULL UNIQUE REFERENCES clinical_internal.source_outbox(id),
 group_key text NOT NULL,
 version_no integer NOT NULL CHECK(version_no>=1),
 command_key text NOT NULL UNIQUE,
 command_signature jsonb NOT NULL,
 operation text NOT NULL CHECK(operation IN ('activate','supersede','revoke')),
 current_order_id uuid NOT NULL REFERENCES clinical_support_lab.medication_orders(id),
 previous_state jsonb,
 new_state jsonb NOT NULL,
 author_claim text NOT NULL,
 author_status text NOT NULL DEFAULT 'unverified_source_claim',
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(group_key,version_no)
);
CREATE INDEX medication_group_history_lookup ON clinical_support_lab.medication_group_history(group_key,version_no);
DO $protect$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['medication_orders','medication_order_schedules','medication_order_lifecycle_events','medication_group_history'] LOOP
   EXECUTE format('ALTER TABLE clinical_support_lab.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON clinical_support_lab.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $protect$;
-- Reuse the verified append-only protector from synthetic clinical versions.
CREATE TRIGGER reject_medication_history_change BEFORE UPDATE OR DELETE
 ON clinical_support_lab.medication_group_history
 FOR EACH ROW EXECUTE FUNCTION clinical_internal.prevent_revision_mutation();
CREATE TRIGGER reject_medication_history_truncate BEFORE TRUNCATE
 ON clinical_support_lab.medication_group_history
 FOR EACH STATEMENT EXECUTE FUNCTION clinical_internal.prevent_revision_mutation();
-- Tables have no direct write grants to client roles; a private RPC owns all writes.

CREATE OR REPLACE FUNCTION clinical_support_lab.apply_medication_command(
 p_action text,p_command_key text,p_group_key text,
 p_owner_key text,p_organization_key text,p_actor_claim text,
 p_medication_name text,p_strength_value numeric,p_strength_unit text,
 p_dose_amount numeric,p_dose_unit text,p_frequency_code text,
 p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $procedure$
DECLARE
 v_signature jsonb;
 v_existing clinical_support_lab.medication_group_history%ROWTYPE;
 v_current clinical_support_lab.medication_orders%ROWTYPE;
 v_current_dose clinical_support_lab.medication_order_schedules%ROWTYPE;
 v_new_order uuid;
 v_version integer;
 v_previous jsonb;
 v_new jsonb;
 v_outbox_id bigint;
BEGIN
 IF p_action NOT IN ('activate','supersede','revoke')
    OR p_command_key IS NULL OR length(trim(p_command_key))<8
    OR p_group_key IS NULL OR length(trim(p_group_key))<8
    OR p_owner_key IS NULL OR length(trim(p_owner_key))<8
    OR p_actor_claim IS NULL OR length(trim(p_actor_claim))<3
    OR p_expected_version IS NULL OR p_expected_version<0 THEN
   RAISE EXCEPTION 'invalid_synthetic_medication_command' USING ERRCODE='23514';
 END IF;
 IF p_action<>'revoke' AND (
   p_medication_name IS NULL OR length(trim(p_medication_name))=0
   OR p_strength_value IS NULL OR p_strength_value<=0
   OR p_strength_unit IS NULL OR length(trim(p_strength_unit))=0
   OR p_dose_amount IS NULL OR p_dose_amount<=0
   OR p_dose_unit IS NULL OR length(trim(p_dose_unit))=0
   OR p_frequency_code IS NULL OR length(trim(p_frequency_code))=0
 ) THEN
   RAISE EXCEPTION 'missing_medication_details' USING ERRCODE='23514';
 END IF;
 v_signature:=jsonb_build_array(p_action,p_group_key,p_owner_key,
  p_organization_key,p_actor_claim,p_medication_name,p_strength_value,
  p_strength_unit,p_dose_amount,p_dose_unit,p_frequency_code,p_expected_version);
 -- Serializes all writes and idempotency reads for this group.
 PERFORM pg_advisory_xact_lock(hashtextextended('synthetic-medication:'||p_group_key,0));
 SELECT * INTO v_existing FROM clinical_support_lab.medication_group_history
  WHERE command_key=p_command_key;
 IF FOUND THEN
   IF v_existing.group_key<>p_group_key
      OR v_existing.command_signature IS DISTINCT FROM v_signature THEN
     RAISE EXCEPTION 'idempotency_key_reused_with_different_medication_command'
        USING ERRCODE='23505';
   END IF;
   RETURN jsonb_build_object('version',v_existing.version_no,
     'order_id',v_existing.current_order_id,'already_applied',true);
 END IF;
 SELECT * INTO v_existing FROM clinical_support_lab.medication_group_history
   WHERE group_key=p_group_key ORDER BY version_no DESC LIMIT 1;
 v_version:=COALESCE(v_existing.version_no,0);
 IF p_expected_version<>v_version THEN
   RAISE EXCEPTION 'stale_medication_version_expected_%_actual_%',p_expected_version,v_version
      USING ERRCODE='40001';
 END IF;
 IF p_action='activate' AND v_version<>0 THEN
   RAISE EXCEPTION 'medication_group_already_exists' USING ERRCODE='23505';
 END IF;
 IF p_action<>'activate' AND v_version=0 THEN
   RAISE EXCEPTION 'medication_group_not_found' USING ERRCODE='23514';
 END IF;
 IF v_version>0 THEN
   SELECT * INTO v_current FROM clinical_support_lab.medication_orders
    WHERE id=v_existing.current_order_id FOR UPDATE;
   IF NOT FOUND OR v_current.owner_key<>p_owner_key
      OR v_current.organization_key IS DISTINCT FROM p_organization_key THEN
     RAISE EXCEPTION 'patient_or_clinic_scope_mismatch' USING ERRCODE='42501';
   END IF;
   IF v_existing.new_state->>'state'='revoked' THEN
     RAISE EXCEPTION 'medication_already_revoked' USING ERRCODE='23514';
   END IF;
   v_previous:=v_existing.new_state;
 END IF;
 IF p_action='activate' OR p_action='supersede' THEN
   IF p_action='supersede' THEN
     INSERT INTO clinical_support_lab.medication_order_lifecycle_events
      (medication_order_id,event_type,actor_claim)
     VALUES(v_current.id,'superseded',p_actor_claim);
   END IF;
   INSERT INTO clinical_support_lab.medication_orders(
      group_key,owner_type,owner_key,organization_key,medication_name,
      strength_value,strength_unit,prescriber_claim,version_no,supersedes_order_id
   ) VALUES (
      p_group_key,'anonymous_case',p_owner_key,p_organization_key,p_medication_name,
      p_strength_value,p_strength_unit,p_actor_claim,v_version+1,
      CASE WHEN p_action='supersede' THEN v_current.id ELSE NULL END
   ) RETURNING id INTO v_new_order;
   INSERT INTO clinical_support_lab.medication_order_schedules(
      medication_order_id,dose_amount,dose_unit,frequency_code
   ) VALUES(v_new_order,p_dose_amount,p_dose_unit,p_frequency_code);
   INSERT INTO clinical_support_lab.medication_order_lifecycle_events(
      medication_order_id,event_type,actor_claim
   ) VALUES(v_new_order,'activated',p_actor_claim);
   v_new:=jsonb_build_object('medication_name',p_medication_name,
     'strength_value',p_strength_value,'strength_unit',p_strength_unit,
     'dose_amount',p_dose_amount,'dose_unit',p_dose_unit,
     'frequency_code',p_frequency_code,'state','active');
 ELSE
   v_new_order:=v_current.id;
   INSERT INTO clinical_support_lab.medication_order_lifecycle_events(
      medication_order_id,event_type,actor_claim
   ) VALUES(v_new_order,'revoked',p_actor_claim);
   v_new:=jsonb_set(v_previous,'{state}','"revoked"'::jsonb);
 END IF;
 -- One durable outbox notice and one full version snapshot, atomically.
 INSERT INTO clinical_internal.source_outbox(
  source_table,source_key,operation,owner_type,owner_key,organization_key
 ) VALUES('clinical_support_lab.medication_group',p_group_key,
   CASE WHEN p_action='activate' THEN 'INSERT' ELSE 'UPDATE' END,
   'anonymous_case',p_owner_key,p_organization_key)
 RETURNING id INTO v_outbox_id;
 INSERT INTO clinical_support_lab.medication_group_history(
  outbox_id,group_key,version_no,command_key,command_signature,operation,
  current_order_id,previous_state,new_state,author_claim
 ) VALUES(
  v_outbox_id,p_group_key,v_version+1,p_command_key,v_signature,p_action,
  v_new_order,v_previous,v_new,p_actor_claim
 );
 RETURN jsonb_build_object('version',v_version+1,'order_id',v_new_order,
   'already_applied',false);
END;
$procedure$;
REVOKE ALL ON FUNCTION clinical_support_lab.apply_medication_command(
 text,text,text,text,text,text,text,numeric,text,numeric,text,text,integer
) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON SCHEMA clinical_support_lab IS
 'Private synthetic medication lifecycle lab; NOT real patients or prescriber credentials';
COMMIT;
