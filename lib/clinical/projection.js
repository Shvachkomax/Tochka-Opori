import crypto from "node:crypto";
import { getSupabase } from "../supabase.js";

const OWNER_TYPES = {
  support: "anonymous_case",
  body: "anonymous_profile",
};

const PROVENANCE = new Set([
  "patient_reported",
  "clinician_entered",
  "clinician_ordered",
  "device_measured",
  "lab_result",
  "ai_extracted",
  "ai_inferred",
  "clinician_confirmed",
  "system_generated",
]);

const VALIDATION_STATUSES = new Set([
  "unreviewed",
  "ai_structured",
  "clinician_reviewed",
  "clinician_confirmed",
  "rejected",
]);

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getProjectionFingerprint({ module, sourceType, sourceId, eventType, sourceEventKey } = {}) {
  const identity = [
    module || "unknown",
    sourceType || "unknown",
    sourceId ?? "null",
    eventType || "unknown",
    sourceEventKey ?? "null",
  ].join("|");
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

export function logProjectionFailure({
  operation,
  module,
  eventType,
  sourceType,
  sourceId,
  sourceEventKey,
  errorCode,
}) {
  console.error("[clinical-projection]", JSON.stringify({
    operation,
    module: module || null,
    event_type: eventType || null,
    source_type: sourceType || null,
    projection_fingerprint: getProjectionFingerprint({ module, sourceType, sourceId, eventType, sourceEventKey }),
    error_code: errorCode || "unknown",
  }));
}

export function validateClinicalEventInput(input = {}) {
  const {
    module,
    ownerType,
    ownerId,
    eventType,
    occurredAt,
    sourceType,
    sourceId,
    sourceEventKey,
    provenance,
    confidence,
    validationStatus = "unreviewed",
    qualityLevel,
    payload = {},
  } = input;

  if (!Object.hasOwn(OWNER_TYPES, module) || OWNER_TYPES[module] !== ownerType) return "invalid_owner_scope";
  if (!isUuid(ownerId)) return "invalid_owner_id";
  if (typeof eventType !== "string" || !eventType.trim() || typeof sourceType !== "string" || !sourceType.trim() || typeof sourceEventKey !== "string" || !sourceEventKey.trim()) return "missing_event_identity";
  if (sourceId !== null && sourceId !== undefined && typeof sourceId !== "string") return "invalid_source_id";
  if (!PROVENANCE.has(provenance)) return "invalid_provenance";
  if (!VALIDATION_STATUSES.has(validationStatus)) return "invalid_validation_status";
  if (confidence !== null && confidence !== undefined && (typeof confidence !== "number" || confidence < 0 || confidence > 1)) return "invalid_confidence";
  if (qualityLevel !== null && qualityLevel !== undefined && (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 5)) return "invalid_quality_level";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid_payload";
  if (occurredAt && Number.isNaN(new Date(occurredAt).getTime())) return "invalid_occurred_at";
  return null;
}

export async function recordClinicalEvent(input = {}, { supabase: injectedSupabase } = {}) {
  const validationError = validateClinicalEventInput(input);
  if (validationError) {
    logProjectionFailure({ ...input, operation: "record_event", errorCode: validationError });
    return null;
  }

  const {
    module,
    ownerType,
    ownerId,
    organizationId = null,
    expertId = null,
    eventType,
    occurredAt = new Date().toISOString(),
    recordedAt = new Date().toISOString(),
    sourceType,
    sourceId = null,
    sourceEventKey,
    provenance,
    confidence = null,
    validationStatus = "unreviewed",
    qualityLevel = null,
    payload = {},
  } = input;

  const row = {
    module,
    owner_type: ownerType,
    owner_id: ownerId,
    organization_id: organizationId,
    expert_id: expertId,
    event_type: eventType,
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    source_type: sourceType,
    source_id: sourceId,
    source_event_key: sourceEventKey,
    provenance,
    confidence,
    validation_status: validationStatus,
    quality_level: qualityLevel,
    payload,
  };

  try {
    const supabase = injectedSupabase || getSupabase();
    const { data, error } = await supabase
      .from("clinical_events")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (!error) return data?.id || null;

    if (error.code === "23505") {
      let lookup = supabase
        .from("clinical_events")
        .select("id")
        .eq("source_type", sourceType)
        .eq("event_type", eventType)
        .eq("source_event_key", sourceEventKey);
      lookup = sourceId === null ? lookup.is("source_id", null) : lookup.eq("source_id", sourceId);
      const { data: existing, error: lookupError } = await lookup.maybeSingle();
      if (!lookupError && existing?.id) return existing.id;
      logProjectionFailure({ ...input, operation: "duplicate_recovery", errorCode: lookupError?.code || "not_found" });
    }

    logProjectionFailure({ ...input, operation: "record_event", errorCode: error.code || "insert_failed" });
    return null;
  } catch (error) {
    logProjectionFailure({ ...input, operation: "record_event", errorCode: error.code || error.name || "exception" });
    return null;
  }
}

export async function recordClinicalObservation(input = {}, { supabase: injectedSupabase } = {}) {
  try {
    const validationError = validateClinicalObservationInput(input);
    if (validationError) {
      logProjectionFailure({ ...input, eventType: "observation", operation: "record_observation", errorCode: validationError });
      return null;
    }
    const supabase = injectedSupabase || getSupabase();
    let previousQuery = supabase
      .from("clinical_observations")
      .select("id")
      .eq("source_type", input.sourceType)
      .eq("concept", input.concept)
      .neq("source_event_key", input.sourceEventKey)
      .order("created_at", { ascending: false })
      .limit(1);
    previousQuery = input.sourceId === null || input.sourceId === undefined
      ? previousQuery.is("source_id", null)
      : previousQuery.eq("source_id", input.sourceId);
    const { data: previous, error: previousError } = await previousQuery.maybeSingle();
    if (previousError) {
      logProjectionFailure({ ...input, eventType: "observation", operation: "resolve_supersession", errorCode: previousError.code || "lookup_failed" });
      return null;
    }
    const row = {
      clinical_event_id: input.clinicalEventId ?? null,
      module: input.module,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      organization_id: input.organizationId ?? null,
      concept: input.concept,
      value_numeric: input.valueNumeric ?? null,
      value_text: input.valueText ?? null,
      value_boolean: input.valueBoolean ?? null,
      unit: input.unit ?? null,
      severity: input.severity ?? null,
      observed_at: input.observedAt,
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      source_event_key: input.sourceEventKey,
      supersedes_observation_id: input.supersedesObservationId ?? previous?.id ?? null,
      provenance: input.provenance,
      confidence: input.confidence ?? null,
      validation_status: input.validationStatus || "unreviewed",
      quality_level: input.qualityLevel ?? null,
      metadata: input.metadata || {},
    };
      const { data, error } = await supabase
        .from("clinical_observations")
        .insert(row)
      .select("id")
      .maybeSingle();
    if (!error) return data?.id || null;
    if (error.code === "23505") {
      let lookup = supabase
        .from("clinical_observations")
        .select("id")
        .eq("source_type", input.sourceType)
        .eq("concept", input.concept)
        .eq("source_event_key", input.sourceEventKey);
      lookup = input.sourceId === null || input.sourceId === undefined
        ? lookup.is("source_id", null)
        : lookup.eq("source_id", input.sourceId);
      const { data: existing, error: lookupError } = await lookup.maybeSingle();
      if (!lookupError && existing?.id) return existing.id;
      logProjectionFailure({ ...input, eventType: "observation", operation: "duplicate_recovery", errorCode: lookupError?.code || "not_found" });
    }
    logProjectionFailure({ ...input, eventType: "observation", operation: "record_observation", errorCode: error.code || "insert_failed" });
    return null;
  } catch (error) {
    logProjectionFailure({ ...input, eventType: "observation", operation: "record_observation", errorCode: error.code || error.name || "exception" });
    return null;
  }
}

export function validateClinicalObservationInput(input = {}) {
  const sharedError = validateClinicalEventInput({
    module: input.module,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    eventType: "observation",
    occurredAt: input.observedAt,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    sourceEventKey: input.sourceEventKey,
    provenance: input.provenance,
    confidence: input.confidence,
    validationStatus: input.validationStatus || "unreviewed",
    qualityLevel: input.qualityLevel,
    payload: input.metadata || {},
  });
  if (sharedError) return sharedError;
  if (!input.concept) return "missing_concept";
  const values = [input.valueNumeric, input.valueText, input.valueBoolean].filter(value => value !== null && value !== undefined);
  if (values.length !== 1) return "invalid_observation_value";
  if (input.valueNumeric !== null && input.valueNumeric !== undefined && (typeof input.valueNumeric !== "number" || !Number.isFinite(input.valueNumeric))) return "invalid_numeric_value";
  if (input.valueText !== null && input.valueText !== undefined && typeof input.valueText !== "string") return "invalid_text_value";
  if (input.valueBoolean !== null && input.valueBoolean !== undefined && typeof input.valueBoolean !== "boolean") return "invalid_boolean_value";
  if (!input.observedAt || Number.isNaN(new Date(input.observedAt).getTime())) return "invalid_observed_at";
  return null;
}

export async function recordClinicianDecision(input = {}) {
  try {
    const validationError = validateClinicianDecisionInput(input);
    if (validationError) {
      logProjectionFailure({ ...input, eventType: "clinician_decision", sourceType: "clinician_decision", operation: "record_decision", errorCode: validationError });
      return null;
    }
    const supabase = getSupabase();
    const row = {
      module: input.module,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      organization_id: input.organizationId ?? null,
      expert_id: input.expertId,
      decision_type: input.decisionType,
      decision_text: input.decisionText,
      rationale: input.rationale ?? null,
      related_service_request_id: input.relatedServiceRequestId ?? null,
      follow_up_plan: input.followUpPlan ?? null,
      follow_up_at: input.followUpAt ?? null,
      status: input.status || "active",
      supersedes_decision_id: input.supersedesDecisionId ?? null,
      quality_level: input.qualityLevel ?? null,
      metadata: input.metadata || {},
    };
    const { data, error } = await supabase
      .from("clinician_decisions")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) logProjectionFailure({ ...input, eventType: "clinician_decision", sourceType: "clinician_decision", operation: "record_decision", errorCode: error.code || "insert_failed" });
    return data?.id || null;
  } catch (error) {
    logProjectionFailure({ ...input, eventType: "clinician_decision", sourceType: "clinician_decision", operation: "record_decision", errorCode: error.code || error.name || "exception" });
    return null;
  }
}

