// Deterministic mobile layout checks for the Health "Связаться со
// специалистом" screen (new-request form and detail view). TEST only.
//
// Requires (separate terminals):
//   1) local API server (local-api-server.js) on :3001 with TEST
//      Supabase env and a ref-guard
//   2) npm run build && npm run preview -- --port 5173 --host 127.0.0.1
// Usage: node scripts/e2e-service-request-layout.js
//
// Asserts at 320/375/390/430/1280 widths that nothing overflows the
// viewport horizontally and that the context checkboxes, their labels,
// textarea, service prices, phone/date/time fields and action buttons
// stay fully inside the viewport. TEST fixtures are owner-scoped and
// the created smoke request is deleted afterwards.

import { chromium } from "playwright";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const INTAKE_URL = `${BASE}/?module=body`;
const REQUIRED_REF = "eehyehlhiyztciaezaus";
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1280, height: 800 },
];
const CONTEXT_LABELS = [
  "Последние 7 дней дневника",
  "Наблюдения по питанию и фото",
  "Недельный итог",
  "Здоровье, анализы и препараты",
];

let pass = 0;
let fail = 0;
function ok(msg) { console.log("PASS:", msg); pass++; }
function no(msg) { console.log("FAIL:", msg); fail++; }

async function fillIntake(page, name) {
  await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
  const cta = page.getByText("Перейти к анкете");
  await cta.waitFor({ timeout: 15000 });
  await cta.click();
  const form = page.locator("form[data-body-intake]");
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
  try {
    await page.getByRole("button", { name: "Дальше" }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "Продолжить" }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "Начать дневник" }).click({ timeout: 8000 });
  } catch {}
}

async function gotoServiceRequests(page) {
  for (let i = 0; i < 40; i++) {
    const skipIntro = page.getByRole("button", { name: "Вернуться в кабинет" });
    if (await skipIntro.count()) {
      await skipIntro.click();
      await page.waitForTimeout(500);
      continue;
    }
    const target = page.getByText("Связаться со специалистом").first();
    if (await target.count()) break;
    await page.waitForTimeout(500);
  }
  const target = page.getByText("Связаться со специалистом").first();
  try {
    await target.waitFor({ timeout: 5000 });
  } catch {
    const text = await page.locator("body").innerText();
    throw new Error(`service request card not found, page: ${text.replace(/\n+/g, " | ").slice(0, 400)}`);
  }
  await page.getByRole("button", { name: "Открыть" }).first().click();
  await page.getByText("Новый запрос").waitFor({ timeout: 15000 });
}

async function openNewRequestForm(page) {
  await page.getByText("Новый запрос").click();
  await page.getByText("С чем хотите обратиться?").waitFor({ timeout: 15000 });
  await page.getByText("Другой вопрос").click();
  await page.getByText("Как удобнее получить консультацию?").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  // Prefer a contact-requiring format so the date/time grid is visible.
  const contactService = page.locator("button", { hasText: "по телефону" }).first();
  if (await contactService.count()) {
    await contactService.click();
  } else {
    await page.locator("button", { hasText: "кредитов" }).first().click();
  }
  await page.locator("textarea").first().waitFor({ timeout: 10000 });
}

