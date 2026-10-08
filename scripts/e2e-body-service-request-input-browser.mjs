import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const BODY_CODE = process.env.E2E_BODY_CONTINUATION_CODE || "HEALTH-C1HL-TST-ABCD-EFGH-JKMN";
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY for TEST E2E.");
}
if (!BASE_URL.includes("tochka-opori-test.vercel.app") && !BASE_URL.startsWith("http://localhost")) {
  throw new Error("Refusing to run body service-request input E2E outside TEST/localhost.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const results = [];

function assert(condition, message) {
  results.push({ message, ok: Boolean(condition) });
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

async function ensureHealthCabinet(page, code) {
  const target = page.locator("text=Связаться со специалистом");
  if (await target.count()) return;

  const codeInput = page.locator('input[placeholder="HEALTH-XXXX-XXX-XXXX-XXXX-XXXX"]');
  if (!(await codeInput.count())) {
    const url = new URL(page.url());
    url.searchParams.set("module", "body");
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 30000 });
  }
  await codeInput.fill(code);
  await page.locator('button:has-text("Продолжить")').click();

  await target.waitFor({ state: "visible", timeout: 25000 }).catch(async () => {
    const skip = page.locator('button:has-text("Пропустить")');
    const back = page.locator('button:has-text("Вернуться в кабинет")');
    if (await skip.count()) await skip.click();
    else if (await back.count()) await back.click();
    else throw new Error("Health cabinet did not open and no onboarding skip was available");
    await target.waitFor({ state: "visible", timeout: 15000 });
  });
  await page.waitForTimeout(800);
}

async function openServiceRequests(page) {
  const card = page
    .locator("div:has-text(\"Связаться со специалистом\")")
    .filter({ has: page.getByRole("button", { name: "Открыть" }) })
    .last();
  await card.getByRole("button", { name: "Открыть" }).click();
}

const timestamp = Date.now();
const firstLine = `E2E обращение к специалисту ${timestamp}: длинный текст с несколькими строками, проверка видимости ввода, сохранения и перезагрузки.`;
const uniqueMsg = `${firstLine}\nВторая строка — символы: +-# .,;:!? абвгд.\nТретья строка с финальной точкой.`;

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cleanupIds = [];
    const createResp = { status: null, ok: false, id: null, error: null };

    page.on("response", async (r) => {
      if (!r.url().includes("/api/session") || r.request().method() !== "POST") return;
      const postData = r.request().postData() || "";
      if (!postData.includes("createBodyServiceRequest")) return;
      let body = null;
      try { body = await r.json(); } catch {}
      createResp.status = r.status();
      createResp.ok = body && body.ok;
      createResp.id = body && body.request ? body.request.id : null;
      createResp.error = body && body.error ? body.error : null;
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await ensureHealthCabinet(page, BODY_CODE);

    await openServiceRequests(page);
    await page.locator('button:has-text("Новый запрос")').click();
    await page.locator('button:has-text("Другой вопрос")').click();
    await page.locator('button:has-text("Формат: письменно")').click();

    const textarea = page.locator('textarea[placeholder="Опишите вопрос своими словами..."]');
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.fill(uniqueMsg);

    const typed = await textarea.inputValue();
    assert(typed === uniqueMsg, "typed message is retained in the message textarea");

    const cs = await textarea.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    assert(cs.color !== cs.background, `message textarea text is visible against its background (color=${cs.color}, bg=${cs.background})`);

    await page.locator('button:has-text("Отправить запрос")').click();

    const t0 = Date.now();
    while (createResp.status === null && Date.now() - t0 < 20000) await page.waitForTimeout(200);
    await page.getByText(firstLine.slice(0, 40), { exact: false }).first().waitFor({ state: "visible", timeout: 20000 });
    assert(true, "created request appears in the list with the typed message");
    assert(createResp.status === 200 && createResp.ok, `createBodyServiceRequest responded 200 ok (got status=${createResp.status}, ok=${createResp.ok}, error=${createResp.error || "none"})`);
    if (createResp.id) cleanupIds.push(createResp.id);

    const { data: persisted } = await supabase
      .from("service_requests")
      .select("id, message, owner_type, module")
      .like("message", `${firstLine.slice(0, 24)}%`)
      .order("created_at", { ascending: false })
      .limit(5);
    const exactRow = (persisted || []).find((r) => r.message === uniqueMsg && r.owner_type === "anonymous_profile" && r.module === "body");
    assert(Boolean(exactRow), "request is persisted in TEST database with full message (owner_type=anonymous_profile, module=body)");
    if (exactRow && createResp.id && !cleanupIds.includes(exactRow.id)) cleanupIds.push(exactRow.id);

    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await ensureHealthCabinet(page, BODY_CODE);
    await openServiceRequests(page);
    await page.getByText(firstLine.slice(0, 40), { exact: false }).first().waitFor({ state: "visible", timeout: 20000 });
    assert(true, "request message survives a full page reload");

    await context.close();

    const failed = results.filter((r) => !r.ok);
    console.log(`Body service-request input E2E: ${results.length - failed.length} passed, ${failed.length} failed`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});