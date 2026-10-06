// Credential pair semantics tests for Health/Support session access.
// No network, no Supabase. Uses a localStorage mock.
// Covers: atomic pair writes, stale-pair rejection, legacy recovery
// (body_last_result cross-check), fail-closed poisoned state, strict
// withAccessToken without any-token fallback.
// Usage: node scripts/test-session-access-pair.js

import assert from "node:assert/strict";

function createStorageMock() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store),
  };
}

function resetStorage(mock) {
  globalThis.localStorage = mock;
}

let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log(`  OK ${label}`);
}

const {
  saveBodySession,
  saveBodyDisplayResult,
  getBodySession,
  clearBodySession,
  saveSupportSession,
  getSupportSession,
  clearSupportSession,
  withAccessToken,
} = await import("../src/lib/sessionAccess.js");

console.log("Atomic pair save/read (Health)");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveBodySession("session-A", "token-A");
  let pair = getBodySession();
  check(pair.sessionId === "session-A" && pair.accessToken === "token-A", "pair A/tokenA is stored and read together");
  saveBodySession("session-B", "token-B");
  pair = getBodySession();
  check(pair.sessionId === "session-B" && pair.accessToken === "token-B", "new intake replaces the whole pair (A/tokenA gone)");
  check(!mock._dump().body_last_session_id && !mock._dump().body_last_access_token, "legacy keys are removed once the pair key exists");
}

console.log("\nPartial writes never create a mixed pair");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveBodySession("session-A", "token-A");
  saveBodySession("session-B", null);
  let pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "save without token clears the pair instead of keeping token A with session B");
  saveBodySession("session-A", "token-A");
  saveBodySession(null, "token-B");
  pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "save without session_id clears the pair too");
}

console.log("\nPoisoned legacy state is rejected and healed");
{
  // legacy B + tokenA + result A/tokenA -> reject, clear, re-login
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-A");
  mock.setItem("body_last_result", JSON.stringify({ session_id: "session-A", access_token: "token-A" }));
  let pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "legacy B + tokenA with result A/tokenA is rejected (poisoned pair)");
  const dump = mock._dump();
  check(!dump.body_last_session_id && !dump.body_last_access_token && !dump.body_session_pair, "poisoned legacy keys are cleared; user must re-enter the continuation code");
  check(withAccessToken({ action: "save" }, "session-B").access_token === undefined, "after rejected migration no protected request carries token A");
}
{
  // legacy B + tokenB + result B/tokenB -> migrate
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-B");
  mock.setItem("body_last_result", JSON.stringify({ session_id: "session-B", access_token: "token-B" }));
  const pair = getBodySession();
  check(pair.sessionId === "session-B" && pair.accessToken === "token-B", "legacy B + tokenB confirmed by body_last_result is migrated");
  const dump = mock._dump();
  check(!!dump.body_session_pair && !dump.body_last_session_id && !dump.body_last_access_token, "migrated pair moves to the atomic key and legacy keys are removed");
}
{
  // legacy B + tokenB + result missing -> fail closed
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-B");
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "legacy pair without body_last_result is not trusted (fail closed)");
}
{
  // corrupted body_last_result -> fail closed
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-B");
  mock.setItem("body_last_result", "{not-json");
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "corrupted body_last_result fails closed");
}
{
  // result confirms session but not the token -> fail closed
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-A");
  mock.setItem("body_last_result", JSON.stringify({ session_id: "session-B", access_token: "token-B" }));
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "legacy token that does not match the issued result token is rejected");
}

console.log("\nStrict request binding (no any-token fallback)");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveBodySession("session-A", "token-A");
  const bodyRequest = withAccessToken({ action: "daily_log_submitted", session_id: "session-B" }, "session-B");
  check(bodyRequest.access_token === undefined, "stale token A is never attached to a request for session B");
  const okRequest = withAccessToken({ action: "daily_log_submitted", session_id: "session-A" }, "session-A");
  check(okRequest.access_token === "token-A", "the matching pair token is attached for its own session");
}
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveSupportSession("sup-1", "sup-token-1");
  const bodyRequest = withAccessToken({ action: "x", session_id: "sup-1" }, "sup-1");
  check(bodyRequest.access_token === "sup-token-1", "support token is attached only for its own support session");
  saveBodySession("session-A", "token-A");
  const crossRequest = withAccessToken({ action: "x", session_id: "session-A" }, "session-A");
  check(crossRequest.access_token === "token-A", "body token is not shadowed by a support pair");
  const mismatch = withAccessToken({ action: "x", session_id: "other" }, "other");
  check(mismatch.access_token === undefined, "mismatched session never receives a token of another session or module");
}

