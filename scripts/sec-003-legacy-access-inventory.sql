-- SEC-003: read-only inventory of legacy session access.
--
-- Run manually, with a read-only database role where possible. This script
-- returns aggregate counts only: no medical fields, raw access tokens, token
-- hashes, continuation secrets, lookup codes, session IDs, or owner IDs leave
-- the database.
--
-- A raw access token is intentionally never stored, so SQL cannot prove that a
-- user still possesses it. "token_verification_ready" below means only that the
-- server has a well-formed SHA-256 hash against which a presented raw token can
-- be verified. The application currently defines no access-token expiry.

begin transaction read only;

-- 1. Legacy sessions by product and available possession-proof paths.
with legacy_sessions as (
  select
    s.session_id,
    case
      when s.module = 'body' then 'health'
      when s.module = 'support' then 'support'
      else 'unknown'
    end as cohort,
    case
      when s.module = 'body' then 'body'
      when s.module = 'support' then 'support'
      else null
    end as normalized_module,
    s.anonymous_owner_id,
    s.access_token_hash,
    s.access_token_generated_at
  from public.sessions as s
  where s.legacy_access is true
), inventory as (
  select
    ls.*,
    coalesce(
      ls.access_token_hash ~ '^[0-9A-Fa-f]{64}$',
      false
    ) as token_verification_ready,
    (
      cc.id is not null
      and cc.revoked_at is null
      and cc.secret_hash ~ '^[0-9A-Fa-f]{64}$'
    ) as active_continuation_credential,
    (
      cc.id is not null and cc.revoked_at is not null
    ) as revoked_continuation_credential
  from legacy_sessions as ls
  left join public.continuation_credentials as cc
    on cc.owner_id = ls.anonymous_owner_id
   and cc.module = ls.normalized_module
   and cc.owner_type = case ls.normalized_module
     when 'support' then 'anonymous_case'
     when 'body' then 'anonymous_profile'
     else null
   end
)
select
  cohort,
  count(*) as legacy_session_count,
  count(distinct anonymous_owner_id) as distinct_owner_count,
  count(*) filter (where anonymous_owner_id is not null) as with_anonymous_owner_id,
  count(*) filter (where access_token_hash is not null) as with_any_token_hash,
  count(*) filter (where token_verification_ready) as with_verifiable_token_hash,
  count(*) filter (
    where token_verification_ready and access_token_generated_at is not null
  ) as with_complete_token_metadata,
  count(*) filter (where active_continuation_credential) as with_active_continuation_credential,
  count(distinct anonymous_owner_id) filter (
    where active_continuation_credential
  ) as distinct_owners_with_active_credential,
  count(*) filter (where revoked_continuation_credential) as with_revoked_continuation_credential,
  count(*) filter (
    where anonymous_owner_id is not null and token_verification_ready
  ) as with_owner_and_verifiable_token_hash,
  count(*) filter (
    where anonymous_owner_id is not null and active_continuation_credential
  ) as with_owner_and_active_credential,
  count(*) filter (
    where token_verification_ready or active_continuation_credential
  ) as with_known_verification_path,
  count(*) filter (
    where not token_verification_ready and not active_continuation_credential
  ) as without_known_verification_path
from inventory
group by cohort
order by case cohort when 'support' then 1 when 'health' then 2 else 3 end;

-- 2. Health canonical-owner consistency for legacy sessions. Mismatches and
-- missing owners must go to controlled recovery; they must not be auto-filled.
with legacy_health as (
  select s.session_id, s.anonymous_owner_id as session_owner_id
  from public.sessions as s
  where s.legacy_access is true
    and s.module = 'body'
), health_alignment as (
  select
    lh.session_id,
    lh.session_owner_id,
    bc.session_id as body_client_session_id,
    bc.anonymous_owner_id as body_owner_id
  from legacy_health as lh
  left join public.body_clients as bc on bc.session_id = lh.session_id
)
select
  count(*) as legacy_health_session_count,
  count(*) filter (where body_client_session_id is not null) as with_body_client,
  count(*) filter (where session_owner_id is not null) as with_session_owner,
  count(*) filter (where body_owner_id is not null) as with_body_owner,
  count(*) filter (
    where session_owner_id is not null and session_owner_id = body_owner_id
  ) as matching_owners,
  count(*) filter (
    where session_owner_id is null and body_owner_id is not null
  ) as session_owner_missing_body_owner_present,
  count(*) filter (
    where session_owner_id is not null
      and body_owner_id is not null
      and session_owner_id <> body_owner_id
  ) as owner_mismatches,
  count(*) filter (
    where body_client_session_id is null or body_owner_id is null
  ) as missing_body_binding
from health_alignment;

-- 3. Health profiles with no canonical sessions row are not marked legacy (the
-- flag lives on sessions) but are relevant to access recovery planning.
select
  count(*) as body_client_count,
  count(*) filter (where s.session_id is null) as without_sessions_row,
  count(*) filter (
    where s.session_id is null and bc.anonymous_owner_id is not null
  ) as without_sessions_row_with_owner,
  count(*) filter (
    where s.session_id is not null and bc.anonymous_owner_id is null
  ) as sessions_row_present_body_owner_missing,
  count(*) filter (
    where s.session_id is not null
      and s.anonymous_owner_id is not null
      and bc.anonymous_owner_id is not null
      and s.anonymous_owner_id <> bc.anonymous_owner_id
  ) as owner_mismatches
from public.body_clients as bc
left join public.sessions as s on s.session_id = bc.session_id;

rollback;
