-- Shared Preview-Test CK v0.6: synthetic-only, no retained test writes.
BEGIN;
DO $verify$
DECLARE v uuid;
BEGIN
 IF to_regclass('public.published_clinical_cases') IS NULL
 OR to_regclass('public.clinical_review_log') IS NULL THEN
   RAISE EXCEPTION 'Clinical Knowledge consolidation schema missing';
 END IF;
 IF (SELECT COUNT(*) FROM public.clinical_knowledge_cases
   WHERE source='Синтетический демонстрационный случай')<>12 THEN
   RAISE EXCEPTION '12 synthetic knowledge cases not present';
 END IF;
 IF (SELECT COUNT(*) FROM public.published_clinical_cases
  WHERE expert_review_status='pending_review'
  AND NOT source_verified AND NOT rights_verified)<>8 THEN
   RAISE EXCEPTION '8 pending, unverified published cases not present';
 END IF;
 IF EXISTS(SELECT 1 FROM public.published_clinical_cases
   WHERE expert_review_status='approved') THEN
   RAISE EXCEPTION 'Unexpected preapproved publication in Preview-Test';
 END IF;
 IF has_table_privilege('anon','public.published_clinical_cases','SELECT')
 OR has_table_privilege('authenticated','public.published_clinical_cases','SELECT')
 OR has_table_privilege('anon','public.clinical_review_log','INSERT') THEN
   RAISE EXCEPTION 'Public or patient Clinical Knowledge privilege leak';
 END IF;
 IF to_regprocedure('public.approve_published_case(uuid,text,text,text,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'Unreviewed approval RPC was installed';
 END IF;
 INSERT INTO public.published_clinical_cases(title,source_url,expert_review_status,modules)
 VALUES('CK synthetic rollback test','https://example.invalid/ck-rollback',
        'pending_review',ARRAY['support'])
 RETURNING id INTO v;
 BEGIN
  UPDATE public.published_clinical_cases SET expert_review_status='approved'
  WHERE id=v;
  RAISE EXCEPTION 'Unverified publication approval unexpectedly allowed';
 EXCEPTION WHEN check_violation THEN
  NULL;
 END;
END $verify$;
ROLLBACK;
SELECT (SELECT COUNT(*) FROM public.clinical_knowledge_cases) AS synthetic_cases,
       (SELECT COUNT(*) FROM public.published_clinical_cases) AS pending_cases,
       (SELECT COUNT(*) FROM public.published_clinical_cases WHERE expert_review_status='approved') AS approved_cases,
       (SELECT COUNT(*) FROM public.clinical_review_log) AS review_log_rows;