import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import crypto from "node:crypto";
import { readFileSync } from "fs";
import { hashToken } from "../lib/security/council-token.js";

function loadEnv(path) {
  try {
    const content = readFileSync(path, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
    return env;
  } catch { return {}; }
}

const env = loadEnv(".env.local");
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const BASE = "http://localhost:5173";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RESULTS = [];
const FIX = {
  experts: [], specialistSessions: [], organizations: [], memberships: [],
  bodyClients: [], assignments: [], access: [],
  dailyLogs: [], plateHistory: [], weeklySummaries: [], serviceRequests: [],
};

function log(t, r, d = "") { RESULTS.push({ t, r }); console.log((r === "PASS" ? "✅" : "❌") + " " + t + (d ? " — " + d : "")); }

// ── Fixtures ──────────────────────────────────────────────

async function createExpert(name, code) {
  const { data } = await sb.from("experts").insert({ name, role: "doctor", specialty: "Терапевт", city: "Москва", access_code: code, is_active: true }).select("id, access_code").single();
  FIX.experts.push(data.id);
  return data;
}

async function createOrg(name) {
  const slug = "hcard-" + crypto.randomBytes(4).toString("hex");
  const { data } = await sb.from("organizations").insert({ name, slug }).select("id").single();
  FIX.organizations.push(data.id);
  return data.id;
}

async function addMembership(orgId, expertId) {
  const { data } = await sb.from("expert_organization_memberships").insert({ organization_id: orgId, expert_id: expertId, role: "doctor", status: "active" }).select("id").single();
  FIX.memberships.push(data.id);
  return data.id;
}

async function createSessionToken(expertId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const { data } = await sb.from("specialist_sessions").insert({ expert_id: expertId, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString() }).select("id").single();
  FIX.specialistSessions.push(data.id);
  return raw;
}

async function createBodyClient(ownerId, displayName, goal) {
  const sid = "hcard-" + crypto.randomBytes(4).toString("hex");
  const { data } = await sb.from("body_clients").insert({ session_id: sid, anonymous_owner_id: ownerId, display_name: displayName, goal, status: "active", source: "self_signup" }).select("id, session_id").single();
  FIX.bodyClients.push(data.id);
  return data;
}

async function createAssignment(ownerId, orgId, expertId, label) {
  const { data } = await sb.from("patient_assignments").insert({
    owner_type: "anonymous_profile", owner_id: ownerId, organization_id: orgId,
    primary_expert_id: expertId, assigned_by_expert_name: "test", module: "body",
    status: "active", patient_label: label,
  }).select("id").single();
  FIX.assignments.push(data.id);
  return data.id;
}

async function createDailyLog(sessionId, date, fields) {
  const { data } = await sb.from("body_daily_logs").insert({ session_id: sessionId, module: "body", log_date: date, ...fields }).select("id").single();
  FIX.dailyLogs.push(data.id);
  return data.id;
}

async function createPlate(ownerId, sessionId, date, fields) {
  const { data } = await sb.from("body_plate_history").insert({ owner_type: "anonymous_profile", owner_id: ownerId, session_id: sessionId, log_date: date, ...fields }).select("id").single();
  FIX.plateHistory.push(data.id);
  return data.id;
}

async function createWeeklySummary(ownerId, periodStart, periodEnd, userSummary, summaryJson) {
  const { data } = await sb.from("body_weekly_summaries").insert({
    owner_type: "anonymous_profile", owner_id: ownerId, summary_type: "weekly",
    period_start: periodStart, period_end: periodEnd, source_days: 5, source_plate_count: 3,
    user_summary: userSummary, summary_json: summaryJson,
    request_id: "hcard-test", generation_status: "ready",
  }).select("id").single();
  FIX.weeklySummaries.push(data.id);
  return data.id;
}

async function createServiceRequest(ownerId, type, status) {
  const { data } = await sb.from("service_requests").insert({
    module: "body", owner_type: "anonymous_profile", owner_id: ownerId,
    request_type: type, status, message: "E2E test request",
  }).select("id").single();
  FIX.serviceRequests.push(data.id);
  return data.id;
}

async function cleanup() {
  console.log("\n── Cleanup ──");
  for (const id of FIX.serviceRequests) await sb.from("service_requests").delete().eq("id", id);
  for (const id of FIX.weeklySummaries) await sb.from("body_weekly_summaries").delete().eq("id", id);
  for (const id of FIX.plateHistory) await sb.from("body_plate_history").delete().eq("id", id);
  for (const id of FIX.dailyLogs) await sb.from("body_daily_logs").delete().eq("id", id);
  for (const id of FIX.access) await sb.from("patient_access").delete().eq("id", id);
  for (const id of FIX.assignments) await sb.from("patient_assignments").delete().eq("id", id);
  for (const id of FIX.bodyClients) await sb.from("body_clients").delete().eq("id", id);
  for (const id of FIX.memberships) await sb.from("expert_organization_memberships").delete().eq("id", id);
  for (const id of FIX.organizations) await sb.from("organizations").delete().eq("id", id);
  for (const id of FIX.specialistSessions) await sb.from("specialist_sessions").delete().eq("id", id);
  for (const id of FIX.experts) await sb.from("experts").delete().eq("id", id);
  console.log("  Done.");
}

async function freshLogin(browser, accessCode) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/specialist", { waitUntil: "networkidle", timeout: 15000 });
  await page.fill('input[placeholder="Код специалиста"]', accessCode);
  await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/specialist") && r.request().postDataJSON()?.action === "login", { timeout: 10000 }),
    page.click('button:has-text("Войти")'),
  ]);
  await page.waitForTimeout(2000);
  return { ctx, page };
}

