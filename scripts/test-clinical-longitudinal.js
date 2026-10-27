import assert from "node:assert/strict";
import {
  assembleLongitudinalEvents,
  buildLongitudinalSummary,
  loadLongitudinalFromSources,
  auditLongitudinalProjection,
} from "../lib/clinical/longitudinal.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-01T12:00:00.000Z";
const later = "2026-10-26T12:00:00.000Z";
const now = new Date("2026-10-27T12:00:00.000Z");
const assembled = assembleLongitudinalEvents({
  sessions: [{
    id: "session1", created_at: at, report_generation_status: "ready",
    care_recommendation: { level: "professional_contact" },
  }],
  medication_orders: [{
    id: "med1", issued_at: later, medication_name_snapshot: "Синтетический препарат А",
    strength_value: 25, strength_unit: "мг",
  }],
  patient_medication_orders: [{
    id: "patient-med1", created_at: at, name: "Указанный пациентом препарат",
    single_dose: 5, dose_unit: "мг", status: "active",
  }],
  clinician_decisions: [{
    id: "dec1", created_at: later, decision_type: "change_care_plan", status: "active",
    decision_text: "Не должен попадать в структурированную выдачу",
  }],
  clinical_outcomes: [{
    id: "out1", assessed_at: later, direction: "unknown",
    provenance: "patient_reported", validation_status: "unreviewed",
    baseline_value: 8, followup_value: 5,
  }],
}, "support", now);
assert.equal(assembled.events.length, 5);
assert(assembled.events.some(x => x.provenance === "clinician_ordered" && x.type === "medication_prescribed"));
assert(assembled.events.some(x => x.provenance === "patient_reported" && x.type === "medication_reported"));
assert(assembled.events.some(x => x.type === "clinical_outcome" && x.details.direction === "unknown"));
assert(!JSON.stringify(assembled.events).includes("Не должен попадать"));
assert.equal(assembled.summary.last_patient_contact_at, at);
assert.equal(assembled.summary.followup_data_status, "есть_недавние_сведения_от_пациента");
assert.equal(assembled.summary.treatment_effectiveness, "не_определена_автоматически");
assert.equal(
  buildLongitudinalSummary(assembled.events, new Date("2026-12-01T00:00:00Z")).followup_data_status,
  "нет_новых_сведений_от_пациента_30_дней",
);
const health = assembleLongitudinalEvents({
  body_daily_logs: [{
    id: "diary1", log_date: "2026-10-02", created_at: later, weight_kg: 68.5,
    sleep_hours: 8, mood_level: 4, patient_note: "Скрытое свободное описание",
  }],
}, "body", now);
assert.equal(health.events[0].at, "2026-10-02T00:00:00.000Z");
assert.equal(health.events[0].details.weight_kg, 68.5);
assert(!JSON.stringify(health.events).includes("Скрытое"));

// Fake database lets us inspect the exact owner/organization filters without PHI.
function fakeDb(tables, requests) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (key, value) => { filters.push([key, "eq", value]); return q; },
        is: (key, value) => { filters.push([key, "is", value]); return q; },
        in: (key, values) => { filters.push([key, "in", values]); return q; },
        order: () => q,
        limit: () => q,
        then(resolve, reject) {
          requests.push({ table, filters });
          const result = tables[table] || { data: [] };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return q;
    },
  };
}
const queries = [];
const fake = fakeDb({
  clinical_events: { data: [{ id: "evt1", event_type: "checkin_recorded", occurred_at: at,
    provenance: "patient_reported", validation_status: "unreviewed" }] },
  sessions: { data: [{ id: "s1", created_at: at, report_generation_status: "ready" }] },
}, queries);
const timeline = await loadLongitudinalFromSources({
  supabase: fake, module: "support", ownerType: "anonymous_case", ownerId,
  organizationId: null, now,
});
assert.equal(timeline.coverage.complete, true);
assert.equal(timeline.read_only, true);
assert.equal(timeline.research_export_allowed, false);
for (const r of queries) {
  if (r.table === "sessions") {
    assert(r.filters.some(x => x[0] === "anonymous_owner_id" && x[2] === ownerId));
  } else {
    assert(r.filters.some(x => x[0] === "owner_id" && x[2] === ownerId),
      `Unscoped query: ${r.table}`);
    assert(r.filters.some(x => x[0] === "owner_type" && x[2] === "anonymous_case"),
      `Missing owner type: ${r.table}`);
  }
}
for (const name of ["clinical_events", "clinical_observations", "clinical_outcomes",
  "clinician_decisions", "service_requests", "medication_orders"]) {
  const q = queries.find(x => x.table === name);
  assert(q?.filters.some(x => x[0] === "organization_id" && x[1] === "is" && x[2] === null),
    `Missing private-practice isolation: ${name}`);
}
await assert.rejects(
  () => loadLongitudinalFromSources({ supabase: fake, module: "support",
    ownerType: "anonymous_case", ownerId, organizationId: orgId }),
  /контексте организации/,
);
const revisions = assembleLongitudinalEvents({
  clinical_observations: [
    { id: "o1", observed_at: at, concept: "weight", value_numeric: 69,
      provenance: "patient_reported" },
    { id: "o2", observed_at: at, concept: "weight", value_numeric: 68.5,
      supersedes_observation_id: "o1", provenance: "patient_reported" },
  ],
}, "body", now);
assert.equal(revisions.events.find(e => e.details.value_numeric === 69)?.details.superseded_by_newer_record, true);
assert.equal(revisions.events.find(e => e.details.value_numeric === 68.5)?.details.superseded_by_newer_record, false);
const audit = auditLongitudinalProjection({
  clinical_events: [{ source_type: "service_request", source_id: "req-1",
    event_type: "service_request_created" }],
  service_requests: [{ id: "req-1", created_at: at }, { id: "req-2", created_at: at }],
  medication_orders: [{ id: "med-1", clinical_event_id: null }],
});
assert.equal(audit.missing_projection_count, 2);
assert(audit.reconciliation_required);
assert(!JSON.stringify(audit).includes("req-2"));

await assert.rejects(
  () => loadLongitudinalFromSources({ supabase: fake, module: "support",
    ownerType: "anonymous_profile", ownerId, organizationId: orgId }),
  /Некорректный контекст/,
);
const fails = await loadLongitudinalFromSources({
  supabase: fakeDb({ clinical_outcomes: { data: null, error: { code: "missing_table" } } }, []),
  module: "support", ownerType: "anonymous_case", ownerId, organizationId: orgId, now,
});
assert.equal(fails.coverage.complete, false);
assert(fails.coverage.unavailable_sources.includes("clinical_outcomes"));
console.log("clinical longitudinal: synthetic checks passed; read-only and tenant safe");
