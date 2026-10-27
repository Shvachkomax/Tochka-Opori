-- Repeatable, transaction-rolled-back PostgreSQL integration verification.
-- ONLY for the isolated Clinical-Test project after migration 057.
-- Synthetic records only. Do not run against an actual EHR/production schema.
BEGIN;

INSERT INTO clinical_outbox_lab.synthetic_support(id,owner_type,owner_id,scenario)
VALUES ('SYN-REGRESS-SUP','anonymous_case','SYNTHETIC-REGRESS','Artificial follow-up');
INSERT INTO clinical_outbox_lab.synthetic_health(id,owner_type,owner_id,scenario)
VALUES ('SYN-REGRESS-HEALTH','anonymous_profile','SYNTHETIC-REGRESS-HEALTH','Artificial diary');
UPDATE clinical_outbox_lab.synthetic_support
 SET scenario='Artificial follow-up corrected',revision=2 WHERE id='SYN-REGRESS-SUP';
DELETE FROM clinical_outbox_lab.synthetic_health WHERE id='SYN-REGRESS-HEALTH';

DO $integration$
DECLARE
 job record;
 ack record;
 locked record;
 n integer:=0;
 expected integer;
BEGIN
 SELECT count(*) INTO expected FROM clinical_internal.source_outbox
 WHERE source_key IN ('SYN-REGRESS-SUP','SYN-REGRESS-HEALTH');
 IF expected<>4 THEN RAISE EXCEPTION 'Expected 4 synthetic notifications, got %', expected; END IF;

 BEGIN
   INSERT INTO clinical_outbox_lab.synthetic_support(id,owner_type,owner_id,scenario)
    VALUES ('SYN-REGRESS-ROLLBACK','anonymous_case','SYNTHETIC-REGRESS','Must abort');
   RAISE EXCEPTION 'injected app failure' USING ERRCODE='P0001';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
 END;
 IF EXISTS (SELECT 1 FROM clinical_outbox_lab.synthetic_support WHERE id='SYN-REGRESS-ROLLBACK')
 OR EXISTS (SELECT 1 FROM clinical_internal.source_outbox WHERE source_key='SYN-REGRESS-ROLLBACK')
 THEN RAISE EXCEPTION 'Source + outbox are not atomic'; END IF;

 -- Exercise the same production worker SQL via SPI with real PostgreSQL row locks.
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
$claim$ USING 4,6 LOOP
   locked:=null;
   EXECUTE $lock$
SELECT id FROM clinical_internal.source_outbox
WHERE id=$1 AND lease_token=$2::uuid AND status='processing'
  AND leased_until>now() FOR UPDATE
$lock$ INTO locked USING job.id,job.lease_token;
   IF locked.id IS DISTINCT FROM job.id THEN RAISE EXCEPTION 'Lease verification failed'; END IF;
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
   IF ack.id IS DISTINCT FROM job.id THEN RAISE EXCEPTION 'Ack verification failed'; END IF;
   n:=n+1;
 END LOOP;
 IF n<>4 THEN RAISE EXCEPTION 'Expected four processed messages, got %',n; END IF;
 SELECT count(*) INTO n FROM clinical_internal.source_receipts
 WHERE source_key IN ('SYN-REGRESS-SUP','SYN-REGRESS-HEALTH');
 IF n<>4 THEN RAISE EXCEPTION 'Receipt count mismatch, got %',n; END IF;
 SELECT count(*) INTO n FROM (
   SELECT outbox_id FROM clinical_internal.source_receipts
   WHERE source_key IN ('SYN-REGRESS-SUP','SYN-REGRESS-HEALTH')
   GROUP BY outbox_id HAVING count(*)>1
 ) duplicates;
 IF n<>0 THEN RAISE EXCEPTION 'Duplicate receipts detected'; END IF;
END $integration$;

-- All synthetic changes above are discarded, leaving the fixture schema reusable.
ROLLBACK;
