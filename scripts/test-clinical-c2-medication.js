import {
  MEDICATION_RUNTIME,
  SAFE_MEDICATION_PERMISSION_KEYS,
  getMedicationOrderState,
  isMedicationSessionEligible,
  mapMedicationCard,
  mapMedicationOrder,
  medicationOrderRef,
  normalizeMedicationPermissionKeys,
  parseMedicationOrderRef,
  resolveMedicationPermission,
} from "../lib/clinical/medication.js";

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

const orderId = "11111111-1111-4111-8111-111111111111";
const baseOrder = {
  id: orderId,
  valid_from: "2026-01-01T00:00:00.000Z",
  valid_until: "2026-02-01T00:00:00.000Z",
};

console.log("1. C2 runtime boundary");
assert(MEDICATION_RUNTIME.prescribingModules.length === 1 && MEDICATION_RUNTIME.prescribingModules[0] === "support", "prescribing runtime is Support-only");
assert(MEDICATION_RUNTIME.patientMedicationAiEnabled === false, "patient medication AI is disabled");
assert(isMedicationSessionEligible({ legacy_access: false }), "current patient session can access medication card");
assert(isMedicationSessionEligible({ legacy_access: true }) === false, "legacy patient session cannot access medication card");
assert(isMedicationSessionEligible({}) === false, "malformed patient session cannot access medication card");
assert(!SAFE_MEDICATION_PERMISSION_KEYS.some((key) => ["change_dose", "stop_medication", "suggest_medication", "titrate"].includes(key)), "permission list contains no treatment-changing capability");

console.log("\n2. Safe permission validation");
assert(normalizeMedicationPermissionKeys(SAFE_MEDICATION_PERMISSION_KEYS).ok, "all safe permissions are accepted");
assert(normalizeMedicationPermissionKeys(["change_dose"]).ok === false, "dose change permission is rejected");
assert(normalizeMedicationPermissionKeys(["stop_medication"]).ok === false, "stop permission is rejected");
assert(normalizeMedicationPermissionKeys(["view_authorized_order", "view_authorized_order"]).ok === false, "duplicate permissions are rejected");
assert(normalizeMedicationPermissionKeys("view_authorized_order").ok === false, "non-array permissions are rejected");

console.log("\n3. Opaque order references");
const ref = medicationOrderRef(orderId);
assert(ref === `medication-order:${orderId}`, "order reference is opaque and deterministic");
assert(parseMedicationOrderRef(ref) === orderId, "valid order reference parses");
assert(parseMedicationOrderRef("medication-order:not-an-id") === null, "invalid order reference is rejected");

console.log("\n4. Order state derivation");
assert(getMedicationOrderState(baseOrder, [{ event_type: "activated" }], new Date("2026-01-15")) === "active", "activated order is active");
assert(getMedicationOrderState(baseOrder, [{ event_type: "activated" }, { event_type: "superseded" }], new Date("2026-01-15")) === "superseded", "superseded order is terminal");
assert(getMedicationOrderState(baseOrder, [{ event_type: "activated" }, { event_type: "revoked" }], new Date("2026-01-15")) === "revoked", "revoked order is terminal");
assert(getMedicationOrderState(baseOrder, [{ event_type: "activated" }], new Date("2026-02-01")) === "expired", "expiration is derived without scheduler");
assert(getMedicationOrderState(baseOrder, [{ event_type: "activated" }], new Date("2025-12-31")) === "scheduled", "future order is scheduled");

console.log("\n5. Patient card boundary");
const card = mapMedicationCard({
  order_ref: ref,
  medication_name: "Synthetic medication",
  formulation: "tablet",
  strength_value: 25,
  strength_unit: "mg",
  route_code: "oral",
  schedules: [],
  valid_from: baseOrder.valid_from,
  valid_until: baseOrder.valid_until,
  effective_state: "active",
  prescriber: { name: "Synthetic prescriber", specialty: "doctor" },
  clinician_instruction: "Follow the clinician's written instruction.",
  order_id: orderId,
  owner_id: "22222222-2222-4222-8222-222222222222",
});
assert(card.read_only === true, "patient card is read-only");
assert(card.order_id === undefined && card.owner_id === undefined, "patient card omits internal identifiers");
assert(card.prescriber?.name === "Synthetic prescriber", "patient card contains safe prescriber display");

const capped = mapMedicationOrder({ ...baseOrder, module: "support", owner_type: "anonymous_case", organization_id: null, order_group_id: "66666666-6666-4666-8666-666666666666", version_number: 1, medication_concept_id: "77777777-7777-4777-8777-777777777777", medication_name_snapshot: "Synthetic medication", strength_value: 25, strength_unit: "mg", route_code: "oral", valid_until: "2026-02-01T00:00:00.000Z", prescriber_expert_id: "88888888-8888-4888-8888-888888888888", prescriber_authorization_id: "99999999-9999-4999-8999-999999999999", created_at: baseOrder.valid_from }, [{ phase_number: 1, dosing_mode: "fixed", phase_start_at: baseOrder.valid_from, phase_end_at: null, dose_amount: 25, dose_unit: "mg", frequency_code: "once_daily", route_code: "oral", timezone: "Europe/Moscow" }], [{ event_type: "activated" }], []);
assert(capped.schedules[0].phase_end_at === baseOrder.valid_until, "finite order caps an open-ended final schedule phase");

const disabledResolverResult = await resolveMedicationPermission({ module: "body", permissionKey: "view_authorized_order" });
assert(disabledResolverResult.allowed === false && disabledResolverResult.reason === "module_disabled", "disabled resolver returns deny state");
assert(!Object.hasOwn(disabledResolverResult, "order") && !Object.hasOwn(disabledResolverResult, "owner_id"), "resolver result does not expose clinical or authorization internals");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
