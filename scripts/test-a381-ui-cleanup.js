import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PATIENT_TOUR_STEPS } from "../lib/my-practice/patient-onboarding-tour.js";
import { TOUR_STEPS } from "../lib/my-practice/onboarding-tour.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const main = read("src/main.jsx");
const cabinet = read("src/pages/specialist/SpecialistCabinet.jsx");
const practice = read("src/pages/specialist/PracticeBookingPanel.jsx");
const library = read("src/pages/specialist/ClinicalKnowledge.jsx");
const timeline = read("src/pages/specialist/ClinicalTimelinePanel.jsx");
const patientRequests = read("src/BodyServiceRequests.jsx");
const app = read("src/App.jsx");
const clinicalApi = read("api/clinical-knowledge.js");
const clinicalService = read("lib/clinical/knowledge/service.js");

for (const route of [
  "/specialist/my-practice/demo",
  "/specialist/my-practice/booking-demo",
  "/specialist/knowledge/demo",
]) {
  assert(!main.includes(route), `${route} must not be mounted in the user entry point`);
}
for (const component of ["ClinicalKnowledgeDemo", "MyPracticePilot", "MyPracticePatientBookingDemo"]) {
  assert(!main.includes(component), `${component} must remain an internal fixture`);
}
assert(main.includes("pathname === '/specialist/knowledge'"), "The connected clinical library route must remain available");
assert(!main.includes(".stack"), "The user error screen must not expose stack traces");

assert(!library.includes("/specialist/knowledge/demo"));
assert(!library.includes("Демонстрационный результат"));
assert(!library.includes("Демонстрационное описание"));
assert(!library.includes("тестовые данные"));
assert(!library.includes("provider_mode"), "Provider implementation modes must not be shown to users");
assert(library.includes("подключённым справочным источникам"));
assert(library.includes("Списание средств не выполнялось"));

assert(!timeline.includes("SYNTHETIC"), "Synthetic chronology must not be embedded in the patient card");
assert(!timeline.includes("Учебный пример"));
assert(timeline.includes("getClinicalTimeline"));
assert(timeline.includes("Не изменяйте"));

assert(!cabinet.includes("<PartnerProgram"), "Test-only partner accounting must not appear in the ordinary cabinet");
assert(cabinet.includes("<PracticeBookingPanel"), "Server-backed My Practice must remain in the cabinet");
assert(cabinet.includes("<ClinicalTimelinePanel"));
assert(practice.includes('callPractice("savePracticeService"'));
assert(practice.includes('callPractice("savePracticeAvailability"'));
assert(practice.includes('callPractice("listPracticeBookings"'));
assert(practice.includes('mutate("resetPracticeAvailabilityDefaults"'));
assert(practice.includes("Сделать выходным"));
assert(practice.includes("Добавить исключение"));
assert(practice.includes("Восстановить 09:00–18:00 на всю неделю"));
assert(practice.includes("Начислено специалисту"));
assert(practice.includes("Комиссия сервиса"));

assert(!patientRequests.includes("это тестовый режим"));
assert(patientRequests.includes("отправка запроса не списывает средства"));
assert(!app.includes("Тестовый режим: фактическое списание"));

assert(clinicalApi.includes("allowSyntheticFallback: false"), "User searches must never fall back to synthetic clinical cases");
assert(clinicalService.includes('source_type === "synthetic_case"'));
assert(clinicalService.includes('provider: hasVerifiedResults ? "approved_clinical_cases"'));

assert.equal(TOUR_STEPS.length, 3, "A3.6 specialist tour must keep three steps");
assert.equal(PATIENT_TOUR_STEPS.support.length, 7, "A3.7 Support patient tour must keep seven steps");
assert.equal(PATIENT_TOUR_STEPS.health.length, 7, "A3.7 Health patient tour must keep seven steps");

console.log("A3.8.1 UI cleanup: PASS (public routes, professional copy, real data paths, tours preserved)");
