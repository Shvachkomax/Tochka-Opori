-- Phase 7 performance hardening.
-- Previous migrations remain frozen.

-- Wrap current_setting() in scalar subquery to prevent per-row initplan re-evaluation.

ALTER POLICY cc_email_campaigns_service_role_only
ON public.clinical_council_email_campaigns
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY cc_email_deliveries_service_role_only
ON public.clinical_council_email_deliveries
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY cc_experts_service_role_only
ON public.clinical_council_experts
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY cc_invitations_service_role_only
ON public.clinical_council_invitations
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY usage_wallets_service_role_only
ON public.usage_wallets
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY usage_ledger_service_role_only
ON public.usage_ledger
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY support_daily_checkins_service_role_only
ON public.support_daily_checkins
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY support_owner_practices_service_role_only
ON public.support_owner_practices
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY support_owner_profiles_service_role_only
ON public.support_owner_profiles
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));

ALTER POLICY support_ai_chat_service_role_only
ON public.support_ai_chat
USING (((SELECT current_setting('role'::text)) = 'service_role'::text));
