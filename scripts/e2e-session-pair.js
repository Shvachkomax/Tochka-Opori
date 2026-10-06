// Acceptance E2E for the Health session credential pair hotfix. TEST only.
// Real client flow: Health intake -> pair stored -> cabinet -> diary ->
// plate analysis -> save -> reload -> cabinet shows the entry; then
// session A -> session B replacement (stale token A never sent) and a
// poisoned legacy fixture healed fail-closed before any protected request.
//
// Requires (separate terminals):
//   1) node /var/folders/bq/dwfnvhjs5h192n4syngj695r0000gn/T/opencode/run-api-test.mjs
//      (local-api-server.js on :3001 with TEST Supabase env, ref-guarded)
//   2) npm run dev  (Vite on :5173, proxies /api -> :3001)
// Usage: node scripts/e2e-session-pair.js
// No production access; no synthetic production data.

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const INTAKE_URL = `${BASE}/?module=body`;

let pass = 0;
let fail = 0;
function ok(msg) { console.log("PASS:", msg); pass++; }
function no(msg) { console.log("FAIL:", msg); fail++; }

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

function wireRequestLog(page) {
  const log = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      log.push({ url: req.url(), post: req.postData() || "" });
    }
  });
  return log;
}

async function readPair(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("body_session_pair") || "null");
    } catch {
      return null;
    }
  });
}

async function readLegacy(page) {
  return page.evaluate(() => ({
    sessionId: localStorage.getItem("body_last_session_id"),
    token: localStorage.getItem("body_last_access_token"),
    result: localStorage.getItem("body_last_result"),
  }));
}

async function fillIntakeForm(page, name, options = {}) {
  const form = page.locator('form[data-body-intake]');
  await form.waitFor({ timeout: 15000 });
  await form.locator('input[placeholder="Имя или псевдоним"]').fill(name);
  await form.locator("select").nth(0).selectOption("female");
  await form.locator('input[placeholder="Например: 30"]').fill("30");
  await form.locator("select").nth(1).selectOption("improve_wellbeing");
  await form.locator('input[placeholder="Например: 170"]').fill("170");
  await form.locator('input[placeholder="Например: 70"]').fill("70");
  await form.locator("select").nth(2).selectOption("sedentary");
  await form.locator("select").nth(3).selectOption("6000_10000");
  await form.locator("select").nth(4).selectOption("7_8");
  await form.locator("select").nth(5).selectOption("no");
  await form.locator("select").nth(6).selectOption("overeating");
  await form.locator("select").nth(7).selectOption("none");
  await form.locator("select").nth(8).selectOption("3");
  await form.locator("input.healthRedFlagCheckbox").last().check();
  await form.locator('button[type="submit"]').click();
  await page.getByRole("button", { name: "Дальше" }).waitFor({ timeout: 120000 });
  let toastSeen = false;
  if (options.expectFailToast) {
    toastSeen = (await page.getByText("Не удалось сохранить доступ к сессии").count()) > 0;
  }
  await page.getByRole("button", { name: "Дальше" }).click();
  // The code step must show the full continuation code (never a short session id)
  const codeText = (await page.locator("body").innerText()).match(/HEALTH-[A-Z0-9]+-[A-Z0-9-]+/i)?.[0] || "";
  try {
    await page.getByRole("button", { name: "Продолжить" }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "Начать дневник" }).click({ timeout: 8000 });
  } catch {
    // result walkthrough is cosmetic; the pair is already stored
  }
  return { codeText, toastSeen };
}

async function finishToCabinet(page) {
  const cabinetCta = page.getByRole("button", { name: "Перейти в личный кабинет" });
  if (await cabinetCta.count()) {
    await cabinetCta.click();
  } else {
    await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
  }
}

async function fillIntake(page, name) {
  await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
  await openIntakeForm(page);
  const { codeText: shownCode } = await fillIntakeForm(page, name);
  await finishToCabinet(page);
  return shownCode;
}

async function openIntakeForm(page) {
  const cta = page.getByText("Перейти к анкете");
  await cta.waitFor({ timeout: 15000 });
  await cta.click();
  await page.locator('form[data-body-intake]').waitFor({ timeout: 15000 });
}

async function backToLanding(page) {
  await page.getByRole("button", { name: "На главную" }).click();
  await page.getByText("Перейти к анкете").waitFor({ timeout: 15000 });
}

