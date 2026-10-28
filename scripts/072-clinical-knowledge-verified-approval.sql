-- Shared Preview-Test Clinical Knowledge: transactional reviewer approval.
-- This is a server-only RPC. Real source/rights verification happens separately;
-- no imported publication becomes approved as a side effect of this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.approve_published_case(
 p_reviewer_id uuid,p_publication_id text,p_version text,p_comment text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $approve$
DECLARE
 v_case public.published_clinical_cases%ROWTYPE;
 v_existing public.clinical_review_log%ROWTYPE;
 v_rev public.experts%ROWTYPE;
 v_updated integer;
BEGIN
 IF p_reviewer_id IS NULL OR p_publication_id IS NULL
    OR p_version IS NULL OR btrim(p_version)=''
    OR p_comment IS NULL OR length(btrim(p_comment))<3
    OR p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' THEN
  RETURN jsonb_build_object('ok',false,'error','required reviewer, case, version, comment and idempotency key');
 END IF;
 IF length(p_idempotency_key)>200 THEN
  RETURN jsonb_build_object('ok',false,'error','idempotency key too long');
 END IF;

 SELECT * INTO v_rev FROM public.experts
 WHERE id=p_reviewer_id AND role='clinical_reviewer' AND is_active=true;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'error','reviewer not authorized');
 END IF;

 SELECT * INTO v_case FROM public.published_clinical_cases
 WHERE id::text=p_publication_id FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'error','publication not found');
 END IF;
 IF v_case.submitted_by_expert_id=p_reviewer_id THEN
  RETURN jsonb_build_object('ok',false,'error','self approval forbidden');
 END IF;

 SELECT * INTO v_existing FROM public.clinical_review_log
 WHERE publication_id=p_publication_id AND idempotency_key=p_idempotency_key LIMIT 1;
 IF FOUND THEN
  IF v_existing.reviewer_id=p_reviewer_id
     AND v_existing.publication_version=p_version
     AND v_existing.decision='approve' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','idempotency key conflict');
 END IF;

 IF v_case.expert_review_status<>'pending_review' THEN
  RETURN jsonb_build_object('ok',false,'error','publication is not pending review');
 END IF;
 IF v_case.version<>p_version THEN
  RETURN jsonb_build_object('ok',false,'error','stale version');
 END IF;
 IF NOT v_case.source_verified OR NOT v_case.rights_verified THEN
  RETURN jsonb_build_object('ok',false,'error','required metadata not verified');
 END IF;

 UPDATE public.published_clinical_cases
 SET expert_review_status='approved',updated_at=clock_timestamp()
 WHERE id=v_case.id AND expert_review_status='pending_review' AND version=p_version;
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 IF v_updated<>1 THEN
  RAISE EXCEPTION 'concurrent clinical publication update' USING ERRCODE='40001';
 END IF;

 INSERT INTO public.clinical_review_log
  (reviewer_id,publication_id,publication_version,decision,comment,idempotency_key)
 VALUES(p_reviewer_id,p_publication_id,p_version,'approve',btrim(p_comment),p_idempotency_key);
 RETURN jsonb_build_object('ok',true,'idempotent',false);
END;
$approve$;
REVOKE ALL ON FUNCTION public.approve_published_case(uuid,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_published_case(uuid,text,text,text,text)
 TO service_role;
COMMENT ON FUNCTION public.approve_published_case(uuid,text,text,text,text) IS
 'Server-only transactional CK review, requires active clinical_reviewer, distinct author, matching version, verified source and rights.';
COMMIT;
