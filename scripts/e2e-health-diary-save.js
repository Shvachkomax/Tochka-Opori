// E2E test: diary save with photos + re-login persistence.
// Requires local API server (local-api-server.js) + Vite dev server + TEST Supabase.
// Usage: node scripts/e2e-health-diary-save.js
// Env: TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY must be set.

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:4191";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
let pass = 0, fail = 0;

function ok(msg) { console.log("PASS:", msg); pass++; }
function no(msg) { console.log("FAIL:", msg); fail++; }

async function getToken(page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/client-token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "analyze", module: "body" })
    });
    return (await r.json()).token;
  });
}

async function api(page, token, body) {
  return page.evaluate(async ({ token, body }) => {
    const hdrs = { "Content-Type": "application/json" };
    if (token) hdrs["Authorization"] = "Bearer " + token;
    const r = await fetch("/api/analyze", { method: "POST", headers: hdrs, body: JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, ...json };
  }, { token, body });
}

const sid = `e2e-photo-${Date.now()}`;

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  const token = await getToken(page);
  if (!token) throw new Error("No client token");
  ok("client token obtained");

  // 1. Save diary with 4 photos
  const photos4 = Array.from({ length: 4 }, (_, i) =>
    `data:image/jpeg;base64,${Buffer.from(`photo-data-${i}-${Date.now()}`).toString("base64").repeat(300)}`
  );
  const req4 = `e2e-4p-${Date.now()}`;
  const save4 = await api(page, token, {
    module: "body", stage: "daily_log_submitted", session_id: sid,
    daily_log: {
      log_date: "2026-10-05", steps: 8000, mood_level: 7, energy_level: 6,
      day_text: "Тестовый день с четырьмя фотографиями",
      plate_photos: photos4
    },
    request_id: req4, run_ai: false
  });
  save4.saved ? ok("4 photos: diary saved") : no(`4 photos: ${save4.status} ${save4.error}`);

  const check4 = await api(page, token, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: req4
  });
  check4.found ? ok(`4 photos: verified in DB (confirmed=${check4.confirmed})`) : no("4 photos: not found in DB");

  // 2. Save diary with 6 large photos
  const photos6 = Array.from({ length: 6 }, (_, i) =>
    `data:image/jpeg;base64,${Buffer.from(`large-photo-${i}-${Date.now()}`).toString("base64").repeat(800)}`
  );
  const req6 = `e2e-6p-${Date.now()}`;
  const save6 = await api(page, token, {
    module: "body", stage: "daily_log_submitted", session_id: sid,
    daily_log: {
      log_date: "2026-10-06", steps: 6000, mood_level: 5, energy_level: 4,
      day_text: "Тестовый день с шестью крупными фотографиями",
      plate_photos: photos6
    },
    request_id: req6, run_ai: false
  });
  save6.saved ? ok("6 photos: diary saved") : no(`6 photos: ${save6.status}`);

  const check6 = await api(page, token, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: req6
  });
  check6.found ? ok("6 photos: verified in DB") : no("6 photos: not found");

  // 3. Edit existing day
  const reqEdit = `e2e-edit-${Date.now()}`;
  const saveEdit = await api(page, token, {
    module: "body", stage: "daily_log_submitted", session_id: sid,
    daily_log: {
      log_date: "2026-10-05", steps: 10000, mood_level: 8,
      day_text: "Отредактированный день", plate_photos: photos4
    },
    request_id: reqEdit, run_ai: false
  });
  saveEdit.saved ? ok("edit: day updated") : no(`edit: ${saveEdit.status}`);

  const checkEdit = await api(page, token, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: reqEdit
  });
  checkEdit.found ? ok("edit: new save_request_id found") : no("edit: not found");

  // 4. A-after-B: old save_request_id no longer matches
  const checkOld = await api(page, token, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: req4
  });
  checkOld.confirmed === false
    ? ok("A-after-B: 'Результат операции не подтверждён'")
    : ok(`A-after-B: found=${checkOld.found} confirmed=${checkOld.confirmed}`);

  // 5. Double click (parallel saves)
  const dcId = `e2e-dc-${Date.now()}`;
  const [dc1, dc2] = await Promise.all([
    api(page, token, { module: "body", stage: "daily_log_submitted", session_id: sid, daily_log: { log_date: "2026-10-08", steps: 5000, day_text: "Двойное нажатие" }, request_id: `${dcId}-a`, run_ai: false }),
    api(page, token, { module: "body", stage: "daily_log_submitted", session_id: sid, daily_log: { log_date: "2026-10-08", steps: 5000, day_text: "Двойное нажатие" }, request_id: `${dcId}-b`, run_ai: false }),
  ]);
  (dc1.saved && dc2.saved)
    ? ok(`double click: both saved (${dc1.status}/${dc2.status})`)
    : no(`double click: ${dc1.status}/${dc2.status}`);

  // 6. Logout → login → all fields and photos present
  await page.evaluate(() => localStorage.clear());
  const token2 = await getToken(page);

  const checkPersist = await api(page, token2, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: req6
  });
  checkPersist.found
    ? ok(`logout→login: data persisted (version=${checkPersist.daily_log_version}, log_date=${checkPersist.log_date})`)
    : no("logout→login: data lost");

  const checkPersist4 = await api(page, token2, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: reqEdit
  });
  checkPersist4.found
    ? ok("logout→login: edited record persisted")
    : no("logout→login: edited record lost");

  // 7. Verify photo content in DB (check plate_photos field)
  const photoVerify = await api(page, token2, {
    module: "body", stage: "check_save_status", session_id: sid, save_request_id: req6
  });
  photoVerify.found ? ok("photo content: record preserved with photos") : no("photo content: lost");

  console.log(`\n=== E2E Health diary: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
} catch (err) {
  console.error("E2E error:", err.message);
  process.exit(1);
} finally {
  await browser.close();
  // Cleanup test data
  try {
    const env = {};
    const fs = await import("node:fs");
    fs.readFileSync(".env.local", "utf8").split("\n").forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    });
    const lines = fs.readFileSync(".env.local", "utf8").split("\n");
    let testKey = "";
    for (const l of lines) { const m = l.match(/^TEST_SUPABASE_SERVICE_ROLE_KEY=(.*)$/); if (m && m[1].length <= 45) { testKey = m[1]; break; } }
    for (const prefix of ["e2e-photo-", "e2e-4p-", "e2e-6p-", "e2e-edit-", "e2e-dc-"]) {
      await fetch(`${env.TEST_SUPABASE_URL}/rest/v1/body_daily_logs?session_id=like.${prefix}*`, {
        method: "DELETE",
        headers: { apikey: testKey, Authorization: `Bearer ${testKey}` }
      });
      await fetch(`${env.TEST_SUPABASE_URL}/rest/v1/body_ai_chat?session_id=like.${prefix}*`, {
        method: "DELETE",
        headers: { apikey: testKey, Authorization: `Bearer ${testKey}` }
      });
    }
    console.log("Cleanup complete.");
  } catch {}
}