async function gotoCabinet(page) {
  // Cabinet loads asynchronously and BodyOnboarding intro (step 0) may appear
  // first for fresh sessions; poll until the cabinet actions are visible.
  for (let i = 0; i < 40; i++) {
    const skipIntro = page.getByRole("button", { name: "Вернуться в кабинет" });
    if (await skipIntro.count()) {
      await skipIntro.click();
      await page.waitForTimeout(500);
      continue;
    }
    if (await page.getByText("Заполнить").first().count()) return;
    await page.waitForTimeout(500);
  }
  const text = await page.locator("body").innerText();
  throw new Error(`cabinet not reached, page: ${text.replace(/\n+/g, " | ").slice(0, 300)}`);
}

async function cabinetHasEntry(page, marker) {
  return page.evaluate(async (needle) => {
    let pair = null;
    try { pair = JSON.parse(localStorage.getItem("body_session_pair") || "null"); } catch {}
    if (!pair?.sessionId || !pair?.accessToken) return false;
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listBodyDailyLogs", session_id: pair.sessionId, access_token: pair.accessToken }),
    });
    const data = await res.json();
    return JSON.stringify(data).includes(needle);
  }, marker);
}

async function openNewDiary(page) {
  await page.getByText("Заполнить").first().click();
  await page.locator("form[data-body-diary]").waitFor({ timeout: 15000 });
}

async function fillAndSaveDiary(page, marker) {
  await page.locator('form[data-body-diary] textarea[placeholder^="Коротко опишите день"]').fill(marker);
  await page.locator('form[data-body-diary] button[type="submit"]').click();
  for (let i = 0; i < 20; i++) {
    const bodyText = await page.locator("body").innerText();
    if (bodyText.includes("Сессия недействительна") || bodyText.includes("Сессия истекла")) return false;
    if (await cabinetHasEntry(page, marker)) return true;
    await page.waitForTimeout(1000);
  }
  return cabinetHasEntry(page, marker);
}


async function scenario1(page) {
  console.log("\n--- Scenario 1: intake -> pair -> cabinet -> diary -> plate -> save -> reload ---");
  const log = wireRequestLog(page);
  const shownCode = await fillIntake(page, "E2E Pair One");
  const pairA = await readPair(page);
  if (pairA?.sessionId && pairA?.accessToken) {
    ok(`scenario1: intake stored an atomic credential pair (session ${String(pairA.sessionId).slice(0, 12)}…)`);
  } else {
    no(`scenario1: pair not stored: ${JSON.stringify(await readLegacy(page))}`);
  }
  if (shownCode && shownCode.split("-").length >= 5 && shownCode !== pairA?.sessionId) {
    ok("scenario1: the fresh intake shows the full continuation code, not the session short code");
  } else {
    no(`scenario1: unexpected continuation code display: "${shownCode}" vs session ${pairA?.sessionId}`);
  }

  await gotoCabinet(page);
  ok("scenario1: cabinet opened with the stored pair");
  await openNewDiary(page);

  const markerA = `e2e pair day A ${Date.now()}`;
  await page.locator('form[data-body-diary] input[type="file"]').setInputFiles([
    { name: "plate.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG },
  ]);
  const plateBtn = page.getByText("Проанализировать тарелку");
  let plateReady = false;
  for (let i = 0; i < 20 && !plateReady; i++) {
    plateReady = (await plateBtn.count()) > 0;
    if (!plateReady) await page.waitForTimeout(500);
  }
  if (plateReady) {
    await plateBtn.click();
    await page.waitForTimeout(6000);
    const plateText = await page.locator("body").innerText();
    if (plateText.includes("Сессия недействительна")) {
      no("scenario1: plate analysis rejected the credential pair");
    } else {
      ok("scenario1: plate analysis accepted the credential pair (no auth error)");
    }
  } else {
    no("scenario1: plate analysis button not found after adding a photo");
  }

  const savedA = await fillAndSaveDiary(page, markerA);
  savedA ? ok("scenario1: diary save accepted the credential pair") : no("scenario1: diary save rejected the pair");

  await page.reload({ waitUntil: "domcontentloaded" });
  await gotoCabinet(page);
  if (await cabinetHasEntry(page, markerA)) {
    ok("scenario1: after reload the cabinet shows the saved day entry");
  } else {
    no("scenario1: saved day entry missing after reload");
    const dump = await page.evaluate(async () => {
      const pair = JSON.parse(localStorage.getItem("body_session_pair") || "null");
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listBodyDailyLogs", session_id: pair.sessionId, access_token: pair.accessToken }),
      });
      return (await res.text()).slice(0, 600);
    });
    console.log("  diagnostics listBodyDailyLogs:", dump);
  }
  const pairAfterReload = await readPair(page);
  pairAfterReload?.accessToken === pairA?.accessToken
    ? ok("scenario1: credential pair survives reload unchanged")
    : no("scenario1: pair changed across reload");

  // Blocker 3: restored (sanitized) result never shows session_id as a code
  await page.evaluate(() => localStorage.removeItem("body_session_pair"));
  await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
  const restoreBtn = page.getByRole("button", { name: "Вернуться к последнему плану" });
  await restoreBtn.waitFor({ timeout: 15000 });
  await restoreBtn.click();
  await page.getByRole("button", { name: "Дальше" }).click();
  await page.waitForTimeout(500);
  const codeStepText = await page.locator("body").innerText();
  if (codeStepText.includes("Код продолжения не хранится на устройстве")
    && !codeStepText.includes(pairA.sessionId)
    && !codeStepText.includes("Скопировать код")) {
    ok("scenario1: restored result hides the code step fallback and never shows the session short code");
  } else {
    no("scenario1: restored result still exposes a session short code or copy action");
  }
  return { tokenA: pairA?.accessToken || "token-A-missing", sessionA: pairA?.sessionId || null };
}

