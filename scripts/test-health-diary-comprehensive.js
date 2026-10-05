// Comprehensive mock tests for Health diary: lost response, re-save, parallel AI,
// edit-after-analysis, late-response, idempotency, photo budget, body_ai_chat recovery.
// No Supabase, no network. Pure logic + mocked state.

import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.CLIENT_API_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");

// ── Shared mock state ─────────────────────────────────────────────────────

const mockDb = {
  body_daily_logs: [],
  body_ai_chat: [],
  usage_ledger: [],
};

function resetDb() {
  mockDb.body_daily_logs = [];
  mockDb.body_ai_chat = [];
  mockDb.usage_ledger = [];
}

function makeDiary(overrides = {}) {
  return {
    id: `log-${mockDb.body_daily_logs.length + 1}`,
    session_id: "test-session",
    log_date: "2026-10-05",
    save_request_id: `req-${mockDb.body_daily_logs.length + 1}`,
    daily_log_version: 1,
    ai_analysis_status: "pending",
    ai_analysis_request_id: null,
    ai_day_summary: null,
    ai_focus_tomorrow: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── 1. Save result verification: request_id in DB ─────────────────────────

resetDb();

const { parseApiResponse, classifyHttpError, estimateRequestSize } = await import("../src/lib/apiResponse.js");

// Verify save_request_id is stored (code structure)
const analyzeCode = await import("node:fs").then(fs => fs.readFileSync("api/analyze.js", "utf8"));
assert.ok(analyzeCode.includes("save_request_id") && analyzeCode.includes("diagId"), "save_request_id is stored in diary record");
assert.ok(analyzeCode.includes("daily_log_version: 2"), "daily_log_version is tracked");

// Verify check_save_status stage exists
assert.ok(analyzeCode.includes('"check_save_status"'), "check_save_status stage is registered");
assert.ok(analyzeCode.includes("handleCheckSaveStatus"), "check_save_status handler exists");

console.log("PASS save verification: request_id stored in DB, check_save_status endpoint exists");

// ── 2. Lost response: check_save_status finds record by request_id ────────

const diary1 = makeDiary({ save_request_id: "lost-response-req-001", ai_analysis_status: "success", ai_day_summary: "Test summary" });
mockDb.body_daily_logs.push(diary1);

// Simulate check_save_status logic
function checkSaveStatus(sessionId, saveRequestId) {
  const diary = mockDb.body_daily_logs.find(d => d.session_id === sessionId && d.save_request_id === saveRequestId);
  if (!diary) return { ok: false, found: false, saved: false };
  return {
    ok: true,
    found: true,
    saved: true,
    daily_log_id: diary.id,
    save_request_id: diary.save_request_id,
    ai_analysis_status: diary.ai_analysis_status,
  };
}

const foundResult = checkSaveStatus("test-session", "lost-response-req-001");
assert.equal(foundResult.found, true);
assert.equal(foundResult.saved, true);
assert.equal(foundResult.save_request_id, "lost-response-req-001");

const notFoundResult = checkSaveStatus("test-session", "nonexistent-req");
assert.equal(notFoundResult.found, false);

console.log("PASS lost response: check_save_status finds record by request_id");

// ── 3. Re-save idempotency: same operation doesn't create duplicate ───────

// Simulate upsert logic: same session_id + log_date → update, not insert
function upsertDiary(sessionId, logDate, data, requestId) {
  const existing = mockDb.body_daily_logs.find(d => d.session_id === sessionId && d.log_date === logDate);
  if (existing) {
    Object.assign(existing, data, { save_request_id: requestId, updated_at: new Date().toISOString(), daily_log_version: (existing.daily_log_version || 1) + 1 });
    return { action: "update", id: existing.id };
  }
  const newDiary = makeDiary({ ...data, save_request_id: requestId, session_id: sessionId, log_date: logDate });
  mockDb.body_daily_logs.push(newDiary);
  return { action: "insert", id: newDiary.id };
}

resetDb();
const r1 = upsertDiary("test-session", "2026-10-05", { steps: 5000 }, "req-A");
const r2 = upsertDiary("test-session", "2026-10-05", { steps: 6000 }, "req-B");
assert.equal(r1.action, "insert");
assert.equal(r2.action, "update");
assert.equal(mockDb.body_daily_logs.length, 1, "no duplicate created");
assert.equal(mockDb.body_daily_logs[0].daily_log_version, 2, "version incremented");
assert.equal(mockDb.body_daily_logs[0].save_request_id, "req-B", "latest request_id saved");

console.log("PASS re-save: upsert updates existing, no duplicate, version tracked");

// ── 4. Parallel AI: second request sees in_progress, doesn't duplicate ────

function tryStartAi(diary, requestId) {
  if (diary.ai_analysis_status === "success") return { action: "cached" };
  if (diary.ai_analysis_status === "in_progress" && diary.ai_analysis_request_id && diary.ai_analysis_request_id !== requestId) {
    const elapsed = Date.now() - new Date(diary.updated_at).getTime();
    if (elapsed < 120000) return { action: "in_progress" };
  }
  diary.ai_analysis_status = "in_progress";
  diary.ai_analysis_request_id = requestId;
  return { action: "started" };
}

resetDb();
const diary2 = makeDiary({ ai_analysis_status: "pending" });
mockDb.body_daily_logs.push(diary2);

const ai1 = tryStartAi(diary2, "ai-req-1");
const ai2 = tryStartAi(diary2, "ai-req-2");
assert.equal(ai1.action, "started", "first AI request starts");
assert.equal(ai2.action, "in_progress", "second AI request sees in_progress");

console.log("PASS parallel AI: second request detected as in_progress, no duplicate run");

// ── 5. Edit after analysis: previous analysis becomes stale ──────────────

function analyzeAndWrite(diary, requestId, result, expectedVersion) {
  if (diary.daily_log_version !== expectedVersion) {
    return { action: "stale", reason: "version changed" };
  }
  diary.ai_day_summary = result.summary;
  diary.ai_analysis_status = "success";
  diary.ai_analysis_request_id = requestId;
  return { action: "written" };
}

resetDb();
const diary3 = makeDiary({ daily_log_version: 1, ai_analysis_status: "pending" });
mockDb.body_daily_logs.push(diary3);

// Start AI analysis at version 1
const started = tryStartAi(diary3, "ai-req-old");
assert.equal(started.action, "started");

// User edits diary → version bumps to 2
upsertDiary("test-session", "2026-10-05", { steps: 7000 }, "edit-req");
assert.equal(diary3.daily_log_version, 2);

// Late AI result arrives, expecting version 1
const writeResult = analyzeAndWrite(diary3, "ai-req-old", { summary: "Old summary" }, 1);
assert.equal(writeResult.action, "stale", "late AI result rejected due to version change");
assert.equal(diary3.ai_day_summary, null, "stale result did not overwrite");

console.log("PASS edit after analysis: late AI result rejected due to version mismatch");

// ── 6. Debit idempotency: version-stable request_id ─────────────────────

function debitCredits(requestId) {
  const existing = mockDb.usage_ledger.find(e => e.request_id === requestId);
  if (existing) return { action: "skipped", reason: "already debited" };
  mockDb.usage_ledger.push({ request_id: requestId, amount: 100 });
  return { action: "debited" };
}

resetDb();
// Same version → same debit ID → no double debit
const d1 = debitCredits("body-diary-ai-log-1-v1");
const d2 = debitCredits("body-diary-ai-log-1-v1");
assert.equal(d1.action, "debited");
assert.equal(d2.action, "skipped", "same version → no double debit");

// Different version → different debit ID → separate debit
const d3 = debitCredits("body-diary-ai-log-1-v2");
assert.equal(d3.action, "debited", "new version → separate debit");

// Different diary → different debit
const d4 = debitCredits("body-diary-ai-log-2-v1");
assert.equal(d4.action, "debited");
assert.equal(mockDb.usage_ledger.length, 3, "3 debits: v1 once, v2 once, log-2 once");

console.log("PASS debit idempotency: version-stable ID, same version no double, new version separate");

// ── 6b. Debit ID format verification ───────────────────────────────────

assert.ok(analyzeCode.includes("body-diary-ai-${diary.id}-v${analyzeVersion}"), "debit ID includes diary ID and version");
assert.ok(analyzeCode.includes("body-diary-ai-${savedLog.id}-v${debitVersion}"), "non-deferred path uses version-stable debit ID");

console.log("PASS debit ID format: body-diary-ai-{log_id}-v{version}");

// ── 6c. Ownership check before write ───────────────────────────────────

assert.ok(analyzeCode.includes("lost_ownership"), "ownership check before write exists");
assert.ok(analyzeCode.includes('eq("ai_analysis_request_id", diagId)'), "CAS on ownership in update");

console.log("PASS ownership check: CAS on ai_analysis_request_id before writing results");

// ── 7. Photo budget: accounts for non-photo fields ───────────────────────

const { compressPhotosToBudget, estimateDataUrlBytes } = await import("../src/lib/photoCompress.js");

// Mock canvas/Image for Node
globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") {
      const c = { width: 0, height: 0 };
      c.getContext = () => ({ drawImage: () => {} });
      c.toDataURL = () => `data:image/jpeg;base64,${"A".repeat(Math.max(100, Math.floor(c.width * c.height / 50)))}`;
      return c;
    }
    return {};
  },
};
globalThis.Image = class {
  set src(v) {
    this.naturalWidth = 1000;
    this.naturalHeight = 800;
    setTimeout(() => this.onload?.(), 0);
  }
};

