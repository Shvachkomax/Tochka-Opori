#!/usr/bin/env bash
set -euo pipefail

container="${1:-}"

case "$container" in
  r232_prod_a_7a1c66d|r232_prod_b_7a1c66d|r233_prod_a_7a1c66d|r233_prod_b_7a1c66d|r234a_prod_a_7a1c66d|r234a_prod_b_7a1c66d|r234a_tx_a_7a1c66d|r234a_tx_b_7a1c66d) ;;
  *)
    echo "Usage: $0 <approved-r232-r233-or-r234a-rehearsal-container>" >&2
    exit 64
    ;;
esac

tmp_dir="$(mktemp -d /private/tmp/r232-concurrency.XXXXXX)"
first_out="$tmp_dir/first.out"
second_out="$tmp_dir/second.out"

docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  >"$first_out" 2>&1 <<'SQL' &
begin;
set role service_role;
select public.request_practice_booking_without_payment(
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'anonymous_case',
  'c0000000-0000-4000-8000-000000000001',
  'r232-concurrent-session-a',
  date_trunc('day', now()) + interval '21 days 10 hours',
  null,
  'r232-concurrent-a'
);
select pg_sleep(3);
commit;
SQL
first_pid=$!

sleep 0.5

set +e
docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 \
  >"$second_out" 2>&1 <<'SQL'
set role service_role;
select public.request_practice_booking_without_payment(
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'anonymous_profile',
  'c0000000-0000-4000-8000-000000000002',
  'r232-concurrent-session-b',
  date_trunc('day', now()) + interval '21 days 10 hours 15 minutes',
  null,
  'r232-concurrent-b'
);
SQL
second_status=$?
wait "$first_pid"
first_status=$?
set -e

if [[ "$first_status" != "0" ]]; then
  echo "First concurrent transaction failed" >&2
  sed -n '1,160p' "$first_out" >&2
  exit 65
fi

if [[ "$second_status" == "0" ]]; then
  echo "Overlapping concurrent transaction unexpectedly succeeded" >&2
  sed -n '1,160p' "$second_out" >&2
  exit 66
fi

if ! grep -q "practice_bookings_no_double_booking_halfopen" "$second_out"; then
  echo "Second transaction failed for an unexpected reason" >&2
  sed -n '1,160p' "$second_out" >&2
  exit 67
fi

echo "CONCURRENT_BOOKING PASS first=committed second=exclusion_violation"
echo "EVIDENCE_DIR $tmp_dir"
