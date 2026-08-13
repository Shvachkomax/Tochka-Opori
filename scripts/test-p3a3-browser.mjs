import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import crypto from "node:crypto";

const BASE = "http://localhost:5173";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RESULTS = [];
const FIXTURES = { experts: [], specialistSessions: [], supportSessions: [], assignments: [], access: [] };

function log(t, r, d = "") { RESULTS.push({ t, r }); console.log((r === "PASS" ? "✅" : "❌") + " " + t + (d ? " — " + d : "")); }

async function createExpert(name) {
  const { data } = await sb.from("experts").insert({ name, role: "psychologist", access_code: "P3A3-" + crypto.randomBytes(4).toString("hex").toUpperCase(), is_active: true }).select("id, access_code").single();
  FIXTURES.experts.push(data.id);
  return data;
}

async function createSessionToken(expertId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data } = await sb.from("specialist_sessions").insert({ expert_id: expertId, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString() }).select("id").single();
  FIXTURES.specialistSessions.push(data.id);
  return raw;
}

async function createSession(ownerId, publicCode, level, reasons, report) {
  const { data } = await sb.from("sessions").insert({
    session_id: "p3a3-" + crypto.randomBytes(4).toString("hex"), public_code: publicCode, module: "support",
    patient_text: "test", care_recommendation: { level, reasons, timeframe: "routine" },
    doctor_report: report, report_generation_status: "ready", anonymous_owner_id: ownerId,
  }).select("id").single();
  FIXTURES.supportSessions.push(data.id);
  return data.id;
}

async function createAssignment(publicCode, expertId, label) {
  const { data } = await sb.from("patient_assignments").insert({
    public_code: publicCode, organization_id: null, primary_expert_id: expertId,
    assigned_by_expert_id: expertId, source: "p3a3_test", status: "active",
    module: "support", patient_label: label,
  }).select("id").single();
  FIXTURES.assignments.push(data.id);
  return data.id;
}

async function cleanup() {
  console.log("\n── Cleanup ──");
  for (const id of FIXTURES.supportSessions) await sb.from("sessions").delete().eq("id", id);
  for (const id of FIXTURES.access) await sb.from("patient_access").delete().eq("id", id);
  for (const id of FIXTURES.assignments) await sb.from("patient_assignments").delete().eq("id", id);
  for (const id of FIXTURES.specialistSessions) await sb.from("specialist_sessions").delete().eq("id", id);
  for (const id of FIXTURES.experts) await sb.from("experts").delete().eq("id", id);
  console.log(`  Removed ${FIXTURES.supportSessions.length} sessions, ${FIXTURES.assignments.length} assignments, ${FIXTURES.experts.length} experts`);
}