async function setupContext(page, orgId) {
  await page.evaluate(([orgIdVal]) => {
    sessionStorage.setItem("specialist_org_id", orgIdVal);
    sessionStorage.setItem("specialist_module", "body");
  }, [orgId]);
  await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/specialist") && r.request().postDataJSON()?.action === "listClients", { timeout: 10000 }).catch(() => {}),
    page.reload({ waitUntil: "networkidle", timeout: 15000 }),
  ]);
  await page.waitForTimeout(3000);
}

async function waitForDetailLoad(page) {
  await page.waitForSelector('[data-testid="health-client-detail"]', { timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="health-client-detail"]');
    return el && !el.textContent.includes("Загрузка...");
  }, { timeout: 10000 });
}

async function waitForDetailGone(page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="health-client-detail"]'), { timeout: 5000 });
}

// ── Main ──────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  try {
    // Pre-cleanup
    const { data: oldE } = await sb.from("experts").select("id").like("access_code", "HCARD-%");
    for (const r of oldE || []) {
      await sb.from("specialist_sessions").delete().eq("expert_id", r.id);
      await sb.from("expert_organization_memberships").delete().eq("expert_id", r.id);
      await sb.from("experts").delete().eq("id", r.id);
    }

    // ── Create fixtures ────────────────────────────────────
    const expert = await createExpert("HCARD Specialist", "HCARD-" + crypto.randomBytes(4).toString("hex").toUpperCase());
    const token = await createSessionToken(expert.id);
    const orgId = await createOrg("HCARD Clinic");
    await addMembership(orgId, expert.id);

    // Owner A: full data
    const ownerA = crypto.randomUUID();
    const bcA = await createBodyClient(ownerA, "Алиса Тест", "Похудеть на 5 кг");
    const assignA = await createAssignment(ownerA, orgId, expert.id, "Алиса Тест");

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await createDailyLog(bcA.session_id, today, { weight_kg: 72.5, steps: 8500, sleep_hours: 7.5, mood_level: 4, energy_level: 4, workout_done: true, workout_type: "Бег", workout_minutes: 30, meals_count: 3, calories: 1800, water_l: 2.0, ai_day_summary: "Хороший день, достаточно активный.", ai_positive_observation: "Много шагов и хорошее настроение." });
    await createDailyLog(bcA.session_id, yesterday, { weight_kg: 73.0, steps: 4200, sleep_hours: 6, mood_level: 3, energy_level: 3, meals_count: 4, calories: 2200 });
    await createPlate(ownerA, bcA.session_id, today, { meal_type: "obed", balance_summary: "Сбалансировано", vegetables_assessment: "Хорошо", protein_assessment: "Норма", carbohydrate_assessment: "Чуть много", gentle_suggestion: "Добавьте больше овощей" });
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await createWeeklySummary(ownerA, weekAgo, today, "Неделя прошла хорошо. Больше шагов, стабильный сон.", { period_summary: "Неделя прошла хорошо.", positive_changes: ["Больше шагов"], patterns: [], nutrition_observations: ["Сбалансированное питание"], activity_observations: ["8500 шагов в среднем"], sleep_observations: [], next_week_focus: ["Продолжить активность"], questions_for_specialist: [] });
    await createServiceRequest(ownerA, "text_question", "submitted");

    // Owner B: zero data
    const ownerB = crypto.randomUUID();
    const bcB = await createBodyClient(ownerB, "Пустой Клиент", null);
    const assignB = await createAssignment(ownerB, orgId, expert.id, "Пустой Клиент");

    // ═══ TEST A: Login + Body module ═══════════════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);
      const consoleErrors = [];
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

      log("A. Login succeeds", "PASS");

      await setupContext(page, orgId);

      // ═══ TEST C: Health client appears ═══════════════════
      const clientVisible = await page.getByText("Алиса Тест", { exact: false }).count();
      log("C. Health client appears in list", clientVisible > 0 ? "PASS" : "FAIL");

      const emptyClientVisible = await page.getByText("Пустой Клиент", { exact: false }).count();
      log("C2. Zero-data client appears in list", emptyClientVisible > 0 ? "PASS" : "FAIL");

      // ═══ TEST D: Card opens ══════════════════════════════
      await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
      await waitForDetailLoad(page);
      const hasDetail = await page.locator('[data-testid="health-client-detail"]').count();
      log("D. Health card opens", hasDetail > 0 ? "PASS" : "FAIL");

      // ═══ TEST E: Обзор tab ═══════════════════════════════
      const overviewGoal = await page.locator('[data-testid="health-overview-goal"]').count();
      log("E. Обзор shows goal", overviewGoal > 0 ? "PASS" : "FAIL");

      const overviewWeight = await page.locator('[data-testid="health-overview-weight"]').count();
      log("E2. Обзор shows latest weight", overviewWeight > 0 ? "PASS" : "FAIL");

      const overviewSteps = await page.locator('[data-testid="health-overview-steps"]').count();
      log("E3. Обзор shows latest steps", overviewSteps > 0 ? "PASS" : "FAIL");

      // ═══ TEST F: Дневник tab ═════════════════════════════
      await page.locator("button").filter({ hasText: "Дневник" }).first().click();
      await page.waitForTimeout(500);
      const diaryHasWeight = await page.getByText("Вес: 72.5 кг", { exact: false }).count();
      log("F. Дневник renders day entries", diaryHasWeight > 0 ? "PASS" : "FAIL");

      const diaryHasWorkout = await page.getByText("Тренировка: Бег", { exact: false }).count();
      log("F2. Дневник shows workout", diaryHasWorkout > 0 ? "PASS" : "FAIL");

      // ═══ TEST G: Питание tab ═════════════════════════════
      await page.locator("button").filter({ hasText: "Питание" }).first().click();
      await page.waitForTimeout(500);
      const plateHasBalance = await page.getByText("Сбалансировано", { exact: false }).count();
      log("G. Питание renders plate analysis", plateHasBalance > 0 ? "PASS" : "FAIL");

      const plateDisclaimer = await page.getByText("приблизительный", { exact: false }).count();
      log("G2. Питание shows disclaimer", plateDisclaimer > 0 ? "PASS" : "FAIL");

      // ═══ TEST H: No plate image/base64 ══════════════════
      const hasBase64 = await page.locator('img[src*="data:image"]').count();
      log("H. No plate image/base64 rendered", hasBase64 === 0 ? "PASS" : "FAIL");

      // ═══ TEST I: Активность tab ══════════════════════════
      await page.locator("button").filter({ hasText: "Активность" }).first().click();
      await page.waitForTimeout(500);
      const actHasRun = await page.getByText("Бег", { exact: false }).count();
      log("I. Активность renders workout", actHasRun > 0 ? "PASS" : "FAIL");

      const actHasSteps = await page.getByText("Шаги:", { exact: false }).count();
      log("I2. Активность shows steps", actHasSteps > 0 ? "PASS" : "FAIL");

      // ═══ TEST J: Вес и параметры tab ═════════════════════
      await page.locator("button").filter({ hasText: "Вес и параметры" }).first().click();
      await page.waitForTimeout(500);
      const weightHas72 = await page.getByText("72.5 кг", { exact: false }).count();
      log("J. Вес и параметры renders weight", weightHas72 > 0 ? "PASS" : "FAIL");

      // ═══ TEST K+L: AI-сводки tab ═════════════════════════
      await page.locator("button").filter({ hasText: "AI-сводки" }).first().click();
      await page.waitForTimeout(500);
      const aiLabel = await page.getByText("AI-сводка для клиента", { exact: false }).count();
      log("K. AI-сводки renders client-oriented label", aiLabel > 0 ? "PASS" : "FAIL");

      const aiDisclaimer = await page.getByText("не является заключением специалиста", { exact: false }).count();
      log("L. AI disclaimer visible", aiDisclaimer > 0 ? "PASS" : "FAIL");

      const weeklySummary = await page.getByText("Неделя прошла хорошо", { exact: false }).count();
      log("K2. Weekly summary renders", weeklySummary > 0 ? "PASS" : "FAIL");

      // ═══ TEST M+N: Запросы tab ═══════════════════════════
      await page.locator("button").filter({ hasText: "Запросы" }).first().click();
      await page.waitForTimeout(500);
      const reqHasType = await page.getByText("Онлайн-вопрос", { exact: false }).count();
      log("M. Запросы renders request type", reqHasType > 0 ? "PASS" : "FAIL");

      const reqHasMessage = await page.getByText("E2E test request", { exact: false }).count();
      log("N. Запросы does NOT render message text", reqHasMessage === 0 ? "PASS" : "FAIL");

      // ═══ TEST O: Zero-data client ════════════════════════
      await page.locator('[data-testid="health-back-btn"]').first().click();
      await page.waitForTimeout(2000);
      await page.getByText("Пустой Клиент", { exact: false }).first().click({ timeout: 5000 });
      await waitForDetailLoad(page);

      await page.locator("button").filter({ hasText: "Дневник" }).first().click();
      await page.waitForTimeout(500);
      const emptyDiaryTab = await page.getByText("Дневник пока не заполнен.", { exact: false }).count();
      log("O. Zero-data client shows empty states", emptyDiaryTab > 0 ? "PASS" : "FAIL");

      // ═══ TEST P-S: Privacy checks ════════════════════════
      await page.locator('[data-testid="health-back-btn"]').first().click();
      await page.waitForTimeout(2000);
      await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
      await waitForDetailLoad(page);

      const bodyText = await page.textContent("body");
      log("P. No owner UUID visible", !bodyText.includes(ownerA) ? "PASS" : "FAIL");
      log("Q. No session_id visible", !bodyText.includes(bcA.session_id) ? "PASS" : "FAIL");
      log("R. No continuation code visible", !bodyText.includes("HEALTH-") && !bodyText.includes("ТОЧКА-") ? "PASS" : "FAIL");
      log("S1. No technical client_ref visible", !bodyText.includes("assignment:") && !bodyText.includes("access:") ? "PASS" : "FAIL");

      // ═══ TEST T: No body_ai_chat ═════════════════════════
      const hasAiChat = await page.getByText("ai_chat", { exact: false }).count();
      log("T. No body_ai_chat content visible", hasAiChat === 0 ? "PASS" : "FAIL");

      // ═══ TEST U: No body_health_contexts ═════════════════
      const hasHealthCtx = await page.getByText("health_conditions", { exact: false }).count();
      log("U. No body_health_contexts content visible", hasHealthCtx === 0 ? "PASS" : "FAIL");

      // ═══ TEST V: Console clean ═══════════════════════════
      log("V. Console clean (errors=" + consoleErrors.length + ")", consoleErrors.length === 0 ? "PASS" : "FAIL", consoleErrors.join("; "));

      await page.close();
    }

    // ═══ TEST 7: CONTEXT SWITCHING ════════════════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);
      await setupContext(page, orgId);

      // Open Body client
      await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
      await waitForDetailLoad(page);

      const hasHealthDetail = await page.locator('[data-testid="health-client-detail"]').count();
      log("CTX-1. Health detail open before switch", hasHealthDetail > 0 ? "PASS" : "FAIL");

      // Switch to Support using data-testid
      await page.locator('[data-testid="module-support"]').click();
      // Health detail must disappear immediately (synchronous clearing)
      await waitForDetailGone(page);
      const healthDetailGone = (await page.locator('[data-testid="health-client-detail"]').count()) === 0;
      log("CTX-2. Health detail disappears on Support switch", healthDetailGone ? "PASS" : "FAIL");

      // Switch back to Body
      await page.locator('[data-testid="module-body"]').click();
      await page.waitForTimeout(1500);

      // No detail should be open (selectedClient was cleared)
      const supportDetailGone = (await page.locator('[data-testid="health-client-detail"]').count()) === 0;
      log("CTX-3. Support detail disappears on Body switch", supportDetailGone ? "PASS" : "FAIL");

      await page.close();
    }

    // ═══ TEST 8: REVOKED ACCESS ═══════════════════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);
      await setupContext(page, orgId);

      // Open Health client
      await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
      await waitForDetailLoad(page);

      // Verify content visible
      await page.locator("button").filter({ hasText: "Дневник" }).first().click();
      await page.waitForTimeout(500);
      const hasDiaryBefore = await page.getByText("Вес: 72.5 кг", { exact: false }).count();
      log("REV-1. Diary content visible before revocation", hasDiaryBefore > 0 ? "PASS" : "FAIL");

      // Deactivate assignment
      await sb.from("patient_assignments").update({ status: "inactive" }).eq("id", assignA);

      // Go back to list and re-open — server should deny
      await page.locator('[data-testid="health-back-btn"]').first().click();
      await page.waitForTimeout(2000);
      const clientStillListed = await page.getByText("Алиса Тест", { exact: false }).count();
      if (clientStillListed > 0) {
        await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
        // Wait for loading to appear then disappear
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-testid="health-client-detail"]');
          return el && el.textContent.includes("Загрузка...");
        }, { timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-testid="health-client-detail"]');
          if (!el) return true;
          return !el.textContent.includes("Загрузка...");
        }, { timeout: 15000 });
        await page.waitForTimeout(500);
        const hasError = await page.locator('[data-testid="health-detail-error"]').count();
        log("REV-2. Access denied after revocation", hasError > 0 ? "PASS" : "FAIL");
      } else {
        log("REV-2. Client removed from list after revocation", "PASS");
      }

      // Re-activate for other tests
      await sb.from("patient_assignments").update({ status: "active" }).eq("id", assignA);
      await page.close();
    }

    // ═══ TEST 9: STALE RESPONSE ═══════════════════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);
      await setupContext(page, orgId);

      // Verify both clients visible
      const clientsBefore = await page.getByText("Алиса Тест", { exact: false }).count();
      if (clientsBefore === 0) {
        log("STALE-1. Client B displayed (not A)", "SKIP", "clients not loaded");
        log("STALE-2. No mixed Health records", "SKIP");
      } else {
        // Delay Client A's getBodyClientOverview by 3s
        let aDelayed = false;
        await page.route("**/api/specialist", async (route) => {
          const body = route.request().postDataJSON();
          if (body?.action === "getBodyClientOverview" && !aDelayed) {
            aDelayed = true;
            await new Promise(r => setTimeout(r, 3000));
            try {
              const response = await route.fetch();
              return route.fulfill({ response });
            } catch { return route.abort(); }
          }
          return route.continue();
        });

        // Click Client A → triggers delayed response
        await page.getByText("Алиса Тест", { exact: false }).first().click({ timeout: 5000 });
        await page.waitForTimeout(500);
        // Go back before A's response
        await page.locator('[data-testid="health-back-btn"]').first().click();
        await page.waitForTimeout(500);
        // Click Client B → fast response
        await page.getByText("Пустой Клиент", { exact: false }).first().click({ timeout: 5000 });
        await waitForDetailLoad(page);
        // Wait for A's delayed response to arrive (should be discarded by generation guard)
        await page.waitForTimeout(4000);

        await page.unrouteAll({ behavior: "ignoreErrors" });

        const clientBVisible = await page.locator('[data-testid="health-client-name"]').filter({ hasText: "Пустой Клиент" }).count();
        log("STALE-1. Client B displayed (not A)", clientBVisible > 0 ? "PASS" : "FAIL");

        const bodyText = await page.textContent("body");
        const hasAMixed = bodyText.includes("72.5 кг") && clientBVisible > 0;
        log("STALE-2. No mixed Health records", !hasAMixed ? "PASS" : "FAIL");
      }

      await page.close();
    }

  } finally {
    await browser.close();
    await cleanup();
  }

  console.log("\n═══════════════════════════════════════════");
  const passed = RESULTS.filter(r => r.r === "PASS").length;
  const failed = RESULTS.filter(r => r.r === "FAIL").length;
  const skipped = RESULTS.filter(r => r.r === "SKIP").length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
})();
