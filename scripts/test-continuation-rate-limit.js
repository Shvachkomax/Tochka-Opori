// Standalone test for unified continuation credential failure limiter.
// Simulates the database-backed lock logic without requiring Supabase.

import crypto from "crypto";

const PEPPER = crypto.randomBytes(32).toString("hex");
const EXCHANGE_ERROR = "Не удалось открыть разговор. Проверьте код продолжения.";

function getAttemptKey(clientIp, lookupCode) {
  const lookupHash = crypto.createHmac("sha256", PEPPER).update(lookupCode.toUpperCase()).digest("hex");
  return crypto.createHash("sha256").update(`${clientIp}:${lookupHash}`).digest("hex");
}

function hashSecret(secret) {
  return crypto.createHmac("sha256", PEPPER).update(secret.toUpperCase()).digest("hex");
}

// In-memory simulation of continuation_failed_attempts
const attemptsDb = new Map();

function atomicIncrement(attemptKey) {
  const existing = attemptsDb.get(attemptKey);
  const newCount = (existing?.failed_attempt_count || 0) + 1;
  const lockedUntil = newCount >= 5
    ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
    : null;
  const row = { failed_attempt_count: newCount, locked_until: lockedUntil, updated_at: new Date().toISOString() };
  attemptsDb.set(attemptKey, row);
  return row;
}

function clearAttempts(attemptKey) {
  attemptsDb.delete(attemptKey);
}

function simulateExchange({ clientIp, lookupCode, secret, storedSecret = null, revoked = false }) {
  const attemptKey = getAttemptKey(clientIp, lookupCode);
  const now = new Date().toISOString();
  const existing = attemptsDb.get(attemptKey);

  if (existing?.locked_until && existing.locked_until > now) {
    return { status: 429, error: EXCHANGE_ERROR, body: { ok: false, error: EXCHANGE_ERROR }, attemptKey };
  }

  const isValid = storedSecret && !revoked && secret === storedSecret;

  if (!isValid) {
    const incremented = atomicIncrement(attemptKey);
    if (incremented.locked_until && incremented.locked_until > now) {
      return { status: 429, error: EXCHANGE_ERROR, body: { ok: false, error: EXCHANGE_ERROR }, attemptKey };
    }
    return { status: 401, error: EXCHANGE_ERROR, body: { ok: false, error: EXCHANGE_ERROR }, attemptKey };
  }

  clearAttempts(attemptKey);
  return { status: 200, ok: true, body: { ok: true, access_token: "new-token" }, attemptKey };
}

