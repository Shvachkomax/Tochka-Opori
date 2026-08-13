import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { createHash } from "node:crypto";

const BASE = "http://localhost:5173";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const R = [];
function log(t, r) { R.push({ t, r }); console.log((r === "PASS" ? "✅" : "❌") + " " + t); }

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });

  try {
    // Pre-cleanup
    const { data: oldE } = await sb.from("experts").select("id").like("access_code", "P3B1-%");
    for (const r of oldE || []) { await sb.from("specialist_sessions").delete().eq("expert_id", r.id); await sb.from("experts").delete().eq("id", r.id); }
    await sb.from("patient_assignments").delete().eq("source", "p3b1_test");
    await sb.from("sessions").delete().like("session_id", "p3b1-%");

    // Create fixtures
    const expert = (await sb.from("experts").insert({ name: "P3B1 Spec", role: "psychologist", access_code: "P3B1-" + Date.now(), is_active: true }).select("id, access_code").single()).data;
    const raw = crypto.randomBytes(32).toString("hex");
    await sb.from("specialist_sessions").insert({ expert_id: expert.id, token_hash: createHash("sha256").update(raw).digest("hex"), expires_at: new Date(Date.now() + 43200000).toISOString() });

    const owner1 = crypto.randomUUID();
    const pc1 = "P3B1-" + Date.now();
    // Session 1: old urgent_help
    await sb.from("sessions").insert({ session_id: "p3b1-1-" + Date.now(), public_code: pc1, module: "support", patient_text: "SECRETihanna", care_recommendation: { level: "urgent_help", reasons: ["suicidal_ideation"] }, doctor_report: "Выявлены суицидальные мысли. Требуется срочная оценка. Рекомендации: немедленная консультация.", report_generation_status: "ready", anonymous_owner_id: owner1 });
    // Session 2: middle medical_consultation
    await sb.from("sessions").insert({ session_id: "p3b1-2-" + Date.now(), public_code: pc1 + "-2", module: "support", patient_text: "SECRET2", care_recommendation: { level: "medical_consultation", reasons: ["functional_impairment"] }, doctor_report: "Наблюдается снижение функциональности. План: наблюдение.", report_generation_status: "ready", anonymous_owner_id: owner1 });
    // Session 3: latest self_support with voice observations
    const voiceData = { status: "completed", speech_features: { tempo: { value: "slow", confidence: "medium" }, pauses: { value: "frequent", confidence: "medium" }, volume: { value: "normal", confidence: "low" }, prosody: { value: "reduced", confidence: "medium" }, tension: { value: "possible", confidence: "low" }, stability: { value: "stable", confidence: "medium" } }, summary: "Замедленный темп речи, частые паузы." };
    await sb.from("sessions").insert({ session_id: "p3b1-3-" + Date.now(), public_code: pc1 + "-3", module: "support", patient_text: "SECRET3", care_recommendation: { level: "self_support", reasons: [] }, doctor_report: "Стабильное состояние. Рекомендуется самопомощь.", report_generation_status: "ready", anonymous_owner_id: owner1, json_data: { voiceObservations: voiceData } });
    await sb.from("patient_assignments").insert({ public_code: pc1, organization_id: null, primary_expert_id: expert.id, assigned_by_expert_id: expert.id, source: "p3b1_test", status: "active", module: "support", patient_label: "P3B1 Клиент" });

    // Zero-session client
    const pc0 = "P3B1-ZERO-" + Date.now();
    await sb.from("patient_assignments").insert({ public_code: pc0, organization_id: null, primary_expert_id: expert.id, assigned_by_expert_id: expert.id, source: "p3b1_test", status: "active", module: "support", patient_label: "P3B1 Zero" });

    // Login
    const page = await browser.newContext().then(c => c.newPage());
    await page.goto(BASE + "/specialist", { waitUntil: "networkidle", timeout: 10000 });
    await page.fill('input[placeholder="Код специалиста"]', expert.access_code);
    await Promise.all([page.waitForResponse(r => r.url().includes("/api/specialist"), { timeout: 10000 }), page.click('button:has-text("Войти")')]);
    await page.waitForTimeout(3000);

    // ═══ Client with sessions ═══
    await page.getByText("P3B1 Клиент", { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);

    log("A. Card opens", (await page.locator('button:has-text("AI-анализ")').count()) > 0 ? "PASS" : "FAIL");

    // B: AI-анализ tab
    await page.locator('button:has-text("AI-анализ")').first().click();
    await page.waitForTimeout(5000);
    log("B. AI-анализ tab opens", (await page.locator('text=/Профессиональный анализ/').count()) > 0 ? "PASS" : "FAIL");

    // C: doctor_report renders (latest session has "Стабильное состояние")
    log("C. doctor_report renders", (await page.locator("text=/Стабильное состояние/").count()) > 0 ? "PASS" : "FAIL");

    // D: disclaimer
    log("D. Disclaimer renders", (await page.locator("text=/не является самостоятельным диагнозом/").count()) > 0 ? "PASS" : "FAIL");

    // E: safety block
    log("E. Safety block renders", (await page.locator("text=/Безопасность/").count()) > 0 ? "PASS" : "FAIL");

    // F: voice observations
    log("F. Voice observations render", (await page.locator("text=/Наблюдения по голосу/").count()) > 0 ? "PASS" : "FAIL");

    // G: only approved voice fields
    const bodyText = await page.textContent("body");
    const hasTempo = bodyText.includes("Темп:");
    const hasAge = bodyText.includes("возраст") || bodyText.includes("пол") || bodyText.includes("мужск") || bodyText.includes("женск");
    log("G. Only approved voice fields", hasTempo && !hasAge ? "PASS" : "FAIL");

    // H: no age/gender inference
    log("H. No age/gender inference", !hasAge ? "PASS" : "FAIL");

    // I: no patient_text
    log("I. No patient_text", !bodyText.includes("SECRETihanna") ? "PASS" : "FAIL");

    // J: no user_report
    log("J. No user_report", !bodyText.includes("user_report") ? "PASS" : "FAIL");

    // K: no conversation_history
    log("K. No conversation_history", !bodyText.includes("conversation_history") ? "PASS" : "FAIL");

    // L: no raw json_data
    log("L. No raw json_data", !bodyText.includes("json_data") ? "PASS" : "FAIL");

    // M: no technical identifiers
    log("M. No public_code/session_id visible", !bodyText.includes(pc1) && !bodyText.includes("session_id") ? "PASS" : "FAIL");

    // ═══ Dynamics test ═══
    await page.locator('button:has-text("Динамика")').first().click();
    await page.waitForTimeout(2000);
    const dynText = await page.textContent("body");
    const hasUrgent = dynText.includes("Срочно");
    const hasAttention = dynText.includes("Внимание");
    const hasNormal = dynText.includes("Норма");
    log("DYNAMICS. All 3 safety levels visible", hasUrgent && hasAttention && hasNormal ? "PASS" : "FAIL", `urgent=${hasUrgent} attention=${hasAttention} normal=${hasNormal}`);

    // ═══ Empty state ═══
    await page.click('button:has-text("← Мои клиенты")');
    await page.waitForTimeout(2000);
    await page.getByText("P3B1 Zero", { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(5000);
    const zeroHasTabs = await page.locator('button:has-text("AI-анализ")').count();
    if (zeroHasTabs > 0) {
      await page.locator('button:has-text("AI-анализ")').first().click();
      await page.waitForTimeout(3000);
      const emptyAnalysis = await page.locator("text=/недоступен|не сформирован/").count();
      log("EMPTY. No sessions → safe empty state", emptyAnalysis > 0 ? "PASS" : "FAIL");
    } else {
      log("EMPTY. No sessions → safe empty state", "PASS", "tabs not rendered (zero sessions)");
    }

    // ═══ Context switch ═══
    const bodyBtn = page.locator("div").filter({ hasText: /^Здоровье/ }).first();
    if (await bodyBtn.count() > 0) await bodyBtn.click();
    await page.waitForTimeout(2000);
    const analysisGone = (await page.locator("text=/Профессиональный анализ/").count()) === 0;
    log("CTX. Analysis disappears on module switch", analysisGone ? "PASS" : "FAIL");

  } finally {
    await browser.close();
    await sb.from("sessions").delete().like("session_id", "p3b1-%");
    await sb.from("patient_assignments").delete().eq("source", "p3b1_test");
    const { data: e } = await sb.from("experts").select("id").like("access_code", "P3B1-%").single();
    if (e) { await sb.from("specialist_sessions").delete().eq("expert_id", e.id); await sb.from("experts").delete().eq("id", e.id); }
    console.log("Cleanup done");
  }

  const p = R.filter(r => r.r === "PASS").length, f = R.filter(r => r.r === "FAIL").length;
  console.log("TOTAL: " + p + " PASS, " + f + " FAIL");
})();
