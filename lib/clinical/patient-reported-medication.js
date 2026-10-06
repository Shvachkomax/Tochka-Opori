import { buildMedicationReferenceAIContext } from "./medication-reference.js";

const FREQUENCY_TYPES = new Set(["times_per_day", "scheduled_times", "as_needed", "text"]);
const ITEM_TYPES = new Set(["medication", "supplement"]);
const ORDER_STATUSES = new Set(["active", "completed", "paused", "cancelled"]);
const INTAKE_STATUSES = new Set(["taken", "missed", "taken_late", "different_dose"]);

const ORDER_FIELDS = [
  "item_type", "name", "active_ingredient", "dosage_form", "strength", "single_dose", "dose_unit",
  "route", "frequency_type", "times_per_day", "scheduled_times", "instructions", "start_date",
  "end_date", "ongoing", "doctor_comment", "patient_comment",
];

export function isMedicationDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validatePatientMedicationOrder(input = {}) {
  const order = Object.fromEntries(ORDER_FIELDS.map((field) => [field, input[field] ?? null]));
  order.name = typeof order.name === "string" ? order.name.trim() : "";
  order.dose_unit = typeof order.dose_unit === "string" ? order.dose_unit.trim() : "";
  order.single_dose = Number(order.single_dose);
  order.ongoing = order.ongoing === true;
  order.reported_as_doctor_order = true;

  if (!ITEM_TYPES.has(order.item_type)) return { ok: false, error: "Выберите препарат или БАД." };
  if (!order.name || order.name.length > 200) return { ok: false, error: "Укажите название (до 200 символов)." };
  if (!Number.isFinite(order.single_dose) || order.single_dose <= 0) return { ok: false, error: "Укажите разовую дозу больше нуля." };
  if (!order.dose_unit || order.dose_unit.length > 40) return { ok: false, error: "Укажите единицу дозы." };
  if (!FREQUENCY_TYPES.has(order.frequency_type)) return { ok: false, error: "Укажите схему приёма." };
  if (!isMedicationDate(order.start_date)) return { ok: false, error: "Укажите дату начала." };
  if (order.end_date && (!isMedicationDate(order.end_date) || order.end_date < order.start_date)) return { ok: false, error: "Проверьте дату окончания." };
  if (order.frequency_type === "times_per_day" && (!Number.isInteger(Number(order.times_per_day)) || Number(order.times_per_day) < 1 || Number(order.times_per_day) > 24)) {
    return { ok: false, error: "Укажите количество приёмов в день от 1 до 24." };
  }
  if (order.frequency_type === "scheduled_times" && (!Array.isArray(order.scheduled_times) || order.scheduled_times.length < 1 || order.scheduled_times.length > 24 || order.scheduled_times.some((time) => !isTime(time)))) {
    return { ok: false, error: "Укажите время приёма в формате ЧЧ:ММ." };
  }
  if (order.frequency_type === "text" && !String(order.instructions || "").trim()) return { ok: false, error: "Опишите схему приёма." };

  order.times_per_day = order.frequency_type === "times_per_day" ? Number(order.times_per_day) : null;
  order.scheduled_times = order.frequency_type === "scheduled_times" ? [...new Set(order.scheduled_times)].sort() : null;
  order.end_date = order.ongoing ? null : (order.end_date || null);
  const maxLengths = { active_ingredient: 200, dosage_form: 100, strength: 100, route: 100, instructions: 1000, doctor_comment: 1000, patient_comment: 1000 };
  for (const [field, maxLength] of Object.entries(maxLengths)) {
    if (order[field] !== null && typeof order[field] !== "string") return { ok: false, error: "Проверьте дополнительные сведения." };
    if (typeof order[field] === "string") order[field] = order[field].trim() || null;
    if (order[field] && order[field].length > maxLength) return { ok: false, error: "Слишком длинное дополнительное описание." };
  }
  return { ok: true, order };
}

export function isPatientMedicationOrderStatus(status) {
  return ORDER_STATUSES.has(status);
}

export function patientMedicationOwnerMatches(record, owner) {
  return !!record && !!owner
    && record.owner_type === owner.ownerType
    && record.owner_id === owner.ownerId
    && record.source_module === owner.sourceModule;
}

export function buildScheduledMedicationIntakes(orders, scheduledDate) {
  if (!isMedicationDate(scheduledDate)) return [];
  return (orders || []).filter((order) => {
    return order.status === "active" && order.start_date <= scheduledDate
      && (order.ongoing || !order.end_date || order.end_date >= scheduledDate)
      && ["times_per_day", "scheduled_times"].includes(order.frequency_type);
  }).flatMap((order) => {
    const times = order.frequency_type === "scheduled_times"
      ? order.scheduled_times || []
      : Array.from({ length: Number(order.times_per_day || 0) }, () => null);
    return times.map((time, index) => ({
      medication_order_id: order.id,
      scheduled_date: scheduledDate,
      scheduled_time: time,
      scheduled_slot: index + 1,
      name: order.name,
      item_type: order.item_type,
      single_dose: order.single_dose,
      dose_unit: order.dose_unit,
      intake_log: null,
    }));
  });
}

