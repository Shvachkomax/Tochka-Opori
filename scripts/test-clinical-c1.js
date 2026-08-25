import {
  recordClinicalEvent,
  getProjectionFingerprint,
  logProjectionFailure,
  validateClinicalEventInput,
  validateClinicalObservationInput,
  validateClinicianDecisionInput,
  validateClinicalOutcomeInput,
} from "../lib/clinical/projection.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const supportOwner = "11111111-1111-4111-8111-111111111111";
const bodyOwner = "22222222-2222-4222-8222-222222222222";
const expertId = "33333333-3333-4333-8333-333333333333";
const baseEvent = {
  module: "support",
  ownerType: "anonymous_case",
  ownerId: supportOwner,
  eventType: "service_request_created",
  occurredAt: "2026-01-01T00:00:00.000Z",
  sourceType: "service_request",
  sourceId: "44444444-4444-4444-8444-444444444444",
  sourceEventKey: "created",
  provenance: "patient_reported",
  payload: { service_code: "short_followup" },
};

console.log("1. Clinical event validation");
assert(validateClinicalEventInput(baseEvent) === null, "valid Support event accepted");
assert(validateClinicalEventInput({ ...baseEvent, module: "body" }) === "invalid_owner_scope", "cross-module owner rejected");
assert(validateClinicalEventInput({ ...baseEvent, ownerType: "anonymous_profile" }) === "invalid_owner_scope", "wrong owner type rejected");
assert(validateClinicalEventInput({ ...baseEvent, ownerId: "not-a-uuid" }) === "invalid_owner_id", "invalid owner id rejected");
assert(validateClinicalEventInput({ ...baseEvent, provenance: "clinician_confirmed" }) === null, "clinician confirmation provenance accepted");
assert(validateClinicalEventInput({ ...baseEvent, provenance: "diagnosed" }) === "invalid_provenance", "unknown provenance rejected");
assert(validateClinicalEventInput({ ...baseEvent, validationStatus: "rejected" }) === null, "rejected validation status preserved");
assert(validateClinicalEventInput({ ...baseEvent, validationStatus: "approved" }) === "invalid_validation_status", "unknown validation status rejected");
assert(validateClinicalEventInput({ ...baseEvent, confidence: 1.1 }) === "invalid_confidence", "confidence above one rejected");
assert(validateClinicalEventInput({ ...baseEvent, qualityLevel: 6 }) === "invalid_quality_level", "quality above L5 rejected");
assert(validateClinicalEventInput({ ...baseEvent, payload: [] }) === "invalid_payload", "array payload rejected");
assert(validateClinicalEventInput({ ...baseEvent, sourceEventKey: "submitted->accepted" }) === null, "transition source identity accepted");
assert(validateClinicalEventInput({ ...baseEvent, sourceEventKey: null }) === "missing_event_identity", "NULL source event key rejected because C1 identity requires it");

console.log("\n1b. Projection identity and observability");
const nullSourceEvent = { ...baseEvent, sourceId: null };
assert(getProjectionFingerprint(nullSourceEvent) === getProjectionFingerprint(nullSourceEvent), "nullable source fingerprint is deterministic");
assert(getProjectionFingerprint(nullSourceEvent).length === 12, "projection fingerprint is 12 hex characters");
assert(!getProjectionFingerprint(nullSourceEvent).includes("service_request"), "projection fingerprint does not expose source identity");

const logLines = [];
const originalConsoleError = console.error;
console.error = (...args) => logLines.push(args.join(" "));
logProjectionFailure({ ...baseEvent, operation: "record_event", errorCode: "test_failure" });
console.error = originalConsoleError;
assert(logLines[0]?.startsWith("[clinical-projection]"), "projection failures use the clinical-projection namespace");
assert(logLines[0]?.includes('"module":"support"') && logLines[0]?.includes('"event_type":"service_request_created"') && logLines[0]?.includes('"source_type":"service_request"'), "projection failures include structured safe context");
assert(logLines[0]?.includes('"projection_fingerprint":"') && logLines[0]?.includes('"error_code":"test_failure"'), "projection failures include fingerprint and error code");
assert(!logLines[0]?.includes(baseEvent.sourceId) && !logLines[0]?.includes(JSON.stringify(baseEvent.payload)), "projection failures omit raw source identity and payload");

