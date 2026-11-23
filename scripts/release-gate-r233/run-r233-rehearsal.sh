#!/usr/bin/env bash
set -euo pipefail

container="${1:-}"

case "$container" in
  r233_prod_a_7a1c66d|r233_prod_b_7a1c66d|r234a_prod_a_7a1c66d|r234a_prod_b_7a1c66d|r234a_tx_a_7a1c66d|r234a_tx_b_7a1c66d) ;;
  *)
    echo "Usage: $0 <approved-r233-or-r234a-rehearsal-container>" >&2
    exit 64
    ;;
esac

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

run_sql() {
  local sql_file="$1"
  docker exec -i "$container" \
    psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$sql_file"
}

run_migration() {
  local sql_file="$1"
  docker exec -i "$container" \
    psql -X -q --single-transaction -U postgres -d postgres \
      -v ON_ERROR_STOP=1 < "$sql_file"
}

echo "R232_REHEARSAL_START"
bash scripts/release-gate-r232/run-production-rehearsal.sh "$container"
echo "R232_REHEARSAL_DONE"

guard_output="$(mktemp /private/tmp/r233-alignment-guard.XXXXXX)"
set +e
docker exec -i "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < scripts/release-gate-r232/production-baseline-local-alignment.sql \
  >"$guard_output" 2>&1
guard_status=$?
set -e

if [[ "$guard_status" == "0" ]] \
   || ! grep -q "LOCAL REHEARSAL ONLY" "$guard_output"; then
  echo "Local-only alignment guard failed" >&2
  sed -n '1,120p' "$guard_output" >&2
  exit 65
fi
echo "LOCAL_ALIGNMENT_GUARD PASS"

docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "insert into public.continuation_failed_attempts (attempt_key, failed_attempt_count, locked_until, updated_at) values ('r233-preserve-existing', 3, '2026-11-23 12:34:56+00', '2026-11-23 12:00:00+00')"

for rpc_sql in \
  "select * from public.increment_continuation_failed_attempts('r233-pre-fix');" \
  "select public.clear_continuation_failed_attempts('r233-pre-fix');"
do
  pre_fix_output="$(mktemp /private/tmp/r233-pre-fix.XXXXXX)"
  set +e
  docker exec "$container" \
    psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$rpc_sql" \
    >"$pre_fix_output" 2>&1
  pre_fix_status=$?
  set -e

  if [[ "$pre_fix_status" == "0" ]] \
     || ! grep -q 'relation "continuation_failed_attempts" does not exist' "$pre_fix_output"; then
    echo "Pre-fix RPC failure was not reproduced" >&2
    sed -n '1,120p' "$pre_fix_output" >&2
    exit 66
  fi
done
echo "PRE_FIX_FAILURES_REPRODUCED PASS"

echo "RPC_FIX_FIRST_APPLY"
run_migration supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql
run_sql scripts/release-gate-r233/test-continuation-rpc-fix.sql

echo "RPC_FIX_SECOND_APPLY"
run_migration supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql
run_sql scripts/release-gate-r233/test-continuation-rpc-fix.sql
echo "RPC_FIX_REPEATABILITY PASS"

docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "insert into public.continuation_failed_attempts (attempt_key, failed_attempt_count) values ('r233-role-probe-anon', 7), ('r233-role-probe-authenticated', 8)"

docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "set role anon; select public.clear_continuation_failed_attempts('r233-role-probe-anon')"
docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "set role authenticated; select public.clear_continuation_failed_attempts('r233-role-probe-authenticated')"

role_rows="$(docker exec "$container" psql -X -Atq -U postgres -d postgres -c \
  "select count(*) from public.continuation_failed_attempts where attempt_key in ('r233-role-probe-anon','r233-role-probe-authenticated')")"
if [[ "$role_rows" != "2" ]]; then
  echo "Non-bypass role cleared a protected row" >&2
  exit 67
fi

for denied_role in anon authenticated
do
  denied_output="$(mktemp /private/tmp/r233-role-denied.XXXXXX)"
  set +e
  docker exec "$container" \
    psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
      "set role $denied_role; select * from public.increment_continuation_failed_attempts('r233-denied-$denied_role')" \
    >"$denied_output" 2>&1
  denied_status=$?
  set -e

  if [[ "$denied_status" == "0" ]] \
     || ! grep -q "row-level security" "$denied_output"; then
    echo "$denied_role unexpectedly bypassed RLS" >&2
    sed -n '1,120p' "$denied_output" >&2
    exit 68
  fi
done

hidden_anon="$(docker exec "$container" psql -X -Atq -U postgres -d postgres -c \
  "set role anon; select count(*) from public.continuation_failed_attempts")"
hidden_authenticated="$(docker exec "$container" psql -X -Atq -U postgres -d postgres -c \
  "set role authenticated; select count(*) from public.continuation_failed_attempts")"
if [[ "$hidden_anon" != "0" || "$hidden_authenticated" != "0" ]]; then
  echo "Protected rows became visible through RLS" >&2
  exit 69
fi
echo "RPC_ROLE_BOUNDARIES PASS"

shadow_result="$(docker exec "$container" psql -X -Atq -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "create temporary table continuation_failed_attempts (attempt_key text primary key, failed_attempt_count integer, locked_until timestamptz, updated_at timestamptz); set search_path=pg_temp,public; set role service_role; select failed_attempt_count from public.increment_continuation_failed_attempts('r233-shadow-probe'); reset role; select (select count(*) from public.continuation_failed_attempts where attempt_key='r233-shadow-probe')::text || ':' || (select count(*) from pg_temp.continuation_failed_attempts)::text")"
if [[ "$shadow_result" != $'1\n1:0' ]]; then
  echo "Schema-shadowing probe failed: $shadow_result" >&2
  exit 70
fi
docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "set role service_role; select public.clear_continuation_failed_attempts('r233-shadow-probe')"
echo "RPC_SCHEMA_SHADOWING PASS"

docker exec "$container" \
  psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "delete from public.continuation_failed_attempts where attempt_key in ('r233-preserve-existing','r233-role-probe-anon','r233-role-probe-authenticated')"

echo "FINAL_FINGERPRINT_AFTER_R233"
run_sql scripts/release-gate-r232/catalog-fingerprint.sql
