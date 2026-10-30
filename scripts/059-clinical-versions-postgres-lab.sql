-- Clinical Longitudinal v0.3 - synthetic-only version history.
-- APPLY ONLY to isolated Clinical-Test project after synthetic outbox lab 057.
-- No real patients; no production clinical source tables are touched.
BEGIN;

-- Add explicit clinical fields to the two artificial source tables only.
ALTER TABLE clinical_outbox_lab.synthetic_support
 ADD COLUMN IF NOT EXISTS diagnosis_text text,
 ADD COLUMN IF NOT EXISTS medication_name text,
 ADD COLUMN IF NOT EXISTS medication_schedule jsonb,
 ADD COLUMN IF NOT EXISTS psychotherapy_text text,
 ADD COLUMN IF NOT EXISTS outcome_text text,
 ADD COLUMN IF NOT EXISTS actor_key text;

ALTER TABLE clinical_outbox_lab.synthetic_health
 ADD COLUMN IF NOT EXISTS weight_kg numeric(8,2),
 ADD COLUMN IF NOT EXISTS sleep_hours numeric(5,2),
 ADD COLUMN IF NOT EXISTS plan_text text,
 ADD COLUMN IF NOT EXISTS medication_schedule jsonb,
 ADD COLUMN IF NOT EXISTS outcome_text text,
 ADD COLUMN IF NOT EXISTS actor_key text;

