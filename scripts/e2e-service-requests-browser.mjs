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

    const card = page.locator('[data-testid="service-request-card"]').filter({ hasText: title }).first();
    await card.waitFor({ state: "visible", timeout: 15000 });

    async function clickAction(name) {
      const button = card.getByRole("button", { name });
      await page.waitForFunction(({ requestTitle, buttonName }) => {
        const requestCard = [...document.querySelectorAll('[data-testid="service-request-card"]')]
          .find((element) => element.textContent.includes(requestTitle));
        const actionButton = [...(requestCard?.querySelectorAll("button") || [])]
          .find((element) => element.textContent.trim() === buttonName);
        return Boolean(actionButton && !actionButton.disabled);
      }, { requestTitle: title, buttonName: name }, { timeout: 15000 });
      await button.click();
    }

    async function waitForStatus(expectedStatus) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await supabase.from("service_requests").select("status, specialist_response").eq("id", request.id).single();
        if (current.data?.status === expectedStatus) return current.data;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return (await supabase.from("service_requests").select("status, specialist_response").eq("id", request.id).single()).data;
    }

    await clickAction("Принять");
    let current = { data: await waitForStatus("accepted") };
    assert(current.data?.status === "accepted", "submitted → Принять reaches accepted");

    await clickAction("Уточнить");
    current = { data: await waitForStatus("needs_clarification") };
    assert(current.data?.status === "needs_clarification", "accepted → Уточнить reaches needs_clarification");
    assert(current.data?.specialist_response === "Уточните удобное время", "clarification is stored as one asynchronous request field");

    await clickAction("Ответить");
    current = { data: await waitForStatus("answered") };
    assert(current.data?.status === "answered", "needs_clarification → Ответить reaches answered");

    await clickAction("Завершить");
    current = { data: await waitForStatus("completed") };
    assert(current.data?.status === "completed", "answered → Завершить reaches completed");

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
