-- Migration 039: Support owner-level persistent practices
-- Stores practices recommended across Support sessions for an owner.
-- Deduplicates by (owner_type, owner_id, practice_key).

CREATE TABLE IF NOT EXISTS support_owner_practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  practice_key text NOT NULL,
  title text NOT NULL,
  description text,
  first_recommended_at timestamptz NOT NULL DEFAULT now(),
  last_recommended_at timestamptz NOT NULL DEFAULT now(),
  recommendation_count integer NOT NULL DEFAULT 1,
  source_session_ids text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  helpfulness text NOT NULL DEFAULT 'unknown',
  user_status text NOT NULL DEFAULT 'not_tried',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_owner_practices_unique UNIQUE (owner_type, owner_id, practice_key),
  CONSTRAINT support_owner_practices_status_check CHECK (status IN ('active', 'completed', 'dismissed')),
  CONSTRAINT support_owner_practices_helpfulness_check CHECK (helpfulness IN ('unknown', 'helped', 'neutral', 'not_helpful')),
  CONSTRAINT support_owner_practices_user_status_check CHECK (user_status IN ('not_tried', 'tried', 'helped', 'not_helpful'))
);

CREATE INDEX IF NOT EXISTS idx_support_owner_practices_owner
  ON support_owner_practices (owner_type, owner_id, status, last_recommended_at DESC);

-- RLS: service-role only (same pattern as all other user-data tables)
ALTER TABLE support_owner_practices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_owner_practices_service_role_only"
  ON support_owner_practices
  USING (current_setting('role') = 'service_role');

NOTIFY pgrst, 'reload schema';
