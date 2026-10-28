BEGIN;
DO $test$
DECLARE doctor uuid;reviewer uuid;cid uuid;incomplete_id uuid; r jsonb;
BEGIN
 INSERT INTO public.experts(name,access_code,role,allowed_modules)
 VALUES('CK SYNTHETIC CONTRIBUTOR','CK-SYN-CONTRIB-ROLLBACK-01','doctor',ARRAY['support'])
 RETURNING id INTO doctor;
 INSERT INTO public.experts(name,access_code,role,allowed_modules)
 VALUES('CK SYNTHETIC REVIEWER','CK-SYN-CREVIEW-ROLLBACK-01','clinical_reviewer',ARRAY['body'])
 RETURNING id INTO reviewer;
 INSERT INTO public.clinical_contributions(
  author_expert_id,module,status,title,complaints,diagnosis,outcomes,
  deidentified_confirmed,lawful_use_confirmed)
 VALUES(doctor,'support','submitted','CK synthetic learning case',
  'Синтетические жалобы','Синтетический диагноз','Синтетическое наблюдение',true,true)
 RETURNING id INTO cid;
 SELECT public.accept_clinical_contribution_demo(doctor,doctor,'Синтетическое решение') INTO r;
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Invalid case test should fail'; END IF;
 SELECT public.accept_clinical_contribution_demo(cid,reviewer,'Синтетическое решение') INTO r;
 IF r->>'ok'<>'false' OR r->>'error'<>'module reviewer permission denied'
 THEN RAISE EXCEPTION 'cross module reviewer not blocked: %',r; END IF;
 UPDATE public.experts SET allowed_modules=ARRAY['support'] WHERE id=reviewer;
 SELECT public.accept_clinical_contribution_demo(cid,reviewer,'Синтетическое решение') INTO r;
 IF r->>'ok'<>'true' OR r->>'idempotent'<>'false'
 OR r->>'reward_mode'<>'demo_nonredeemable' THEN
  RAISE EXCEPTION 'valid demo contribution approval failed: %',r; END IF;
 SELECT public.accept_clinical_contribution_demo(cid,reviewer,'Синтетическое решение') INTO r;
 IF r->>'ok'<>'true' OR r->>'idempotent'<>'true'
 THEN RAISE EXCEPTION 'review replay not idempotent: %',r; END IF;
 IF (SELECT COUNT(*) FROM public.clinical_contribution_bonus_ledger WHERE contribution_id=cid)<>1
 THEN RAISE EXCEPTION 'demo bonus was duplicated'; END IF;
 IF (SELECT reward_mode FROM public.clinical_contribution_bonus_ledger WHERE contribution_id=cid)<>'demo_nonredeemable'
 THEN RAISE EXCEPTION 'bonus became redeemable'; END IF;
 INSERT INTO public.clinical_contributions(
  author_expert_id,module,status,title,deidentified_confirmed,lawful_use_confirmed)
 VALUES(doctor,'support','submitted','CK synthetic unverified contribution',false,false)
 RETURNING id INTO incomplete_id;
 SELECT public.accept_clinical_contribution_demo(incomplete_id,reviewer,'Синтетическое решение') INTO r;
 IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'unverified case approved: %',r; END IF;
END $test$;
ROLLBACK;
SELECT (SELECT COUNT(*) FROM public.clinical_contributions) AS contributions_after,
 (SELECT COUNT(*) FROM public.clinical_contribution_bonus_ledger) AS demo_bonuses_after,
 has_function_privilege('anon','public.accept_clinical_contribution_demo(uuid,uuid,text)','EXECUTE') AS anon_can_accept,
 has_function_privilege('authenticated','public.accept_clinical_contribution_demo(uuid,uuid,text)','EXECUTE') AS user_can_accept;