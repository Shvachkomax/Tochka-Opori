-- Phase 11D follow-up: explicitly close all client-role EXECUTE grants.
REVOKE ALL ON FUNCTION public.ensure_usage_wallet(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_usage_wallet(uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_service_request(uuid, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_usage_wallet(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_usage_wallet(uuid, bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_service_request(uuid, text, text, timestamptz, text, text) TO service_role;
