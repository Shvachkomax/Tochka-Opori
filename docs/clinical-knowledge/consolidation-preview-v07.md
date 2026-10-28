# Clinical Knowledge + Clinical Longitudinal: shared Preview-Test consolidation
**Status 2026-10-28:** partial data/schema/code consolidation completed; NO production merge or clinical browser acceptance yet.

## Source of truth and scope
- OpenCode export supplied by project owner: `clinical-knowledge.json`, original local session titled
  «ТЗ: Clinical Knowledge модуль» (OpenCode v1.19.3, v0.1 → v0.6).
  **Contains sensitive operational logs and secret-looking credential values; DO NOT commit, distribute or paste its raw contents.**
- Two distinct components:
  **Clinical Knowledge** = clinical reference library (Vidal awaiting licence, Russian guidance corpus,
  synthetic demo cases, published case metadata, review queue, module-specific Support/Health catalogs).
  **Clinical Longitudinal** = authorized timeline of a specific patient's own Support/Health history,
  diagnoses, medications, observations, corrections and immutable order versions.
- Source Knowledge branch: `feature/clinical-knowledge-test`, last confirmed GitHub SHA
  `629cfa5910e2c835f539bdbd578a7ae385db20b1`.
- Source Longitudinal branch: `feature/clinical-longitudinal-v01` (independently evolving).
- Earlier `feature/clinical-knowledge-integration` was described by OpenCode as a **local-only branch**,
  NOT present among GitHub remote branches at the time of this audit. Do not assume its claimed
  cherry-picks, merge resolutions or tests were pushed.
- Canonical permanent testing DB: **Tochka-Opori-Preview-Test** `eehyehlhiyztciaezaus`.
- Former isolation/lab DB: `tochka-opori-clinical-iso` `bgkpzzusmioiouxhqfdl`.
- Production DB `blwogrdezfhprdpdnxtn` and `main` are out of scope.

## Completed: target database
- Existing Preview-Test contains full Support/Health medical tables and C2 medication RPCs, plus
  the previously applied `clinical_medication_archive.order_history` and tested atomic wrappers.
- Applied additive migration `scripts/070-clinical-knowledge-preview-schema-only.sql`
  **only** to Preview-Test, adding `public.published_clinical_cases` and
  `public.clinical_review_log`. Existing patient data and existing tables were not changed.
- RLS denies anon/authenticated access to the new tables; reviewer decisions have update/delete/
  truncate blocking triggers. No `approve_published_case` function installed (requires review).
- Copied exactly 12 records from `clinical_knowledge_cases`, each pre-verified to have source
  «Синтетический демонстрационный случай» and usage rights
  «Только для тестирования и демонстрации.» The target was empty before copy.
- Copied exactly 8 bibliographic publication cases from iso, **only** those in `pending_review`
  with `source_verified=false`, `rights_verified=false`, unique DOI and nonempty source URL.
  Kept them unverified; removed any source `submitted_by_expert_id` foreign references to prevent
  copying or leaking isolated test expert identities. No publication became approved.
- Imported **zero** patient sessions, live expert accounts, specialist session hashes, test login
  codes, clinical review logs, billing ledgers, or production records.
- `scripts/071-clinical-knowledge-shared-preview-smoke.sql` ran with ROLLBACK:
  12 synthetic cases, 8 pending publications, 0 approved, 0 target review-log records;
  unverified approval rejected by the database CHECK constraint.

## Completed: versioned source code
- New GitHub feature branch `feature/clinical-consolidation-preview` created from current `main`.
- Preserved Clinical Knowledge v0.6 `lib/clinical/knowledge/*` providers and service, three
  standalone React pages, and source unit/DB test files **without overwriting** current
  `src/App.jsx`, `src/pages/specialist/SpecialistCabinet.jsx`, Support/Health APIs or
  `vercel.json`.
- Added `api/clinical-knowledge.js` from source with **default-closed** server guard:
  `CLINICAL_KNOWLEDGE_ENABLED !== 'true'` or `MEDICAL_STAGING_NO_PATIENT_DATA='true'`
  => HTTP 503 `CLINICAL_KNOWLEDGE_DISABLED`.
- This copied module is **not yet merged into main, not enabled in Preview, not deployed,
  and has not passed fresh end-to-end tests in the current main branch**.

## Still required: do not delete Clinical-ISO yet
1. Audit compatibility of v0.6 reviewer roles, active organization memberships,
   module allowlists and server-side session authentication with the current Support/Health
   expert schema. Source API must not silently fall back to memory/demo records on DB errors.
2. Implement and transaction-test authorization of review approval, version locking,
   idempotency and source/rights verification for the new Preview schema.
   Avoid copying old SQL 049-052 mechanically; earlier SQL had unsafe intermediate versions.
3. Preserve/port laboratory-only `clinical_internal` outbox, revision and
   `clinical_support_lab` behaviors from Longitudinal **without attaching unreviewed
   triggers to live Preview patient tables**.
4. Assess `clinical_contributions` and contribution accounting separately; they exist in
   Clinical-ISO and have not been transferred yet.
5. Reconcile source iso's **5 expert-review log records** (test provenance), 15 rejected
   publications and other lab-only records. Do not copy reviewer accounts, session tokens,
   demo passwords or fake clinical approvals into the shared app.
6. Integrate CK screens into the unified specialist cabinet, preserve existing Support,
   Health, voice and Vercel serverless routing, and run complete functional and browser E2E.
7. Keep Vidal `awaiting_license`, clinical recommendations source-labeled,
   `CLINICAL_KNOWLEDGE_ENABLED` false, and all real charges disabled until explicit testing
   and approvals. Protect demo vs real published cases and per-module catalogs.
8. Inventory and verify all resources, secure archival/backup and rotate any credential
   exposed in historical development session logs as appropriate. Only then separately
   authorize deletion of the extra Supabase project and confirm billing cessation.

## Standing infrastructure rule
Exactly one permanent production Supabase project plus one permanent shared test Supabase
project. New paid projects only when an exception is justified and pre-approved.
Do NOT auto-merge production data with synthetic fixtures or raw research metadata.