async function measureLayout(page, label) {
  return page.evaluate((name) => {
    const vw = window.innerWidth;
    const issues = [];
    const rectOf = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const inside = (el, what) => {
      const r = rectOf(el);
      if (r.width <= 0 || r.height <= 0) { issues.push(`${name}: ${what} has no size`); return null; }
      if (r.left < -1 || r.right > vw + 1) {
        issues.push(`${name}: ${what} outside viewport (left=${r.left.toFixed(1)}, right=${r.right.toFixed(1)}, vw=${vw})`);
      }
      return r;
    };
    if (document.documentElement.scrollWidth > vw + 1) {
      issues.push(`${name}: horizontal scroll (scrollWidth=${document.documentElement.scrollWidth} > ${vw})`);
    }
    const checks = [...document.querySelectorAll(".body-service-request-context-check")];
    const labels = [...document.querySelectorAll(".body-service-request-context-label")];
    checks.forEach((el, i) => inside(el, `context checkbox #${i + 1}`));
    labels.forEach((el, i) => inside(el, `context label #${i + 1} "${el.textContent.trim().slice(0, 24)}"`));
    document.querySelectorAll("textarea").forEach((el, i) => inside(el, `textarea #${i + 1}`));
    document.querySelectorAll(".body-service-request-service-price").forEach((el, i) => inside(el, `service price #${i + 1}`));
    document.querySelectorAll('input[placeholder="Телефон"]').forEach((el) => inside(el, "phone field"));
    document.querySelectorAll('input[type="date"], input[type="time"]').forEach((el, i) => inside(el, `date/time field #${i + 1}`));
    document.querySelectorAll(".body-service-request-actions button").forEach((el, i) => inside(el, `action button #${i + 1}`));
    document.querySelectorAll(".body-service-request-detail-head").forEach((el, i) => inside(el, `detail head #${i + 1}`));
    document.querySelectorAll(".body-service-request-badges").forEach((el, i) => inside(el, `status badges #${i + 1}`));

    // Labels must sit next to their checkboxes, never displaced to the right.
    const pairs = Math.min(checks.length, labels.length);
    for (let i = 0; i < pairs; i++) {
      const c = rectOf(checks[i]);
      const l = rectOf(labels[i]);
      if (l.left + 1 < c.right || l.left > c.right + 24) {
        issues.push(`${name}: label #${i + 1} displaced from its checkbox (check.right=${c.right.toFixed(1)}, label.left=${l.left.toFixed(1)})`);
      }
    }
    return { issues, labelCount: labels.length, checkboxCount: checks.length };
  }, label);
}

function reportMeasurement(label, result) {
  if (result.issues.length === 0) {
    ok(`${label}: layout inside viewport (${result.checkboxCount} checkboxes / ${result.labelCount} labels)`);
  } else {
    for (const issue of result.issues) no(issue);
  }
}

