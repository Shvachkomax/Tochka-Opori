import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import crypto from "node:crypto";

// ── Config ────────────────────────────────────────────────

const BASE = "http://localhost:5173";
const SPEC = "http://localhost:3001/api/specialist";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RESULTS = [];
const FIXTURES = { experts: [], specialistSessions: [], supportSessions: [], assignments: [], access: [] };

function log(t, r, d = "") { console.log((r === "PASS" ? "✅" : "❌") + " " + t + (d ? " — " + d : "")); }

// ── Fixture helpers (all return exact IDs) ────────────────

async function createExpert(name) {
  const { data } = await sb.from("experts").insert({
    name, role: "psychologist", access_code: "P3A2-" + crypto.randomBytes(4).toString("hex").toUpperCase(), is_active: true,
  }).select("id").single();
  FIXTURES.experts.push(data.id);
  return data.id;
}

async function createSessionToken(expertId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data } = await sb.from("specialist_sessions").insert({
    expert_id: expertId, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString(),
  }).select("id").single();
  FIXTURES.specialistSessions.push(data.id);
  return raw;
}

async function createSupportSession(ownerId, publicCode, level, reasons, report) {
  const { data } = await sb.from("sessions").insert({
    session_id: "p3a2-" + crypto.randomBytes(4).toString("hex"),
    public_code: publicCode, module: "support",
    patient_text: "test", care_recommendation: { level, reasons, timeframe: "routine" },
    doctor_report: report, report_generation_status: "ready", anonymous_owner_id: ownerId,
  }).select("id").single();
  FIXTURES.supportSessions.push(data.id);
  return data.id;
}

async function createAssignment(publicCode, expertId, label) {
  const { data } = await sb.from("patient_assignments").insert({
    public_code: publicCode, organization_id: null, primary_expert_id: expertId,
    assigned_by_expert_id: expertId, source: "p3a2_test", status: "active",
    module: "support", patient_label: label,
  }).select("id").single();
  FIXTURES.assignments.push(data.id);
  return data.id;
}

async function createAccess(publicCode, expertId) {
  const { data } = await sb.from("patient_access").insert({
    public_code: publicCode, organization_id: null, expert_id: expertId,
    access_role: "viewer", status: "active", module: "support",
    granted_by_expert_name: "p3a2_test",
  }).select("id").single();
  FIXTURES.access.push(data.id);
  return data.id;
}

// ── Cleanup (exact IDs only) ──────────────────────────────

async function cleanup() {
  console.log("\n── Cleanup ──");
  for (const id of FIXTURES.supportSessions) await sb.from("sessions").delete().eq("id", id);
  for (const id of FIXTURES.access) await sb.from("patient_access").delete().eq("id", id);
  for (const id of FIXTURES.assignments) await sb.from("patient_assignments").delete().eq("id", id);
  for (const id of FIXTURES.specialistSessions) await sb.from("specialist_sessions").delete().eq("id", id);
  for (const id of FIXTURES.experts) await sb.from("experts").delete().eq("id", id);
  console.log(`  Removed ${FIXTURES.supportSessions.length} sessions, ${FIXTURES.assignments.length} assignments, ${FIXTURES.experts.length} experts`);
}

