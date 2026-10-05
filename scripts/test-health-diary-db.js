// Real DB integration tests for Health diary save flow.
// Requires TEST Supabase credentials (TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY).
// Maps TEST_* to SUPABASE_* for app compatibility. Refuses production ref.
// Creates isolated test data with unique prefix, cleans up in finally.
// Usage: TEST_SUPABASE_URL=... TEST_SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-health-diary-db.js

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const REQUIRED_REF = "eehyehlhiyztciaezaus";

// Load env from .env.local and process.env (process.env takes priority)
const env = {};
try {
  readFileSync(".env.local", "utf8").split("\n").forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  });
} catch {}

// Map TEST_* to standard names (TEST_* takes priority for test runs)
const SUPABASE_URL = process.env.TEST_SUPABASE_URL || env.TEST_SUPABASE_URL || env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";

// Ref guard: abort if not TEST project
const refMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
const actualRef = refMatch?.[1] || "unknown";
if (actualRef !== REQUIRED_REF) {
  console.error(`Refusing: expected TEST ref ${REQUIRED_REF}, got ${actualRef}.`);
  console.error(`Set TEST_SUPABASE_URL=https://${REQUIRED_REF}.supabase.co and TEST_SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}

console.log(`Supabase ref: ${actualRef} (TEST) — OK`);

const TEST_PREFIX = `health-diary-test-${Date.now()}`;
const TEST_SESSION_ID = `${TEST_PREFIX}-session`;
const TEST_OWNER_ID = crypto.randomUUID();

function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
  console.log("PASS:", message);
}

async function cleanup() {
  // Remove test data by session_id prefix
  await supabaseFetch(`/rest/v1/body_daily_logs?session_id=like.${TEST_PREFIX}*`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/body_ai_chat?session_id=like.${TEST_PREFIX}*`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/body_clients?session_id=like.${TEST_PREFIX}*`, { method: "DELETE" });
}

// ── 1. Save diary with save_request_id ──────────────────────────────────

async function testSaveWithRequestId() {
  const saveRequestId = `${TEST_PREFIX}-save-001`;
  const insertRes = await supabaseFetch("/rest/v1/body_daily_logs", {
    method: "POST",
    body: JSON.stringify({
      session_id: TEST_SESSION_ID,
      module: "body",
      log_date: "2026-10-05",
      steps: 5000,
      mood_level: 7,
      energy_level: 6,
      save_request_id: saveRequestId,
      daily_log_version: 1,
    }),
    headers: { Prefer: "return=representation" },
  });

  assert(insertRes.status === 201, "diary insert with save_request_id returns 201");
  const inserted = (await insertRes.json())[0];
  assert(inserted.save_request_id === saveRequestId, "save_request_id stored in DB");
  assert(inserted.daily_log_version === 1, "daily_log_version stored");
  return inserted;
}

// ── 2. Check save status by save_request_id ────────────────────────────

async function testCheckSaveStatus(saveRequestId) {
  const checkRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&save_request_id=eq.${saveRequestId}&select=id,save_request_id,ai_analysis_status,daily_log_version`);
  const rows = await checkRes.json();
  assert(rows.length === 1, "check finds record by save_request_id");
  assert(rows[0].save_request_id === saveRequestId, "save_request_id matches");
  assert(rows[0].ai_analysis_status === null || rows[0].ai_analysis_status === "pending", "initial AI status is null/pending");

  // Non-existent request_id
  const missRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&save_request_id=eq.${TEST_PREFIX}-nonexistent`);
  const missRows = await missRes.json();
  assert(missRows.length === 0, "non-existent save_request_id returns empty");
}

// ── 3. Upsert: re-save updates, no duplicate ────────────────────────────

async function testUpsertNoDuplicate() {
  const before = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&select=id`);
  const beforeRows = await before.json();

  // Update existing record (same session + date)
  const updateRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&log_date=eq.2026-10-05`, {
    method: "PATCH",
    body: JSON.stringify({
      steps: 7000,
      save_request_id: `${TEST_PREFIX}-save-002`,
      daily_log_version: 2,
      updated_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=representation" },
  });

  assert(updateRes.status === 200, "update returns 200");
  const updated = await updateRes.json();
  assert(updated.length === 1, "exactly one record updated");
  assert(updated[0].steps === 7000, "steps updated");
  assert(updated[0].save_request_id === `${TEST_PREFIX}-save-002`, "new save_request_id saved");
  assert(updated[0].daily_log_version === 2, "version incremented");

  const after = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&select=id`);
  const afterRows = await after.json();
  assert(afterRows.length === beforeRows.length, "no duplicate created");
}

// ── 4. AI idempotency: in_progress marker ───────────────────────────────

