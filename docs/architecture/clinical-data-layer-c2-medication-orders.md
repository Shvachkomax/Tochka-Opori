# Clinical Data Layer C2 v0.1

## Scope

C2 v0.1 adds the medication order foundation only. It supports the `support` schema/runtime path and keeps `body` schema-compatible but runtime-disabled. C2.1 owns exposures, adherence, effects, adverse events, conditional protocols, interaction checking, active medication AI, episodes, cohorts, and Clinical Intelligence.

The patient medication AI flag is hard-disabled in C2 v0.1. A valid order or stored safe permission never exposes medication context to a patient AI model.

## Medication Identity

`medication_concepts` is a small curated internal catalog scoped to jurisdiction `RU`. Patients, specialists and AI cannot create concepts. Specialists select an active catalog concept; the order stores a display snapshot.

`medication_concept_ingredients` preserves normalized active-ingredient membership, including combination concepts. External catalog integration and a large seed list are deferred.

## Clinician Authority

Prescribing capability is represented by `clinician_medication_authorizations`. It requires an expert, organization or private-practice context, jurisdiction, `prescribe_medications` scope, validity dates, manual verification provenance and revocation state.

Authority is never inferred from `role`, `specialty`, `allowed_modules`, organization membership, service request ownership or display name. Existing experts are not backfilled.

## Immutable Orders

Each `medication_orders` row is one immutable order version. `order_group_id` groups a treatment lineage; `version_number` is monotonic; `supersedes_order_id` points to the immediate prior version.

Clinically meaningful change creates a new version. Existing order, schedule, lifecycle and permission rows are never updated or deleted. A unique successor index prevents two successors of one version.

Order state is derived from lifecycle events and validity:

```text
ACTIVE -> SUPERSEDED
ACTIVE -> REVOKED
ACTIVE -> COMPLETED
ACTIVE -> EXPIRED (derived from valid_until)
```

Terminal states cannot reopen.

## Schedule

`medication_order_schedules` stores clinician-authored deterministic phases. C2 v0.1 supports fixed dosing and deterministic titration with the approved frequency vocabulary:

- `once_daily`
- `twice_daily`
- `three_times_daily`
- `every_other_day`
- `weekly`

Only the final phase may be open-ended. Earlier phases must have an end; phases must be sequential, contiguous and non-overlapping. Validation is performed inside the atomic RPC transaction under the order-group lock. No GiST extension is required.

PRN, `as_directed`, conditional dosing, complex split dosing, patient-driven dose changes and AI-controlled transitions are rejected or deferred.

## AI Permissions

`medication_ai_permissions` is an append-only grant/revoke event table. It accepts only positive safe capabilities:

- `view_authorized_order`
- `explain_authorized_order`
- `show_authorized_schedule`
- `remind_authorized_schedule`
- `prepare_question_for_clinician`

There are no negative capability rows. Dose changes, stopping, switching, substitution, recommendation, titration and instruction override are globally unavailable to patient AI.

Permissions bind to an exact order version. They do not inherit across supersession. Revoked permissions cannot be reactivated on the same version.

## Transactions and RPCs

Medication mutations are fail-closed and use narrowly scoped `SECURITY INVOKER` RPCs called only by backend `service_role`:

- `activate_medication_order`
- `supersede_medication_order`
- `revoke_medication_order`

The RPCs validate authorization, assignment, organization context, catalog, order fields, schedule phases and safe permissions, then insert the complete aggregate in one transaction. Any failure rolls back the order, schedules, decision, lifecycle events, permissions and clinical events.

The current repository exposes backend RPCs in `public`; direct execute is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`. The functions are not `SECURITY DEFINER`.

## Clinical Integration

C2 creates only these clinical events:

- `medication_order_activated`
- `medication_order_superseded`
- `medication_order_revoked`

Each event carries the existing owner/module/organization/expert scope and uses `clinician_ordered` provenance. Activation, supersession and revocation also create explicit C1 clinician decisions.

Medication plans are not exposures, effects or outcomes. No `clinical_outcomes` row is fabricated by order activation.

## APIs and UX

Specialist Support actions:

- `listMedicationConcepts`
- `listPatientMedicationOrders`
- `getMedicationOrder`
- `createMedicationOrder`
- `supersedeMedicationOrder`
- `revokeMedicationOrder`

The server derives owner, expert and authorization identity. Browser-supplied owner, expert or authorization IDs are not trusted.

Patients receive a read-only `getMedicationCard` response. They cannot edit, revoke, replace or grant permissions for an order. A legacy session/access token is insufficient for medication data; the patient card requires a non-legacy validated session token. Legacy sessions cannot be upgraded through the unauthenticated access-token endpoint.

Specialist medication reads are separate from prescribing authority. A specialist may read an assigned patient's medication history when the existing specialist session, module entitlement, patient assignment/access and organization/private-practice context are valid. Verified medication authority is required only for clinical order mutations and safe permission grants. `service_requests.specialist_id` never authorizes medication access.

Body prescribing has no v0.1 API or UI. Its schema remains compatible, but runtime returns disabled/not-supported behavior.

## Security

All C2 tables use RLS and service-role-only ACLs. No direct browser table access exists. Patient access uses validated continuation/session credentials; medication card access additionally requires `legacy_access = false`. Specialist access requires active specialist session, Support entitlement, assignment/access and matching context; prescribing mutations additionally require verified RU medication authority. Historical unrelated cabinet flows retain their legacy compatibility.

Patient AI medication context is not loaded in C2 v0.1. The feature-disabled gate occurs before any model call.

## Idempotency

Create and supersede operations use owner scope plus `creation_idempotency_key`. The database computes `order_hash` from the normalized immutable payload, authority, decision, permissions and canonical schedule. Revoke lifecycle events use a semantic `command_hash` including the target and revoke reason. Same key and same hash replay the existing result; same key with a different hash conflicts.

Lifecycle and permission event identities include their order, event/capability and idempotency key. Retries do not create duplicate clinical records. Advisory transaction locks make same-key concurrent mutation retries deterministic.

For a finite order, an open-ended final phase is capped in read DTOs by `valid_until`; a finite phase cannot extend beyond or leave a gap before the order validity end. An indefinite order must retain an open-ended final phase. The resolver exposes only deny/safe-capability state and never returns the internal order or authorization object.

## Explicit Non-Goals

C2 v0.1 does not record actual medication exposure, adherence, treatment effects or adverse events. It does not execute protocols, change doses, recommend medication, reconcile external medication lists, check interactions, or train models. These require a separate C2.1 clinical safety review.
