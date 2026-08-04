-- Add calorie balance and activity source fields to body_daily_logs
-- Idempotent: safe to run multiple times.

alter table body_daily_logs
  add column if not exists activity_calories integer;

alter table body_daily_logs
  add column if not exists activity_calories_source text;

alter table body_daily_logs
  add column if not exists calorie_intake_source text;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
