-- Phase 11C.1: Patient ↔ Specialist Linking
-- Creates invitation, onboarding request, and match request tables.
-- Also fixes service_pricing label for short_followup.

-- ============================================================================
-- 1. patient_specialist_invitations
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.patient_specialist_invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('specialist_to_patient', 'patient_to_specialist')),
  module text NOT NULL DEFAULT 'support' CHECK (module IN ('support', 'body')),
  inviter_expert_id uuid,
  inviter_owner_type text,
  inviter_owner_id uuid,
  target_expert_id uuid,
  target_owner_type text,
  target_owner_id uuid,
  organization_id uuid,
  patient_label text,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  expires_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone,
  declined_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT patient_specialist_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT patient_specialist_invitations_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX idx_psi_status ON public.patient_specialist_invitations USING btree (status);
CREATE INDEX idx_psi_target_expert ON public.patient_specialist_invitations USING btree (target_expert_id);
CREATE INDEX idx_psi_target_owner ON public.patient_specialist_invitations USING btree (target_owner_type, target_owner_id);
CREATE INDEX idx_psi_inviter_expert ON public.patient_specialist_invitations USING btree (inviter_expert_id);
CREATE INDEX idx_psi_module ON public.patient_specialist_invitations USING btree (module);

ALTER TABLE public.patient_specialist_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. specialist_onboarding_requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.specialist_onboarding_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  invitation_id uuid NOT NULL REFERENCES public.patient_specialist_invitations(id),
  module text NOT NULL,
  organization_id uuid,
  name text NOT NULL,
  contact_email text,
  contact_phone text,
  comment text,
  status text DEFAULT 'submitted' NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  expert_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT specialist_onboarding_requests_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_sor_status ON public.specialist_onboarding_requests USING btree (status);
CREATE INDEX idx_sor_invitation ON public.specialist_onboarding_requests USING btree (invitation_id);

ALTER TABLE public.specialist_onboarding_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. specialist_match_requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.specialist_match_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  module text NOT NULL DEFAULT 'support',
  organization_id uuid,
  message text,
  status text DEFAULT 'submitted' NOT NULL CHECK (status IN ('submitted', 'assigned', 'cancelled')),
  assigned_expert_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  assigned_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT specialist_match_requests_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_smr_status ON public.specialist_match_requests USING btree (status);
CREATE INDEX idx_smr_owner ON public.specialist_match_requests USING btree (owner_type, owner_id);
CREATE INDEX idx_smr_module ON public.specialist_match_requests USING btree (module);

ALTER TABLE public.specialist_match_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. Fix service_pricing label
-- ============================================================================

UPDATE public.service_pricing
SET label = 'Короткая повторная консультация', updated_at = now()
WHERE service_code = 'short_followup';

-- ============================================================================
-- 5. Comments
-- ============================================================================

COMMENT ON TABLE public.patient_specialist_invitations IS 'Bidirectional invitations between patients and specialists. Token stored as hash only.';
COMMENT ON TABLE public.specialist_onboarding_requests IS 'Pending specialist onboarding from patient invitation. Admin must approve before expert can accept.';
COMMENT ON TABLE public.specialist_match_requests IS 'Patient request to platform: assign me a specialist.';
