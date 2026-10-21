import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5178;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: "ignore",
  env: { ...process.env, BROWSER: "none", VITE_APP_BRAND: "anmed" },
});

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Vite test server exited before startup");
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "local Vite server starts for mock API browser test");

  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let analyzeCalls = 0;

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/client-token") {
      return route.fulfill({ json: { token: "synthetic-client-token", expires_at: Date.now() + 60_000 } });
    }
    if (url.pathname === "/api/start-session") {
      return route.fulfill({ json: { ok: true, session_id: "synthetic-session-001", access_token: "synthetic-access-token" } });
    }
    if (url.pathname === "/api/analyze") {
      analyzeCalls += 1;
      if (analyzeCalls === 1) {
        return route.fulfill({ json: {
          type: "crisis_questions",
          questions: [
            "Вы сейчас в безопасности? Есть ли риск, что вы причините себе вред в ближайшее время?",
            "Есть ли у вас сейчас намерение или конкретный план причинить себе вред?",
            "Вы сейчас один/одна? Кто может побыть рядом или поговорить с вами?",
            "Кому вы можете позвонить или написать прямо сейчас?",
          ],
          crisis: { status: "safety_check_in_progress", emergency_contacts: ["112", "103"] },
        } });
      }
      return route.fulfill({ json: {
        type: "final",
        report: "===USER_REPORT===\n\nКризисная поддержка\n\nПозвоните 112 или 103 сейчас.\n\n===DOCTOR_REPORT===\n\nСинтетический контекст.",
        care_recommendation: { level: "urgent_help", timeframe: "today" },
        crisis: { emergencyRecommended: true, status: "urgent_help" },
      } });
    }
    if (url.pathname === "/api/session") {
      const requestBody = route.request().postDataJSON();
      if (requestBody.action === "exchangeContinuationCredential") {
        if (requestBody.continuation_code === "ТОЧКА-ABCD-EFGH") {
          return route.fulfill({ status: 403, json: { ok: false, error: "Это короткий код из старой версии. Создайте новый код на устройстве, где беседа уже открывается." } });
        }
        return route.fulfill({ json: {
          ok: true,
          session_id: "synthetic-session-restored",
          access_token: "synthetic-restored-access-token",
          public_code: "ТОЧКА-ABCD-EFGH",
        } });
      }
      if (requestBody.action === "getCabinet") {
        return route.fulfill({ json: {
          ok: true,
          session_id: "synthetic-session-restored",
          public_code: "ТОЧКА-ABCD-EFGH",
          sessions: [{ sessionId: "synthetic-session-restored", publicCode: "ТОЧКА-ABCD-EFGH", createdAt: "2026-10-20T10:00:00.000Z", summary: "Беседа, восстановленная новым кодом", status: "first_contact", order: 1 }],
          latest_report: {
            user_report: "",
            crisisBlock: {
              status: "safety_check_in_progress",
              initial_message: "У меня участились мысли о смерти.",
              markers: ["мысли о смерти"],
              questions: [
                "Вы сейчас в безопасности? Есть ли риск, что вы причините себе вред в ближайшее время?",
                "Есть ли у вас сейчас намерение или конкретный план причинить себе вред?",
                "Вы сейчас один/одна? Кто может побыть рядом или поговорить с вами?",
                "Кому вы можете позвонить или написать прямо сейчас?",
              ],
              emergency_contacts: ["112", "103"],
            },
          },
          service_requests: [],
          match_requests: [],
          wallet: null,
          specialist: null,
          medication_cards: [],
        } });
      }
      if (requestBody.action === "getSupportCheckins") return route.fulfill({ json: { ok: true, history: [], today: null } });
      if (requestBody.action === "getSupportPractices") return route.fulfill({ json: { ok: true, practices: [] } });
      if (requestBody.action === "listPatientInvitations") return route.fulfill({ json: { ok: true, invitations: [] } });
      if (requestBody.action === "getReport") return route.fulfill({ json: { ok: true, session: { sessionId: "synthetic-session-restored", patient_input: "Беседа, восстановленная новым кодом", user_report: "Отчёт восстановленной беседы", createdAt: "2026-10-20T10:00:00.000Z" } } });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true, requests: [], invitations: [] } });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("textarea").first().fill("У меня участились мысли о смерти, всем было бы легче без меня.");
  await page.getByRole("button", { name: "Начать разбор" }).click();

  await page.getByText("Сначала — ваша безопасность").waitFor();
  const safetyQuestionInputs = page.locator('textarea[aria-label^="Ответ на вопрос"]');
  assert.equal(await safetyQuestionInputs.count(), 4, "only the four short safety questions appear");

  for (const number of ["112", "103"]) {
    const callButton = page.getByRole("link", { name: `Позвонить ${number}` }).first();
    const box = await callButton.boundingBox();
    assert(box, `emergency call link ${number} is visible`);
    assert(box.x >= 0 && box.x + box.width <= 375, `emergency call link ${number} fits 375px mobile width`);
    assert(box.height >= 44, `emergency call link ${number} has a touch target at least 44px high`);
    assert.equal(await callButton.getAttribute("href"), `tel:${number}`);
  }

  await safetyQuestionInputs.nth(0).fill("Я не могу гарантировать, что останусь в безопасности.");
  await safetyQuestionInputs.nth(1).fill("Пока не могу ответить.");
  await safetyQuestionInputs.nth(2).fill("Я один.");
  await safetyQuestionInputs.nth(3).fill("Могу позвонить близкому.");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.getByText("План безопасности и срочная помощь").waitFor();
  assert.equal(analyzeCalls, 2, "crisis clarification ends without ordinary additional rounds");
  assert(await page.getByRole("link", { name: "Позвонить 112" }).last().isVisible());
  assert(await page.getByRole("link", { name: "Позвонить 103" }).last().isVisible());

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Продолжить разговор", exact: true }).click();
  await page.getByPlaceholder("Код продолжения").fill("ТОЧКА-ABCD-EFGH");
  await page.getByRole("button", { name: "Продолжить по коду" }).click();
  await page.getByText(/короткий код из старой версии/iu).last().waitFor();
  assert(await page.getByText("Вернуться к разговору").isVisible(), "the legacy-code explanation leaves the recovery route open");
  await page.getByPlaceholder("Код продолжения").fill("ТОЧКА-ABCD-EFGH-AAAA-BBBB-CCCC");
  await page.getByRole("button", { name: "Продолжить по коду" }).click();
  await page.getByText("Беседа, восстановленная новым кодом").first().waitFor();
  assert(await page.getByText("История разговоров").isVisible(), "a new continuation code restores the patient conversation list");
  await page.getByRole("button", { name: "Продолжить разговор", exact: true }).first().click();
  await page.getByText("Сначала — ваша безопасность").waitFor();
  assert.equal(await page.locator('textarea[aria-label^="Ответ на вопрос"]').count(), 4, "an interrupted safety check resumes with direct questions");
  await page.locator('textarea[aria-label^="Ответ на вопрос"]').nth(0).fill("Я сейчас в безопасности.");
  await page.locator('textarea[aria-label^="Ответ на вопрос"]').nth(1).fill("Нет плана и намерения.");
  await page.locator('textarea[aria-label^="Ответ на вопрос"]').nth(2).fill("Я не один.");
  await page.locator('textarea[aria-label^="Ответ на вопрос"]').nth(3).fill("Позвоню близкому.");
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.getByText("План безопасности и срочная помощь").waitFor();
  assert.equal(analyzeCalls, 3, "resuming the interrupted safety check still skips ordinary clarification rounds");

  console.log("Crisis and continuation mobile browser regression test passed (375px; crisis can resume; emergency links tappable; new code restores conversations).");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
