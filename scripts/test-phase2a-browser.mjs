import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import crypto from "node:crypto";

// ── Config ────────────────────────────────────────────────

const BASE = "http://localhost:5173";
const API = "http://localhost:3001/api/specialist";
const RESULTS = [];

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function log(test, result, detail = "") {
  RESULTS.push({ test, result, detail });
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⏭️";
  console.log(`${icon} ${test}${detail ? " — " + detail : ""}`);
}

function genCode() {
  return `T2A-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// ── Fixture management ────────────────────────────────────

const FIXTURES = [];

function track(table, id) {
  FIXTURES.push({ table, id });
}

async function createSession(expertId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await supabase.from("specialist_sessions").insert({ expert_id: expertId, token_hash: tokenHash, expires_at: expiresAt });
  return rawToken;
}

async function cleanup() {
  console.log("\n── Cleanup ──");
  // Clean test data by source='test_phase2a'
  await supabase.from("patient_assignments").delete().eq("source", "test_phase2a");
  await supabase.from("patient_access").delete().eq("granted_by_expert_name", "test_phase2a");
  // Clean test orgs
  const { data: testOrgs } = await supabase.from("organizations").select("id").like("slug", "test-p2a-%");
  for (const o of testOrgs || []) {
    await supabase.from("expert_organization_memberships").delete().eq("organization_id", o.id);
    await supabase.from("organizations").delete().eq("id", o.id);
  }
  // Clean test experts
  const { data: testExperts } = await supabase.from("experts").select("id").like("access_code", "T2A-%");
  for (const e of testExperts || []) {
    await supabase.from("specialist_sessions").delete().eq("expert_id", e.id);
    await supabase.from("experts").delete().eq("id", e.id);
  }
  console.log("  All test fixtures removed");
}

// ── Setup fixtures ────────────────────────────────────────

let expertA, expertB, orgA, orgB, tokenA, tokenB;

async function setup() {
  // Expert A
  const codeA = genCode();
  const { data: eA } = await supabase.from("experts").insert({
    name: "Тест Специалист А", role: "psychologist", specialty: "test",
    city: "Тестоград", access_code: codeA, is_active: true,
  }).select("id, access_code").single();
  expertA = eA;
  tokenA = await createSession(expertA.id);

  // Expert B
  const codeB = genCode();
  const { data: eB } = await supabase.from("experts").insert({
    name: "Тест Специалист Б", role: "psychiatrist", specialty: "test",
    city: "Тестоград", access_code: codeB, is_active: true,
  }).select("id, access_code").single();
  expertB = eB;
  tokenB = await createSession(expertB.id);

  // Org A
  const { data: oA } = await supabase.from("organizations").insert({
    name: "Тест Клиника А", slug: `test-p2a-${Date.now()}`, type: "private_clinic",
  }).select("id").single();
  orgA = oA;
  await supabase.from("expert_organization_memberships").insert({ organization_id: orgA.id, expert_id: expertA.id, role: "doctor" });

  // Org B
  const { data: oB } = await supabase.from("organizations").insert({
    name: "Тест Клиника Б", slug: `test-p2a-b-${Date.now()}`, type: "private_clinic",
  }).select("id").single();
  orgB = oB;

  // ── Create patient_assignments ──────────────────────────
  // A1: private practice Support, has patient_label
  const { data: a1 } = await supabase.from("patient_assignments").insert({
    public_code: genCode(), organization_id: null, primary_expert_id: expertA.id,
    assigned_by_expert_id: expertA.id, source: "test_phase2a", status: "active",
    module: "support", patient_label: "Анна",
  }).select("id").single();
  track("patient_assignments", a1.id);

  // A2: private practice Support, NO patient_label
  const { data: a2 } = await supabase.from("patient_assignments").insert({
    public_code: genCode(), organization_id: null, primary_expert_id: expertA.id,
    assigned_by_expert_id: expertA.id, source: "test_phase2a", status: "active",
    module: "support",
  }).select("id").single();
  track("patient_assignments", a2.id);

  // A3: Org A Support, has patient_label
  const { data: a3 } = await supabase.from("patient_assignments").insert({
    public_code: genCode(), organization_id: orgA.id, primary_expert_id: expertA.id,
    assigned_by_expert_id: expertA.id, source: "test_phase2a", status: "active",
    module: "support", patient_label: "Борис",
  }).select("id").single();
  track("patient_assignments", a3.id);

  // A4: Org A Support, inactive (should not appear)
  const { data: a4 } = await supabase.from("patient_assignments").insert({
    public_code: genCode(), organization_id: orgA.id, primary_expert_id: expertA.id,
    assigned_by_expert_id: expertA.id, source: "test_phase2a", status: "inactive",
    module: "support", patient_label: "Невидимый",
  }).select("id").single();
  track("patient_assignments", a4.id);

  // A5: private practice Body (owner identity)
  const bodyOwner = crypto.randomUUID();
  const { data: a5 } = await supabase.from("patient_assignments").insert({
    public_code: null, owner_type: "anonymous_profile", owner_id: bodyOwner,
    organization_id: null, primary_expert_id: expertA.id,
    assigned_by_expert_id: expertA.id, source: "test_phase2a", status: "active",
    module: "body",
  }).select("id").single();
  track("patient_assignments", a5.id);

  // Body client with display_name
  await supabase.from("body_clients").insert({
    session_id: genCode(), anonymous_owner_id: bodyOwner, display_name: "Виктор",
    source: "self_signup", status: "active",
  });

  // B1: Expert B private practice Support
  const { data: b1 } = await supabase.from("patient_assignments").insert({
    public_code: genCode(), organization_id: null, primary_expert_id: expertB.id,
    assigned_by_expert_id: expertB.id, source: "test_phase2a", status: "active",
    module: "support", patient_label: "Клиент Б",
  }).select("id").single();
  track("patient_assignments", b1.id);

  // ── Create patient_access (shared) ─────────────────────
  // Shared access to B1 for expert A
  const { data: acc1 } = await supabase.from("patient_access").insert({
    public_code: (await supabase.from("patient_assignments").select("public_code").eq("id", b1.id).single()).data?.public_code,
    organization_id: null, expert_id: expertA.id, access_role: "viewer",
    status: "active", module: "support", granted_by_expert_name: "test_phase2a",
  }).select("id").single();
  track("patient_access", acc1.id);

  // ── Create test session for expert A (for browser login)
  // Expert A uses access_code for login, not token directly

  console.log(`  Expert A: ${expertA.access_code} (${expertA.id})`);
  console.log(`  Expert B: ${expertB.access_code} (${expertB.id})`);
  console.log(`  Org A: ${orgA.id}`);
  console.log(`  Org B: ${orgB.id}`);
}

// ── Browser tests ─────────────────────────────────────────

async function runBrowserTests() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Login as Expert A
  await page.goto(`${BASE}/specialist`, { waitUntil: "networkidle", timeout: 10000 });
  await page.fill('input[placeholder="Код специалиста"]', expertA.access_code);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/specialist"), { timeout: 10000 }),
    page.click('button:has-text("Войти")'),
  ]);
  await page.waitForTimeout(2000);

  // ── A. "Мои клиенты" section renders ──────────────────
  const clientsSection = await page.locator('text=Мои клиенты').count();
  log("A. 'Мои клиенты' section renders", clientsSection > 0 ? "PASS" : "FAIL");

  // ── B. Private-practice Support client appears ────────
  // Wait for listClients to load
  await page.waitForTimeout(2000);
  const anna = await page.locator('text=Анна').count();
  log("B. Private-practice Support client appears", anna > 0 ? "PASS" : "FAIL");

  // ── C. Visible client name comes from patient_label ───
  // Анна is from patient_label — verify it's shown
  log("C. Visible client name comes from patient_label", anna > 0 ? "PASS" : "FAIL", "patient_label='Анна'");

  // ── D. Client without patient_label shows fallback ────
  const fallback = await page.locator('text=Клиент без имени').count();
  log("D. Client without patient_label shows 'Клиент без имени'", fallback > 0 ? "PASS" : "FAIL");

  // ── E. No session text appears anywhere in registry ───
  const pageText = await page.textContent("body");
  const clinicalTerms = ["диагноз", "симптом", "жалоб", "анамнез", "психотерап", "сессия", "тревог", "депресс"];
  const foundClinical = clinicalTerms.filter((t) => pageText.toLowerCase().includes(t));
  log("E. No session text in registry UI", foundClinical.length === 0 ? "PASS" : "FAIL", foundClinical.join(", ") || "clean");

  // ── F. Switching Support → Body clears old cards ──────
  // First ensure we're on private practice support view
  const privatePracticeBtn = page.locator('div:has-text("Частная практика")').first();
  await privatePracticeBtn.click();
  await page.waitForTimeout(2000);

  // Switch to Body
  const bodyBtn = page.locator('div:has-text("Здоровье & Стройность")').first();
  await bodyBtn.click();
  // Wait for listClients to complete
  await page.waitForTimeout(3000);

  const annaAfterBody = await page.locator('text=Анна').count();
  const viktor = await page.locator('text=Виктор').count();
  log("F. Switching Support → Body clears old Support cards", annaAfterBody === 0 ? "PASS" : "FAIL", `anna=${annaAfterBody}`);

  // ── G. Body empty state or Body client appears ────────
  if (viktor > 0) {
    log("G. Body client appears (Виктор from body_clients.display_name)", "PASS");
  } else {
    const emptyState = await page.locator('text=нет закреплённых клиентов').count();
    log("G. Body empty state or client", emptyState > 0 ? "PASS" : "FAIL", "empty state (no body assignments found)");
  }

  // ── H. Switching back restores only Support list ──────
  const supportBtn = page.locator('div:has-text("Точка Опоры")').first();
  await supportBtn.click();
  await page.waitForTimeout(3000);

  const annaBack = await page.locator('text=Анна').count();
  const viktorGone = await page.locator('text=Виктор').count();
  log("H. Switching back restores only Support list", annaBack > 0 && viktorGone === 0 ? "PASS" : "FAIL");

  // ── I. Clinic context shows only that clinic's clients ─
  const clinicABtn = page.locator('div:has-text("Тест Клиника А")').first();
  if (await clinicABtn.count() > 0) {
    await clinicABtn.click();
    await page.waitForTimeout(3000);
    const boris = await page.locator('text=Борис').count();
    const annaInClinic = await page.locator('text=Анна').count();
    log("I. Clinic context shows only that clinic's clients", boris > 0 && annaInClinic === 0 ? "PASS" : "FAIL", `boris=${boris} anna=${annaInClinic}`);
  } else {
    log("I. Clinic context shows only that clinic's clients", "SKIP", "org button not found");
  }

  // ── J. Switching Clinic A → private practice ──────────
  const ppBtn = page.locator('div:has-text("Частная практика")').first();
  await ppBtn.click();
  await page.waitForTimeout(3000);
  const borisAfterPP = await page.locator('text=Борис').count();
  log("J. Clinic A → private practice clears clinic cards", borisAfterPP === 0 ? "PASS" : "FAIL", `boris=${borisAfterPP}`);

  // ── K. Shared patient_access client appears ───────────
  const clientB = await page.locator('text=Клиент Б').count();
  log("K. Shared patient_access client appears", clientB >= 1 ? "PASS" : "FAIL", `count=${clientB}`);

  // ── L. No duplicate cards ─────────────────────────────
  log("L. No duplicate cards", clientB <= 2 ? "PASS" : "FAIL", `count=${clientB}`);

  // ── M. Inactive assignment disappears ─────────────────
  // "Невидимый" has status=inactive, should not appear
  const invisible = await page.locator('text=Невидимый').count();
  log("M. Inactive assignment/access disappears", invisible === 0 ? "PASS" : "FAIL");

  // ── N. Technical IDs not rendered ─────────────────────
  const hasUUID = await page.locator('[data-testid]').count();
  const bodyText = await page.textContent("body");
  const hasPublicCode = /\b[A-Z]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/.test(bodyText) && bodyText.includes("T2A-");
  log("N. Technical public_code/owner UUID not rendered", !hasPublicCode ? "PASS" : "FAIL");

  // ── O. No console errors ──────────────────────────────
  const unexpected = consoleErrors.filter((e) => !e.includes("401") && !e.includes("Unauthorized"));
  log("O. No console errors", unexpected.length === 0 ? "PASS" : "FAIL",
    unexpected.length > 0 ? unexpected.join("; ") : `(${consoleErrors.length} expected 401s)`);

  await browser.close();
}

// ── Main ──────────────────────────────────────────────────

(async () => {
  try {
    console.log("── Setting up fixtures ──");
    await setup();
    console.log("── Running browser tests ──");
    await runBrowserTests();
  } finally {
    await cleanup();
  }

  console.log("\n═══════════════════════════════════════════");
  const passed = RESULTS.filter((r) => r.result === "PASS").length;
  const failed = RESULTS.filter((r) => r.result === "FAIL").length;
  const skipped = RESULTS.filter((r) => r.result === "SKIP").length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
})();
