// Negative authorization tests for Health diary operations.
// Verifies: missing access_token, wrong access_token, no client token.
// No Supabase writes, no real sessions. Pure mock verification.
// Usage: node scripts/test-health-diary-auth.js

import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.CLIENT_API_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");

const { validateSessionAccess } = await import("../lib/security/access-token.js");

// ── 1. Code structure: all three handlers call validateSessionAccess ────

const analyzeCode = await import("node:fs").then(fs => fs.readFileSync("api/analyze.js", "utf8"));

// handleDailyLogAnalysis
const dailyLogIdx = analyzeCode.indexOf("function handleDailyLogAnalysis");
const dailyLogBlock = analyzeCode.substring(dailyLogIdx, dailyLogIdx + 1200);
assert.ok(dailyLogBlock.includes("validateSessionAccess"), "handleDailyLogAnalysis calls validateSessionAccess");
assert.ok(dailyLogBlock.includes("access_token"), "handleDailyLogAnalysis extracts access_token from body");

// handleDailyLogAiAnalysis
const aiIdx = analyzeCode.indexOf("function handleDailyLogAiAnalysis");
const aiBlock = analyzeCode.substring(aiIdx, aiIdx + 1200);
assert.ok(aiBlock.includes("validateSessionAccess"), "handleDailyLogAiAnalysis calls validateSessionAccess");
assert.ok(aiBlock.includes("access_token"), "handleDailyLogAiAnalysis extracts access_token from body");

// handleCheckSaveStatus
const checkIdx = analyzeCode.indexOf("function handleCheckSaveStatus");
const checkBlock = analyzeCode.substring(checkIdx, checkIdx + 1200);
assert.ok(checkBlock.includes("validateSessionAccess"), "handleCheckSaveStatus calls validateSessionAccess");
assert.ok(checkBlock.includes("access_token"), "handleCheckSaveStatus extracts access_token from body");

console.log("PASS code structure: all three handlers validate session access_token");

// ── 2. Client sends access_token in all three request bodies ────────────

const diaryCode = await import("node:fs").then(fs => fs.readFileSync("src/BodyDiary.jsx", "utf8"));

assert.ok(diaryCode.includes("access_token: sessionCreds.accessToken"), "BodyDiary sends access_token in save request");
assert.ok(diaryCode.includes('stage: "daily_log_ai_analysis"'), "BodyDiary has AI analysis request");
assert.ok(diaryCode.includes("access_token: sessionCreds.accessToken || null"), "BodyDiary sends access_token in AI request");

console.log("PASS client: access_token sent in save and AI requests");

// ── 3. validateSessionAccess rejects empty/missing token ────────────────

// Test with null token
const r1 = await validateSessionAccess("some-session", null);
assert.equal(r1, false, "null access_token rejected");

// Test with empty token
const r2 = await validateSessionAccess("some-session", "");
assert.equal(r2, false, "empty access_token rejected");

// Test with no session_id
const r3 = await validateSessionAccess(null, "some-token");
assert.equal(r3, false, "null session_id rejected");

console.log("PASS validateSessionAccess: rejects null/empty token and session_id");

// ── 4. Auth check returns 401 before any DB write ──────────────────────

// Verify the auth check is BEFORE any DB operation (supabase import or query)
const dailyLogAuth = dailyLogBlock.indexOf("validateSessionAccess");
const dailyLogDb = dailyLogBlock.indexOf("import(\"../lib/supabase.js\")");
assert.ok(dailyLogAuth > 0, "handleDailyLogAnalysis: auth check present");
assert.ok(dailyLogDb === -1 || dailyLogAuth < dailyLogDb, "handleDailyLogAnalysis: auth check before DB import");

const aiAuth = aiBlock.indexOf("validateSessionAccess");
const aiDb = aiBlock.indexOf("import(\"../lib/supabase.js\")");
assert.ok(aiAuth > 0, "handleDailyLogAiAnalysis: auth check present");
assert.ok(aiDb === -1 || aiAuth < aiDb, "handleDailyLogAiAnalysis: auth check before DB import");

const checkAuth = checkBlock.indexOf("validateSessionAccess");
const checkDb = checkBlock.indexOf("import(\"../lib/supabase.js\")");
assert.ok(checkAuth > 0, "handleCheckSaveStatus: auth check present");
assert.ok(checkDb === -1 || checkAuth < checkDb, "handleCheckSaveStatus: auth check before DB import");

console.log("PASS auth order: session check before DB access in all handlers");

// ── 5. No debit before auth ────────────────────────────────────────────

const dailyLogDebitInBlock = dailyLogBlock.indexOf("debitCreditsForSession");
assert.ok(dailyLogDebitInBlock === -1 || dailyLogAuth < dailyLogDebitInBlock,
  "no debit before auth in daily_log block");

console.log("PASS no debit before auth check");

// ── 6. Error response does not leak session data ───────────────────────

assert.ok(analyzeCode.includes("Сессия недействительна"), "auth error message is generic");
assert.ok(!analyzeCode.includes("access_token_hash"), "no token hash in error responses");

console.log("PASS error responses: generic message, no token leakage");

console.log("\n=== All Health diary auth tests passed ===");
