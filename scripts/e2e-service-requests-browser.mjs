import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const ACCESS_CODE = process.env.E2E_SPECIALIST_ACCESS_CODE;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";

if (!ACCESS_CODE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Set E2E_SPECIALIST_ACCESS_CODE, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for TEST E2E.");
}
if (!SUPABASE_URL.includes(TEST_PROJECT_REF) || !BASE_URL.includes("tochka-opori-test.vercel.app")) {
  throw new Error("Refusing to run service-request E2E outside TEST.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const cleanupIds = [];

function assert(condition, message) {
  results.push({ message, ok: Boolean(condition) });
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function main() {
  const { data: expert } = await supabase
    .from("experts")
    .select("id")
    .eq("access_code", ACCESS_CODE)
    .single();
  assert(Boolean(expert?.id), "TEST specialist fixture resolves");

  const ownerId = crypto.randomUUID();
  const title = `E2E service request ${Date.now()}`;
  const { data: request, error } = await supabase
    .from("service_requests")
    .insert({
      owner_type: "anonymous_case",
      owner_id: ownerId,
      module: "support",
      specialist_id: expert.id,
      specialist_name: "E2E specialist",
      request_type: "text_question",
      meeting_format: "text",
      title,
      message: "Проверка workflow service request",
      status: "submitted",
      client_contact: {},
    })
    .select("id")
    .single();
  if (error) throw error;
  cleanupIds.push(request.id);

  const failureTitle = `E2E failed service request ${Date.now()}`;
  const { data: failureRequest, error: failureError } = await supabase
    .from("service_requests")
    .insert({
      owner_type: "anonymous_case",
      owner_id: ownerId,
      module: "support",
      specialist_id: expert.id,
      specialist_name: "E2E specialist",
      request_type: "text_question",
      meeting_format: "text",
      title: failureTitle,
      message: "Проверка controlled failure feedback",
      status: "submitted",
      client_contact: {},
    })
    .select("id")
    .single();
  if (failureError) throw failureError;
  cleanupIds.push(failureRequest.id);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/specialist`, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[placeholder="Код специалиста"]', ACCESS_CODE);
    await page.click('button:has-text("Войти")');
    await page.waitForSelector('[data-testid="specialist-cabinet"]', { timeout: 15000 });
    page.on("dialog", async (dialog) => {
      await dialog.accept(dialog.message().includes("Ответ") ? "Подтвердите дату консультации" : "Уточните удобное время");
    });

    const failureRequestRef = `service-request:${failureRequest.id}`;
    await page.route("**/api/specialist", async (route) => {
      const body = route.request().postDataJSON?.();
      if (body?.action === "updateServiceRequest") {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (body.request_ref === failureRequestRef && body.update_action === "accept") {
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "TEST controlled failure" }) });
          return;
        }
      }
      await route.continue();
    });

    const card = page.locator('[data-testid="service-request-card"]').filter({ hasText: title }).first();
    await card.waitFor({ state: "visible", timeout: 15000 });

    async function clickAction(requestCard, requestTitle, name, pendingText) {
      const button = requestCard.getByRole("button", { name });
      await page.waitForFunction(({ requestTitle, buttonName }) => {
        const requestCard = [...document.querySelectorAll('[data-testid="service-request-card"]')]
          .find((element) => element.textContent.includes(requestTitle));
        const actionButton = [...(requestCard?.querySelectorAll("button") || [])]
          .find((element) => element.textContent.trim() === buttonName);
        return Boolean(actionButton && !actionButton.disabled);
      }, { requestTitle, buttonName: name }, { timeout: 15000 });
      await button.click();
      const feedback = requestCard.getByTestId("service-request-feedback");
      await feedback.waitFor({ state: "visible", timeout: 5000 });
      assert((await feedback.textContent()).includes(pendingText), `${name} immediately shows pending feedback`);
      assert(await requestCard.locator("button:disabled").count() > 0, `${name} disables service request actions while pending`);
    }

    async function waitForStatus(expectedStatus) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await supabase.from("service_requests").select("status, specialist_response").eq("id", request.id).single();
        if (current.data?.status === expectedStatus) return current.data;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return (await supabase.from("service_requests").select("status, specialist_response").eq("id", request.id).single()).data;
    }

    await clickAction(card, title, "Принять", "Принимаем…");
    let current = { data: await waitForStatus("accepted") };
    assert(current.data?.status === "accepted", "submitted → Принять reaches accepted");
    await card.locator(".service-request-feedback-success").waitFor({ state: "visible", timeout: 5000 });

    await clickAction(card, title, "Уточнить", "Уточняем…");
    current = { data: await waitForStatus("needs_clarification") };
    assert(current.data?.status === "needs_clarification", "accepted → Уточнить reaches needs_clarification");
    assert(current.data?.specialist_response === "Уточните удобное время", "clarification is stored as one asynchronous request field");
    await card.locator(".service-request-feedback-success").waitFor({ state: "visible", timeout: 5000 });

    await clickAction(card, title, "Ответить", "Отправляем…");
    current = { data: await waitForStatus("answered") };
    assert(current.data?.status === "answered", "needs_clarification → Ответить reaches answered");
    await card.locator(".service-request-feedback-success").waitFor({ state: "visible", timeout: 5000 });

    await clickAction(card, title, "Завершить", "Завершаем…");
    current = { data: await waitForStatus("completed") };
    assert(current.data?.status === "completed", "answered → Завершить reaches completed");
    await card.locator(".service-request-feedback-success").waitFor({ state: "visible", timeout: 5000 });

    const failureCard = page.locator('[data-testid="service-request-card"]').filter({ hasText: failureTitle }).first();
    await failureCard.waitFor({ state: "visible", timeout: 15000 });
    await clickAction(failureCard, failureTitle, "Принять", "Принимаем…");
    await page.waitForFunction((requestTitle) => {
      const requestCard = [...document.querySelectorAll('[data-testid="service-request-card"]')]
        .find((element) => element.textContent.includes(requestTitle));
      return Boolean(requestCard?.querySelector(".service-request-feedback-error"));
    }, failureTitle, { timeout: 10000 });
    assert((await failureCard.getByTestId("service-request-feedback").textContent()).includes("TEST controlled failure"), "failed action shows controlled readable error");
    await page.waitForFunction((requestTitle) => {
      const requestCard = [...document.querySelectorAll('[data-testid="service-request-card"]')]
        .find((element) => element.textContent.includes(requestTitle));
      return Boolean(requestCard && [...requestCard.querySelectorAll("button")].some((button) => button.textContent.trim() === "Принять" && !button.disabled));
    }, failureTitle, { timeout: 10000 });
    const failureState = await supabase.from("service_requests").select("status").eq("id", failureRequest.id).single();
    assert(failureState.data?.status === "submitted", "failed action restores usable submitted state");

    await context.close();
  } finally {
    await browser.close();
    for (const id of cleanupIds) await supabase.from("service_requests").delete().eq("id", id);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`Service request browser E2E: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
