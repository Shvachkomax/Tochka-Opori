-- Consolidated Clinical Knowledge contributor review: synthetic demo-only bonus.
-- RPC invoker service_role only; NEVER creates redeemable balance or payments.
BEGIN;
CREATE OR REPLACE FUNCTION public.accept_clinical_contribution_demo(
 p_contribution_id uuid,p_reviewer_id uuid,p_comment text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public
AS $approve$
DECLARE
 v_row public.clinical_contributions%ROWTYPE;
 v_reviewer public.experts%ROWTYPE;
 v_expected_module text;
BEGIN
 IF p_contribution_id IS NULL OR p_reviewer_id IS NULL
   OR p_comment IS NULL OR length(btrim(p_comment))<8 THEN
  RETURN jsonb_build_object('ok',false,'error','insufficient reviewer decision');
 END IF;
 SELECT * INTO v_reviewer FROM public.experts WHERE id=p_reviewer_id AND is_active=true;
 IF NOT FOUND OR v_reviewer.role NOT IN ('clinical_reviewer','platform_admin') THEN
  RETURN jsonb_build_object('ok',false,'error','reviewer not authorized');
 END IF;
 SELECT * INTO v_row FROM public.clinical_contributions
 WHERE id=p_contribution_id FOR UPDATE;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'error','contribution not found');
 END IF;
 IF v_row.author_expert_id=p_reviewer_id THEN
  RETURN jsonb_build_object('ok',false,'error','self review forbidden');
 END IF;
 v_expected_module:=CASE WHEN v_row.module='health' THEN 'body' ELSE 'support' END;
 IF v_reviewer.role='clinical_reviewer' AND
    NOT (v_expected_module=ANY(COALESCE(v_reviewer.allowed_modules,ARRAY[]::text[]))) THEN
  RETURN jsonb_build_object('ok',false,'error','module reviewer permission denied');
 END IF;

 IF v_row.status='accepted' AND v_row.reviewer_expert_id=p_reviewer_id THEN
  RETURN jsonb_build_object('ok',true,'idempotent',true,'points',100,'reward_mode','demo_nonredeemable');
 END IF;
 IF v_row.status<>'submitted'
    OR v_row.deidentified_confirmed<>true
    OR v_row.lawful_use_confirmed<>true THEN
  RETURN jsonb_build_object('ok',false,'error','contribution not ready for review');
 END IF;

 UPDATE public.clinical_contributions
 SET status='accepted',reviewer_expert_id=p_reviewer_id,
    review_comment=btrim(p_comment),reviewed_at=clock_timestamp(),
    updated_at=clock_timestamp(),version=version+1
 WHERE id=p_contribution_id;
 INSERT INTO public.clinical_contribution_bonus_ledger(contribution_id,expert_id)
 VALUES(p_contribution_id,v_row.author_expert_id)
 ON CONFLICT(contribution_id) DO NOTHING;

 RETURN jsonb_build_object('ok',true,'idempotent',false,'points',100,'reward_mode','demo_nonredeemable');
END;
$approve$;
REVOKE ALL ON FUNCTION public.accept_clinical_contribution_demo(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_clinical_contribution_demo(uuid,uuid,text)
 TO service_role;
COMMENT ON FUNCTION public.accept_clinical_contribution_demo(uuid,uuid,text) IS
 'Demo-only review with nonredeemable points; requires reviewer role and module rights; no financial balance updates.';
COMMIT;