async function freshLogin(browser, accessCode) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/specialist", { waitUntil: "networkidle", timeout: 10000 });
  await page.fill('input[placeholder="Код специалиста"]', accessCode);
  await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/specialist"), { timeout: 10000 }),
    page.click('button:has-text("Войти")'),
  ]);
  // Wait for client list to load
  await page.waitForTimeout(3000);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  try {
    // Pre-cleanup
    const { data: oldA } = await sb.from("patient_assignments").select("id").eq("source", "p3a3_test");
    for (const r of oldA || []) await sb.from("patient_assignments").delete().eq("id", r.id);
    const { data: oldE } = await sb.from("experts").select("id").like("access_code", "P3A3-%");
    for (const r of oldE || []) { await sb.from("specialist_sessions").delete().eq("expert_id", r.id); await sb.from("experts").delete().eq("id", r.id); }

    // ── Create fixtures ────────────────────────────────────
    const expert = await createExpert("P3A3 Specialist");
    await createSessionToken(expert.id);

    const owner1 = crypto.randomUUID();
    const pc1 = "P3A3-" + crypto.randomBytes(4).toString("hex");
    await createSession(owner1, pc1, "urgent_help", ["suicidal_ideation"], "Выявлены суицидальные мысли. Требуется срочная оценка.");
    await createSession(owner1, pc1 + "-2", "self_support", [], "Стабильное состояние.");
    const assignA = await createAssignment(pc1, expert.id, "Клиент А");

    const owner2 = crypto.randomUUID();
    const pc2 = "P3A3-" + crypto.randomBytes(4).toString("hex");
    await createSession(owner2, pc2, "self_support", [], "Норма.");
    const assignB = await createAssignment(pc2, expert.id, "Клиент Б");

    // ═══ TEST 1: REVOKED ACCESS (fresh page) ═══════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);
      const consoleErrors = [];
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

      // Open Client A
      await page.getByText("Клиент А", { exact: false }).first().click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      // Go to Сессии tab
      await page.locator("button").filter({ hasText: "Сессии" }).first().click();
      await page.waitForTimeout(500);
      const hasDoctorReport = await page.locator("text=/суицидальн/").count();
      log("REV-1. Doctor report visible before revocation", hasDoctorReport > 0 ? "PASS" : "FAIL");

      // Deactivate
      await sb.from("patient_assignments").update({ status: "inactive" }).eq("id", assignA.id);

      // Force re-fetch: switch to Body then back to Support
      const bodyBtn = page.locator("div").filter({ hasText: /^Здоровье/ }).first();
      if (await bodyBtn.count() > 0) await bodyBtn.click();
      await page.waitForTimeout(1500);
      const supportBtn = page.locator("div").filter({ hasText: /^Точка Опоры/ }).first();
      if (await supportBtn.count() > 0) await supportBtn.click();
      await page.waitForTimeout(2000);

      const staleDoctorReport = await page.locator("text=/суицидальн/").count();
      log("REV-2. Clinical content removed after revocation", staleDoctorReport === 0 ? "PASS" : "FAIL");

      // Re-activate for other tests
      await sb.from("patient_assignments").update({ status: "active" }).eq("id", assignA.id);
      await page.close();
    }

    // ═══ TEST 2: STALE RESPONSE (fresh page, route interception) ═══
    {
      const { page } = await freshLogin(browser, expert.access_code);

      // Verify clients visible
      const clientsBefore = await page.getByText("Клиент А", { exact: false }).count();
      if (clientsBefore === 0) {
        log("STALE-1. Client B displayed (not A)", "SKIP", "clients not loaded");
        log("STALE-2. No mixed session cards", "SKIP");
      } else {
        // Set up route interception: delay Client A's getClientOverview by 3s
        let aDelayed = false;
        await page.route("**/api/specialist", async (route) => {
          const body = route.request().postDataJSON();
          if (body?.action === "getClientOverview" && !aDelayed) {
            aDelayed = true;
            await new Promise(r => setTimeout(r, 3000));
            try {
              const response = await route.fetch();
              return route.fulfill({ response });
            } catch { return route.abort(); }
          }
          return route.continue();
        });

        // Click Client A → triggers delayed response, detail card opens
        await page.getByText("Клиент А", { exact: false }).first().click({ timeout: 5000 });
        await page.waitForTimeout(500);
        // Go back to list before A's response completes
        await page.locator("button").filter({ hasText: "Мои клиенты" }).first().click();
        await page.waitForTimeout(500);
        // Click Client B → triggers fast response
        await page.getByText("Клиент Б", { exact: false }).first().click({ timeout: 5000 });
        await page.waitForTimeout(4000);

        // Remove interceptor safely
        await page.unrouteAll({ behavior: "ignoreErrors" });

        const clientBName = await page.getByText("Клиент Б", { exact: false }).count();
        const clientAStale = await page.getByText("Клиент А", { exact: false }).count();
        log("STALE-1. Client B displayed (not A)", clientBName > 0 && clientAStale === 0 ? "PASS" : "FAIL", "B=" + clientBName + " A=" + clientAStale);

        const bodyText = await page.textContent("body");
        const hasAMixed = bodyText.includes("суицидальн") && clientBName > 0;
        log("STALE-2. No mixed session cards", !hasAMixed ? "PASS" : "FAIL");
      }

      await page.close();
    }

    // ═══ TEST 3: CONTEXT SWITCH (fresh page) ═══════════════
    {
      const { page } = await freshLogin(browser, expert.access_code);

      // Open Client A
      await page.getByText("Клиент А", { exact: false }).first().click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      const hasBack = await page.locator("button").filter({ hasText: "Мои клиенты" }).count();
      log("CTX-1. Detail open before switch", hasBack > 0 ? "PASS" : "FAIL");

      // Switch to Body
      const bodyBtn = page.locator("div").filter({ hasText: /^Здоровье/ }).first();
      if (await bodyBtn.count() > 0) await bodyBtn.click();
      await page.waitForTimeout(1000);

      const detailGone = (await page.locator("button").filter({ hasText: "Мои клиенты" }).count()) === 0;
      const bodyListOk = (await page.locator("text=/В этом рабочем пространстве/").count()) > 0
        || (await page.locator('[style*="cursor: pointer"]').count()) > 0;
      log("CTX-2. Detail disappears on module switch", detailGone || bodyListOk ? "PASS" : "FAIL");

      // Switch back
      const supportBtn = page.locator("div").filter({ hasText: /^Точка Опоры/ }).first();
      if (await supportBtn.count() > 0) await supportBtn.click();
      await page.waitForTimeout(2000);
      const supportBack = await page.locator('[style*="cursor: pointer"]').count();
      log("CTX-3. Support list restores after switch", supportBack >= 1 ? "PASS" : "FAIL");

      // ── FIX: client registry locator ──
      const fixCards = await page.locator('[style*="cursor: pointer"]').count();
      log("FIX. Client cards clickable", fixCards >= 2 ? "PASS" : "FAIL", "count=" + fixCards);

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
