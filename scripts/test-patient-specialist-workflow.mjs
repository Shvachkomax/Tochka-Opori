import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5179;
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = "synthetic-anmed-session-01";
let serviceRequest = null;
let createRequestObserved = false;
let patientPage;
let browser;
const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: "ignore",
  env: { ...process.env, BROWSER: "none", VITE_APP_BRAND: "anmed" },
});

const preliminarySummary = "Синтетический пациент описал бессонницу, снижение аппетита и частое сердцебиение.";
const attentionSignals = "Маркеры риска: требуется уточнить динамику состояния\nМодифицирующие факторы: снижение аппетита и изоляция";
const specialistReply = "Синтетический ответ специалиста: предлагаю обсудить следующий шаг на встрече.";

function makeCabinetResponse() {
  return {
    ok: true,
    session_id: sessionId,
    public_code: "ТОЧКА-SYNT-CASE1",
    sessions: [{ sessionId, publicCode: "ТОЧКА-SYNT-CASE1", createdAt: "2026-10-20T10:00:00.000Z", summary: "Синтетический разговор о самочувствии", status: "first_contact", order: 1 }],
    latest_report: { user_report: preliminarySummary, careRecommendation: { level: "professional_contact" } },
    specialist: { expertId: "synthetic-specialist-id", expertName: "Синтетический специалист", expertRole: "Психолог" },
    service_requests: serviceRequest ? [{ ...serviceRequest }] : [],
    match_requests: [],
    wallet: null,
    medication_cards: [],
  };
}

async function installPatientApiMocks(context) {
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/client-token") return route.fulfill({ json: { token: "synthetic-client-token", expires_at: Date.now() + 60_000 } });
    if (path === "/api/start-session") return route.fulfill({ json: { ok: true, session_id: sessionId, access_token: "synthetic-patient-token" } });
    if (path === "/api/analyze") {
      return route.fulfill({ json: {
        type: "final",
        report: `===USER_REPORT===\n\n${preliminarySummary}\n\n6. Следующий шаг\n\nОбсудите изменения со специалистом.\n\n===DOCTOR_REPORT===\n\n${attentionSignals}`,
        care_recommendation: { level: "professional_contact", timeframe: "within_days", reasons: ["somatic_symptoms"], specialist_types: ["general_physician"] },
        public_code: "ТОЧКА-SYNT-CASE1",
        access_token: "synthetic-patient-token",
        continuation_code: "ТОЧКА-SYNT-CASE1-AAAA-BBBB-CCCC",
      } });
    }
    if (path === "/api/session") {
      const body = route.request().postDataJSON();
      if (body.action === "getCabinet") return route.fulfill({ json: makeCabinetResponse() });
      if (body.action === "createSupportServiceRequest") {
        createRequestObserved = true;
        assert.equal(body.session_id, sessionId, "service request is linked to the conversation the patient acted from");
        assert.equal(body.access_token, "synthetic-patient-token", "request creation uses the patient's session access token");
        serviceRequest = {
          id: "synthetic-service-request-01",
          request_type: "text_question",
          meeting_format: "text",
          title: "Синтетический запрос специалисту",
          message: body.message,
          status: "submitted",
          created_at: "2026-10-20T10:05:00.000Z",
          specialist_response: null,
        };
        return route.fulfill({ json: { ok: true, request: serviceRequest } });
      }
      if (body.action === "getSupportCheckins") return route.fulfill({ json: { ok: true, history: [], today: null } });
      if (body.action === "getSupportPractices") return route.fulfill({ json: { ok: true, practices: [] } });
      if (body.action === "listPatientInvitations") return route.fulfill({ json: { ok: true, invitations: [] } });
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/reviews") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: { ok: true } });
  });
}

