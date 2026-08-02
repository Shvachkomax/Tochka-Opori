-- Migration 028: Final report reliability pass
-- Adds durable report finalization state to sessions table.

-- 1. Add report finalization columns to sessions
alter table sessions
  add column if not exists report_generation_status text default null,
  add column if not exists report_request_id text default null,
  add column if not exists report_started_at timestamptz default null,
  add column if not exists report_completed_at timestamptz default null,
  add column if not exists report_error_code text default null,
  add column if not exists care_recommendation jsonb default null;

-- 2. Constraint: valid statuses only
alter table sessions drop constraint if exists sessions_report_status_check;
alter table sessions add constraint sessions_report_status_check
  check (report_generation_status is null or report_generation_status in ('processing', 'ready', 'failed'));

-- 3. Unique index on report_request_id for idempotency lookups
-- NULLs are not indexed by default, so this is safe for rows without a report request.
create unique index if not exists idx_sessions_report_request_id
  on sessions (report_request_id);

-- 4. Index for status lookups by session
create index if not exists idx_sessions_report_status
  on sessions (session_id, report_generation_status);