async function resetApp(page) {
  await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
}

async function scenario2(page) {
  console.log("\n--- Scenario 2: intake A -> intake B replaces the pair (no storage reset between) ---");
  await resetApp(page);
  await openIntakeForm(page);
  await fillIntakeForm(page, "E2E Pair One B");
  const pairA = await readPair(page);
  const tokenA = pairA?.accessToken || "token-A-missing";

  // Second intake in the same browser WITHOUT clearing storage: the pair A
  // must be fully replaced by pair B.
  await backToLanding(page);
  await openIntakeForm(page);
  await fillIntakeForm(page, "E2E Pair Two");
  const pairB = await readPair(page);
  if (pairB?.sessionId && pairB?.sessionId !== pairA?.sessionId && pairB?.accessToken && pairB?.accessToken !== tokenA) {
    ok("scenario2: second intake replaced the whole pair (session B + token B)");
  } else {
    no(`scenario2: pair not replaced correctly: ${JSON.stringify(pairB)}`);
  }
  const legacyAfterB = await readLegacy(page);
  (!legacyAfterB.sessionId && !legacyAfterB.token)
    ? ok("scenario2: no legacy session_id/token keys are left beside the pair")
    : no(`scenario2: stale legacy keys present: ${JSON.stringify(legacyAfterB)}`);

  const log = wireRequestLog(page);
  const logStart = log.length;
  await finishToCabinet(page);
  await gotoCabinet(page);
  await openNewDiary(page);
  const markerB = `e2e pair day B ${Date.now()}`;
  const savedB = await fillAndSaveDiary(page, markerB);
  savedB ? ok("scenario2: diary B saved with the new pair") : no("scenario2: diary B save failed");
  const leaked = log.slice(logStart).filter((r) => r.post.includes(tokenA));
  leaked.length === 0
    ? ok("scenario2: token A never appears in any request after the switch")
    : no(`scenario2: token A leaked into ${leaked.length} request(s)`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await gotoCabinet(page);
  (await cabinetHasEntry(page, markerB))
    ? ok("scenario2: diary B entry present after reload")
    : no("scenario2: diary B entry missing after reload");
  return { tokenA, sessionA: pairA?.sessionId, sessionB: pairB?.sessionId };
}

async function scenario3(page, seed) {
  console.log("\n--- Scenario 3: poisoned legacy pair healed fail-closed before any protected request ---");
  await resetApp(page);
  const sessionA = seed?.sessionA || (await (async () => {
    await resetApp(page);
    await fillIntake(page, "E2E Poison A");
    return (await readPair(page))?.sessionId;
  })());
  const tokenA = seed?.tokenA && seed.tokenA !== "token-A-missing" ? seed.tokenA : (await (async () => {
    await resetApp(page);
    await fillIntake(page, "E2E Poison A2");
    return (await readPair(page))?.accessToken;
  })());
  await resetApp(page);
  await fillIntake(page, "E2E Poison B");
  const sessionB = (await readPair(page))?.sessionId;

  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("body_last_session_id", s.sessionB);
    localStorage.setItem("body_last_access_token", s.tokenA);
    localStorage.setItem("body_last_result", JSON.stringify({ session_id: s.sessionA, access_token: s.tokenA }));
  }, { sessionB, sessionA, tokenA });
  const log = wireRequestLog(page);
  const logStart = log.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const healed = await readLegacy(page);
  const healedPair = await readPair(page);
  (!healed.sessionId && !healed.token && !healedPair)
    ? ok("scenario3: poisoned legacy state is cleared on load (fail closed)")
    : no(`scenario3: poisoned state survived: legacy=${JSON.stringify(healed)} pair=${JSON.stringify(healedPair)}`);
  const poisonRequests = log.slice(logStart).filter((r) => r.post.includes(tokenA));
  const protectedAttempts = log.slice(logStart).filter((r) => r.post.includes("daily_log_submitted") || r.post.includes("plate_photo_analysis"));
  poisonRequests.length === 0
    ? ok("scenario3: no request carries token A for session B")
    : no(`scenario3: ${poisonRequests.length} request(s) still sent token A`);
  protectedAttempts.length === 0
    ? ok("scenario3: no protected diary/plate request is attempted before re-login")
    : no(`scenario3: ${protectedAttempts.length} protected request(s) attempted`);
  const landingText = await page.locator("body").innerText();
  !landingText.includes("Заполнить дневник")
    ? ok("scenario3: client returns to the login-by-code flow instead of a live cabinet")
    : no("scenario3: cabinet still reachable with the poisoned pair");
}

