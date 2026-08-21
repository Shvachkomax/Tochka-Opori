-- Phase 11C: Support Service Pricing
-- Creates canonical pricing model and snapshots price into service_requests.

-- 1. Create service_pricing table
CREATE TABLE IF NOT EXISTS public.service_pricing (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  service_code text NOT NULL,
  module text NOT NULL,
  label text NOT NULL,
  credits integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT service_pricing_pkey PRIMARY KEY (id),
  CONSTRAINT service_pricing_service_code_key UNIQUE (service_code),
  CONSTRAINT service_pricing_credits_check CHECK (credits >= 0)
);

-- 2. Seed Support pricing (canonical tariffs)
INSERT INTO public.service_pricing (service_code, module, label, credits) VALUES
  ('short_followup', 'support', 'Короткий follow-up', 10000),
  ('therapy_review', 'support', 'Разбор терапии / повторная консультация по лечению', 20000),
  ('written_consultation', 'support', 'Письменная консультация', 25000),
  ('phone_consultation', 'support', 'Телефонный разговор со специалистом', 30000),
  ('urgent_contact', 'support', 'Срочная связь со специалистом', 40000),
  ('online_consultation', 'support', 'Онлайн-консультация', 50000),
  ('offline_consultation', 'support', 'Очная консультация', 75000)
ON CONFLICT (service_code) DO NOTHING;

-- 3. Add service_code and price_credits to service_requests
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS service_code text;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS price_credits integer;

-- 4. RLS for service_pricing (public read, service_role write)
ALTER TABLE public.service_pricing ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_pricing_select_policy' AND tablename = 'service_pricing') THEN
    CREATE POLICY service_pricing_select_policy ON public.service_pricing
      FOR SELECT USING (true);
  END IF;
END $$;

-- 5. Comment
COMMENT ON TABLE public.service_pricing IS 'Canonical service pricing for Support module. Phase 11C.';
COMMENT ON COLUMN public.service_requests.service_code IS 'Canonical service code snapshot at request creation time.';
COMMENT ON COLUMN public.service_requests.price_credits IS 'Price in credits snapshot at request creation time.';
