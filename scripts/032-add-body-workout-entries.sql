-- Add workout_entries jsonb for multiple workouts per day
-- Idempotent: safe to run multiple times.

alter table body_daily_logs
  add column if not exists workout_entries jsonb;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
