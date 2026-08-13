import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { createHash } from "node:crypto";

const BASE = "http://localhost:5173";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newContext().then(c => c.newPage());
  const R = [];
  function log(t, r) { R.push({ t, r }); console.log((r === "PASS" ? "✅" : "❌") + " " + t); }

  try {
    const { data: expert } = await sb.from("experts").insert({ name: "P3B Test", role: "psychologist", access_code: "P3B-" + Date.now(), is_active: true }).select("id, access_code").single();
    const raw = crypto.randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    await sb.from("specialist_sessions").insert({ expert_id: expert.id, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString() });

    const owner = crypto.randomUUID();
    const pc = "P3B-" + Date.now();
    await sb.from("sessions").insert({ session_id: "p3b-" + Date.now(), public_code: pc, module: "support", patient_text: "test", care_recommendation: { level: "professional_contact", reasons: ["functional_impairment"] }, doctor_report: "Выявлены сигналы: снижение активности. Маркеры риска: умеренные. Рекомендации: консультация специалиста.", report_generation_status: "ready", anonymous_owner_id: owner, json_data: { voiceObservations: { status: "completed", speech_features: { tempo: { value: "slow", confidence: "medium" }, pauses: { value: "frequent", confidence: "medium" }, volume: { value: "normal", confidence: "low" } }, summary: "Замедленный темп речи, частые паузы." } } });
    await sb.from("patient_assignments").insert({ public_code: pc, organization_id: null, primary_expert_id: expert.id, assigned_by_expert_id: expert.id, source: "p3b_test", status: "active", module: "support", patient_label: "Тест Клиент" });

    await page.goto(BASE + "/specialist", { waitUntil: "networkidle", timeout: 10000 });
    await page.fill('input[placeholder="Код специалиста"]', expert.access_code);
    await Promise.all([page.waitForResponse(r => r.url().includes("/api/specialist"), { timeout: 10000 }), page.click('button:has-text("Войти")')]);
    await page.waitForTimeout(3000);

    await page.getByText("Тест Клиент", { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(5000); // Wait for detail data to load

    log("AI-анализ tab visible", (await page.locator('button:has-text("AI-анализ")').count()) > 0 ? "PASS" : "FAIL");

    await page.locator('button:has-text("AI-анализ")').first().click();
    await page.waitForTimeout(3000);

    log("Professional report renders", (await page.locator("text=/Выявлены сигналы/").count()) > 0 ? "PASS" : "FAIL");
    log("Voice observations section", (await page.locator("text=/Наблюдения по голосу/").count()) > 0 ? "PASS" : "FAIL");

    const bodyText = await page.textContent("body");
    log("No raw dialogue", !bodyText.includes("patient_text") ? "PASS" : "FAIL");

    await page.locator('button:has-text("Динамика")').first().click();
    await page.waitForTimeout(1000);
    log("Dynamics timeline renders", (await page.locator("text=/Требует внимания/").count()) > 0 ? "PASS" : "FAIL");

    await page.locator('button:has-text("AI-анализ")').first().click();
    await page.waitForTimeout(500);
    log("AI disclaimer present", (await page.locator("text=/не является самостоятельным диагнозом/").count()) > 0 ? "PASS" : "FAIL");

  } finally {
    await browser.close();
    await sb.from("sessions").delete().like("session_id", "p3b-%");
    await sb.from("patient_assignments").delete().eq("source", "p3b_test");
    const { data: e } = await sb.from("experts").select("id").like("access_code", "P3B-%").single();
    if (e) { await sb.from("specialist_sessions").delete().eq("expert_id", e.id); await sb.from("experts").delete().eq("id", e.id); }
    console.log("Cleanup done");
  }

  const p = R.filter(r => r.r === "PASS").length, f = R.filter(r => r.r === "FAIL").length;
  console.log("TOTAL: " + p + " PASS, " + f + " FAIL");
})();
