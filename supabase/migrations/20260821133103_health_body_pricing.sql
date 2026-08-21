-- Phase 11E: canonical Health / Body service pricing.
-- No historical service_requests are backfilled.

ALTER TABLE public.service_pricing
  ADD COLUMN IF NOT EXISTS service_topic text;

ALTER TABLE public.service_pricing
  ADD COLUMN IF NOT EXISTS meeting_format text;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS service_topic text;

INSERT INTO public.service_pricing (
  service_code, module, label, service_topic, meeting_format, credits, active
) VALUES
  ('labs_review_written', 'body', 'Расшифровка анализов', 'labs', 'text', 15000, true),
  ('labs_consultation_written', 'body', 'Консультация по анализам', 'labs', 'text', 20000, true),
  ('medications_supplements_review', 'body', 'Разбор принимаемых препаратов и БАДов', 'medications_supplements', 'text', 20000, true),
  ('diary_nutrition_review', 'body', 'Разбор дневника питания', 'diary_nutrition', 'text', 15000, true),
  ('health_written_consultation', 'body', 'Письменная консультация', 'general_health', 'text', 20000, true),
  ('health_phone_consultation', 'body', 'Телефонная консультация', NULL, 'phone', 30000, true),
  ('health_online_consultation', 'body', 'Онлайн-консультация', NULL, 'video', 40000, true),
  ('health_offline_consultation', 'body', 'Очная консультация', NULL, 'offline', 60000, true)
ON CONFLICT (service_code) DO NOTHING;

COMMENT ON COLUMN public.service_pricing.service_topic IS
  'Optional fixed topic for a priced Body product; NULL means the client selects an approved topic.';

COMMENT ON COLUMN public.service_pricing.meeting_format IS
  'Canonical meeting format derived from the priced product.';

COMMENT ON COLUMN public.service_requests.service_topic IS
  'Topic snapshot for canonical Body service requests; NULL for legacy requests.';