function openTestSupabase() {
  const env = {};
  try {
    for (const line of readFileSync(`${PROJECT_ROOT}/.env.local`, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
    }
  } catch {}
  const url = process.env.TEST_SUPABASE_URL || env.TEST_SUPABASE_URL || "";
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1] || "unknown";
  if (ref !== REQUIRED_REF) {
    throw new Error(`Refusing: expected TEST ref ${REQUIRED_REF}, got ${ref}.`);
  }
  if (!key) throw new Error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// TEST-only fixture: the create-request path requires an active specialist
// assignment for the current Health owner. The expert is a stable synthetic
// row; the assignment is found or created FOR THIS OWNER ONLY — other TEST
// assignments are never modified.
async function ensureSpecialistAssignment(sessionId) {
  const supabase = openTestSupabase();
  const { data: clientRow } = await supabase
    .from("body_clients")
    .select("anonymous_owner_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  const ownerId = clientRow?.anonymous_owner_id;
  if (!ownerId) throw new Error("body_clients owner not found for the test session");

  const expertId = "e6000000-0000-4000-8000-000000000001";
  const { error: expertError } = await supabase.from("experts").insert({
    id: expertId,
    name: "E2E Layout Specialist",
    role: "doctor",
    specialty: "Терапевт",
    city: "Москва",
    is_active: true,
    access_code: "E2E-LAYOUT-CODE",
  });
  if (expertError && !String(expertError.code || "").includes("23505")) {
    throw new Error(`expert fixture insert failed: ${expertError.message}`);
  }

  const { data: existing, error: lookupError } = await supabase
    .from("patient_assignments")
    .select("id")
    .eq("owner_type", "anonymous_profile")
    .eq("owner_id", ownerId)
    .eq("module", "body")
    .eq("status", "active")
    .maybeSingle();
  if (lookupError) throw new Error(`assignment lookup failed: ${lookupError.message}`);
  if (existing) {
    console.log(`fixture: active specialist assignment reused for owner ${String(ownerId).slice(0, 8)}…`);
    return ownerId;
  }

  const { error: assignmentError } = await supabase.from("patient_assignments").insert({
    id: randomUUID(),
    owner_type: "anonymous_profile",
    owner_id: ownerId,
    organization_id: null,
    primary_expert_id: expertId,
    assigned_by_expert_name: "e2e-layout",
    module: "body",
    status: "active",
    patient_label: "E2E Layout Assignment",
  });
  if (assignmentError) throw new Error(`assignment fixture insert failed: ${assignmentError.message}`);
  console.log(`fixture: active specialist assignment created for owner ${String(ownerId).slice(0, 8)}…`);
  return ownerId;
}

// TEST-only cleanup: remove only the smoke request created for this owner.
async function cleanupSmokeRequest(ownerId) {
  if (!ownerId) return;
  try {
    const supabase = openTestSupabase();
    const { error } = await supabase
      .from("service_requests")
      .delete()
      .eq("module", "body")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", ownerId)
      .eq("message", "layout smoke request");
    if (error) {
      console.log(`cleanup: request removal skipped (${error.message})`);
    } else {
      console.log(`cleanup: smoke request removed for owner ${String(ownerId).slice(0, 8)}…`);
    }
  } catch (error) {
    console.log(`cleanup: request removal skipped (${error.message})`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  let ownerId = null;
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize(VIEWPORTS[2]);
    await fillIntake(page, "E2E Layout");
    const pair = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("body_session_pair") || "null"); } catch { return null; }
    });
    if (!pair?.sessionId) throw new Error("no credential pair after intake");
    ownerId = await ensureSpecialistAssignment(pair.sessionId);
    await page.getByRole("button", { name: "Перейти в личный кабинет" }).click().catch(async () => {
      await page.goto(INTAKE_URL, { waitUntil: "domcontentloaded" });
    });
    await gotoServiceRequests(page);
    await openNewRequestForm(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const result = await measureLayout(page, `${viewport.width}x${viewport.height} new-request`);
      reportMeasurement(`${viewport.width}x${viewport.height} new-request`, result);
      if (viewport.width === 390) {
        const text = await page.locator("body").innerText();
        const allFour = CONTEXT_LABELS.every((needle) => text.includes(needle));
        allFour
          ? ok("390px: all four context labels are rendered next to their checkboxes")
          : no("390px: missing context labels in the visible form");
        if (result.labelCount < 4) no(`390px: expected 4 context labels, found ${result.labelCount}`);
      }
    }

    // Detail view audit: submit the request and open it.
    await page.setViewportSize(VIEWPORTS[2]);
    await page.locator("textarea").first().fill("layout smoke request");
    await page.getByRole("button", { name: "Отправить запрос" }).click();
    // Wait for the form view to switch away from the new-request screen.
    let submitted = false;
    for (let i = 0; i < 30 && !submitted; i++) {
      submitted = (await page.getByText("С чем хотите обратиться?").count()) === 0;
      if (!submitted) await page.waitForTimeout(500);
    }
    if (!submitted) {
      const text = await page.locator("body").innerText();
      throw new Error(`request not submitted, page: ${text.replace(/\n+/g, " | ")}`);
    }
    await page.getByRole("button", { name: "Новый запрос" }).waitFor({ timeout: 15000 });
    await page.getByText("layout smoke request").first().click();
    let detailOpen = false;
    for (let i = 0; i < 20 && !detailOpen; i++) {
      detailOpen = (await page.getByText("К списку").count()) > 0;
      if (!detailOpen) await page.waitForTimeout(500);
    }
    if (!detailOpen) {
      const text = await page.locator("body").innerText();
      throw new Error(`detail view not opened, page: ${text.replace(/\n+/g, " | ").slice(0, 400)}`);
    }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const result = await measureLayout(page, `${viewport.width}x${viewport.height} detail`);
      reportMeasurement(`${viewport.width}x${viewport.height} detail`, result);
    }
  } finally {
    await browser.close();
    await cleanupSmokeRequest(ownerId);
  }
  console.log(`\nService request layout: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((error) => {
  console.error("Layout test crashed:", error?.message || error);
  process.exit(1);
});
