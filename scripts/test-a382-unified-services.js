import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PATIENT_TOUR_STEPS } from "../lib/my-practice/patient-onboarding-tour.js";
import { TOUR_STEPS } from "../lib/my-practice/onboarding-tour.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261121133131_a382_practice_service_modules.sql");
const bodyUi = read("src/BodyServiceRequests.jsx");
const supportUi = read("src/App.jsx");
const doctorUi = read("src/pages/specialist/PracticeBookingPanel.jsx");
const patientUi = read("src/pages/specialist/PracticePatientBooking.jsx");
const handler = read("lib/my-practice/booking-handler.js");
const patientCatalog = read("lib/my-practice/patient-cabinet.js");
const sessionApi = read("api/session.js");

assert(migration.includes("add column if not exists modules text[]"));
assert(migration.includes("array['support', 'body']::text[]"));
assert(migration.includes("practice_services_modules_check"));
assert(migration.includes("practice_services_active_modules_idx"));
assert(!migration.match(/disable row level security|grant\s+.*anon|drop table/i));

assert(bodyUi.includes("Задать вопрос специалисту"));
assert(bodyUi.includes("Записаться к своему специалисту"));
assert(bodyUi.includes("Стоимость уточняется специалистом. Отправка вопроса не резервирует и не списывает кредиты."));
assert(bodyUi.includes("<PracticePatientBooking"));
assert(!bodyUi.includes('apiCall("getServicePricing"'));
assert(!bodyUi.includes("Загрузка актуальных тарифов"));

assert(supportUi.includes('request_type: "question"'));
assert(supportUi.includes("Стоимость уточняется специалистом. Отправка вопроса не резервирует и не списывает кредиты."));
for (const oldPrice of ["credits: 10000", "credits: 20000", "credits: 75000"]) {
  assert(!supportUi.includes(oldPrice), `ordinary Support UI must not embed ${oldPrice}`);
}

assert(sessionApi.includes("A3.8.2 ordinary Health questions are deliberately unpriced"));
assert(sessionApi.includes("effectiveServiceCode = null"));
assert(sessionApi.includes('requestType = "text_question"'));
assert(sessionApi.includes("A3.8.2 ordinary Support questions are unpriced"));
assert(sessionApi.includes('requestType = "question"'));
assert(sessionApi.includes('.from("service_pricing")'), "legacy pricing dependency remains available");

assert(patientCatalog.includes('.contains("modules", [module])'));
assert(patientCatalog.includes("getAttachedPracticeService"));
assert(handler.includes("listPracticePatientSpecialists(supabase, [owner], owner.module)"));
assert(handler.includes("getAttachedPracticeService(supabase, owner, service_id)"));
assert(handler.includes("Нет доступа к выбранному разделу"));
assert(handler.includes("Сессия пациента не проверена"));

assert(doctorUi.includes("a2-service-module-${value}"));
assert(doctorUi.includes('[["support", "Support"], ["body", "Health"]]'));
assert(doctorUi.includes("Кредитный эквивалент рассчитает сервер после сохранения цены."));
assert(!doctorUi.includes("Math.ceil(Number(price || 0) * 10)"));
assert(patientUi.includes("creditsPerRuble"));
assert(!patientUi.includes("topUp / 10"));
assert(!patientUi.includes("available_credits / 10"));

assert(doctorUi.includes('mutate("resetPracticeAvailabilityDefaults"'));
assert(doctorUi.includes("Сделать выходным"));
assert(doctorUi.includes("Добавить исключение"));
assert.equal(TOUR_STEPS.length, 3, "A3.6 doctor tour remains three steps");
assert.equal(PATIENT_TOUR_STEPS.support.length, 7, "A3.7 Support tour remains seven steps");
assert.equal(PATIENT_TOUR_STEPS.health.length, 7, "A3.7 Health tour remains seven steps");

console.log("A3.8.2 unified services: migration, unpriced questions, attached catalog, server pricing, schedule and tours PASS");
