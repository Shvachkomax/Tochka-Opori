-- Migration 040: Support owner profiles (display_name)
-- Stores owner-level profile data for Support module.

CREATE TABLE IF NOT EXISTS support_owner_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_owner_profiles_unique UNIQUE (owner_type, owner_id)
);

-- RLS: service-role only
ALTER TABLE support_owner_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_owner_profiles_service_role_only"
  ON support_owner_profiles
  USING (current_setting('role') = 'service_role');

NOTIFY pgrst, 'reload schema';
