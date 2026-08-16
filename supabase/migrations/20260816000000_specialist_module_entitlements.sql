-- Phase 11: Specialist module entitlements
-- Adds allowed_modules to experts table with safe backfill.

-- 1. Add column with safe default (idempotent)
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS allowed_modules text[] NOT NULL DEFAULT ARRAY['support']::text[];

-- 2. Drop existing constraint if re-applying
ALTER TABLE public.experts
  DROP CONSTRAINT IF EXISTS experts_allowed_modules_check;

-- 3. CHECK constraint: exactly one of the three valid states
ALTER TABLE public.experts
  ADD CONSTRAINT experts_allowed_modules_check
  CHECK (
    allowed_modules = ARRAY['support']::text[]
    OR allowed_modules = ARRAY['body']::text[]
    OR allowed_modules = ARRAY['support','body']::text[]
  );

-- 4. Safe backfill: derive from DISTINCT active module relationships
--    across both patient_assignments and patient_access.
--    Canonical ordering: support first, body second.

UPDATE public.experts
SET allowed_modules = ARRAY['support']::text[]
WHERE is_active = true;

WITH expert_modules AS (
  SELECT
    pa.primary_expert_id AS expert_id,
    pa.module
  FROM public.patient_assignments pa
  JOIN public.experts e ON e.id = pa.primary_expert_id
  WHERE pa.status = 'active'
    AND pa.module IN ('support', 'body')
    AND e.is_active = true

  UNION

  SELECT
    pa.expert_id,
    pa.module
  FROM public.patient_access pa
  JOIN public.experts e ON e.id = pa.expert_id
  WHERE pa.status = 'active'
    AND pa.module IN ('support', 'body')
    AND e.is_active = true
),
module_flags AS (
  SELECT
    expert_id,
    bool_or(module = 'support') AS has_support,
    bool_or(module = 'body') AS has_body
  FROM expert_modules
  GROUP BY expert_id
)
UPDATE public.experts e
SET allowed_modules =
  CASE
    WHEN f.has_support AND f.has_body
      THEN ARRAY['support','body']::text[]
    WHEN f.has_body
      THEN ARRAY['body']::text[]
    ELSE ARRAY['support']::text[]
  END
FROM module_flags f
WHERE e.id = f.expert_id;

-- 5. Comment
COMMENT ON COLUMN public.experts.allowed_modules IS 'Modules this specialist is entitled to access. Values: support, body.';
