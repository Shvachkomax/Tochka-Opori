-- Ensure existing deployments that created expert_requests before this
-- migration have the tenant column required by the server scope wrapper.
ALTER TABLE public.expert_requests
  ADD COLUMN IF NOT EXISTS tenant_id text;

CREATE INDEX IF NOT EXISTS expert_requests_tenant_created_idx
  ON public.expert_requests (tenant_id, created_at DESC);

ALTER TABLE public.crisis_requests
  ADD COLUMN IF NOT EXISTS tenant_id text;

CREATE INDEX IF NOT EXISTS crisis_requests_tenant_created_idx
  ON public.crisis_requests (tenant_id, created_at DESC);

ALTER TABLE public.expert_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crisis_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.expert_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.crisis_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.expert_requests TO service_role;
GRANT ALL ON TABLE public.crisis_requests TO service_role;