function assertEqual(a, b, message) {
  if (a !== b) {
    console.error(`FAIL: ${message}\n  expected: ${b}\n  actual: ${a}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
  console.log("PASS:", message);
}

const CLIENT_IP = "1.2.3.4";
const EXISTING_LOOKUP = "ТОЧКА-ABCD-EFGH";
const NONEXISTING_LOOKUP = "ТОЧКА-ZZZZ-ZZZZ";
const CORRECT_SECRET = "AAAA-BBBB-CCCC";
const WRONG_SECRET = "XXXX-YYYY-ZZZZ";

// Test A: Existing lookup + wrong secret
console.log("\n--- A. Existing lookup + wrong secret ---");
attemptsDb.clear();
let existingResponses = [];
for (let i = 0; i < 6; i++) {
  const result = simulateExchange({
    clientIp: CLIENT_IP,
    lookupCode: EXISTING_LOOKUP,
    secret: WRONG_SECRET,
    storedSecret: CORRECT_SECRET,
  });
  existingResponses.push(result.status);
}
assertEqual(existingResponses[0], 401, "1st wrong existing → 401");
assertEqual(existingResponses[1], 401, "2nd wrong existing → 401");
assertEqual(existingResponses[2], 401, "3rd wrong existing → 401");
assertEqual(existingResponses[3], 401, "4th wrong existing → 401");
assertEqual(existingResponses[4], 429, "5th wrong existing → 429 (lock triggered)");
assertEqual(existingResponses[5], 429, "6th wrong existing → 429");

// Test B: Non-existing lookup must match existing lookup responses
console.log("\n--- B. Non-existing lookup ---");
attemptsDb.clear();
let nonexistingResponses = [];
for (let i = 0; i < 6; i++) {
  const result = simulateExchange({
    clientIp: CLIENT_IP,
    lookupCode: NONEXISTING_LOOKUP,
    secret: WRONG_SECRET,
  });
  nonexistingResponses.push(result.status);
}
assertEqual(JSON.stringify(nonexistingResponses), JSON.stringify(existingResponses), "non-existing lookup matches existing lookup status sequence");

// Compare bodies too
const lastExistingBody = simulateExchange({
  clientIp: CLIENT_IP,
  lookupCode: EXISTING_LOOKUP,
  secret: WRONG_SECRET,
  storedSecret: CORRECT_SECRET,
}).body;
attemptsDb.clear();
for (let i = 0; i < 5; i++) {
  simulateExchange({ clientIp: CLIENT_IP, lookupCode: EXISTING_LOOKUP, secret: WRONG_SECRET, storedSecret: CORRECT_SECRET });
}
const existingLockedBody = simulateExchange({ clientIp: CLIENT_IP, lookupCode: EXISTING_LOOKUP, secret: WRONG_SECRET, storedSecret: CORRECT_SECRET }).body;

attemptsDb.clear();
for (let i = 0; i < 5; i++) {
  simulateExchange({ clientIp: CLIENT_IP, lookupCode: NONEXISTING_LOOKUP, secret: WRONG_SECRET });
}
const nonexistingLockedBody = simulateExchange({ clientIp: CLIENT_IP, lookupCode: NONEXISTING_LOOKUP, secret: WRONG_SECRET }).body;

assertEqual(JSON.stringify(existingLockedBody), JSON.stringify(nonexistingLockedBody), "locked response bodies are identical for existing and non-existing lookups");

// Test C: 5 successful entries do not increment limiter
console.log("\n--- C. Five successful entries ---");
attemptsDb.clear();
const successStatuses = [];
for (let i = 0; i < 5; i++) {
  const result = simulateExchange({
    clientIp: CLIENT_IP,
    lookupCode: EXISTING_LOOKUP,
    secret: CORRECT_SECRET,
    storedSecret: CORRECT_SECRET,
  });
  successStatuses.push(result.status);
}
assert(successStatuses.every(s => s === 200), "all 5 successful exchanges return 200");
assertEqual(attemptsDb.size, 0, "success does not create failure attempts");

// Test D: Parallel wrong requests
console.log("\n--- D. Parallel wrong requests ---");
attemptsDb.clear();
const promises = [];
for (let i = 0; i < 5; i++) {
  promises.push(Promise.resolve(simulateExchange({
    clientIp: CLIENT_IP,
    lookupCode: EXISTING_LOOKUP,
    secret: WRONG_SECRET,
    storedSecret: CORRECT_SECRET,
  })));
}
const parallelResults = await Promise.all(promises);
const parallelStatuses = parallelResults.map(r => r.status);
const attemptKey = getAttemptKey(CLIENT_IP, EXISTING_LOOKUP);
const finalRow = attemptsDb.get(attemptKey);
assertEqual(finalRow.failed_attempt_count, 5, "parallel wrong requests increment counter to 5");
assertEqual(parallelStatuses.filter(s => s === 401).length, 4, "4 of 5 parallel wrong requests return 401");
assertEqual(parallelStatuses.filter(s => s === 429).length, 1, "1 of 5 parallel wrong requests returns 429 (lock triggered)");

// Test E: Correct code during lock does not reveal data
console.log("\n--- E. Correct code during lock ---");
attemptsDb.clear();
for (let i = 0; i < 5; i++) {
  simulateExchange({ clientIp: CLIENT_IP, lookupCode: EXISTING_LOOKUP, secret: WRONG_SECRET, storedSecret: CORRECT_SECRET });
}
const duringLock = simulateExchange({
  clientIp: CLIENT_IP,
  lookupCode: EXISTING_LOOKUP,
  secret: CORRECT_SECRET,
  storedSecret: CORRECT_SECRET,
});
assertEqual(duringLock.status, 429, "correct secret during lock returns 429");
assertEqual(duringLock.body.ok, false, "correct secret during lock does not return ok");

// Test F: After lock expires, correct code opens and resets
console.log("\n--- F. After lock expiry ---");
// Manually expire the lock
const currentRow = attemptsDb.get(attemptKey);
assert(currentRow, "current attempt row exists before expiry");
currentRow.locked_until = new Date(Date.now() - 1000).toISOString();
const afterExpiry = simulateExchange({
  clientIp: CLIENT_IP,
  lookupCode: EXISTING_LOOKUP,
  secret: CORRECT_SECRET,
  storedSecret: CORRECT_SECRET,
});
assertEqual(afterExpiry.status, 200, "correct secret after lock expiry returns 200");
assertEqual(attemptsDb.has(attemptKey), false, "failure attempts cleared after success");

// Test G: Different IP should not share lock
console.log("\n--- G. Different IP isolation ---");
attemptsDb.clear();
for (let i = 0; i < 5; i++) {
  simulateExchange({ clientIp: CLIENT_IP, lookupCode: EXISTING_LOOKUP, secret: WRONG_SECRET, storedSecret: CORRECT_SECRET });
}
const otherIp = simulateExchange({ clientIp: "5.6.7.8", lookupCode: EXISTING_LOOKUP, secret: WRONG_SECRET, storedSecret: CORRECT_SECRET });
assertEqual(otherIp.status, 401, "different IP starts with 401");

console.log("\n=== All unified failure limiter tests passed ===");
