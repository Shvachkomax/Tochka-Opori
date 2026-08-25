import crypto from "node:crypto";

const HEALTH_NUMERIC_MAPPINGS = [
  { concept: "weight", sourceField: "weight_kg", unit: "kg", valid: value => value >= 0 && value <= 500 },
  { concept: "waist_circumference", sourceField: "waist_cm", unit: "cm", valid: value => value >= 0 && value <= 300 },
  { concept: "daily_steps", sourceField: "steps", unit: "count/day", valid: value => Number.isInteger(value) && value >= 0 && value <= 200000 },
  { concept: "sleep_duration", sourceField: "sleep_hours", unit: "hours/night", valid: value => value >= 0 && value <= 24 },
  { concept: "energy_intake", sourceField: "calories", unit: "kcal/day", valid: value => value >= 0 && value <= 100000 },
  { concept: "meal_count", sourceField: "meals_count", unit: "count/day", valid: value => Number.isInteger(value) && value >= 1 && value <= 10 },
  { concept: "fluid_intake", sourceField: "water_l", unit: "L/day", valid: value => value >= 0 && value <= 50 },
];

function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function serializeClinicalSnapshot(snapshot = {}) {
  return JSON.stringify(sortObject(snapshot));
}

export function hashClinicalSnapshot(snapshot = {}) {
  return crypto.createHash("sha256").update(serializeClinicalSnapshot(snapshot)).digest("hex");
}

function hashLogicalSource(sourceType, identity) {
  return `logical:${crypto.createHash("sha256").update(serializeClinicalSnapshot({ source_type: sourceType, ...identity })).digest("hex")}`;
}

export function buildHealthDiaryLogicalSourceId(sessionId, logDate) {
  return hashLogicalSource("body_daily_log", { session_id: sessionId, log_date: logDate });
}

export function buildSupportCheckinLogicalSourceId(ownerType, ownerId, checkinDate) {
  return hashLogicalSource("support_daily_checkin", { owner_type: ownerType, owner_id: ownerId, checkin_date: checkinDate });
}

export function buildHealthDiaryObservationSnapshot(log = {}) {
  const observations = [];
  const snapshot = {};

  for (const mapping of HEALTH_NUMERIC_MAPPINGS) {
    const value = numericValue(log[mapping.sourceField]);
    if (value === null || !mapping.valid(value)) continue;
    observations.push({
      concept: mapping.concept,
      valueNumeric: value,
      unit: mapping.unit,
      metadata: {},
    });
    snapshot[mapping.concept] = { value: value, unit: mapping.unit };
  }

  if (log.workout_done === true) {
    const value = numericValue(log.workout_minutes);
    if (value !== null && Number.isInteger(value) && value > 0 && value <= 1440) {
      observations.push({ concept: "exercise_duration", valueNumeric: value, unit: "min/day", metadata: {} });
      snapshot.exercise_duration = { value, unit: "min/day" };
    }
  }

  const revisionHash = hashClinicalSnapshot(snapshot);
  return { snapshot, observations, revisionHash, sourceEventKey: `rev:${revisionHash}` };
}

export function buildSupportCheckinObservationSnapshot(checkin = {}) {
  const observations = [];
  const snapshot = {};
  const wellbeing = numericValue(checkin.wellbeing_score);
  const anxiety = numericValue(checkin.anxiety_score);

  if (wellbeing !== null && Number.isInteger(wellbeing) && wellbeing >= -5 && wellbeing <= 5) {
    const metadata = { scale_min: -5, scale_max: 5, scale_label: "self_report" };
    observations.push({ concept: "subjective_wellbeing", valueNumeric: wellbeing, unit: "score", metadata });
    snapshot.subjective_wellbeing = { value: wellbeing, unit: "score", ...metadata };
  }
  if (anxiety !== null && Number.isInteger(anxiety) && anxiety >= 0 && anxiety <= 10) {
    const metadata = { scale_min: 0, scale_max: 10, scale_label: "self_report" };
    observations.push({ concept: "subjective_anxiety", valueNumeric: anxiety, unit: "score", metadata });
    snapshot.subjective_anxiety = { value: anxiety, unit: "score", ...metadata };
  }

  const revisionHash = hashClinicalSnapshot(snapshot);
  return { snapshot, observations, revisionHash, sourceEventKey: `rev:${revisionHash}` };
}
