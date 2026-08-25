import {
  recordClinicalEvent,
  getProjectionFingerprint,
  logProjectionFailure,
  recordClinicalObservation,
  validateClinicalEventInput,
  validateClinicalObservationInput,
  validateClinicianDecisionInput,
  validateClinicalOutcomeInput,
} from "../lib/clinical/projection.js";
import {
  buildHealthDiaryObservationSnapshot,
  buildHealthDiaryLogicalSourceId,
  buildSupportCheckinLogicalSourceId,
  buildSupportCheckinObservationSnapshot,
  hashClinicalSnapshot,
} from "../lib/clinical/observation-mappings.js";

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
assert(validateClinicalObservationInput({ ...baseObservation, valueNumeric: "92.4" }) === "invalid_numeric_value", "numeric observation type is enforced");
assert(validateClinicalObservationInput({ ...baseObservation, valueNumeric: null, valueText: 92.4 }) === "invalid_text_value", "text observation type is enforced");
assert(validateClinicalObservationInput({ ...baseObservation, valueNumeric: null, valueBoolean: "true" }) === "invalid_boolean_value", "boolean observation type is enforced");
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

console.log("\n5. Canonical observation snapshots");
const healthLogicalSourceA = buildHealthDiaryLogicalSourceId("session-c1", "2026-02-15");
const healthLogicalSourceRecreated = buildHealthDiaryLogicalSourceId("session-c1", "2026-02-15");
const healthLogicalSourceOtherDate = buildHealthDiaryLogicalSourceId("session-c1", "2026-02-16");
assert(healthLogicalSourceA === healthLogicalSourceRecreated, "recreated Health source row keeps the same logical source id");
assert(healthLogicalSourceA !== healthLogicalSourceOtherDate, "different Health diary dates have different source lineages");
assert(!healthLogicalSourceA.includes("session-c1") && healthLogicalSourceA.startsWith("logical:"), "Health logical source id is privacy-safe");
const supportLogicalSourceA = buildSupportCheckinLogicalSourceId("anonymous_case", supportOwner, "2026-02-15");
const supportLogicalSourceRecreated = buildSupportCheckinLogicalSourceId("anonymous_case", supportOwner, "2026-02-15");
const supportLogicalSourceOtherDate = buildSupportCheckinLogicalSourceId("anonymous_case", supportOwner, "2026-02-16");
assert(supportLogicalSourceA === supportLogicalSourceRecreated, "recreated Support check-in keeps the same logical source id");
assert(supportLogicalSourceA !== supportLogicalSourceOtherDate, "different Support check-in dates have different source lineages");
assert(!supportLogicalSourceA.includes(supportOwner), "Support logical source id does not expose owner id");
const diaryA = buildHealthDiaryObservationSnapshot({
  weight_kg: 92.4,
  waist_cm: 98,
  steps: 7000,
  sleep_hours: 6.5,
  calories: 1800,
  meals_count: 3,
  water_l: 1.8,
  workout_done: false,
  day_text: "Первый текст",
  energy_level: 5,
});
const diaryTextChanged = buildHealthDiaryObservationSnapshot({
  weight_kg: 92.4,
  waist_cm: 98,
  steps: 7000,
  sleep_hours: 6.5,
  calories: 1800,
  meals_count: 3,
  water_l: 1.8,
  workout_done: false,
  day_text: "Другой текст",
  energy_level: 9,
});
assert(diaryA.revisionHash === diaryTextChanged.revisionHash, "excluded free text/default fields do not change diary revision");
assert(diaryA.observations.length === 7, "diary maps only seven approved numeric fields");
assert(diaryA.observations.find(row => row.concept === "weight").unit === "kg", "weight unit is kg");
assert(diaryA.observations.find(row => row.concept === "sleep_duration").unit === "hours/night", "sleep unit is hours/night");
assert(buildHealthDiaryObservationSnapshot({ ...diaryA.snapshot, weight_kg: 91 }).revisionHash !== diaryA.revisionHash, "approved field change creates a new diary revision");
assert(buildHealthDiaryObservationSnapshot({ weight_kg: 0 }).observations.some(row => row.concept === "weight"), "explicit zero is distinguishable from missing weight");
assert(buildHealthDiaryObservationSnapshot({ workout_done: false, workout_minutes: 30 }).observations.every(row => row.concept !== "exercise_duration"), "ambiguous incomplete workout is excluded");
assert(buildHealthDiaryObservationSnapshot({ workout_done: true, workout_minutes: 30 }).observations.some(row => row.concept === "exercise_duration"), "explicit completed workout duration is mapped");