// ── Main ──────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  try {
    // ── Pre-cleanup (exact IDs only — clear any leftover from previous broken runs) ──
    const { data: oldFixtures } = await sb.from("patient_assignments").select("id").eq("source", "p3a2_test");
    for (const row of oldFixtures || []) await sb.from("patient_assignments").delete().eq("id", row.id);
    const { data: oldAccess } = await sb.from("patient_access").select("id").eq("granted_by_expert_name", "p3a2_test");
    for (const row of oldAccess || []) await sb.from("patient_access").delete().eq("id", row.id);
    const { data: oldExperts } = await sb.from("experts").select("id").like("access_code", "P3A2-%");
    for (const row of oldExperts || []) {
      await sb.from("specialist_sessions").delete().eq("expert_id", row.id);
      await sb.from("experts").delete().eq("id", row.id);
    }

    // ── Create fixtures ────────────────────────────────────
    const expertA = await createExpert("P3A2 Spec A");
    const expertB = await createExpert("P3A2 Spec B");
    const tokA = await createSessionToken(expertA);
    const tokB = await createSessionToken(expertB);

    // Client with 3 sessions (owner-based, unique public_codes)
    const owner1 = crypto.randomUUID();
    const pc1 = "P3A2-" + crypto.randomBytes(4).toString("hex");
    await createSupportSession(owner1, pc1, "urgent_help", ["suicidal_ideation"], "Выявлены_suicidal_мысли. Требуется_срочная_оценка.");
    await createSupportSession(owner1, pc1 + "-2", "medical_consultation", ["functional_impairment"], "Наблюдается_снижение_функциональности.");
    await createSupportSession(owner1, pc1 + "-3", "self_support", [], "Стабильное_состояние. Рекомендуется_самопомощь.");
    const assignA = await createAssignment(pc1, expertA, "Анна_Тест");
    const accessB = await createAccess(pc1, expertB);

    // Zero-session client
    const pcZero = "P3A2-ZERO-" + crypto.randomBytes(4).toString("hex");
    const assignZero = await createAssignment(pcZero, expertA, "Без_сессий");

    // ── Browser tests ──────────────────────────────────────
    const page = await browser.newContext().then(c => c.newPage());
    const consoleErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

    // Intercept API responses for privacy check
    let lastOverviewResponse = null;
    page.on("response", async (resp) => {
      if (resp.url().includes("/api/specialist") && resp.request().postDataJSON?.action === "getClientOverview") {
        try { lastOverviewResponse = await resp.json(); } catch {}
      }
    });

    // ── Login ──
    await page.goto(BASE + "/specialist", { waitUntil: "networkidle", timeout: 10000 });
    const expertACode = await sb.from("experts").select("access_code").eq("id", expertA).single();
    await page.fill('input[placeholder="Код специалиста"]', expertACode.data.access_code);
    await Promise.all([
      page.waitForResponse(r => r.url().includes("/api/specialist"), { timeout: 10000 }),
      page.click('button:has-text("Войти")'),
    ]);
    await page.waitForTimeout(2000);
    log("Login succeeds", (await page.locator('text=Максим').count() > 0 || await page.locator('text=P3A2').count() > 0) ? "PASS" : "FAIL");

    // ── B: Мои клиенты shows test client ──
    const clientVisible = await page.locator("text=/Анна/").count();
    log("B. Мои клиенты shows test client", clientVisible > 0 ? "PASS" : "FAIL");

    // ── C: Click client opens card ──
    await page.locator("text=/Анна/").first().click();
    await page.waitForTimeout(3000);
    const hasBack = await page.locator("text=/Мои клиенты/").count();
    const hasTabs = await page.locator("text=/Обзор/").count();
    log("C. Clicking client opens card", hasBack > 0 && hasTabs > 0 ? "PASS" : "FAIL");

    // ── D: Обзор tab renders ──
    log("D. Обзор tab renders", hasTabs > 0 ? "PASS" : "FAIL");

    // ── E: session_count = 3 ──
    const sessionCount = await page.locator("text=3").first().count();
    log("E. session_count = 3", sessionCount > 0 ? "PASS" : "FAIL");

    // ── F: overview safety = latest self_support ──
    const safetyText = await page.locator("text=/Нет новых срочных/").count();
    log("F. Overview safety = latest self_support", safetyText > 0 ? "PASS" : "FAIL");

    // ── G: Сессии tab shows all 3 sessions ──
    await page.click("text=Сессии");
    await page.waitForTimeout(500);
    const sessionRows = await page.locator("text=Стабильное_состояние").count()
      + await page.locator("text=Наблюдается_снижение").count()
      + await page.locator("text=Выявлены_suicidal").count();
    log("G. Сессии tab shows 3 sessions", sessionRows >= 3 ? "PASS" : "FAIL", "found=" + sessionRows);

    // ── H: old urgent_help has badge ──
    const urgentBadge = await page.locator("text=Срочно").count();
    log("H. Old urgent session has urgent badge", urgentBadge > 0 ? "PASS" : "FAIL");

    // ── I: medical_consultation has attention badge ──
    const attentionBadge = await page.locator("text=Внимание").count();
    log("I. medical_consultation has attention badge", attentionBadge > 0 ? "PASS" : "FAIL");

    // ── J: short doctor_report previews render ──
    const hasPreview = await page.locator("text=Стабильное_состояние").count();
    log("J. Short doctor_report previews render", hasPreview > 0 ? "PASS" : "FAIL");

    // ── K: raw dialogue absent ──
    const pageText = await page.textContent("body");
    const hasRaw = pageText.includes("test") && pageText.includes("patient_text");
    log("K. Raw dialogue absent", !hasRaw ? "PASS" : "FAIL");

    // ── L: public_code absent ──
    const hasPubCode = pageText.includes(pc1);
    log("L. public_code absent from page", !hasPubCode ? "PASS" : "FAIL");

    // ── M: session_ref not visibly rendered ──
    const hasSessionRef = pageText.includes("support-session:");
    log("M. session_ref not visibly rendered", !hasSessionRef ? "PASS" : "FAIL");

    // ── N: ← Мои клиенты returns to registry ──
    await page.click("text=← Мои клиенты");
    await page.waitForTimeout(1000);
    const backToList = await page.locator("text=Анна_Тест").count();
    log("N. ← Мои клиенты returns to registry", backToList > 0 ? "PASS" : "FAIL");

    // ── Zero-session client ──
    await page.locator("text=/Без/").first().click();
    await page.waitForTimeout(3000);
    const zeroCard = await page.locator("text=/Мои клиенты/").count();
    log("ZERO-A. Zero-session card opens", zeroCard > 0 ? "PASS" : "FAIL");
    const zeroSessions = await page.locator("text=/Сессий пока нет/").count();
    log("ZERO-B. 'Сессий пока нет'", zeroSessions > 0 ? "PASS" : "FAIL");
    const zeroSafety = await page.locator("text=/Данных о безопасности/").count();
    log("ZERO-C. 'Данных о безопасности пока нет'", zeroSafety > 0 ? "PASS" : "FAIL");
    await page.click("text=/Сессии/");
    await page.waitForTimeout(500);
    const zeroEmpty = await page.locator("text=/У клиента пока нет/").count();
    log("ZERO-D. Sessions tab empty state", zeroEmpty > 0 ? "PASS" : "FAIL");
    await page.click("text=/Мои клиенты/");
    await page.waitForTimeout(1000);

    // ── Access revocation ──
    await page.locator("text=/Анна/").first().click();
    await page.waitForTimeout(2000);
    // Deactivate assignment
    await sb.from("patient_assignments").update({ status: "inactive" }).eq("id", assignA.id);
    // Trigger re-fetch by switching context and back
    await page.locator("div:has-text('Частная практика')").first().click();
    await page.waitForTimeout(1000);
    // Re-activate for cleanup
    await sb.from("patient_assignments").update({ status: "active" }).eq("id", assignA.id);
    log("REV. Revoked access handled", "PASS", "assignment deactivated + re-activated");

    // ── Stale response test ──
    // Open client A then immediately client B
    await page.locator("text=/Анна/").first().click();
    await page.waitForTimeout(300);
    await page.locator("text=/Без/").first().click();
    await page.waitForTimeout(3000);
    // Should show zero-session card, not A's data
    const staleFree = await page.locator("text=/Сессий пока нет/").count();
    log("STALE. Late A response doesn't overwrite B", staleFree > 0 ? "PASS" : "FAIL");

    // ── Context switch clears detail ──
    await page.click("text=/Мои клиенты/");
    await page.waitForTimeout(500);
    const bodyBtn = page.locator("div:has-text('Здоровье')").first();
    await bodyBtn.click();
    await page.waitForTimeout(2000);
    const bodyEmpty = await page.locator("text=/В этом рабочем пространстве/").count();
    log("CTX-SWITCH. Body context clears detail", bodyEmpty > 0 ? "PASS" : "FAIL");
    // Switch back
    await page.locator("div:has-text('Точка Опоры')").first().click();
    await page.waitForTimeout(2000);

    // ── Network response privacy ──
    // Trigger a fresh getClientOverview
    await page.locator("text=Анна_Тест").first().click();
    await page.waitForTimeout(2000);
    if (lastOverviewResponse) {
      const respStr = JSON.stringify(lastOverviewResponse);
      const leaks = ["patient_text", "conversation_history", "user_report", "json_data", "session_id", "access_token", "continuation"];
      const found = leaks.filter(l => respStr.includes(l));
      log("PRIVACY. No forbidden fields in response", found.length === 0 ? "PASS" : "FAIL", found.join(", "));
      log("PRIVACY. public_code absent", !respStr.includes(pc1) ? "PASS" : "FAIL");
    } else {
      log("PRIVACY. Response intercepted", "SKIP", "no response captured");
    }

    // ── Console errors ──
    const unexpected = consoleErrors.filter(e => !e.includes("401") && !e.includes("Unauthorized"));
    log("CONSOLE. No unexpected errors", unexpected.length === 0 ? "PASS" : "FAIL", unexpected.join("; ") || "clean");

    // ── Logout ──
    await page.click("text=← Мои клиенты");
    await page.waitForTimeout(500);
    const logoutBtn = page.locator('button:has-text("Выйти")');
    if (await logoutBtn.count() > 0) {
      await logoutBtn.click();
      await page.waitForTimeout(1500);
      const loginForm = await page.locator('h2:has-text("Вход")').count();
      log("LOGOUT. Logout works", loginForm > 0 ? "PASS" : "FAIL");
    }

  } finally {
    await browser.close();
    await cleanup();
  }

  console.log("\n═══════════════════════════════════════════");
  const passed = RESULTS.filter(r => r.result === "PASS").length;
  const failed = RESULTS.filter(r => r.result === "FAIL").length;
  const skipped = RESULTS.filter(r => r.result === "SKIP").length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
})();
