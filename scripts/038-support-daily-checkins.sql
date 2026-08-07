-- Migration 038: Support daily check-ins (wellbeing + anxiety self-tracking)
-- Owner-level subjective state tracking between Support sessions.

CREATE TABLE IF NOT EXISTS support_daily_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  checkin_date date NOT NULL,
  wellbeing_score integer NOT NULL,
  anxiety_score integer,
  comment text,
  source text NOT NULL DEFAULT 'client_cabinet',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_daily_checkins_wellbeing_range CHECK (wellbeing_score BETWEEN -5 AND 5),
  CONSTRAINT support_daily_checkins_anxiety_range CHECK (anxiety_score IS NULL OR anxiety_score BETWEEN 0 AND 10),
  CONSTRAINT support_daily_checkins_unique_day UNIQUE (owner_type, owner_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_support_daily_checkins_owner
  ON support_daily_checkins (owner_type, owner_id, checkin_date DESC);

-- RLS: service-role only (same pattern as all other user-data tables)
ALTER TABLE support_daily_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_daily_checkins_service_role_only"
  ON support_daily_checkins
  USING (current_setting('role') = 'service_role');

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