export function validateClinicianDecisionInput(input = {}) {
  const sharedError = validateClinicalEventInput({
    module: input.module,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    eventType: "decision",
    occurredAt: input.createdAt || new Date().toISOString(),
    sourceType: "clinician_decision",
    sourceEventKey: input.sourceEventKey || input.expertId || "manual",
    provenance: "clinician_entered",
    qualityLevel: input.qualityLevel,
    payload: input.metadata || {},
  });
  if (sharedError) return sharedError;
  if (!isUuid(input.expertId)) return "invalid_expert_id";
  if (!input.decisionType || !["continue_monitoring", "request_clarification", "schedule_consultation", "change_care_plan", "refer_to_specialist", "other"].includes(input.decisionType)) return "invalid_decision_type";
  if (!input.decisionText) return "missing_decision_text";
  return null;
}

export async function recordClinicalOutcome(input = {}) {
  try {
    const validationError = validateClinicalOutcomeInput(input);
    if (validationError) {
      logProjectionFailure({ ...input, eventType: "clinical_outcome", sourceType: "clinical_outcome", operation: "record_outcome", errorCode: validationError });
      return null;
    }
    const supabase = getSupabase();
    const row = {
      module: input.module,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      organization_id: input.organizationId ?? null,
      decision_id: input.decisionId ?? null,
      assessment_event_id: input.assessmentEventId ?? null,
      outcome_type: input.outcomeType,
      baseline_value: input.baselineValue ?? null,
      followup_value: input.followupValue ?? null,
      direction: input.direction ?? null,
      clinician_assessed: input.clinicianAssessed ?? false,
      followup_complete: input.followupComplete ?? false,
      assessed_at: input.assessedAt,
      provenance: input.provenance,
      validation_status: input.validationStatus || "unreviewed",
      quality_level: input.qualityLevel ?? null,
      metadata: input.metadata || {},
    };
    const { data, error } = await supabase
      .from("clinical_outcomes")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) logProjectionFailure({ ...input, eventType: "clinical_outcome", sourceType: "clinical_outcome", operation: "record_outcome", errorCode: error.code || "insert_failed" });
    return data?.id || null;
  } catch (error) {
    logProjectionFailure({ ...input, eventType: "clinical_outcome", sourceType: "clinical_outcome", operation: "record_outcome", errorCode: error.code || error.name || "exception" });
    return null;
  }
}

export function validateClinicalOutcomeInput(input = {}) {
  const sharedError = validateClinicalEventInput({
    module: input.module,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    eventType: "outcome",
    occurredAt: input.assessedAt,
    sourceType: "clinical_outcome",
    sourceEventKey: input.sourceEventKey || input.assessmentEventId || "manual",
    provenance: input.provenance,
    validationStatus: input.validationStatus || "unreviewed",
    qualityLevel: input.qualityLevel,
    payload: input.metadata || {},
  });
  if (sharedError) return sharedError;
  if (!input.outcomeType) return "missing_outcome_type";
  if (!input.assessedAt || Number.isNaN(new Date(input.assessedAt).getTime())) return "invalid_assessed_at";
  if (input.direction !== null && input.direction !== undefined && !["improved", "unchanged", "worsened", "mixed", "unknown"].includes(input.direction)) return "invalid_direction";
  return null;
}