console.log("\nSupport pair semantics");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveSupportSession("sup-A", "sup-token-A");
  saveSupportSession("sup-B", null);
  let pair = getSupportSession();
  check(pair.sessionId === null && pair.accessToken === null, "partial support save clears the pair (no mixed support pair)");
  saveSupportSession("sup-A", "sup-token-A");
  saveSupportSession("sup-B", "sup-token-B");
  pair = getSupportSession();
  check(pair.sessionId === "sup-B" && pair.accessToken === "sup-token-B", "new support session replaces the whole pair");
}
{
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("support_last_session_id", "sup-B");
  mock.setItem("support_last_access_token", "sup-token-B");
  const pair = getSupportSession();
  check(pair.sessionId === "sup-B" && pair.accessToken === "sup-token-B", "complete legacy support pair is migrated");
  const partial = createStorageMock();
  resetStorage(partial);
  partial.setItem("support_last_session_id", "sup-B");
  const partialPair = getSupportSession();
  check(partialPair.sessionId === null && partialPair.accessToken === null, "partial legacy support state fails closed");
}

console.log("\nReload / storage failure behavior");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveBodySession("session-A", "token-A");
  const before = getBodySession();
  const after = getBodySession();
  check(before.sessionId === after.sessionId && before.accessToken === after.accessToken, "reload (fresh read) returns the same consistent pair");
}
console.log("\nFailed pair write is fail-closed (never leaves an older session active)");
{
  const mock = createStorageMock();
  resetStorage(mock);
  check(saveBodySession("session-A", "token-A") === true, "successful pair save reports success and read-back matches");
  check(saveSupportSession("sup-A", "sup-token-A") === true, "successful support pair save reports success");
  const throwing = {
    getItem: mock.getItem,
    removeItem: mock.removeItem,
    clear: mock.clear,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  globalThis.localStorage = throwing;
  const failedBody = saveBodySession("session-B", "token-B");
  const failedSupport = saveSupportSession("sup-B", "sup-token-B");
  globalThis.localStorage = mock;
  check(failedBody === false && failedSupport === false, "failed pair writes report failure");
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "failed new-session save clears the old body pair (session A is never left active)");
  check(getSupportSession().sessionId === null, "failed new-session save clears the old support pair too");
  check(withAccessToken({ action: "getBodyCabinet", session_id: "session-A" }, "session-A").access_token === undefined,
    "no cabinet request can run with the cleared old token after a failed write");
  check(saveBodySession("session-C", null) === false, "partial save reports failure");
}

console.log("\nDisplay result state stores no credential material");
{
  const mock = createStorageMock();
  resetStorage(mock);
  saveBodySession("session-B", "token-B");
  const stored = saveBodyDisplayResult({
    session_id: "session-B",
    access_token: "token-B",
    continuation_code: "HEALTH-SECRET-CODE",
    user_report: "план",
    body_plan: { days: [] },
  });
  const raw = mock.getItem("body_last_result") || "";
  check(stored === true && !raw.includes("token-B") && !raw.includes("HEALTH-SECRET-CODE"),
    "body_last_result keeps no access_token and no continuation code");
  check(raw.includes("session-B") && raw.includes("план"),
    "body_last_result keeps the display fields needed to restore the plan");
  const pair = getBodySession();
  check(pair.sessionId === "session-B" && pair.accessToken === "token-B",
    "body_session_pair remains the single credential storage after the display save");
  const afterReload = getBodySession();
  check(afterReload.accessToken === "token-B", "reload keeps working through body_session_pair with a sanitized display state");
}
{
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-B");
  mock.setItem("body_last_result", JSON.stringify({ session_id: "session-B", access_token: "token-B", user_report: "старый план" }));
  const pair = getBodySession();
  check(pair.sessionId === "session-B" && pair.accessToken === "token-B",
    "a pre-fix legacy result that still carries the token can one-time confirm a consistent legacy pair");
  const raw = mock.getItem("body_last_result") || "";
  check(!raw.includes("token-B") && raw.includes("старый план"),
    "after the one-time migration body_last_result keeps no access_token but keeps the display fields");
}
{
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-A");
  mock.setItem("body_last_result", JSON.stringify({ session_id: "session-A", access_token: "token-A", continuation_code: "HEALTH-SECRET-CODE" }));
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null, "poisoned legacy state is rejected (unchanged)");
  const raw = mock.getItem("body_last_result") || "";
  check(!raw.includes("token-A") && !raw.includes("HEALTH-SECRET-CODE"),
    "a rejected legacy state purges credential material from the display result");
}
{
  const mock = createStorageMock();
  resetStorage(mock);
  mock.setItem("body_last_session_id", "session-B");
  mock.setItem("body_last_access_token", "token-B");
  mock.setItem("body_last_result", "{not-json");
  const pair = getBodySession();
  check(pair.sessionId === null && pair.accessToken === null && mock.getItem("body_last_result") === null,
    "a corrupted display result is removed entirely while healing legacy state");
}

