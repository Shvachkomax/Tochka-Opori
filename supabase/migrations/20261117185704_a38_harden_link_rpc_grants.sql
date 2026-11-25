-- Supabase grants API roles explicitly in this test project. Keep both
-- SECURITY DEFINER functions server-only even when PUBLIC has no EXECUTE.
revoke all on function public.accept_specialist_invitation(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.accept_specialist_invitation(text, uuid, text)
  to service_role;
grant execute on function public.revoke_patient_specialist_link(text, uuid, text, text, uuid, uuid)
  to service_role;
