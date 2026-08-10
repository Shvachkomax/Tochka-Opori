-- Migration 042: Enrich support_owner_practices with catalog metadata
-- ADDITIVE ONLY — does not modify existing columns, constraints, or rows.

ALTER TABLE support_owner_practices
  ADD COLUMN IF NOT EXISTS instructions jsonb,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS when_to_use text,
  ADD COLUMN IF NOT EXISTS safety_note text,
  ADD COLUMN IF NOT EXISTS category text;

-- Non-negative duration
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_owner_practices_duration_check'
  ) THEN
    ALTER TABLE support_owner_practices
      ADD CONSTRAINT support_owner_practices_duration_check
      CHECK (duration_minutes IS NULL OR duration_minutes >= 0);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
