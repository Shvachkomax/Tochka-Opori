import crypto from "node:crypto";

export const MEDICATION_RUNTIME = Object.freeze({
  prescribingModules: ["support"],
  patientMedicationAiEnabled: false,
});

export const SAFE_MEDICATION_PERMISSION_KEYS = Object.freeze([
  "view_authorized_order",
  "explain_authorized_order",
  "show_authorized_schedule",
  "remind_authorized_schedule",
  "prepare_question_for_clinician",
]);

const SAFE_PERMISSION_SET = new Set(SAFE_MEDICATION_PERMISSION_KEYS);

export function normalizeMedicationPermissionKeys(value) {
  if (value === undefined || value === null) return { ok: true, keys: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Некорректный набор разрешений AI." };
  const keys = [...new Set(value.filter((key) => typeof key === "string"))];
  if (keys.length !== value.length || keys.some((key) => !SAFE_PERMISSION_SET.has(key))) {
    return { ok: false, error: "Указано неподдерживаемое разрешение AI." };
  }
  return { ok: true, keys };
}

export function medicationOrderRef(id) {
  return `medication-order:${id}`;
}

export function isMedicationSessionEligible(session) {
  return session?.legacy_access === false;
}

export function parseMedicationOrderRef(value) {
  if (typeof value !== "string" || !value.startsWith("medication-order:")) return null;
  const id = value.slice("medication-order:".length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function getMedicationOrderState(order, lifecycleEvents = [], now = new Date()) {
  if (!order) return "not_found";
  const events = new Set(lifecycleEvents.map((event) => event.event_type));
  if (events.has("revoked")) return "revoked";
  if (events.has("completed")) return "completed";
  if (events.has("superseded")) return "superseded";
  if (order.valid_until && new Date(order.valid_until) <= now) return "expired";
  if (new Date(order.valid_from) > now) return "scheduled";
  if (!events.has("activated")) return "invalid";
  return "active";
}

function toSafeSchedule(schedule, orderValidUntil) {
  const effectiveEnd = orderValidUntil && (!schedule.phase_end_at || new Date(schedule.phase_end_at) > new Date(orderValidUntil))
    ? orderValidUntil
    : schedule.phase_end_at;
  return {
    phase_number: schedule.phase_number,
    dosing_mode: schedule.dosing_mode,
    phase_start_at: schedule.phase_start_at,
    phase_end_at: effectiveEnd,
    dose_amount: schedule.dose_amount,
    dose_unit: schedule.dose_unit,
    frequency_code: schedule.frequency_code,
    route_code: schedule.route_code,
    administration_time_local: schedule.administration_time_local,
    timezone: schedule.timezone,
    max_daily_dose_amount: schedule.max_daily_dose_amount,
    max_daily_dose_unit: schedule.max_daily_dose_unit,
  };
}

export function mapMedicationOrder(order, schedules = [], lifecycleEvents = [], permissions = [], now = new Date()) {
  const state = getMedicationOrderState(order, lifecycleEvents, now);
  const grants = permissions
    .filter((permission) => permission.permission_action === "grant")
    .filter((grant) => !permissions.some((revoke) => revoke.revokes_permission_id === grant.id))
    .filter((grant) => !grant.effective_at || new Date(grant.effective_at) <= now)
    .filter((grant) => !grant.expires_at || new Date(grant.expires_at) > now)
    .map((grant) => grant.permission_key);

  return {
    order_ref: medicationOrderRef(order.id),
    order_id: order.id,
    module: order.module,
    owner_type: order.owner_type,
    organization_id: order.organization_id,
    prescriber_expert_id: order.prescriber_expert_id,
    prescriber_authorization_id: order.prescriber_authorization_id,
    order_group_id: order.order_group_id,
    version_number: order.version_number,
    supersedes_order_ref: order.supersedes_order_id ? medicationOrderRef(order.supersedes_order_id) : null,
    medication_concept_id: order.medication_concept_id,
    medication_name: order.medication_name_snapshot,
    formulation: order.formulation_snapshot || null,
    strength_value: order.strength_value,
    strength_unit: order.strength_unit,
    route_code: order.route_code,
    indication_code: order.indication_code || null,
    clinician_instruction: order.clinician_instruction || null,
    issued_at: order.issued_at,
    valid_from: order.valid_from,
    valid_until: order.valid_until || null,
    effective_state: state,
    schedules: schedules.map((schedule) => toSafeSchedule(schedule, order.valid_until)),
    ai_permission_keys: grants,
    created_at: order.created_at,
  };
}

export function mapMedicationCard(orderView) {
  return {
    order_ref: orderView.order_ref,
    medication_name: orderView.medication_name,
    formulation: orderView.formulation,
    strength_value: orderView.strength_value,
    strength_unit: orderView.strength_unit,
    route_code: orderView.route_code,
    schedules: orderView.schedules,
    valid_from: orderView.valid_from,
    valid_until: orderView.valid_until,
    effective_state: orderView.effective_state,
    prescriber: orderView.prescriber || null,
    clinician_instruction: orderView.clinician_instruction,
    read_only: true,
  };
}

async function loadMedicationRecords({ supabase, ownerType, ownerId, module, organizationId, orderId } = {}) {
  let orderQuery = supabase
    .from("medication_orders")
    .select("id, module, owner_type, owner_id, organization_id, prescriber_expert_id, prescriber_authorization_id, order_group_id, version_number, supersedes_order_id, medication_concept_id, medication_name_snapshot, formulation_snapshot, strength_value, strength_unit, route_code, indication_code, clinician_instruction, issued_at, valid_from, valid_until, source_decision_id, clinical_event_id, creation_idempotency_key, order_hash, created_at")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("module", module)
    .order("version_number", { ascending: false });
  if (organizationId !== undefined) {
    orderQuery = organizationId === null
      ? orderQuery.is("organization_id", null)
      : orderQuery.eq("organization_id", organizationId);
  }
  if (orderId) orderQuery = orderQuery.eq("id", orderId);

  const { data: orders, error: orderError } = await orderQuery;
  if (orderError) throw orderError;
  if (!orders?.length) return [];

  const ids = orders.map((order) => order.id);
  const [{ data: schedules, error: scheduleError }, { data: lifecycle, error: lifecycleError }, { data: permissions, error: permissionError }] = await Promise.all([
    supabase.from("medication_order_schedules").select("*").in("medication_order_id", ids).order("phase_number"),
    supabase.from("medication_order_lifecycle_events").select("id, medication_order_id, event_type, related_order_id, actor_type, actor_expert_id, occurred_at, reason_code, reason_text, idempotency_key, created_at").in("medication_order_id", ids).order("created_at"),
    supabase.from("medication_ai_permissions").select("id, medication_order_id, permission_key, permission_action, granted_by_expert_id, organization_id, source_decision_id, revokes_permission_id, effective_at, expires_at, idempotency_key, created_at").in("medication_order_id", ids).order("created_at"),
  ]);
  if (scheduleError) throw scheduleError;
  if (lifecycleError) throw lifecycleError;
  if (permissionError) throw permissionError;

  return orders.map((order) => mapMedicationOrder(
    order,
    (schedules || []).filter((schedule) => schedule.medication_order_id === order.id),
    (lifecycle || []).filter((event) => event.medication_order_id === order.id),
    (permissions || []).filter((permission) => permission.medication_order_id === order.id),
  ));
}

export async function listMedicationOrdersForOwner(params) {
  return loadMedicationRecords(params);
}

export async function getMedicationOrderForOwner(params) {
  const records = await loadMedicationRecords(params);
  return records[0] || null;
}

export async function getMedicationCardsForOwner({ supabase, ownerType, ownerId, module = "support", organizationId } = {}) {
  const records = await listMedicationOrdersForOwner({ supabase, ownerType, ownerId, module, organizationId });
  const latestByGroup = new Map();
  for (const record of records) {
    if (!latestByGroup.has(record.order_group_id)) latestByGroup.set(record.order_group_id, record);
  }
  const latest = [...latestByGroup.values()].filter((record) => record.effective_state !== "superseded");
  const expertIds = [...new Set(latest.map((record) => record.prescriber_expert_id).filter(Boolean))];
  const { data: experts } = expertIds.length
    ? await supabase.from("experts").select("id, name, specialty").in("id", expertIds)
    : { data: [] };
  const expertMap = new Map((experts || []).map((expert) => [expert.id, expert]));
  return latest.map((record) => mapMedicationCard({
    ...record,
    prescriber: expertMap.get(record.prescriber_expert_id) ? {
      name: expertMap.get(record.prescriber_expert_id).name,
      specialty: expertMap.get(record.prescriber_expert_id).specialty,
    } : null,
  }));
}

export async function resolveMedicationPermission({ supabase, ownerType, ownerId, module, organizationId = null, orderId, permissionKey, now = new Date() } = {}) {
  if (!SAFE_PERMISSION_SET.has(permissionKey)) {
    return { allowed: false, reason: "unsupported_permission", feature_enabled: false };
  }
  if (module !== "support" || !MEDICATION_RUNTIME.prescribingModules.includes(module)) {
    return { allowed: false, reason: "module_disabled", feature_enabled: false };
  }

  const order = await getMedicationOrderForOwner({ supabase, ownerType, ownerId, module, organizationId, orderId });
  if (!order) return { allowed: false, reason: "order_not_found", feature_enabled: false };
  if (order.effective_state !== "active") {
    return { allowed: false, reason: `order_${order.effective_state}`, structurally_eligible: false, safe_capabilities: [], feature_enabled: false };
  }

  const { data: authorization, error: authorizationError } = await supabase
    .from("clinician_medication_authorizations")
    .select("id, expert_id, organization_id, jurisdiction, authorization_scope, verification_status, valid_from, valid_until, revoked_at")
    .eq("id", order.prescriber_authorization_id)
    .maybeSingle();
  if (authorizationError) throw authorizationError;
  let prescriberQuery = supabase
    .from("experts")
    .select("id, is_active, allowed_modules");
  prescriberQuery = authorization?.expert_id
    ? prescriberQuery.eq("id", authorization.expert_id)
    : prescriberQuery.is("id", null);
  const { data: prescriber, error: prescriberError } = await prescriberQuery.maybeSingle();
  if (prescriberError) throw prescriberError;
  const authorityValid = authorization
    && authorization.jurisdiction === "RU"
    && authorization.authorization_scope === "prescribe_medications"
    && authorization.verification_status === "verified"
    && authorization.organization_id === order.organization_id
    && !authorization.revoked_at
    && prescriber?.is_active === true
    && Array.isArray(prescriber.allowed_modules)
    && prescriber.allowed_modules.includes("support")
    && new Date(authorization.valid_from) <= now
    && (!authorization.valid_until || new Date(authorization.valid_until) > now);
  if (!authorityValid) return { allowed: false, reason: "prescriber_authorization_invalid", structurally_eligible: false, safe_capabilities: [], feature_enabled: false };

  const effectivePermission = order.ai_permission_keys.includes(permissionKey);
  return {
    allowed: effectivePermission && MEDICATION_RUNTIME.patientMedicationAiEnabled,
    reason: effectivePermission ? "feature_disabled" : "permission_not_granted",
    structurally_eligible: effectivePermission,
    safe_capabilities: effectivePermission ? order.ai_permission_keys : [],
    feature_enabled: MEDICATION_RUNTIME.patientMedicationAiEnabled,
    permission_key: permissionKey,
  };
}

export function hashMedicationCommand(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