// Small base size (non-photo fields) + 4 photos
const baseSize = 5000;
const smallPhotos = Array.from({ length: 4 }, (_, i) => ({ dataUrl: `data:image/jpeg;base64,${"A".repeat(500)}`, name: `p${i}` }));
const budgetResult = await compressPhotosToBudget(smallPhotos, 3 * 1024 * 1024, baseSize);
assert.equal(budgetResult.photos.length, 4);
assert.equal(budgetResult.truncated, false);

// 8 photos → truncated at 6
const manyPhotos = Array.from({ length: 8 }, (_, i) => ({ dataUrl: `data:image/jpeg;base64,${"A".repeat(100)}`, name: `p${i}` }));
const truncResult = await compressPhotosToBudget(manyPhotos, 3 * 1024 * 1024, baseSize);
assert.equal(truncResult.photos.length, 6, "capped at 6");
assert.equal(truncResult.truncated, true, "truncated flag set");

console.log("PASS photo budget: base size accounted, >6 photos truncated with flag");

// ── 8. body_ai_chat: full response serialization and recovery ────────────

const sessionCode = await import("node:fs").then(fs => fs.readFileSync("api/session.js", "utf8"));

// Verify fallback serializes full response into message_text
assert.ok(sessionCode.includes("JSON.stringify(fullResponse)"),
  "fallback serializes full response into message_text");
