// Clinical longitudinal registry v0.1.
// Read-only reconstruction from original medical records. Never a publication feed.
// Source data remain in their original tables; no PHI copied into a second datastore.
const OWNER_TYPES = Object.freeze({ support: "anonymous_case", body: "anonymous_profile" });
const SOURCE_NAMES = Object.freeze({
  sessions: "Сессия Support",
  clinical_events: "Клиническое событие",
  clinical_observations: "Клиническое наблюдение",
  clinician_decisions: "Решение специалиста",
  clinical_outcomes: "Результат наблюдения",
  medication_orders: "Назначение врача",
  medication_order_lifecycle_events: "Изменение врачебного назначения",
  medication_order_schedules: "Схема приёма по назначению врача",
  patient_medication_orders: "Лекарства со слов пациента",
  medication_intake_logs: "Отметка о приёме лекарства",
  patient_medication_order_events: "Изменение списка лекарств пациента",
  service_requests: "Запрос специалисту",
  body_daily_logs: "Дневник Health",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMIT = 250;
const nums = (row, fields) => Object.fromEntries(fields
  .filter((f) => typeof row[f] === "number" && Number.isFinite(row[f]))
  .map((f) => [f, row[f]]));
const iso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const entry = (source, row, timestamp, eventType, provenance, validation, details = {}) => ({
  // These identifiers only deduplicate a response; they are never patient identifiers.
  _key: `${source}:${row.id || row.source_event_key || timestamp || ""}:${eventType}`,
  at: iso(timestamp), type: eventType, label: SOURCE_NAMES[source],
  source, provenance, validation_status: validation, details,
});

export function buildLongitudinalSummary(events, now = new Date()) {
  const dated = events.filter((e) => e.at).sort((a, b) => a.at.localeCompare(b.at));
  const firstAt = dated[0]?.at || null;
  const lastAt = dated.at(-1)?.at || null;
  const patientSources = new Set(["sessions", "body_daily_logs", "service_requests",
    "patient_medication_orders", "medication_intake_logs", "patient_medication_order_events"]);
  const contacts = dated.filter((e) => patientSources.has(e.source)
    || (e.source === "clinical_events" && e.provenance === "patient_reported"));
  const lastPatientContact = contacts.at(-1)?.at || null;
  const cutoff = now.getTime() - 30 * 86400000;
  return {
    first_event_at: firstAt, last_event_at: lastAt,
    last_patient_contact_at: lastPatientContact, event_count: events.length,
    // Doctor activity does not count as a new patient report.
    // No data does not imply recovery, deterioration or formal treatment termination.
    followup_data_status: !lastPatientContact ? "нет_сведений_от_пациента"
      : new Date(lastPatientContact).getTime() < cutoff
        ? "нет_новых_сведений_от_пациента_30_дней"
        : "есть_недавние_сведения_от_пациента",
    treatment_effectiveness: "не_определена_автоматически",
  };
}

export function assembleLongitudinalEvents(rows, module, now = new Date()) {
  const out = [];
  const add = (source, arr, convert) => {
    for (const item of arr || []) {
      const e = convert(item);
      if (e?.at) out.push(e);
    }
  };
  add("clinical_events", rows.clinical_events, (r) =>
    entry("clinical_events", r, r.occurred_at || r.recorded_at,
      r.event_type || "event", r.provenance || "unknown",
      r.validation_status || "unreviewed", {
        event_type: r.event_type || null,
        source_type: r.source_type || null,
      }));
  const supersededIds = new Set((rows.clinical_observations || [])
    .map((r) => r.supersedes_observation_id).filter(Boolean));
  add("clinical_observations", rows.clinical_observations, (r) => {
    const e = entry("clinical_observations", r, r.observed_at,
      "observation", r.provenance || "unknown", r.validation_status || "unreviewed",
      { concept: r.concept || null, unit: r.unit || null,
        superseded_by_newer_record: supersededIds.has(r.id),
        ...nums(r, ["value_numeric"]) });
    return e;
  });
  add("clinician_decisions", rows.clinician_decisions, (r) =>
    entry("clinician_decisions", r, r.created_at, "clinician_decision",
      "clinician_entered", "clinician_confirmed",
      { decision_type: r.decision_type || null, status: r.status || null, follow_up_at: iso(r.follow_up_at) }));
  add("clinical_outcomes", rows.clinical_outcomes, (r) =>
    entry("clinical_outcomes", r, r.assessed_at, "clinical_outcome",
      r.provenance || "unknown", r.validation_status || "unreviewed",
      { outcome_type: r.outcome_type || null, direction: r.direction || "unknown",
        followup_complete: r.followup_complete === true,
        clinician_assessed: r.clinician_assessed === true,
        ...nums(r, ["baseline_value", "followup_value"]) }));
  add("service_requests", rows.service_requests, (r) =>
    entry("service_requests", r, r.created_at, "service_request",
      "patient_reported", "unreviewed",
      { request_type: r.request_type || null, status: r.status || null }));
  add("patient_medication_orders", rows.patient_medication_orders, (r) =>
    entry("patient_medication_orders", r, r.created_at || r.start_date,
      "medication_reported", "patient_reported", "unreviewed",
      { medication_name: r.name || null, status: r.status || null,
        dose: r.single_dose ?? null, dose_unit: r.dose_unit || null }));
  add("medication_intake_logs", rows.medication_intake_logs, (r) =>
    entry("medication_intake_logs", r, r.scheduled_date,
      "intake_reported", "patient_reported", "unreviewed",
      { intake_status: r.status || null,
        ...nums(r, ["actual_dose"]), actual_dose_unit: r.actual_dose_unit || null }));
  add("patient_medication_order_events", rows.patient_medication_order_events, (r) =>
    entry("patient_medication_order_events", r, r.created_at,
      "medication_history_changed", "patient_reported", "unreviewed",
      { medication_change_type: r.event_type || null,
        previous_status: r.previous_status || null, new_status: r.new_status || null }));

  if (module === "support") {
    add("sessions", rows.sessions, (r) =>
      entry("sessions", r, r.created_at, "initial_or_followup_contact", "patient_reported",
        "unreviewed",
        { report_status: r.report_generation_status || null,
          safety_level: typeof r.care_recommendation?.level === "string"
            ? r.care_recommendation.level : null }));
    add("medication_orders", rows.medication_orders, (r) =>
      entry("medication_orders", r, r.issued_at || r.created_at, "medication_prescribed",
        "clinician_ordered", "clinician_confirmed",
        { medication_name: r.medication_name_snapshot || null,
          strength_value: r.strength_value ?? null,
          strength_unit: r.strength_unit || null,
          schedules: (rows.medication_order_schedules || [])
            .filter((phase) => phase.medication_order_id === r.id)
            .map(({ phase_number, dose_amount, dose_unit, frequency_code,
                    phase_start_at, phase_end_at }) => ({
              phase_number, dose_amount, dose_unit, frequency_code,
              phase_start_at, phase_end_at,
            })),
          valid_from: r.valid_from || null, valid_until: r.valid_until || null }));
    add("medication_order_lifecycle_events", rows.medication_order_lifecycle_events, (r) =>
      entry("medication_order_lifecycle_events", r, r.occurred_at || r.created_at,
        "medication_order_changed", "clinician_ordered", "clinician_confirmed",
        { lifecycle_event: r.event_type || null, reason_code: r.reason_code || null }));
  }
  if (module === "body") {
    add("body_daily_logs", rows.body_daily_logs, (r) =>
      entry("body_daily_logs", r, r.log_date || r.created_at,
        "health_diary", "patient_reported", "unreviewed",
        { diary_date: r.log_date, ...nums(r,
          ["weight_kg", "waist_cm", "steps", "sleep_hours", "mood_level", "energy_level"]) }));
  }
  // Unchanged source records can appear both as underlying records and projection events.
  // We preserve provenance rather than merging away distinct clinical claims.
  const keys = new Set();
  const unique = [];
  for (const e of out) if (!keys.has(e._key)) { keys.add(e._key); unique.push(e); }
  unique.sort((a, b) => a.at.localeCompare(b.at) || a._key.localeCompare(b._key));
  return {
    events: unique.map(({ _key, ...e }) => e),
    summary: buildLongitudinalSummary(unique, now),
  };
}
// Read-only integrity check. This is NOT a completeness guarantee:
// only source events which are contractually expected to be projected are checked.
export function auditLongitudinalProjection(rows) {
  const projected = new Set((rows.clinical_events || []).filter((e) => e.source_type && e.source_id)
    .map((e) => `${e.source_type}:${e.source_id}:${e.event_type}`));
  const missing = [];
  for (const row of rows.service_requests || []) {
    if (!row.id || !row.created_at) continue;
    const expected = `service_request:${row.id}:service_request_created`;
    if (!projected.has(expected)) missing.push({
      source: "service_requests", type: "service_request_created",
      // No patient identifiers or source IDs leave this function.
    });
  }
  for (const order of rows.medication_orders || []) {
    if (!order.id) continue;
    if (!order.clinical_event_id) missing.push({
      source: "medication_orders", type: "medication_order_issued",
    });
  }
  return {
    checked_sources: ["service_requests", "medication_orders"],
    missing_projection_count: missing.length,
    missing_projection_types: [...new Set(missing.map((m) => m.source + ":" + m.type))],
    reconciliation_required: missing.length > 0,
  };
}

// Reconstruct doctor medication courses from source orders + schedules + lifecycle.
 // This must only receive rows already scoped to one authorized patient and clinic.
 // Identifiers stay internal to this function and are NEVER returned to the browser.
export function assembleMedicationTreatmentCourses(rows) {
  const groups = new Map();
  const issues = [];
  const orders = rows.medication_orders || [];
  const schedules = rows.medication_order_schedules || [];
  const lifecycle = rows.medication_order_lifecycle_events || [];
  for (const order of orders) {
    if (!order.id || !order.order_group_id || !Number.isInteger(order.version_number)
        || order.version_number < 1) {
      issues.push("medication_group_version_missing");
      continue;
    }
    if (!groups.has(order.order_group_id)) groups.set(order.order_group_id, []);
    groups.get(order.order_group_id).push(order);
  }
  const courses = [];
  for (const ordersInGroup of groups.values()) {
    const versions = ordersInGroup.sort((a, b) => a.version_number - b.version_number);
    if (versions[0].version_number !== 1
        || versions.some((o, i) => o.version_number !== i + 1)) {
      issues.push("medication_version_gap_or_duplicate");
    }
    const course = versions.map((order, index) => {
      if (index > 0 && order.supersedes_order_id !== versions[index - 1].id) {
        issues.push("medication_supersession_link_invalid");
      }
      const events = lifecycle.filter((e) => e.medication_order_id === order.id);
      let state = "not_confirmed";
      if (events.some((e) => e.event_type === "revoked")) state = "revoked";
      else if (events.some((e) => e.event_type === "superseded")) state = "superseded";
      else if (events.some((e) => e.event_type === "activated")) state = "activation_recorded";
      const phases = schedules.filter((s) => s.medication_order_id === order.id)
        .sort((a, b) => (a.phase_number || 0) - (b.phase_number || 0))
        .map((s) => ({
          phase_number: s.phase_number ?? null,
          dose_amount: s.dose_amount ?? null,
          dose_unit: s.dose_unit || null,
          frequency_code: s.frequency_code || null,
          phase_start_at: s.phase_start_at || null,
          phase_end_at: s.phase_end_at || null,
        }));
      if (!phases.length) issues.push("medication_order_schedule_missing");
      return {
        version: order.version_number,
        issued_at: iso(order.issued_at || order.created_at),
        medication_name: order.medication_name_snapshot || null,
        formulation_strength: order.strength_value ?? null,
        strength_unit: order.strength_unit || null,
        schedules: phases,
        order_record_state: state,
        author_status: order.prescriber_expert_id
          ? "prescriber_recorded_not_signed" : "unverified_author",
      };
    });
    courses.push({ versions: course, latest_recorded_state: course.at(-1)?.order_record_state || "unknown" });
  }
  // No group ID, patient ID, prescription ID, prescriber ID or raw clinical text
  // appears in the returned payload.
  return { courses, issues: [...new Set(issues)], complete: issues.length === 0 };
}

function orgScope(query, organizationId) {
  return organizationId ? query.eq("organization_id", organizationId) : query.is("organization_id", null);
}
function ownerScope(query, ownerType, ownerId) {
  return query.eq("owner_type", ownerType).eq("owner_id", ownerId);
}
function makeTask(name, query) { return { name, query }; }

export async function loadLongitudinalFromSources({
  supabase, module, ownerType, ownerId, organizationId = null, now = new Date(),
}) {
  if (OWNER_TYPES[module] !== ownerType || !UUID.test(ownerId) || !supabase?.from)
    throw new Error("Некорректный контекст клинической истории");
  // v0.1 cannot safely combine owner-level (organization-blind) sources with
  // clinic-scoped data. Refuse rather than exposing records from another clinic.
  // Clinic use requires verified per-source organization scope and consent.
  if (organizationId !== null) {
    throw new Error("История в контексте организации ждёт проверки разграничения клиник");
  }
  const tasks = [];
  const own = (table, columns) => ownerScope(supabase.from(table).select(columns), ownerType, ownerId);
  tasks.push(makeTask("clinical_events",
    orgScope(own("clinical_events",
      "id,source_event_key,source_type,source_id,event_type,occurred_at,recorded_at,provenance,validation_status"), organizationId)
      .order("occurred_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("clinical_observations",
    orgScope(own("clinical_observations",
      "id,concept,value_numeric,unit,observed_at,provenance,validation_status,supersedes_observation_id"), organizationId)
      .order("observed_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("clinician_decisions",
    orgScope(own("clinician_decisions",
      "id,decision_type,status,follow_up_at,created_at"), organizationId)
      .order("created_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("clinical_outcomes",
    orgScope(own("clinical_outcomes",
      "id,outcome_type,baseline_value,followup_value,direction,clinician_assessed,followup_complete,assessed_at,provenance,validation_status"), organizationId)
      .order("assessed_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("service_requests",
    orgScope(own("service_requests", "id,request_type,status,created_at"), organizationId)
      .eq("module", module).order("created_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("patient_medication_orders",
    own("patient_medication_orders", "id,name,status,single_dose,dose_unit,start_date,created_at")
      .eq("source_module", module === "body" ? "health" : "support")
      .order("created_at", { ascending: false }).limit(LIMIT)));
  tasks.push(makeTask("medication_intake_logs",
    own("medication_intake_logs",
      "id,status,scheduled_date,actual_dose,actual_dose_unit")
      .order("scheduled_date", { ascending: false }).limit(LIMIT)));

  if (module === "support") {
    tasks.push(makeTask("sessions",
      orgScope(supabase.from("sessions").select("id,created_at,care_recommendation,report_generation_status")
        .eq("anonymous_owner_id", ownerId).eq("module", "support"), organizationId)
        .order("created_at", { ascending: false }).limit(LIMIT)));
    tasks.push(makeTask("medication_orders",
      orgScope(own("medication_orders",
        "id,clinical_event_id,order_group_id,version_number,supersedes_order_id,prescriber_expert_id,medication_name_snapshot,strength_value,strength_unit,issued_at,created_at,valid_from,valid_until"), organizationId)
        .eq("module", "support").order("created_at", { ascending: false }).limit(LIMIT)));
    // Join lifecycle events only through medication order IDs from this authorized patient.
  } else {
    const { data: clients, error } = await supabase.from("body_clients")
      .select("session_id").eq("anonymous_owner_id", ownerId).limit(200);
    if (error) throw new Error("История Health недоступна: не удалось проверить связь сессий");
    const ids = [...new Set((clients || []).map((x) => x.session_id).filter(Boolean))];
    if (clients?.length >= 200) {
      throw new Error("Неполный перечень сессий Health; нужна постраничная выборка");
    }
    // body_clients has no established organization dimension. Resolve each session
    // through the organization-scoped sessions table before disclosing any diary rows.
    if (ids.length) {
      const { data: matched, error: scopeError } = await orgScope(
        supabase.from("sessions").select("session_id")
          .eq("anonymous_owner_id", ownerId).eq("module", "body").in("session_id", ids),
        organizationId,
      );
      if (scopeError) throw new Error("Не удалось проверить организацию сессий Health");
      const scopedIds = (matched || []).map((x) => x.session_id);
      if (scopedIds.length !== ids.length) {
        throw new Error("История Health пока не поддерживает смешанные организационные сессии");
      }
      tasks.push(makeTask("body_daily_logs",
        supabase.from("body_daily_logs")
          .select("id,log_date,weight_kg,waist_cm,steps,sleep_hours,mood_level,energy_level,updated_at,created_at")
          .in("session_id", scopedIds).order("created_at", { ascending: false }).limit(LIMIT)));
    }
  }

  // Medication change history is associated by verified owner-scoped order IDs.
  // Never query order events by patient identifier alone if an order link exists.
    const results = await Promise.all(tasks.map(async (t) => {
    try {
      const { data, error } = await t.query;
      return { name: t.name, data: data || [], error: error?.code || error?.message || null };
    } catch {
      return { name: t.name, data: [], error: "source_unavailable" };
    }
  }));
  const rows = Object.fromEntries(results.map((r) => [r.name, r.data]));
  if (rows.patient_medication_orders?.length) {
    const ids = rows.patient_medication_orders.map((x) => x.id).filter(Boolean);
    try {
      const { data, error } = await supabase.from("patient_medication_order_events")
        .select("id,medication_order_id,event_type,previous_status,new_status,created_at")
        .eq("owner_type", ownerType).eq("owner_id", ownerId)
        .in("medication_order_id", ids)
        .order("created_at", { ascending: false }).limit(LIMIT);
      results.push({ name: "patient_medication_order_events", data: data || [],
        error: error?.code || error?.message || null });
      rows.patient_medication_order_events = data || [];
    } catch {
      results.push({ name: "patient_medication_order_events", data: [],
        error: "source_unavailable" });
    }
  }
  if (module === "support" && rows.medication_orders?.length) {
    const ids = rows.medication_orders.map((x) => x.id).filter(Boolean);
    for (const [table, columns, orderField] of [
      ["medication_order_lifecycle_events",
        "id,medication_order_id,event_type,occurred_at,created_at,reason_code", "occurred_at"],
      ["medication_order_schedules",
        "id,medication_order_id,phase_number,dose_amount,dose_unit,frequency_code,phase_start_at,phase_end_at",
        "phase_number"],
    ]) {
      try {
        const { data, error } = await supabase.from(table).select(columns)
          .in("medication_order_id", ids).order(orderField, { ascending: false }).limit(LIMIT);
        results.push({ name: table, data: data || [],
          error: error?.code || error?.message || null });
        rows[table] = data || [];
      } catch {
        results.push({ name: table, data: [], error: "source_unavailable" });
      }
    }
  }
  // Observations are versioned; if the newest record is not in the window,
  // apparent current values cannot safely be inferred from older entries.
  const unavailable = results.filter((r) => r.error).map((r) => r.name);
  const truncated = results.filter((r) => r.data.length >= LIMIT).map((r) => r.name);
  const assembled = assembleLongitudinalEvents(rows, module, now);
  const medication = module === "support"
    ? assembleMedicationTreatmentCourses(rows) : { courses: [], issues: [], complete: true };
  return {
    ...assembled, module, source_of_truth: "existing_patient_records",
    read_only: true, research_export_allowed: false,
    treatment_courses: medication.courses,
    integrity: auditLongitudinalProjection(rows),
    coverage: { complete: unavailable.length === 0 && truncated.length === 0 && medication.complete,
      unavailable_sources: unavailable, truncated_sources: truncated,
      integrity_issues: medication.issues },
  };
}