async function installSpecialistApiMocks(context) {
  await context.route("**/api/specialist", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "me") return route.fulfill({ status: 401, json: { ok: false, error: "Неверный код специалиста" } });
    if (body.action === "login") return route.fulfill({ json: {
      ok: true,
      expert: { id: "synthetic-specialist-id", name: "Синтетический специалист", specialty: "Психолог", allowed_modules: ["support"] },
      memberships: [],
    } });
    if (body.action === "listClients") return route.fulfill({ json: { ok: true, clients: [] } });
    if (body.action === "listInvitations") return route.fulfill({ json: { ok: true, invitations: [] } });
    if (body.action === "listServiceRequests") {
      return route.fulfill({ json: { ok: true, requests: serviceRequest ? [{
        request_ref: `service-request:${serviceRequest.id}`,
        module: "support",
        client_display_name: "Синтетический пациент",
        request_type: serviceRequest.request_type,
        title: serviceRequest.title,
        message: serviceRequest.message,
        status: serviceRequest.status,
        created_at: serviceRequest.created_at,
        specialist_response: serviceRequest.specialist_response,
        clinical_context: {
          session_date: "2026-10-20T10:00:00.000Z",
          preliminary_summary: preliminarySummary,
          signals_for_attention: attentionSignals,
          crisis_context: null,
        },
      }] : [] } });
    }
    if (body.action === "updateServiceRequest") {
      assert.equal(body.request_ref, `service-request:${serviceRequest.id}`);
      if (body.update_action === "accept") serviceRequest.status = "accepted";
      if (body.update_action === "answer") {
        serviceRequest.status = "answered";
        serviceRequest.specialist_response = body.specialist_response;
      }
      return route.fulfill({ json: { ok: true, status: serviceRequest.status } });
    }
    return route.fulfill({ json: { ok: true, requests: [] } });
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Vite workflow test server exited before startup");
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "local Vite server starts for synthetic patient-specialist workflow");
  browser = await chromium.launch({ headless: true, channel: "chrome" });

  const patientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installPatientApiMocks(patientContext);
  patientPage = await patientContext.newPage();
  await patientPage.goto(baseUrl, { waitUntil: "networkidle" });
  await patientPage.locator("textarea").first().fill("Синтетический пациент: несколько недель плохо сплю, снизился аппетит и бывает сердцебиение.");
  await patientPage.getByRole("button", { name: "Начать разбор" }).click();
  await patientPage.getByText("Сохраните код продолжения").waitFor();
  await patientPage.getByRole("button", { name: "Перейти в личный кабинет" }).click();
  await patientPage.getByText("Синтетический специалист").first().waitFor();

  await patientPage.getByRole("button", { name: "Связаться", exact: true }).click();
  await patientPage.getByRole("button", { name: /Короткий follow-up/ }).click();
  await patientPage.getByPlaceholder("Опишите, что хотите обсудить со специалистом...").fill("Синтетический запрос по связанному разговору.");
  await patientPage.getByRole("button", { name: "Отправить запрос" }).click();
  await patientPage.getByText("Отправлен — ожидает ответа").waitFor();
  assert(createRequestObserved, "patient explicitly created a request after the conversation");

  const specialistContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await installSpecialistApiMocks(specialistContext);
  const doctorPage = await specialistContext.newPage();
  await doctorPage.goto(`${baseUrl}/specialist`, { waitUntil: "networkidle" });
  await doctorPage.getByPlaceholder("Код специалиста").fill("SYNTHETIC-DOCTOR-CODE");
  await doctorPage.getByRole("button", { name: "Войти" }).click();
  await doctorPage.getByTestId("specialist-cabinet").waitFor();
  const requestCard = doctorPage.getByTestId("service-request-card");
  await requestCard.getByText(preliminarySummary).waitFor();
  await requestCard.getByText(/Маркеры риска: требуется уточнить динамику состояния/).waitFor();
  await requestCard.getByRole("button", { name: "Принять" }).click();
  await requestCard.getByRole("button", { name: "Ответить" }).waitFor();
  doctorPage.once("dialog", (dialog) => dialog.accept(specialistReply));
  await requestCard.getByRole("button", { name: "Ответить" }).click();
  await requestCard.getByText("подробнее").click();
  await requestCard.getByText(specialistReply).waitFor();
  assert.equal(serviceRequest.status, "answered", "doctor accepted and answered the linked request");

  await patientPage.reload({ waitUntil: "networkidle" });
  await patientPage.getByRole("button", { name: "Продолжить последний разговор" }).click();
  await patientPage.getByText("Получен ответ").waitFor();
  await patientPage.getByText(specialistReply).waitFor();
  console.log("Synthetic patient → linked specialist request → clinician response → patient status/reply workflow passed.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