async function testAiIdempotency() {
  // Mark as in_progress with request_id
  const markRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&log_date=eq.2026-10-05`, {
    method: "PATCH",
    body: JSON.stringify({ ai_analysis_status: "in_progress", ai_analysis_request_id: "ai-req-1" }),
    headers: { Prefer: "return=representation" },
  });
  const marked = await markRes.json();
  assert(marked[0].ai_analysis_status === "in_progress", "AI status set to in_progress");
  assert(marked[0].ai_analysis_request_id === "ai-req-1", "AI request_id stored");

  // Second request sees in_progress
  const checkRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&select=ai_analysis_status,ai_analysis_request_id`);
  const check = (await checkRes.json())[0];
  assert(check.ai_analysis_status === "in_progress", "second request sees in_progress");
  assert(check.ai_analysis_request_id === "ai-req-1", "original request_id preserved");
}

// ── 5. Edit after analysis: version mismatch detection ──────────────────

async function testEditAfterAnalysis() {
  // Record version at analysis start
  const v1Res = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&select=daily_log_version`);
  const v1 = (await v1Res.json())[0].daily_log_version;

  // Simulate edit (version bump)
  await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&log_date=eq.2026-10-05`, {
    method: "PATCH",
    body: JSON.stringify({ steps: 9000, daily_log_version: v1 + 1, updated_at: new Date().toISOString() }),
  });

  // Late AI result arrives, expecting v1
  const v2Res = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&select=daily_log_version`);
  const v2 = (await v2Res.json())[0].daily_log_version;

  assert(v1 !== v2, "version changed after edit");
  assert(v2 === v1 + 1, "version incremented by 1");

  // CAS update: only write if version matches (simulating stale rejection)
  const casRes = await supabaseFetch(`/rest/v1/body_daily_logs?session_id=eq.${TEST_SESSION_ID}&daily_log_version=eq.${v1}`, {
    method: "PATCH",
    body: JSON.stringify({ ai_day_summary: "Stale summary" }),
    headers: { Prefer: "return=representation" },
  });
  const casRows = await casRes.json();
  assert(casRows.length === 0, "CAS update with old version rejected (0 rows)");
}

// ── 6. body_ai_chat: full response storage and recovery ─────────────────

async function testBodyAiChatRecovery() {
  const fullResponse = {
    answer: "Тестовый ответ ассистента",
    small_next_step: "Попробуйте прогулку",
    question_for_specialist: "Как ваш сон?",
    safety_note: null,
    confidence: "high",
  };

  // Insert with serialized JSON in message_text (fallback pattern)
  const insertRes = await supabaseFetch("/rest/v1/body_ai_chat", {
    method: "POST",
    body: JSON.stringify({
      owner_type: "anonymous_profile",
      owner_id: TEST_OWNER_ID,
      session_id: TEST_SESSION_ID,
      role: "assistant",
      message_text: JSON.stringify(fullResponse),
      model_used: "test",
      created_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=representation" },
  });

  assert(insertRes.status === 201, "body_ai_chat insert succeeds");
  const inserted = (await insertRes.json())[0];

  // Read back and recover
  const readRes = await supabaseFetch(`/rest/v1/body_ai_chat?session_id=eq.${TEST_SESSION_ID}&role=eq.assistant&select=id,role,message_text,created_at,model_used`);
  const messages = await readRes.json();
  assert(messages.length === 1, "one assistant message found");

  // Recovery logic (matches server code)
  const recovered = messages.map(msg => {
    if (msg.role === "assistant" && msg.message_text && msg.message_text.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg.message_text);
        return { ...msg, ai_response: parsed, message_text: parsed.answer || msg.message_text };
      } catch {}
    }
    return msg;
  });

  assert(recovered[0].ai_response?.answer === "Тестовый ответ ассистента", "answer recovered from JSON");
  assert(recovered[0].ai_response?.small_next_step === "Попробуйте прогулку", "small_next_step recovered");
  assert(recovered[0].ai_response?.question_for_specialist === "Как ваш сон?", "question_for_specialist recovered");
  assert(recovered[0].ai_response?.confidence === "high", "confidence recovered");
  assert(recovered[0].message_text === "Тестовый ответ ассистента", "message_text shows answer");
}

// ── Run all tests ────────────────────────────────────────────────────────

(async () => {
  console.log(`Test prefix: ${TEST_PREFIX}`);
  console.log(`Supabase: ${SUPABASE_URL?.replace(/:[^:@]*@/, ":***@")}`);

  try {
    await cleanup(); // Clean any leftover

    const diary = await testSaveWithRequestId();
    await testCheckSaveStatus(`${TEST_PREFIX}-save-001`);
    await testUpsertNoDuplicate();
    await testAiIdempotency();
    await testEditAfterAnalysis();
    await testBodyAiChatRecovery();

    console.log("\n=== All Health diary DB integration tests passed ===");
  } catch (err) {
    console.error("Test error:", err.message);
    process.exit(1);
  } finally {
    await cleanup();
    console.log("Cleanup complete.");
  }
})();
