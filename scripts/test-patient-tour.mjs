import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PATIENT_TOUR_INVITE_DELAY_MS,
  PATIENT_TOUR_INVITE_PULSE_MS,
  PATIENT_TOUR_STEPS,
  parsePatientTourProgress,
  patientTourStepStatus,
  patientTourInviteKey,
  patientTourStorageKey,
  shouldInviteToPatientTour,
} from "../lib/my-practice/patient-onboarding-tour.js";

const expectedIds = ["overview", "diary", "ai", "specialist", "booking", "health", "complete"];
assert.deepEqual(PATIENT_TOUR_STEPS.support.map(({ id }) => id), expectedIds);
assert.deepEqual(PATIENT_TOUR_STEPS.health.map(({ id }) => id), expectedIds);
assert.equal(new Set(PATIENT_TOUR_STEPS.support.map(({ target }) => target)).size, 6);
assert.equal(new Set(PATIENT_TOUR_STEPS.health.map(({ target }) => target)).size, 6);
assert.equal(PATIENT_TOUR_INVITE_DELAY_MS, 1600);
assert.equal(PATIENT_TOUR_INVITE_PULSE_MS, 10000);

const patientA = "private-session-a";
const patientB = "private-session-b";
const supportA = patientTourStorageKey("support", patientA);
const supportB = patientTourStorageKey("support", patientB);
const healthA = patientTourStorageKey("health", patientA);
assert.notEqual(supportA, supportB, "patients have separate progress");
assert.notEqual(supportA, healthA, "Support and Health have separate progress");
assert.ok(!supportA.includes(patientA), "raw patient/session scope is not exposed in storage keys");
assert.notEqual(patientTourInviteKey("support", patientA), patientTourInviteKey("support", patientB));

assert.deepEqual(parsePatientTourProgress(null), { completed: false, step: 0 });
assert.deepEqual(parsePatientTourProgress("4"), { completed: false, step: 4 });
assert.deepEqual(parsePatientTourProgress("complete"), { completed: true, step: 0 });
assert.deepEqual(parsePatientTourProgress("999"), { completed: false, step: 0 });
assert.equal(shouldInviteToPatientTour(), true, "first visit is invited");
assert.equal(shouldInviteToPatientTour({ dismissed: true }), false, "dismissal persists on repeat visit");
assert.equal(shouldInviteToPatientTour({ completed: true }), false, "completed tour is not invited again");
assert.match(patientTourStepStatus("specialist", { specialists: 0 }), /пока нет/);
assert.match(patientTourStepStatus("booking", { specialists: 1, services: 0 }), /Специалист прикреплён/);
assert.doesNotMatch(patientTourStepStatus("booking", { specialists: 1, services: 0 }), /отсутствует врач/i);
assert.match(patientTourStepStatus("booking", { unavailable: true }), /временно недоступен/);

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const health = readFileSync(new URL("../src/HealthCabinet.jsx", import.meta.url), "utf8");
const booking = readFileSync(new URL("../src/pages/specialist/PracticePatientBooking.jsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../src/components/PatientCabinetTour.jsx", import.meta.url), "utf8");
const shared = readFileSync(new URL("../src/components/GuidedTour.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/components/PatientCabinetTour.css", import.meta.url), "utf8");

assert.ok(app.includes('<PatientCabinetTour profile="support"'));
assert.ok(health.includes('<PatientCabinetTour profile="health"'));
for (const target of ["patient-overview", "patient-diary", "patient-ai", "patient-specialist", "patient-booking", "patient-health"]) {
  assert.ok(`${app}\n${health}\n${booking}`.includes(`data-tour-target="${target}"`), `real DOM target ${target} exists`);
}
assert.ok(shared.includes('aria-modal="false"'), "tour does not trap interaction with highlighted controls");
assert.ok(shared.includes("scrollIntoView"), "real targets are brought into view");
assert.ok(css.includes("prefers-reduced-motion:reduce"), "patient invitation respects reduced motion");
assert.ok(!controller.includes("fetch("), "tour controller performs no API or medical writes");
assert.ok(!controller.includes("reservePracticeBooking"), "tour never creates a booking");
assert.ok(!controller.includes("HealthLiveConversation"), "tour never starts a voice session");
assert.ok(booking.includes("активных серверных услуг для записи пока нет"), "attached specialist without services has a distinct empty state");
assert.ok(booking.includes("Это не означает, что прикреплённый специалист отсутствует"), "server outage is not reported as no specialist");

console.log("A3.7 patient tour unit checks: PASS (7 steps, scoped progress, contextual empty states, safe real targets)");
