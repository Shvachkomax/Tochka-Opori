# Test deployment plan — Clinical Knowledge v0.1

1. Apply unapplied migration `scripts/046-clinical-knowledge.sql` to test Supabase only (not production).
2. Deploy preview build with env unchanged except test flags; keep billing disabled.
3. Verify routes: `/specialist`, `/specialist/knowledge`.
4. HTTP access matrix:
   - anonymous POST `/api/clinical-knowledge` -> 401.
   - patient/no specialist session -> 401.
   - specialist org A with valid session + own org -> 200.
   - specialist org A requesting org B -> 403.
   - cross-org data not returned; errors contain no secrets/internal details.
5. Run `npm run test:clinical-knowledge` and `npm run build` in CI.
6. Verify mock labels in all responses/UI.
7. Verify no real charges: `real_charge_performed=false`, no wallet debits.
8. Rollback: revert commit/preview deployment; migration rollback not needed for empty tables.
