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

root_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root_dir"

baseline_files=(
  supabase/migrations/20260814000000_production_baseline.sql
  supabase/migrations/20260814010000_security_hardening.sql
  supabase/migrations/20260814020000_performance_hardening.sql
  supabase/migrations/20260816000000_specialist_module_entitlements.sql
  supabase/migrations/20260817000000_support_pricing.sql
  supabase/migrations/20260818000000_patient_specialist_linking.sql
  supabase/migrations/20260819000000_accept_invitation_rpc.sql
  supabase/migrations/20260821000000_harden_specialist_invitation_accept.sql
  supabase/migrations/20260821010000_scope_owner_accept.sql
  supabase/migrations/20260821133103_health_body_pricing.sql
  supabase/migrations/20260821155003_service_request_financial_lifecycle.sql
  supabase/migrations/20260824083854_harden_service_request_financial_grants.sql
  supabase/migrations/20260825085627_harden_accept_specialist_invitation_grants.sql
  supabase/migrations/20260825134958_clinical_data_layer_c1_foundation.sql
  supabase/migrations/20260825143903_clinical_data_layer_c1_reference_hardening.sql
  supabase/migrations/20260825154115_clinical_c1_1_observation_idempotency.sql
  supabase/migrations/20260825172224_clinical_c1_1_1_observation_owner_identity_hardening.sql
  supabase/migrations/20260826095017_c2_v0_1_medication_order_foundation.sql
  supabase/migrations/20260826102004_c2_v0_1_medication_function_security_hardening.sql
  supabase/migrations/20260826102252_c2_v0_1_schedule_constraint_hardening.sql
  supabase/migrations/20260826104426_c2_v0_1_mutation_consistency_hardening.sql
  supabase/migrations/20260826111542_c2_v0_1_revoke_idempotency_hardening.sql
  supabase/migrations/20260826111916_c2_v0_1_schedule_completeness_hardening.sql
  supabase/migrations/20260826112815_c2_v0_1_indefinite_schedule_hardening.sql
  supabase/migrations/20260826113620_c2_v0_1_schedule_open_phase_fix.sql
  supabase/migrations/20260826114920_c2_v0_1_global_lifecycle_idempotency_guard.sql
  supabase/migrations/20260826131822_c2_v0_1_medication_concept_snapshot_binding.sql
  scripts/migrations/add-save-request-id-to-body-daily-logs.sql
  supabase/migrations/20261005123149_patient_reported_medication_orders.sql
  supabase/migrations/20261005234912_medication_reference_layer.sql
  supabase/migrations/20261021000822_link_match_request_to_session.sql
  supabase/migrations/20261026062744_pneumointegration_shared_org_scope.sql
  supabase/migrations/20261027062352_partner_test_accruals.sql
)

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

run_local_alignment() {
  local sql_file="$1"
  docker exec -i \
    -e "PGOPTIONS=-c r232.local_rehearsal=on" \
    "$container" \
    psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$sql_file"
}

public_relation_count="$(
  docker exec "$container" \
    psql -X -Atq -U postgres -d postgres \
      -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S')"
)"

if [[ "$public_relation_count" != "0" ]]; then
  echo "Expected an empty public schema, found $public_relation_count relations" >&2
  exit 65
fi

for sql_file in "${baseline_files[@]}"; do
  echo "BASELINE $sql_file"
  run_migration "$sql_file" >/dev/null
done

echo "LOCAL_ALIGNMENT scripts/release-gate-r232/production-baseline-local-alignment.sql"
run_local_alignment scripts/release-gate-r232/production-baseline-local-alignment.sql >/dev/null

echo "BASELINE_FINGERPRINT"
run_sql scripts/release-gate-r232/catalog-fingerprint.sql

echo "FIXTURES scripts/release-gate-r232/pre-migration-fixtures.sql"
run_sql scripts/release-gate-r232/pre-migration-fixtures.sql >/dev/null

echo "TARGET supabase/migration-artifacts/production-r234a/20261123070309_r232_production_clinical_base_a3_a5.sql"
run_migration supabase/migration-artifacts/production-r234a/20261123070309_r232_production_clinical_base_a3_a5.sql >/dev/null

echo "TARGET supabase/migration-artifacts/production-r234a/20261123070333_r232_production_payments_disabled_booking.sql"
run_migration supabase/migration-artifacts/production-r234a/20261123070333_r232_production_payments_disabled_booking.sql >/dev/null

echo "POST_MIGRATION_TESTS"
run_sql scripts/release-gate-r232/post-migration-tests.sql

extension_schema="$(
  docker exec "$container" \
    psql -X -Atq -U postgres -d postgres \
      -c "select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='btree_gist'"
)"

if [[ "$extension_schema" != "extensions" ]]; then
  echo "btree_gist installed in unexpected schema: $extension_schema" >&2
  exit 66
fi

docker exec "$container" \
  psql -X -Atq -U postgres -d postgres \
    -c "set role service_role; select count(*) from public.practice_bookings" >/dev/null

if docker exec "$container" \
  psql -X -Atq -U postgres -d postgres \
    -c "set role anon; select count(*) from public.practice_bookings" >/dev/null 2>&1; then
  echo "anon unexpectedly read practice_bookings" >&2
  exit 67
fi

if docker exec "$container" \
  psql -X -Atq -U postgres -d postgres \
    -c "set role authenticated; select count(*) from public.medical_encounter_versions" >/dev/null 2>&1; then
  echo "authenticated unexpectedly read medical_encounter_versions" >&2
  exit 68
fi

echo "ROLE_BOUNDARIES PASS"
echo "FINAL_FINGERPRINT"
run_sql scripts/release-gate-r232/catalog-fingerprint.sql
