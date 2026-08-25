-- Harden EXECUTE permissions for the SECURITY DEFINER invitation RPC.

REVOKE EXECUTE
ON FUNCTION public.accept_specialist_invitation(text, uuid, text)
FROM PUBLIC;

REVOKE EXECUTE
ON FUNCTION public.accept_specialist_invitation(text, uuid, text)
FROM anon;

REVOKE EXECUTE
ON FUNCTION public.accept_specialist_invitation(text, uuid, text)
FROM authenticated;

GRANT EXECUTE
ON FUNCTION public.accept_specialist_invitation(text, uuid, text)
TO service_role;
