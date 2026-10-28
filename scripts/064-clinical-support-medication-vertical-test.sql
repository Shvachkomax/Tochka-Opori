-- v0.4 synthetic Support medication end-to-end PostgreSQL test.
-- ONLY run against isolated Clinical-Test after script 063.
-- Entire scenario rolls back; no actual patient medication orders.
BEGIN;
DO $test$
DECLARE
 a jsonb;
 b jsonb;
 c jsonb;
 r jsonb;
 prior jsonb;
 current jsonb;
 n integer;
 old_order uuid;
 new_order uuid;
BEGIN
 SELECT clinical_support_lab.apply_medication_command(
   'activate','SYN-COMMAND-ISSUE-0001','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-A',
   'Вымышленный препарат А',20,'мг',5,'мг','once_daily',0
 ) INTO a;
 IF a->>'version'<>'1' OR a->>'already_applied'<>'false' THEN
   RAISE EXCEPTION 'activate failed: %',a;
 END IF;
 old_order:=(a->>'order_id')::uuid;
 SELECT clinical_support_lab.apply_medication_command(
   'activate','SYN-COMMAND-ISSUE-0001','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-A',
   'Вымышленный препарат А',20,'мг',5,'мг','once_daily',0
 ) INTO r;
 IF r->>'already_applied'<>'true' OR r->>'order_id'<>a->>'order_id' THEN
   RAISE EXCEPTION 'idempotent activation duplicated order';
 END IF;
 BEGIN
  PERFORM clinical_support_lab.apply_medication_command(
   'activate','SYN-COMMAND-ISSUE-0001','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-A',
   'Вымышленный препарат А',20,'мг',9,'мг','once_daily',0);
  RAISE EXCEPTION 'idempotency key incorrectly accepted different dose';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;

 SELECT clinical_support_lab.apply_medication_command(
   'supersede','SYN-COMMAND-CHANGE-0002','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-B',
   'Вымышленный препарат А',20,'мг',10,'мг','once_daily',1
 ) INTO b;
 new_order:=(b->>'order_id')::uuid;
 IF b->>'version'<>'2' OR old_order=new_order THEN
   RAISE EXCEPTION 'supersede must create new order version';
 END IF;
 SELECT previous_state,new_state INTO prior,current
 FROM clinical_support_lab.medication_group_history
 WHERE group_key='SYN-MEDICATION-GROUP-0001' AND version_no=2;
 IF prior->>'dose_amount'<>'5' OR current->>'dose_amount'<>'10'
 OR prior->>'strength_value'<>'20' OR current->>'strength_value'<>'20' THEN
   RAISE EXCEPTION 'dose/strength history corrupted';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_support_lab.medication_orders
  WHERE id=new_order AND supersedes_order_id=old_order AND version_no=2)
 THEN RAISE EXCEPTION 'new order not linked to predecessor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_support_lab.medication_order_lifecycle_events
  WHERE medication_order_id=old_order AND event_type='superseded')
 THEN RAISE EXCEPTION 'superseded transition not stored'; END IF;

 BEGIN
  PERFORM clinical_support_lab.apply_medication_command(
   'supersede','SYN-COMMAND-ATTACK-0003','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-OTHER',NULL,'SYNTHETIC-DOCTOR-B',
   'Вымышленный препарат А',20,'мг',12,'мг','daily',2);
  RAISE EXCEPTION 'cross-patient update accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM clinical_support_lab.apply_medication_command(
   'supersede','SYN-COMMAND-STALE-0004','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-B',
   'Вымышленный препарат А',20,'мг',12,'мг','daily',1);
  RAISE EXCEPTION 'stale version accepted';
 EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
 END;
 BEGIN
  UPDATE clinical_support_lab.medication_group_history
  SET author_claim='TAMPER' WHERE group_key='SYN-MEDICATION-GROUP-0001' AND version_no=1;
  RAISE EXCEPTION 'history tampered';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 SELECT clinical_support_lab.apply_medication_command(
   'revoke','SYN-COMMAND-REVOKE-0005','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-C',
   NULL,NULL,NULL,NULL,NULL,NULL,2
 ) INTO c;
 IF c->>'version'<>'3' THEN RAISE EXCEPTION 'revoke did not advance history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_support_lab.medication_group_history
   WHERE group_key='SYN-MEDICATION-GROUP-0001' AND version_no=3
   AND previous_state->>'state'='active' AND new_state->>'state'='revoked'
   AND author_claim='SYNTHETIC-DOCTOR-C') THEN
  RAISE EXCEPTION 'revoke not captured with actor and history';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM clinical_support_lab.medication_order_lifecycle_events
  WHERE medication_order_id=new_order AND event_type='revoked')
 THEN RAISE EXCEPTION 'revocation lifecycle missing'; END IF;
 SELECT count(*) INTO n FROM clinical_support_lab.medication_orders
 WHERE group_key='SYN-MEDICATION-GROUP-0001';
 IF n<>2 THEN RAISE EXCEPTION 'unexpected order count: %',n; END IF;
 SELECT count(*) INTO n FROM clinical_support_lab.medication_group_history
 WHERE group_key='SYN-MEDICATION-GROUP-0001';
 IF n<>3 THEN RAISE EXCEPTION 'history count expected 3 got %',n; END IF;
 SELECT count(*) INTO n FROM clinical_internal.source_outbox
 WHERE source_table='clinical_support_lab.medication_group'
 AND source_key='SYN-MEDICATION-GROUP-0001';
 IF n<>3 THEN RAISE EXCEPTION 'outbox count expected 3 got %',n; END IF;
 SELECT clinical_support_lab.apply_medication_command(
   'revoke','SYN-COMMAND-REVOKE-0005','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-C',
   NULL,NULL,NULL,NULL,NULL,NULL,2
 ) INTO r;
 IF r->>'already_applied'<>'true' THEN
  RAISE EXCEPTION 'revoke retry not idempotent';
 END IF;
 BEGIN
   PERFORM clinical_support_lab.apply_medication_command(
   'supersede','SYN-COMMAND-INVALID-0006','SYN-MEDICATION-GROUP-0001',
   'SYNTHETIC-SUPPORT-OWNER-0001',NULL,'SYNTHETIC-DOCTOR-D',
   'Вымышленный препарат А',20,'мг',15,'мг','daily',3);
   RAISE EXCEPTION 'revoked prescription reactivated';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 -- Inject failure at history append, which must roll back source rows and outbox.
 ALTER TABLE clinical_support_lab.medication_group_history ADD CONSTRAINT
  v04_test_failure CHECK(command_key<>'SYN-COMMAND-FORCED-FAIL');
 BEGIN
  PERFORM clinical_support_lab.apply_medication_command(
   'activate','SYN-COMMAND-FORCED-FAIL','SYN-MEDICATION-GROUP-FAIL',
   'SYNTHETIC-SUPPORT-OWNER-0002',NULL,'SYNTHETIC-DOCTOR-X',
   'Вымышленный препарат А',20,'мг',5,'мг','once_daily',0);
  RAISE EXCEPTION 'expected history failure';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM clinical_support_lab.medication_orders
   WHERE group_key='SYN-MEDICATION-GROUP-FAIL')
   OR EXISTS(SELECT 1 FROM clinical_internal.source_outbox
   WHERE source_key='SYN-MEDICATION-GROUP-FAIL')
 THEN RAISE EXCEPTION 'partial medication transaction survived failure'; END IF;
 ALTER TABLE clinical_support_lab.medication_group_history DROP CONSTRAINT v04_test_failure;
