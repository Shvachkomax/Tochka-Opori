-- Add support_plan jsonb column to sessions table
alter table sessions
add column if not exists support_plan jsonb;
