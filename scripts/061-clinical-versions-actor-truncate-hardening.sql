-- v0.3.1 lab hardening: deletion actor must NOT be inferred from OLD row.
-- Block TRUNCATE, which would bypass row-level history triggers.
-- Synthetic Clinical-Test only; not a production medical migration.
BEGIN;
ALTER TABLE clinical_internal.record_revisions
 DROP CONSTRAINT IF EXISTS record_revisions_author_status_check;
ALTER TABLE clinical_internal.record_revisions
 ADD CONSTRAINT record_revisions_author_status_check
 CHECK (author_status IN ('unverified_source_claim','not_captured'));

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

 v_author:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE NULLIF(v_record->>'actor_key','') END;
 INSERT INTO clinical_internal.record_revisions(
  outbox_id,source_table,source_key,version_no,operation,
  previous_state,new_state,author_claim,author_status
 ) VALUES (
  v_outbox_id,v_source,v_id,v_version,TG_OP,
  v_previous,v_current,v_author,
  CASE WHEN v_author IS NULL THEN 'not_captured' ELSE 'unverified_source_claim' END
 );
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$capture$;

REVOKE ALL ON FUNCTION clinical_internal.capture_source_change()
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION clinical_internal.prevent_lab_source_truncate()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $deny$
BEGIN
 RAISE EXCEPTION 'clinical_source_truncate_requires_reviewed_retention_workflow'
   USING ERRCODE='23514';
END;
$deny$;
REVOKE ALL ON FUNCTION clinical_internal.prevent_lab_source_truncate()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS prevent_unversioned_truncate ON clinical_outbox_lab.synthetic_support;
DROP TRIGGER IF EXISTS prevent_unversioned_truncate ON clinical_outbox_lab.synthetic_health;
CREATE TRIGGER prevent_unversioned_truncate BEFORE TRUNCATE
 ON clinical_outbox_lab.synthetic_support
 FOR EACH STATEMENT EXECUTE FUNCTION clinical_internal.prevent_lab_source_truncate();
CREATE TRIGGER prevent_unversioned_truncate BEFORE TRUNCATE
 ON clinical_outbox_lab.synthetic_health
 FOR EACH STATEMENT EXECUTE FUNCTION clinical_internal.prevent_lab_source_truncate();
COMMIT;
