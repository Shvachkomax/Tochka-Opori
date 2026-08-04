-- Add source_snapshot to body_weekly_summaries for stale detection
-- Idempotent: safe to run multiple times.

alter table body_weekly_summaries
  add column if not exists source_snapshot jsonb;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
