-- Add missing plate_analysis column to body_daily_logs
-- All other expected columns already exist.
-- Idempotent: safe to run multiple times.

alter table public.body_daily_logs
  add column if not exists plate_analysis jsonb;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