async function scenario4(page) {
  console.log("\n--- Scenario 4: storage write failure fails closed, old pair never stays active ---");
  await resetApp(page);
  await openIntakeForm(page);
  await fillIntakeForm(page, "E2E Fail A");
  const pairA = await readPair(page);
  const tokenA = pairA?.accessToken || "token-A-missing";
  if (pairA?.sessionId && pairA?.accessToken) {
    ok("scenario4: intake A stored pair A/tokenA");
  } else {
    no("scenario4: pair A not stored");
  }

  await backToLanding(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreSetItem = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = () => { throw new Error("QuotaExceededError"); };
  });
  const log = wireRequestLog(page);
  const logStart = log.length;
  await openIntakeForm(page);
  const { toastSeen } = await fillIntakeForm(page, "E2E Fail B", { expectFailToast: true });

  const pairAfter = await readPair(page);
  const legacyAfter = await readLegacy(page);
  (!pairAfter && !legacyAfter.sessionId && !legacyAfter.token)
    ? ok("scenario4: after the failed pair write no credential pair is active (A/tokenA cleared)")
    : no(`scenario4: stale credentials survived: pair=${JSON.stringify(pairAfter)} legacy=${JSON.stringify(legacyAfter)}`);
  const leaked = log.slice(logStart).filter((r) => r.post.includes(tokenA));
  leaked.length === 0
    ? ok("scenario4: no request carries token A after the failed write")
    : no(`scenario4: token A leaked into ${leaked.length} request(s)`);
  toastSeen
    ? ok("scenario4: client shows the explicit fail-closed error")
    : no("scenario4: explicit fail-closed error not shown");

  await page.evaluate(() => window.__restoreSetItem());
  await backToLanding(page);
  const recoveryText = await page.locator("body").innerText();
  recoveryText.includes("Уже есть код продолжения")
    ? ok("scenario4: continuation-code recovery path is available to the user")
    : no("scenario4: continuation-code recovery path missing");
}

async function run() {
  const only = process.env.E2E_ONLY || "";
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    if (!only || only === "1") await scenario1(page);
    if (!only || only === "2") await scenario2(page);
    if (!only || only === "3") await scenario3(page);
    if (!only || only === "4") await scenario4(page);
  } finally {
    await browser.close();
  }
  console.log(`\nE2E session pair: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((error) => {
  console.error("E2E crashed:", error?.message || error);
  process.exit(1);
});
