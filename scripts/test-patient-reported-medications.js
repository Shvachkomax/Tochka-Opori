import {
  buildPatientMedicationContext,
  buildScheduledMedicationIntakes,
  isMedicationDate,
  isPatientMedicationOrderStatus,
  patientMedicationOwnerMatches,
  projectMedicationIntakes,
  validateMedicationIntake,
  validatePatientMedicationOrder,
} from "../lib/clinical/patient-reported-medication.js";
import { validateSpecialistContext } from "../api/specialist.js";

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

const healthOwner = { ownerType: "anonymous_profile", ownerId: "11111111-1111-4111-8111-111111111111", sourceModule: "health" };
const supportOwner = { ownerType: "anonymous_case", ownerId: "22222222-2222-4222-8222-222222222222", sourceModule: "support" };
const baseOrder = {
  item_type: "medication", name: "Сертралин", single_dose: "50", dose_unit: "мг",
  frequency_type: "times_per_day", times_per_day: "1", start_date: "2026-10-05", ongoing: true,
};

console.log("Patient-reported medication orders");
const medication = validatePatientMedicationOrder(baseOrder);
assert(medication.ok && medication.order.reported_as_doctor_order, "valid medication order is represented as patient-reported physician order");
const supplement = validatePatientMedicationOrder({ ...baseOrder, item_type: "supplement", name: "Омега-3" });
assert(supplement.ok && supplement.order.item_type === "supplement", "supplement is stored as a separate item type");
assert(!validatePatientMedicationOrder({ ...baseOrder, name: "" }).ok, "order without a name is rejected");
assert(!validatePatientMedicationOrder({ ...baseOrder, single_dose: 0 }).ok, "zero dose is rejected");
assert(!validatePatientMedicationOrder({ ...baseOrder, start_date: "2026-02-31" }).ok, "invalid calendar dates are rejected");
assert(isMedicationDate("2026-10-05") && !isMedicationDate("2026-02-31"), "schedule date validation uses exact calendar dates");
const editedSchedule = validatePatientMedicationOrder({ ...baseOrder, times_per_day: "2", scheduled_times: null });
assert(editedSchedule.ok && editedSchedule.order.times_per_day === 2, "schedule can be edited to two doses per day");
assert(isPatientMedicationOrderStatus("completed") && !isPatientMedicationOrderStatus("deleted"), "completion/archive statuses are allowlisted");

console.log("\nScheduled tasks and intake facts");
const timedOrder = { ...medication.order, id: "med-1", status: "active", frequency_type: "scheduled_times", times_per_day: null, scheduled_times: ["08:00", "20:00"] };
const noClockOrder = { ...medication.order, id: "med-2", name: "Витамин", status: "active", times_per_day: 2 };
const schedules = buildScheduledMedicationIntakes([timedOrder, noClockOrder], "2026-10-05");
assert(schedules.length === 4, "two active orders produce deterministic daily tasks");
assert(schedules.some((task) => task.scheduled_time === "08:00") && schedules.some((task) => task.scheduled_time === null), "explicit time and unspecified-time slots are kept distinct");
assert(buildScheduledMedicationIntakes([], "2026-10-05").length === 0, "Health diary without medication orders remains empty and usable");
assert(buildScheduledMedicationIntakes([{ ...timedOrder, status: "paused" }], "2026-10-05").length === 0, "paused orders do not create tasks");

const taken = validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "taken" });
const missed = validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "missed" });
const late = validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "taken_late", actual_time: "09:15" });
const different = validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "different_dose", actual_dose: "25", actual_dose_unit: "мг", patient_note: "Самочувствие без изменений" });
assert(taken.ok && missed.ok && late.ok && different.ok, "taken, missed, taken-late and different-dose facts validate separately from the order");
assert(!validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "taken_late" }).ok, "late intake requires actual time");
assert(!validateMedicationIntake({ scheduled_date: "2026-10-05", scheduled_slot: 1, status: "different_dose", actual_dose: 0, actual_dose_unit: "мг" }).ok, "different-dose intake requires a positive factual dose");
assert(projectMedicationIntakes(schedules, [{ medication_order_id: "med-1", scheduled_slot: 1, status: "taken" }])[0].intake_log.status === "taken", "saved intake is projected onto its matching scheduled slot only");

console.log("\nPatient and specialist access scopes");
assert(patientMedicationOwnerMatches({ owner_type: healthOwner.ownerType, owner_id: healthOwner.ownerId, source_module: healthOwner.sourceModule }, healthOwner), "patient's Health rows match their validated owner scope");
assert(!patientMedicationOwnerMatches({ ...supportOwner }, healthOwner), "patient cannot read another owner's or module's rows");
const specialistAccess = validateSpecialistContext({ memberships: [], organizationId: null, module: "support", allowedModules: ["support"] });
const wrongModule = validateSpecialistContext({ memberships: [], organizationId: null, module: "body", allowedModules: ["support"] });
assert(specialistAccess.ok && !wrongModule.ok, "specialist data access remains constrained by module entitlement");
const emptyContext = buildPatientMedicationContext([], [], []);
assert(emptyContext.active_orders.length === 0 && emptyContext.recent_intake.length === 0, "Support without patient-reported medication has an empty, non-blocking context");
assert(emptyContext.provenance === "patient_reported_not_independently_verified", "AI context explicitly preserves patient-reported provenance");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
process.exit(0);