END $test$;
-- A real PostgreSQL queue pass using the exact worker SQL against the
-- three synthetic prescription transitions in this same rollback-only test.
DO $queue$
DECLARE job record; locked record; ack record; n integer:=0; receipts integer;
BEGIN
 FOR job IN EXECUTE $claim$
WITH candidates AS (
 SELECT id FROM clinical_internal.source_outbox
 WHERE attempts < $2
   AND (
     (status IN ('pending','retry') AND (available_at IS NULL OR available_at <= now()))
     OR (status='processing' AND leased_until IS NOT NULL AND leased_until < now())
   )
 ORDER BY id
 LIMIT $1
 FOR UPDATE SKIP LOCKED
)
UPDATE clinical_internal.source_outbox o
SET status='processing', attempts=attempts+1,
    lease_token=gen_random_uuid(), leased_until=now()+interval '120 seconds',
    available_at=NULL
FROM candidates c
WHERE o.id=c.id
RETURNING o.id,o.lease_token,o.attempts
$claim$ USING 3,6 LOOP
   locked:=null;
   EXECUTE $lock$
SELECT id FROM clinical_internal.source_outbox
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
  AND leased_until>now() FOR UPDATE
$lock$ INTO locked USING job.id,job.lease_token;
   IF locked.id IS DISTINCT FROM job.id THEN RAISE EXCEPTION 'lost lease'; END IF;
   EXECUTE $receipt$
INSERT INTO clinical_internal.source_receipts (
  outbox_id,source_table,source_key,operation,
  owner_type,owner_key,organization_key,captured_at
)
SELECT id,source_table,source_key,operation,
       owner_type,owner_key,organization_key,captured_at
FROM clinical_internal.source_outbox
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
ON CONFLICT (outbox_id) DO NOTHING
$receipt$ USING job.id,job.lease_token;
   ack:=null;
   EXECUTE $ack$
UPDATE clinical_internal.source_outbox
SET status='processed',processed_at=now(),leased_until=NULL,
    lease_token=NULL,error_code=NULL
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
RETURNING id
$ack$ INTO ack USING job.id,job.lease_token;
   IF ack.id IS DISTINCT FROM job.id THEN RAISE EXCEPTION 'outbox ACK failed'; END IF;
   n:=n+1;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'Expected 3 processed medical transitions got %',n; END IF;
 SELECT count(*) INTO receipts FROM clinical_internal.source_receipts
   WHERE source_table='clinical_support_lab.medication_group'
   AND source_key='SYN-MEDICATION-GROUP-0001';
 IF receipts<>3 THEN RAISE EXCEPTION 'Expected 3 unique receipts got %',receipts; END IF;
END $queue$;
ROLLBACK;