export function projectMedicationIntakes(scheduled, logs = []) {
  const logsBySlot = new Map(logs.map((log) => [`${log.medication_order_id}:${log.scheduled_slot}`, log]));
  return scheduled.map((task) => ({
    ...task,
    intake_log: logsBySlot.get(`${task.medication_order_id}:${task.scheduled_slot}`) || null,
  }));
}

export function validateMedicationIntake(input = {}) {
  if (!INTAKE_STATUSES.has(input.status)) return { ok: false, error: "Выберите отметку о приёме." };
  if (!isMedicationDate(input.scheduled_date) || !Number.isInteger(Number(input.scheduled_slot)) || Number(input.scheduled_slot) < 1 || Number(input.scheduled_slot) > 24) {
    return { ok: false, error: "Некорректное время приёма." };
  }
  if (input.actual_time && !isTime(input.actual_time)) return { ok: false, error: "Укажите время в формате ЧЧ:ММ." };
  if (input.status === "taken_late" && !input.actual_time) return { ok: false, error: "Укажите фактическое время приёма." };
  if (input.status === "different_dose" && (!Number.isFinite(Number(input.actual_dose)) || Number(input.actual_dose) <= 0 || !String(input.actual_dose_unit || "").trim())) {
    return { ok: false, error: "Укажите фактическую дозу и её единицу." };
  }
  return {
    ok: true,
    intake: {
      scheduled_date: input.scheduled_date,
      scheduled_slot: Number(input.scheduled_slot),
      status: input.status,
      actual_time: input.actual_time || null,
      actual_dose: input.status === "different_dose" ? Number(input.actual_dose) : null,
      actual_dose_unit: input.status === "different_dose" ? String(input.actual_dose_unit).trim() : null,
      patient_note: typeof input.patient_note === "string" ? input.patient_note.trim().slice(0, 1000) || null : null,
    },
  };
}

export function buildPatientMedicationContext(orders, intakeLogs = [], events = [], referenceViews = new Map()) {
  const activeOrders = (orders || []).filter((order) => order.status === "active").map((order) => {
    const referenceView = referenceViews.get(order.id) || null;
    return {
      id: order.id,
      item_type: order.item_type,
      name: order.name,
      active_ingredient: order.active_ingredient,
      strength: order.strength,
      single_dose: order.single_dose,
      dose_unit: order.dose_unit,
      route: order.route,
      frequency_type: order.frequency_type,
      times_per_day: order.times_per_day,
      scheduled_times: order.scheduled_times,
      instructions: order.instructions,
      start_date: order.start_date,
      end_date: order.end_date,
      patient_comment: order.patient_comment,
      reported_as_doctor_order: true,
      reference_context: buildMedicationReferenceAIContext(order, referenceView?.verified_reference || null, referenceView?.concept || null),
    };
  });
  return {
    provenance: "patient_reported_not_independently_verified",
    active_orders: activeOrders,
    recent_intake: (intakeLogs || []).map(({ scheduled_date, status, actual_time, actual_dose, actual_dose_unit, patient_note, medication_order_id }) => ({
      medication_order_id, scheduled_date, status, actual_time, actual_dose, actual_dose_unit, patient_note,
    })),
    recent_changes: (events || []).map(({ event_type, changed_fields, previous_status, new_status, created_at }) => ({
      event_type, changed_fields, previous_status, new_status, created_at,
    })),
  };
}

export const PATIENT_MEDICATION_SAFETY_INSTRUCTION = "Сведения о лекарствах и БАДах переданы пациентом как описание уже существующего назначения или рекомендации врача и не проверены сервисом. Не назначай, не отменяй, не заменяй и не меняй дозировку или частоту. При вопросах об изменении терапии рекомендуй согласовать это с лечащим врачом. Не утверждай лечебную эффективность БАД на основании записи пациента. Фармакологические факты сообщай только из verified reference вместе с его источником; не отвечай на них из памяти модели. Если для лекарства verified reference отсутствует, используй reference_unavailable_message без медицинских догадок. Для БАДа не утверждай лечебную эффективность или свойства без отдельно одобренного supplement source. Различай «такой эффект описан в источнике» и «препарат вызвал симптом»; второе без достаточных оснований не утверждай.";