CREATE TABLE IF NOT EXISTS clinical_internal.record_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 outbox_id bigint NOT NULL UNIQUE REFERENCES clinical_internal.source_outbox(id),
 source_table text NOT NULL
   CHECK (source_table IN ('clinical_outbox_lab.synthetic_support','clinical_outbox_lab.synthetic_health')),
 source_key text NOT NULL,
 version_no integer NOT NULL CHECK (version_no>=1),
 operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
 previous_state jsonb,
 new_state jsonb,
 author_claim text,
 author_status text NOT NULL DEFAULT 'unverified_source_claim'
   CHECK (author_status='unverified_source_claim'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source_table,source_key,version_no),
 CONSTRAINT record_revisions_transition_check CHECK (
   (operation='INSERT' AND previous_state IS NULL AND new_state IS NOT NULL)
   OR (operation='UPDATE' AND previous_state IS NOT NULL AND new_state IS NOT NULL)
   OR (operation='DELETE' AND previous_state IS NOT NULL AND new_state IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS record_revisions_lookup
 ON clinical_internal.record_revisions(source_table,source_key,version_no);
ALTER TABLE clinical_internal.record_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clinical_internal.record_revisions FROM PUBLIC,anon,authenticated,service_role;

-- Application-level append-only guarantee. DB superusers/owners retain legal DBA powers.
CREATE OR REPLACE FUNCTION clinical_internal.prevent_revision_mutation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $block$
BEGIN
 RAISE EXCEPTION 'clinical_record_revision_is_append_only'
   USING ERRCODE='23514';
END;
$block$;
REVOKE ALL ON FUNCTION clinical_internal.prevent_revision_mutation()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS prevent_record_revision_change ON clinical_internal.record_revisions;
CREATE TRIGGER prevent_record_revision_change BEFORE UPDATE OR DELETE
 ON clinical_internal.record_revisions
 FOR EACH ROW EXECUTE FUNCTION clinical_internal.prevent_revision_mutation();
DROP TRIGGER IF EXISTS prevent_record_revision_truncate ON clinical_internal.record_revisions;
CREATE TRIGGER prevent_record_revision_truncate BEFORE TRUNCATE
 ON clinical_internal.record_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION clinical_internal.prevent_revision_mutation();

-- Strict whitelist: never record free-form session transcripts, contacts or images.
CREATE OR REPLACE FUNCTION clinical_internal.lab_clinical_snapshot(
 v jsonb, source_table text
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path=pg_catalog AS $projection$
BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;
 IF source_table='clinical_outbox_lab.synthetic_support' THEN
  RETURN jsonb_build_object(
    'diagnosis',v->'diagnosis_text',
    'medication',v->'medication_name',
    'medication_schedule',v->'medication_schedule',
    'psychotherapy',v->'psychotherapy_text',
    'outcome',v->'outcome_text');
 ELSIF source_table='clinical_outbox_lab.synthetic_health' THEN
  RETURN jsonb_build_object(
    'weight_kg',v->'weight_kg',
    'sleep_hours',v->'sleep_hours',
    'care_plan',v->'plan_text',
    'medication_schedule',v->'medication_schedule',
    'outcome',v->'outcome_text');
 ELSE
  RAISE EXCEPTION 'unreviewed_source_type' USING ERRCODE='23514';
 END IF;
END;
$projection$;
REVOKE ALL ON FUNCTION clinical_internal.lab_clinical_snapshot(jsonb,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- This replaces the lab's existing capture function, keeping outbox and clinical
-- versions in ONE source transaction. In Clinical-Test it is attached ONLY to
-- the two synthetic lab tables. It deliberately refuses any unknown table.
CREATE OR REPLACE FUNCTION clinical_internal.capture_source_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $capture$
DECLARE
 v_old jsonb;
 v_new jsonb;
 v_record jsonb;
 v_source text;
 v_id text;
 v_outbox_id bigint;
 v_previous jsonb;
 v_current jsonb;
 v_version integer;
 v_author text;
BEGIN
 v_source:=TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME;
 IF v_source NOT IN (
  'clinical_outbox_lab.synthetic_support',
  'clinical_outbox_lab.synthetic_health') THEN
  RAISE EXCEPTION 'clinical_version_source_not_approved' USING ERRCODE='23514';
 END IF;
 v_old:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 v_new:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 v_record:=coalesce(v_new,v_old);
 v_id:=NULLIF(v_record->>'id','');
 IF v_id IS NULL THEN RAISE EXCEPTION 'missing_clinical_source_id' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (
   v_old->>'id' IS DISTINCT FROM v_new->>'id'
   OR v_old->>'owner_id' IS DISTINCT FROM v_new->>'owner_id'
   OR v_old->>'owner_type' IS DISTINCT FROM v_new->>'owner_type'
   OR v_old->>'organization_id' IS DISTINCT FROM v_new->>'organization_id'
 ) THEN
  RAISE EXCEPTION 'clinical_patient_identity_changed_without_workflow'
    USING ERRCODE='23514';
 END IF;

 INSERT INTO clinical_internal.source_outbox
  (source_table,source_key,operation,owner_type,owner_key,organization_key)
 VALUES (v_source,v_id,TG_OP,v_record->>'owner_type',
         v_record->>'owner_id',v_record->>'organization_id')
 RETURNING id INTO v_outbox_id;

 v_previous:=clinical_internal.lab_clinical_snapshot(v_old,v_source);
 v_current:=clinical_internal.lab_clinical_snapshot(v_new,v_source);
 -- Nonclinical metadata updates still create outbox notifications but not
 -- extra clinical revisions.
 IF TG_OP='UPDATE' AND v_previous IS NOT DISTINCT FROM v_current THEN
   RETURN NEW;
 END IF;

 -- Serialize version numbers even if a synthetic source is deleted/reinserted.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source||':'||v_id,0));
 SELECT coalesce(max(version_no),0)+1 INTO v_version
 FROM clinical_internal.record_revisions
 WHERE source_table=v_source AND source_key=v_id;

 v_author:=NULLIF(v_record->>'actor_key','');
 INSERT INTO clinical_internal.record_revisions(
  outbox_id,source_table,source_key,version_no,operation,
  previous_state,new_state,author_claim
 ) VALUES (
  v_outbox_id,v_source,v_id,v_version,TG_OP,
  v_previous,v_current,v_author
 );
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$capture$;
REVOKE ALL ON FUNCTION clinical_internal.capture_source_change()
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE clinical_internal.record_revisions IS
 'Private append-only lab revisions, synthetic content ONLY. Contains clinical details; never exposed via REST.';
COMMIT;
