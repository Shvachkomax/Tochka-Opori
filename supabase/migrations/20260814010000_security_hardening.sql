-- Phase 6 security hardening.
-- Production baseline 20260814000000 remains frozen.


ALTER FUNCTION public.clear_continuation_failed_attempts(text)
  SET search_path = '';


ALTER FUNCTION public.increment_continuation_failed_attempts(text)
  SET search_path = '';


ALTER FUNCTION public.enforce_patient_access_identity()
  SET search_path = '';


ALTER FUNCTION public.enforce_patient_assignment_identity()
  SET search_path = '';


ALTER FUNCTION public.update_updated_at()
  SET search_path = '';


REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated, service_role;