console.log("\nClient-side guard and handler structure");
{
  const fs = await import("node:fs");
  const diaryCode = fs.readFileSync("src/BodyDiary.jsx", "utf8");
  const submitIdx = diaryCode.indexOf("async function handleSubmit");
  const guardIdx = diaryCode.indexOf("Сессия недействительна. Войдите снова по коду продолжения.", submitIdx);
  const fetchIdx = diaryCode.indexOf("fetchWithRetry", guardIdx);
  check(guardIdx > submitIdx && fetchIdx > guardIdx, "BodyDiary save checks the credential pair before any network request");
  check(diaryCode.includes("sessionCreds.sessionId !== sessionId"), "BodyDiary save rejects a pair that belongs to another session");
  const plateIdx = diaryCode.indexOf("stage: \"plate_photo_analysis\"");
  const plateBlock = diaryCode.substring(plateIdx - 600, plateIdx + 200);
  check(plateBlock.includes("sessionCreds.accessToken"), "plate analysis request carries the validated access_token");
  const appCode = fs.readFileSync("src/App.jsx", "utf8");
  const intakeIdx = appCode.indexOf("function handleBodyIntakeComplete");
  const intakeBlock = appCode.substring(intakeIdx, intakeIdx + 1400);
  check(intakeBlock.includes("saveBodySession(sid, token)"), "intake completion stores the credential pair atomically");
  check(!intakeBlock.includes("localStorage.setItem(\"body_last_session_id\""), "intake completion no longer writes session_id without its token");
  check(intakeBlock.includes("clearBodySession()"), "intake completion without a token clears the previous pair");
  check(intakeBlock.includes("saveBodyDisplayResult(response)"), "intake completion stores the display result through the sanitized helper");
  check(intakeBlock.indexOf("saveBodySession(sid, token)") < intakeBlock.indexOf("saveBodyDisplayResult(response)"),
    "the trusted credential pair is saved before the display result state");
  check(intakeBlock.includes("const pairSaved =") && intakeBlock.includes("if (!pairSaved) clearBodySession()"),
    "a failed pair write is fail-closed in the intake completion handler");
  check(intakeBlock.includes("if (!pairSaved)") && intakeBlock.includes("Не удалось сохранить доступ к сессии"),
    "a failed pair write shows an explicit error and keeps the continuation code memory-only");

  // Blocker 3: session_id is never presented as a continuation code
  const codeStepIdx = appCode.indexOf("Ваш код продолжения");
  const codeStepBlock = appCode.substring(codeStepIdx, codeStepIdx + 2200);
  check(!codeStepBlock.includes("bodyIntakeResult.session_id"), "the code step never displays session_id as the continuation code");
  check(codeStepBlock.includes("continuation_code || continuationCode"), "the code step shows the in-memory continuation code after a fresh intake");
  check(codeStepBlock.includes("Код продолжения не хранится на устройстве"),
    "the code step explains when no continuation code is available on the device");
  const copyIdx = appCode.indexOf("function copyBodyCode");
  const copyBlock = appCode.substring(copyIdx, copyIdx + 400);
  check(!copyBlock.includes("session_id") && !copyBlock.includes("body_last_session_id"),
    "copyBodyCode never falls back to a session short code");
  check(appCode.includes("preferCode: true") && appCode.includes("options.preferCode === true"),
    "an explicitly entered continuation code takes priority over a stored pair");
}

console.log("\nNo token logging");
{
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/sessionAccess.js", "utf8");
  check(!source.includes("console.log") && !source.includes("console.error"), "sessionAccess never logs raw credential material");
}

console.log(`\nSession access pair tests: ${passed} passed`);
