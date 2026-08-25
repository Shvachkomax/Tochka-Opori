# Clinical Data Layer C1

## Purpose

C1 adds a structured, longitudinal clinical projection layer beside the existing operational product. Existing sessions, diaries, service requests, specialist actions, wallets, and assignments remain canonical for current behavior.

The long-term model is state -> observation -> clinician decision -> intervention -> follow-up -> outcome. C1 establishes the storage and provenance boundary for that model; it does not create a knowledge, cohort, or intelligence layer.

## Layers

- Operational layer: current Support, Health, specialist, request, wallet, and linking tables.
- Structured clinical layer: `clinical_events`, `clinical_observations`, `clinician_decisions`, and `clinical_outcomes`.
- Future knowledge layer: de-identified validated episodes and cohort analytics, not implemented in C1.

## C1 Entities

- `clinical_events` is the canonical longitudinal timeline. It stores module and owner scope, organization/expert context, source identity, provenance, validation status, confidence, quality level, and a small JSON payload.
- `clinical_observations` stores one structured numeric, text, or boolean value linked optionally to an event. It does not add domain-specific columns.
- `clinician_decisions` stores explicit specialist decisions, including rationale, follow-up plan, status, and superseding decision reference.
- `clinical_outcomes` stores follow-up evidence linked to a decision and/or assessment event. Completion of a service request is not an outcome.

All four tables enforce Support/Body owner scope and retain `organization_id` where known. `owner_type + owner_id` is intentionally polymorphic: Support uses `anonymous_case`, Body uses `anonymous_profile`, and future owner types may be added. There is no universal owner FK because operational owner records live in different source structures. The pair is the logical clinical subject identity within a module, not a missing relational constraint.

## Provenance and Validation

Provenance is mandatory and distinguishes patient-reported information from clinician confirmation and AI extraction. A rejected AI extraction remains stored with `validation_status = rejected`.

Validation statuses are `unreviewed`, `ai_structured`, `clinician_reviewed`, `clinician_confirmed`, and `rejected`. Quality levels reserve L0 through L5 for future workflow promotion. C1 never assigns clinician-confirmed or high quality status automatically.

## Projection Architecture

`lib/clinical/projection.js` provides validated server-side writers. Projection calls run with the existing backend service-role client and are never exposed to browser clients. A projection failure is logged under `[clinical-projection]` with operation, module, event/source type, a short identity fingerprint, and an error code. It returns no clinical row and does not fail the operational request, diary save, session finalization, or specialist action.

C1 projection points are:

- Support durable final report: `session_completed`.
- Health diary persistence: `diary_entry`.
- Support and Body service request creation: `service_request_created`.
- Specialist, admin, and client transition paths: `service_request_status_changed`.

The Health diary projection uses the canonical `body_clients` owner registry. C1 does not extract observations from free text or AI output. Structured diary values are intentionally deferred until their ownership and revision semantics are explicit.

Operational mutation success plus Clinical projection failure is a known C1 tradeoff. The Clinical Layer is eventually reconcilable, not transactionally atomic with operational storage.

## Idempotency and History

Clinical events use a unique projection identity of `(source_type, source_id, event_type, source_event_key)`, with NULLs treated as equal. `source_type + source_id + source_event_key` are provenance pointers, not universal foreign keys. `source_id` is intentionally `text` because source identifiers are heterogeneous: they may be UUID row IDs, session identifiers, or other stable operational identifiers. Source keys are deterministic:

- final Support report: stable report request identity;
- diary entry: daily-log row plus log date;
- request creation: `created`;
- request transition: the real `from_status->to_status` transition.

Retries insert no duplicate event and never overwrite an existing event. Real state changes receive separate transition keys. Corrections and superseding decisions are additive; normal APIs do not hard-delete clinical records.

## Time Semantics

- `occurred_at`: when the underlying clinical or operational event happened.
- `recorded_at`: when the source system recorded or became aware of it.
- `created_at`: when the Clinical Layer row was inserted.

No ordering constraint is imposed between these timestamps. Delayed documentation and imported observations can be legitimate; chronology quality belongs to a later validation layer.

## Decisions and Outcomes

The C1 schema supports clinician decisions and later outcomes, but no automatic decision or outcome population is enabled. Technical request transitions are not assumed to be clinical decisions, and request completion is not fabricated as outcome evidence.

## Security and Tenant Boundaries

All clinical tables use RLS with default deny and revoke direct table access from `PUBLIC`, `anon`, and `authenticated`. Only the backend `service_role` receives table grants. No client-facing clinical-table API is introduced. Module and owner checks prevent Support/Body scope mixing, while nullable organization context is preserved instead of inferred.

## Future Medication Boundary

C2 must require an explicit clinician medication order before patient-facing AI can discuss that specific medication, its approved schedule, adherence, effects, or possible adverse effects. AI must not independently start, change, stop, substitute, or override medication treatment.

## C1 Non-Goals

C1 migrations are additive and forward-only. Normal rollback must not drop Clinical Layer tables after real history exists. Application projection code may be disabled while accumulated records are preserved; destructive schema rollback requires explicit reviewed operator action.

C1 does not implement medication orders or exposures, adverse-event workflows, clinical or knowledge episodes, de-identification, contributions, cohorts, benchmarking, Clinical Intelligence, automatic treatment recommendations, model training, or historical backfill. Existing operational history is not projected retroactively.