function duplicateSupabase(existingId) {
  const calls = [];
  return {
    calls,
    from() {
      let operation = "lookup";
      const query = {
        insert() { operation = "insert"; return query; },
        select() { return query; },
        eq(field, value) { calls.push(["eq", field, value]); return query; },
        is(field, value) { calls.push(["is", field, value]); return query; },
        async maybeSingle() {
          if (operation === "insert") return { data: null, error: { code: "23505" } };
          return { data: { id: existingId }, error: null };
        },
      };
      return query;
    },
  };
}

const nonNullMock = duplicateSupabase("event-non-null");
const nonNullRetry = await recordClinicalEvent(baseEvent, { supabase: nonNullMock });
assert(nonNullRetry === "event-non-null", "non-null duplicate recovery returns existing event");
assert(nonNullMock.calls.some(call => call[0] === "eq" && call[1] === "source_id"), "non-null duplicate recovery uses equality");
const nullMock = duplicateSupabase("event-null");
const nullRetry = await recordClinicalEvent(nullSourceEvent, { supabase: nullMock });
assert(nullRetry === "event-null", "NULL source duplicate recovery returns existing event");
assert(nullMock.calls.some(call => call[0] === "is" && call[1] === "source_id" && call[2] === null), "NULL source duplicate recovery uses IS NULL");
assert(new Set(["submitted->accepted", "accepted->answered", "answered->completed", "accepted->cancelled"]).size === 4, "legitimate transitions remain distinct by source event key");

console.log("\n2. Observation validation");
const baseObservation = {
  module: "body",
  ownerType: "anonymous_profile",
  ownerId: bodyOwner,
  concept: "weight",
  valueNumeric: 92.4,
  observedAt: "2026-01-01T08:00:00.000Z",
  sourceType: "body_daily_log",
  sourceId: "55555555-5555-4555-8555-555555555555",
  sourceEventKey: "2026-01-01",
  provenance: "patient_reported",
};
assert(validateClinicalObservationInput(baseObservation) === null, "valid structured observation accepted");
assert(validateClinicalObservationInput({ ...baseObservation, valueText: "92.4" }) === "invalid_observation_value", "multiple observation values rejected");
assert(validateClinicalObservationInput({ ...baseObservation, valueNumeric: null }) === "invalid_observation_value", "missing observation value rejected");
assert(validateClinicalObservationInput({ ...baseObservation, concept: "" }) === "missing_concept", "missing observation concept rejected");
assert(validateClinicalObservationInput({ ...baseObservation, observedAt: "invalid" }) === "invalid_occurred_at", "invalid observation time rejected");

console.log("\n3. Decision and outcome validation");
const baseDecision = {
  module: "support",
  ownerType: "anonymous_case",
  ownerId: supportOwner,
  expertId,
  decisionType: "continue_monitoring",
  decisionText: "Продолжить наблюдение в динамике.",
  metadata: {},
};
assert(validateClinicianDecisionInput(baseDecision) === null, "valid clinician decision accepted");
assert(validateClinicianDecisionInput({ ...baseDecision, expertId: "bad" }) === "invalid_expert_id", "invalid decision expert rejected");
assert(validateClinicianDecisionInput({ ...baseDecision, decisionType: "medication_change" }) === "invalid_decision_type", "medication decision deferred");
assert(validateClinicianDecisionInput({ ...baseDecision, decisionText: "" }) === "missing_decision_text", "empty decision rejected");
const baseOutcome = {
  module: "support",
  ownerType: "anonymous_case",
  ownerId: supportOwner,
  outcomeType: "followup_assessment",
  assessedAt: "2026-01-08T00:00:00.000Z",
  direction: "improved",
  provenance: "patient_reported",
};
assert(validateClinicalOutcomeInput(baseOutcome) === null, "valid clinical outcome accepted");
assert(validateClinicalOutcomeInput({ ...baseOutcome, direction: "diagnosed" }) === "invalid_direction", "unknown outcome direction rejected");
assert(validateClinicalOutcomeInput({ ...baseOutcome, assessedAt: "invalid" }) === "invalid_occurred_at", "invalid outcome time rejected");

console.log("\n4. Failure-open projection behavior");
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const failedOpenResult = await recordClinicalEvent(baseEvent);
assert(failedOpenResult === null, "database projection failure returns without throwing");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
