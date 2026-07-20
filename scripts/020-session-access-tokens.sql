-- Security Pass 2 — Session Access Tokens
-- Adds access_token_hash to sessions for scoped read access.
-- New sessions require a matching access_token to read.
-- Old sessions (before this migration) have legacy_access = true by default.

alter table if exists sessions
  add column if not exists access_token_hash text,
  add column if not exists legacy_access boolean not null default true,
  add column if not exists access_token_generated_at timestamptz;

-- Index for looking up by access_token_hash (used during validation)
create index if not exists idx_sessions_access_token_hash
  on sessions(access_token_hash)
  where access_token_hash is not null;

-- After a grace period, flip legacy_access to false for new inserts
-- by removing the default. Existing rows keep their value.
-- Run this manually after migration:
--   alter table sessions alter column legacy_access drop default;

comment on column sessions.access_token_hash is 'SHA-256 hash of the raw access token; NULL for legacy sessions';
comment on column sessions.legacy_access is 'If true, session can be read without access_token (backward compat)';
comment on column sessions.access_token_generated_at is 'When the current access token was generated';

-- ============================================================================
-- Sync access_token_hash into body_daily_logs for consistency
-- body_daily_logs references sessions by session_id, not FK.
-- We add a nullable column to store the hash at write time for RLS.
-- ============================================================================
alter table if exists body_daily_logs
  add column if not exists access_token_hash text;

comment on column body_daily_logs.access_token_hash is 'Snapshot of sessions.access_token_hash at log creation time';
