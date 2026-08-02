-- Anonymous Continuation Credential Pass
-- Creates a shared table for cross-device / cross-origin access credentials.
-- A credential belongs to a canonical owner, not to an individual session or diary record.

-- Support module: owner_type = anonymous_case
-- Health module: owner_type = anonymous_profile

-- Credentials table stores only public lookup_code and hashed secret.
-- These columns existed only in an earlier draft and are removed if present.
alter table if exists continuation_credentials
  drop column if exists failed_attempt_count,
  drop column if exists locked_until;

create table if not exists continuation_credentials (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  owner_type text not null,
  owner_id uuid not null,
  lookup_code text not null unique,
  secret_hash text not null,
  secret_version integer not null default 1,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  unique(owner_type, owner_id),
  constraint continuation_credentials_module_owner_check
    check (
      (module = 'support' and owner_type = 'anonymous_case')
      or
      (module = 'body' and owner_type = 'anonymous_profile')
    )
);

-- Failure attempts are tracked separately per IP + lookup hash.
-- This table intentionally stores neither lookup_code nor the full continuation code.
create table if not exists continuation_failed_attempts (
  attempt_key text primary key,
  failed_attempt_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Atomic increment of failed attempts. Lock is set once the count reaches 5,
-- so attempts 1-5 return the generic failure response and the 6th is blocked.
create or replace function increment_continuation_failed_attempts(p_attempt_key text)
returns table(failed_attempt_count integer, locked_until timestamptz)
language plpgsql
as $$
begin
  return query
  insert into continuation_failed_attempts (attempt_key, failed_attempt_count, locked_until, updated_at)
  values (p_attempt_key, 1, null, now())
  on conflict (attempt_key)
  do update set
    failed_attempt_count = continuation_failed_attempts.failed_attempt_count + 1,
    locked_until = case
      when continuation_failed_attempts.failed_attempt_count + 1 >= 5 then now() + interval '15 minutes'
      else null
    end,
    updated_at = now()
  returning continuation_failed_attempts.failed_attempt_count, continuation_failed_attempts.locked_until;
end;
$$;

-- Clear attempts after a successful exchange.
create or replace function clear_continuation_failed_attempts(p_attempt_key text)
returns void
language plpgsql
as $$
begin
  delete from continuation_failed_attempts where attempt_key = p_attempt_key;
end;
$$;

-- Unique constraints above already create indexes on lookup_code and (owner_type, owner_id).
-- No additional indexes are required for the current query patterns.

-- RLS enabled; no policies for anon/authenticated. Backend uses service role only.
alter table continuation_credentials enable row level security;
alter table continuation_failed_attempts enable row level security;

comment on table continuation_credentials is 'Cross-device continuation credentials per canonical owner';
comment on column continuation_credentials.module is 'support or body';
comment on column continuation_credentials.owner_type is 'anonymous_case for support, anonymous_profile for body';
comment on column continuation_credentials.owner_id is 'Canonical anonymous owner UUID';
comment on column continuation_credentials.lookup_code is 'Publicly visible part of continuation code (e.g. ТОЧКА-XXXX-XXXX)';
comment on column continuation_credentials.secret_hash is 'HMAC-SHA256 of secret part with server-side pepper';
comment on column continuation_credentials.secret_version is 'Version for future crypto migrations';

comment on table continuation_failed_attempts is 'Per-IP+lookup failure attempts for brute-force protection';
comment on column continuation_failed_attempts.attempt_key is 'HMAC-derived opaque key for IP + lookup_code pair';

-- CHECK constraint enforces:
-- support module must use anonymous_case owner type;
-- body module must use anonymous_profile owner type.
-- Application layer also validates before insert/upsert.