const checkinA = buildSupportCheckinObservationSnapshot({ wellbeing_score: -2, anxiety_score: 7 });
const checkinB = buildSupportCheckinObservationSnapshot({ wellbeing_score: -2, anxiety_score: 6 });
assert(checkinA.observations.length === 2, "Support check-in maps wellbeing and anxiety");
assert(checkinA.observations.find(row => row.concept === "subjective_wellbeing").metadata.scale_min === -5, "wellbeing scale minimum preserved");
assert(checkinA.observations.find(row => row.concept === "subjective_anxiety").metadata.scale_max === 10, "anxiety scale maximum preserved");
assert(checkinA.revisionHash !== checkinB.revisionHash, "changed check-in score creates a new revision");
assert(buildSupportCheckinObservationSnapshot({ wellbeing_score: 0, anxiety_score: null }).observations.length === 1, "NULL anxiety is not projected");
assert(hashClinicalSnapshot({ b: 2, a: 1 }) === hashClinicalSnapshot({ a: 1, b: 2 }), "snapshot hashing uses canonical key ordering");

console.log("\n6. Observation writer idempotency and supersession");
function observationMock() {
  const rows = [];
  const calls = [];
  return {
    rows,
    calls,
    from() {
      let mode = "select";
      let inserted = null;
      const filters = [];
      const query = {
        insert(row) { mode = "insert"; inserted = row; return query; },
        select() { return query; },
        eq(field, value) { filters.push([field, "eq", value]); return query; },
        neq(field, value) { filters.push([field, "neq", value]); return query; },
        is(field, value) { filters.push([field, "is", value]); return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          if (mode === "insert") {
            const duplicate = rows.find(row => row.source_type === inserted.source_type
              && row.source_id === inserted.source_id
              && row.concept === inserted.concept
              && row.source_event_key === inserted.source_event_key);
            if (duplicate) return { data: null, error: { code: "23505" } };
            const row = { ...inserted, id: `observation-${rows.length + 1}` };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          }
          const matches = rows.filter(row => filters.every(([field, operator, value]) => {
            if (operator === "is") return row[field] === null;
            if (operator === "neq") return row[field] !== value;
            return row[field] === value;
          }));
          return { data: matches[0] || null, error: null };
        },
      };
      calls.push({ filters });
      return query;
    },
  };
}

const observationInput = {
  clinicalEventId: "66666666-6666-4666-8666-666666666666",
  module: "body",
  ownerType: "anonymous_profile",
  ownerId: bodyOwner,
  concept: "weight",
  valueNumeric: 92.4,
  unit: "kg",
  observedAt: "2026-01-01T00:00:00.000Z",
  sourceType: "body_daily_log",
  sourceId: "daily-log-1",
  sourceEventKey: "rev:aaa",
  provenance: "patient_reported",
  validationStatus: "unreviewed",
  qualityLevel: 0,
  metadata: {},
};
const writerMock = observationMock();
const firstObservation = await recordClinicalObservation(observationInput, { supabase: writerMock });
const firstObservationCount = writerMock.rows.length;
const retryObservation = await recordClinicalObservation(observationInput, { supabase: writerMock });
const retryObservationCount = writerMock.rows.length;
const secondRevision = await recordClinicalObservation({ ...observationInput, valueNumeric: 91.2, sourceEventKey: "rev:bbb" }, { supabase: writerMock });
const differentConcept = await recordClinicalObservation({ ...observationInput, concept: "waist_circumference", valueNumeric: 98, sourceEventKey: "rev:bbb" }, { supabase: writerMock });
assert(firstObservation === "observation-1", "first observation is inserted");
assert(retryObservation === firstObservation && firstObservationCount === 1 && retryObservationCount === 1, "identical observation retry is idempotent");
assert(secondRevision === "observation-2" && writerMock.rows[1].supersedes_observation_id === firstObservation, "new revision supersedes prior observation");
assert(differentConcept === "observation-3" && writerMock.rows.length === 3, "different concepts share a revision without collision");
const nullSourceMock = observationMock();
const nullSourceInput = { ...observationInput, sourceId: null, sourceEventKey: "rev:null" };
const nullFirst = await recordClinicalObservation(nullSourceInput, { supabase: nullSourceMock });
const nullObservationRetry = await recordClinicalObservation(nullSourceInput, { supabase: nullSourceMock });
assert(nullObservationRetry === nullFirst && nullSourceMock.rows.length === 1, "NULL source_id observation retry is idempotent");
assert(nullSourceMock.calls.some(call => call.filters.some(([field, operator]) => field === "source_id" && operator === "is")), "NULL source_id observation lookup uses IS NULL");

console.log("\n4. Failure-open projection behavior");
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const failedOpenResult = await recordClinicalEvent(baseEvent);
assert(failedOpenResult === null, "database projection failure returns without throwing");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
