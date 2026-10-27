-- v0.3 repeatable PostgreSQL 17 integration verification, synthetic data ONLY.
-- Runs inside a transaction and ROLLBACKs all examples.
BEGIN;
DO $test$
DECLARE
 s1 jsonb;
 s2 jsonb;
 s3 jsonb;
 h1 jsonb;
 h2 jsonb;
 n integer;
 original_outbox bigint;
BEGIN
 INSERT INTO clinical_outbox_lab.synthetic_support (
  id,owner_type,owner_id,scenario,diagnosis_text,medication_name,
  medication_schedule,psychotherapy_text,outcome_text,actor_key
 ) VALUES (
  'SYN-V3-SUPPORT','anonymous_case','SYN-OWNER-V3','not for clinical archive',
  'Синтетический депрессивный эпизод','Препарат А',
  '{"dose_amount":25,"dose_unit":"мг","frequency":"once_daily"}'::jsonb,
  'Учебная психотерапия','Исход неизвестен','TEST-CLINICIAN-A'
 );
 SELECT new_state INTO s1 FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-SUPPORT' AND version_no=1;
 IF s1->>'diagnosis' <> 'Синтетический депрессивный эпизод'
  OR s1->'medication_schedule'->>'dose_amount'<>'25' THEN
  RAISE EXCEPTION 'v1 lacks initial synthetic diagnosis and dose';
 END IF;

 UPDATE clinical_outbox_lab.synthetic_support
 SET diagnosis_text='Синтетический диагноз уточнён',
     medication_schedule='{"dose_amount":50,"dose_unit":"мг","frequency":"once_daily"}',
     actor_key='TEST-CLINICIAN-B'
 WHERE id='SYN-V3-SUPPORT';

 SELECT previous_state INTO s1 FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-SUPPORT' AND version_no=2;
 SELECT new_state INTO s2 FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-SUPPORT' AND version_no=2;
 IF s1->'medication_schedule'->>'dose_amount'<>'25'
  OR s2->'medication_schedule'->>'dose_amount'<>'50'
  OR s1->>'diagnosis'<>'Синтетический депрессивный эпизод'
  OR s2->>'diagnosis'<>'Синтетический диагноз уточнён' THEN
   RAISE EXCEPTION 'before / after states missing';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM clinical_internal.record_revisions
   WHERE source_key='SYN-V3-SUPPORT' AND version_no=2
     AND author_claim='TEST-CLINICIAN-B'
     AND author_status='unverified_source_claim') THEN
   RAISE EXCEPTION 'author provenance lost';
 END IF;

 UPDATE clinical_outbox_lab.synthetic_support
 SET scenario='metadata only: must not be copied into version' WHERE id='SYN-V3-SUPPORT';
 SELECT count(*) INTO n FROM clinical_internal.record_revisions
  WHERE source_key='SYN-V3-SUPPORT';
 IF n<>2 THEN RAISE EXCEPTION 'nonclinical change created a revision'; END IF;

 INSERT INTO clinical_outbox_lab.synthetic_health (
   id,owner_type,owner_id,scenario,weight_kg,sleep_hours,
   plan_text,outcome_text,actor_key)
 VALUES ('SYN-V3-HEALTH','anonymous_profile','SYN-OWNER-HEALTH','private scenario',
         85.50,6.0,'Учебный план А','Результат неизвестен','TEST-HEALTH-A');
 UPDATE clinical_outbox_lab.synthetic_health
 SET weight_kg=84.20,sleep_hours=7.0,plan_text='Учебный план Б',
     actor_key='TEST-HEALTH-B'
 WHERE id='SYN-V3-HEALTH';
 SELECT previous_state INTO h1 FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-HEALTH' AND version_no=2;
 SELECT new_state INTO h2 FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-HEALTH' AND version_no=2;
 IF h1->>'weight_kg'<>'85.50' OR h2->>'weight_kg'<>'84.20'
  OR h1->>'care_plan'<>'Учебный план А'
  OR h2->>'care_plan'<>'Учебный план Б' THEN
    RAISE EXCEPTION 'Health history incomplete';
 END IF;
 IF EXISTS (SELECT 1 FROM clinical_internal.record_revisions
  WHERE source_key IN ('SYN-V3-SUPPORT','SYN-V3-HEALTH')
    AND ((previous_state::text LIKE '%scenario%') OR (new_state::text LIKE '%scenario%'))) THEN
   RAISE EXCEPTION 'unapproved metadata leaked to revision history';
 END IF;

 -- A direct attempt to rewrite older versions must fail.
 BEGIN
  UPDATE clinical_internal.record_revisions SET author_claim='TAMPER'
   WHERE source_key='SYN-V3-SUPPORT' AND version_no=1;
  RAISE EXCEPTION 'direct mutation unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 BEGIN
  DELETE FROM clinical_internal.record_revisions
   WHERE source_key='SYN-V3-SUPPORT' AND version_no=1;
  RAISE EXCEPTION 'direct deletion unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 -- TRUNCATE would bypass row triggers; both source and history forbid it.
 BEGIN
  EXECUTE 'TRUNCATE TABLE clinical_internal.record_revisions';
  RAISE EXCEPTION 'revision truncate unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 BEGIN
  EXECUTE 'TRUNCATE TABLE clinical_outbox_lab.synthetic_support';
  RAISE EXCEPTION 'source truncate unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 -- Changing patient identity without explicit transfer workflow must fail.
 BEGIN
  UPDATE clinical_outbox_lab.synthetic_support SET owner_id='ANOTHER-PATIENT'
   WHERE id='SYN-V3-SUPPORT';
  RAISE EXCEPTION 'owner reassignment unexpectedly allowed';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;

 DELETE FROM clinical_outbox_lab.synthetic_support WHERE id='SYN-V3-SUPPORT';
 SELECT previous_state INTO s3 FROM clinical_internal.record_revisions
  WHERE source_key='SYN-V3-SUPPORT' AND version_no=3 AND new_state IS NULL
    AND operation='DELETE';
 IF s3->'medication_schedule'->>'dose_amount'<>'50' THEN
  RAISE EXCEPTION 'deleted source was not preserved';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM clinical_internal.record_revisions
   WHERE source_key='SYN-V3-SUPPORT' AND version_no=3
     AND author_claim IS NULL AND author_status='not_captured') THEN
   RAISE EXCEPTION 'delete actor falsely attributed to previous treating clinician';
 END IF;

 -- A reused source key must NOT rewrite old versions.
 INSERT INTO clinical_outbox_lab.synthetic_support (
  id,owner_type,owner_id,scenario,diagnosis_text,actor_key
 ) VALUES ('SYN-V3-SUPPORT','anonymous_case','SYN-OWNER-V3',
           'reinsert only','Синтетическое повторное поступление','TEST-CLINICIAN-C');
 IF NOT EXISTS(SELECT 1 FROM clinical_internal.record_revisions
   WHERE source_key='SYN-V3-SUPPORT' AND version_no=4 AND operation='INSERT') THEN
  RAISE EXCEPTION 'source key reuse did not continue revision numbering';
 END IF;

 -- Rejecting a revision entry must also reject the source edit + outbox event.
 ALTER TABLE clinical_internal.record_revisions
   ADD CONSTRAINT test_v3_forced_failure CHECK(source_key<>'SYN-V3-FAIL');
 BEGIN
  INSERT INTO clinical_outbox_lab.synthetic_support (
   id,owner_type,owner_id,scenario,diagnosis_text
  ) VALUES ('SYN-V3-FAIL','anonymous_case','SYN-OWNER-V3',
            'synthetic must rollback','Синтетический диагноз');
  RAISE EXCEPTION 'missing fail-closed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM clinical_outbox_lab.synthetic_support WHERE id='SYN-V3-FAIL')
  OR EXISTS (SELECT 1 FROM clinical_internal.source_outbox WHERE source_key='SYN-V3-FAIL')
  OR EXISTS (SELECT 1 FROM clinical_internal.record_revisions WHERE source_key='SYN-V3-FAIL') THEN
  RAISE EXCEPTION 'failed revision did not atomically roll back';
 END IF;
 ALTER TABLE clinical_internal.record_revisions DROP CONSTRAINT test_v3_forced_failure;

 SELECT count(*) INTO n FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-SUPPORT';
 IF n<>4 THEN RAISE EXCEPTION 'expected four revisions, got %',n; END IF;
 SELECT count(*) INTO n FROM clinical_internal.record_revisions
 WHERE source_key='SYN-V3-HEALTH';
 IF n<>2 THEN RAISE EXCEPTION 'expected two health versions, got %',n; END IF;
END $test$;
ROLLBACK;