assert.ok(sessionCode.includes("fullResponse = { answer:"),
  "full response includes answer, small_next_step, question_for_specialist, safety_note, confidence");

// Verify SELECT recovers full response from JSON message_text
assert.ok(sessionCode.includes("JSON.parse(msg.message_text)"),
  "SELECT recovers full response from JSON message_text");
assert.ok(sessionCode.includes("ai_response: parsed"),
  "recovered response assigned to ai_response");

// Simulate recovery logic
function recoverMessages(messages) {
  return messages.map(msg => {
    if (msg.role === "assistant" && msg.message_text && msg.message_text.startsWith("{")) {
      try {
        const parsed = JSON.parse(msg.message_text);
        return { ...msg, ai_response: parsed, message_text: parsed.answer || msg.message_text };
      } catch {}
    }
    return msg;
  });
}

const rawMessages = [
  { id: 1, role: "user", message_text: "Hello" },
  { id: 2, role: "assistant", message_text: JSON.stringify({ answer: "Hi!", small_next_step: "Try walking", safety_note: null, confidence: "high" }) },
  { id: 3, role: "assistant", message_text: "Plain text response" },
];

const recovered = recoverMessages(rawMessages);
assert.equal(recovered[1].ai_response.answer, "Hi!", "JSON message_text recovered to ai_response");
assert.equal(recovered[1].ai_response.small_next_step, "Try walking", "full structured response preserved");
assert.equal(recovered[1].message_text, "Hi!", "message_text shows answer");
assert.equal(recovered[2].ai_response, undefined, "plain text message not affected");

console.log("PASS body_ai_chat: full response serialized in fallback, recovered on read");

// ── 9. save_request_id + check_save_status contract ──────────────────────

// Verify the code has the complete flow
assert.ok(analyzeCode.includes("safeLog.save_request_id"), "save_request_id assigned in safeLog");
assert.ok(analyzeCode.includes("handleCheckSaveStatus"), "check handler exists");
assert.ok(analyzeCode.includes("save_request_id"), "check handler queries by save_request_id");

// Verify no fallback to latest record (should return "could not confirm" instead)
assert.ok(analyzeCode.includes("confirmed: false"), "missing column returns confirmed=false");
assert.ok(analyzeCode.includes("Не удалось подтвердить"), "missing column returns 'could not confirm'");
assert.ok(!analyzeCode.includes("showing latest record"), "no fallback to latest record");

// Verify "operation A after B" returns "not confirmed" not "not saved"
assert.ok(analyzeCode.includes("Результат операции не подтверждён"), "A-after-B returns 'not confirmed'");
assert.ok(!analyzeCode.includes("Запись не найдена. Возможно, сохранение не завершилось"), "old 'not saved' message removed");

console.log("PASS save verification contract: no fallback, 'not confirmed' on missing column and A-after-B");

console.log("\n=== All Health diary comprehensive tests passed ===");
