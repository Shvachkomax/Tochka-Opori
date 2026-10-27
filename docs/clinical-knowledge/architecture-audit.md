# Architecture audit — Clinical Knowledge

## Stack
- Frontend: React + Vite (src/App.jsx, src/pages).
- API: Vercel serverless functions in api/, local wrapper local-api-server.js.
- Data: Supabase/Postgres, migrations in scripts/*.sql.
- Finance: usage_wallets, usage_ledger, RPC consume_usage_credits (support/body modules).

## Existing specialist cabinet
- src/pages/specialist/SpecialistCabinet.jsx.
- API api/specialist.js with auth, memberships, medication orders, service requests.

## Finance architecture
- Usage wallets per owner_type/owner_id/module.
- Ledger with idempotent request_id.
- Test balances (is_test_balance) and no real charges in current pass.
- Partner commissions not touched.

## Existing clinical components
- lib/clinical/medication.js (medication orders).
- lib/clinical/projection.js, observation-mappings.js.
- SpecialistMedicationOrders.jsx.

## Reuse decisions
- Reuse access/membership patterns.
- Reuse usage wallet concepts; no new competing accounting.
- New module added as independent lib/clinical/knowledge + API + UI.
- Billing is feature-flagged and disabled by default (real_charge_performed=false).
