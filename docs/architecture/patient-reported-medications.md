# Patient-Reported Medication Orders

## Scope

`patient_medication_orders` stores a patient's report of an existing physician-prescribed medication or physician-recommended supplement. It is not an electronic prescription and does not verify who issued the recommendation. It remains separate from immutable clinician-authored `medication_orders`.

The database owner scope is the project's current anonymous identity pair:

- Health: `anonymous_profile` + `owner_id`, `source_module = health`.
- Support: `anonymous_case` + `owner_id`, `source_module = support`.

These identities are not currently linked to one another. A record is visible in the module where it was entered; the system does not guess that two module owners represent the same person.

## Data and Access

- `patient_medication_orders` stores the reported item, dose, schedule, dates, patient/doctor comments and active/completed/paused/cancelled state.
- `medication_intake_logs` stores a separate patient-reported fact for an order/date/schedule slot. A missing log means no fact was recorded, not that a dose was missed.
- `patient_medication_order_events` is an append-only audit trail for creation and material edits, including dose, schedule and status changes. It stores changed field names, not old/new clinical values.
- All three tables have RLS enabled; client roles have no table privileges. Server APIs use the existing validated session/access-token model. Specialist reads additionally resolve the existing module entitlement and patient assignment/access; there is no specialist write path for patient-reported data.

Daily tasks are derived from active orders at read time. Concrete times and N-times-per-day schedules create slots. PRN and free-text schedules remain visible in the order list but do not fabricate timed tasks.

## AI and Reference Data

Health and Support quick-chat contexts may receive active patient-reported orders, recent intake facts and recent order-change metadata. Context provenance is explicit. A safety instruction prohibits the AI from starting, stopping or changing treatment and directs therapy-change questions to the treating clinician. This does not enable AI access to clinician-authored C2 orders, and it does not change Support triage.

`lib/clinical/medication-reference.js` defines the future reference-provider seam. It currently returns no drug facts and performs no network lookup. No medication mechanism, indication, adverse-effect or interaction claims are generated from model memory as verified reference data.

## Follow-Up

Cross-module sharing requires a separate explicit identity-linking/consent design. Any expansion from quick-chat context to Support triage, clinician-order AI discussion, drug references or clinical recommendations requires a dedicated safety review.
