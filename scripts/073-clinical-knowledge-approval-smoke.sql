BEGIN;
DO $test$
DECLARE v_reviewer uuid;v_author uuid;v_case uuid;r jsonb;
BEGIN
 INSERT INTO public.experts(name,access_code,role,allowed_modules)
 VALUES('CK SYNTHETIC REVIEWER','CK-SYN-REVIEW-ROLLBACK-01','clinical_reviewer',ARRAY['support'])
 RETURNING id INTO v_reviewer;
 INSERT INTO public.experts(name,access_code,role,allowed_modules)
 VALUES('CK SYNTHETIC AUTHOR','CK-SYN-AUTHOR-ROLLBACK-01','doctor',ARRAY['support'])
 RETURNING id INTO v_author;
 INSERT INTO public.published_clinical_cases
 (title,source_url,version,source_verified,rights_verified,expert_review_status,submitted_by_expert_id)
 VALUES('CK synthetic verified publication','https://example.invalid/ck-approved','1',true,true,'pending_review',v_author)
 RETURNING id INTO v_case;

 SELECT public.approve_published_case(v_author,v_case::text,'1','valid comment','ck-invalid-role') INTO r;
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'unprivileged expert could approve: %',r; END IF;
 SELECT public.approve_published_case(v_reviewer,v_case::text,'0','valid comment','ck-stale') INTO r;
 IF r->>'ok'<>'false' OR r->>'error'<>'stale version' THEN RAISE EXCEPTION 'stale version not rejected: %',r; END IF;
 UPDATE public.experts SET role='clinical_reviewer' WHERE id=v_author;
 SELECT public.approve_published_case(v_author,v_case::text,'1','valid comment','ck-self') INTO r;
 IF r->>'ok'<>'false' OR r->>'error'<>'self approval forbidden' THEN RAISE EXCEPTION 'self-review not denied: %',r; END IF;

 SELECT public.approve_published_case(v_reviewer,v_case::text,'1','valid comment','ck-approve-synthetic') INTO r;
 IF r->>'ok'<>'true' OR r->>'idempotent'<>'false' THEN RAISE EXCEPTION 'first approval failed: %',r; END IF;
 SELECT public.approve_published_case(v_reviewer,v_case::text,'1','valid comment','ck-approve-synthetic') INTO r;
 IF r->>'ok'<>'true' OR r->>'idempotent'<>'true' THEN RAISE EXCEPTION 'idempotent replay failed: %',r; END IF;
 SELECT public.approve_published_case(v_author,v_case::text,'1','valid comment','ck-approve-synthetic') INTO r;
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'foreign idempotency key accepted'; END IF;
 IF (SELECT COUNT(*) FROM public.clinical_review_log
  WHERE publication_id=v_case::text AND decision='approve')<>1
 THEN RAISE EXCEPTION 'replay wrote duplicate approval'; END IF;
 IF (SELECT expert_review_status FROM public.published_clinical_cases WHERE id=v_case)<>'approved'
 THEN RAISE EXCEPTION 'approval status not saved'; END IF;
 BEGIN
  UPDATE public.clinical_review_log SET comment='TAMPER' WHERE publication_id=v_case::text;
  RAISE EXCEPTION 'review mutation unexpectedly allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='review mutation unexpectedly allowed' THEN RAISE; END IF;
 END;
END $test$;
ROLLBACK;
SELECT
 (SELECT COUNT(*) FROM public.published_clinical_cases) AS pending_publications,
 (SELECT COUNT(*) FROM public.published_clinical_cases WHERE expert_review_status='approved') AS approved_publications,
 (SELECT COUNT(*) FROM public.clinical_review_log) AS recorded_reviews,
 has_function_privilege('anon','public.approve_published_case(uuid,text,text,text,text)','EXECUTE') AS anon_can_approve,
 has_function_privilege('authenticated','public.approve_published_case(uuid,text,text,text,text)','EXECUTE') AS patient_can_approve;