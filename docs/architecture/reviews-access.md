# Reviews API access control

`api/reviews.js` authorizes requests through `lib/security/reviews-access.js`
before dispatch, reads, local fallback files, or writes. `expert_id`,
`expert_code`, and cached browser profile data do not authenticate a caller.

## Credentials and permissions

| Caller | Credential | Permission |
| --- | --- | --- |
| Legacy review administrator | `admin_secret` matching server `ADMIN_SECRET` using a timing-safe comparison | Existing global review administration, exports, quality analysis, and destructive actions |
| Specialist | Active, unexpired, non-revoked `specialist_sessions` token; active expert with Support entitlement | Training list/export, patient timeline/details, and permitted training writes |
| Patient | Exact `sessionId` + `access_token`, matched against the stored SHA-256 hash | `save` only, bound to that session's canonical code and module |

Patient-linked specialist records require an active `patient_assignments` or
`patient_access` row for the same public code, Support module, and organization.
Clinic access also requires current organization membership. Membership alone,
historical author fields, and historical primary-expert fields do not grant
patient access. Shared viewers can read; `owner`/`editor` grants or a primary
assignment are required for training writes. Existing training updates also
require authorship. Standalone private exercises without a patient/session/review
link are visible to their verified author.

Every supplied source identifier is checked before a write. Training edits
cannot change patient identifiers. Linked records in detail responses are checked
individually. Scope filters and final record checks apply to training lists and
CSV exports. Global review lists, debug lists, deletion, and quality actions
remain administrator-only. The legacy review admin secret is intentionally not
replaced by the separate module admin-token scheme in this patch.

Patient review saves do not use the `legacy_access` bypass. A valid saved session
pair is required. Client-supplied expert attribution is cleared; an anonymous
patient cannot claim to be a doctor. Credentials are removed recursively before
persisting review/training payloads, local fallback files, or returning JSON.
Existing records are not rewritten.

## Browser compatibility

The specialist login cookie remains HttpOnly, SameSite=Lax, Secure in production,
with a 12-hour lifetime. Its path changes to `/api` so reviews can use the same
session. Login and logout expire the previous `/api/specialist` cookie to avoid
two cookies with the same name. Existing narrow-path cookies require a fresh
login for reviews. Logout revokes the current server-side session.

Reviews reject disallowed origins. Cookie-authenticated calls require an allowed
Origin; Bearer clients can omit Origin. The legacy expert UI now logs in through
`/api/specialist`, clears review caches on account changes, and prompts for login
when a protected review call returns 401. Report autosave, recovered reports, and
patient feedback attach the saved session token. Admin list calls now send the
existing admin credential.

## Verification and rollout

Run `npm run test:reviews-access` (Node with `--experimental-test-module-mocks`),
`npm run test:session-access-pair`, `node scripts/test-specialist-context-state.js`,
and `npm run build`. The reviews suite executes real API handlers with mocked
Supabase clients, prohibits network access, and writes only to a temporary test
directory. It does not validate deployed database state.

No database migration or data deletion is required. Before production rollout,
verify the deployed `ADMIN_SECRET`, the existing `specialist_sessions` schema,
module entitlements, and current patient assignments in the target environment.
Legacy patient-linked training records without a current grant are intentionally
not accessible to specialists; an administrator retains access for review.
