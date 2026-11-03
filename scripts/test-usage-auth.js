import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { accessTokenMatchesHash } from "../lib/security/access-token.js";
import { resolveUsageOwner } from "../lib/security/usage-session-owner.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessions = new Map([
  ["support-a", {
    session_id: "support-a", module: "support", anonymous_owner_id: "owner-a",
    access_token_hash: hash("support-token-a"), legacy_access: false,
    json_data: { pilot_id: "usage-auth-test" },
  }],
  ["support-b", {
    session_id: "support-b", module: "support", anonymous_owner_id: "owner-b",
    access_token_hash: hash("support-token-b"), legacy_access: false,
    json_data: { pilot_id: "usage-auth-test" },
  }],
  ["body-a", {
    session_id: "body-a", module: "body", anonymous_owner_id: "owner-body-a",
    access_token_hash: hash("body-token-a"), legacy_access: false,
    json_data: { pilot_id: "usage-auth-test" },
  }],
  ["legacy-a", {
    session_id: "legacy-a", module: "support", anonymous_owner_id: "owner-legacy",
    access_token_hash: hash("legacy-token"), legacy_access: true,
    json_data: { pilot_id: "usage-auth-test" },
  }],
  ["pilot-other", {
    session_id: "pilot-other", module: "support", anonymous_owner_id: "owner-other-pilot",
    access_token_hash: hash("other-pilot-token"), legacy_access: false,
    json_data: { pilot_id: "other-pilot" },
  }],
]);
const bodyClients = new Map([
  ["body-a", { session_id: "body-a", anonymous_owner_id: "owner-body-a" }],
  ["body-mismatch", { session_id: "body-a", anonymous_owner_id: "owner-someone-else" }],
]);

let sessionLookups = 0;
let bodyClientLookups = 0;
const dependencies = {
  findSession: async (sessionId, module) => {
    sessionLookups += 1;
    const session = sessions.get(sessionId);
    return session?.module === module ? session : null;
  },
  findBodyClient: async (sessionId) => {
    bodyClientLookups += 1;
    return bodyClients.get(sessionId) || null;
  },
  validateAccess: async (_sessionId, token, session) => accessTokenMatchesHash(token, session.access_token_hash),
};

const originalPilot = process.env.PILOT_ID;
process.env.PILOT_ID = "usage-auth-test";

assert.deepEqual(await resolveUsageOwner({
  sessionId: "support-a", module: "support", accessToken: "support-token-a", ...dependencies,
}), {
  ownerId: "owner-a", ownerType: "anonymous_case", module: "support", sessionId: "support-a",
});

assert.deepEqual(await resolveUsageOwner({
  sessionId: "body-a", module: "body", accessToken: "body-token-a", ...dependencies,
}), {
  ownerId: "owner-body-a", ownerType: "anonymous_profile", module: "body", sessionId: "body-a",
});

const lookupsBeforeMissingCredentials = sessionLookups;
assert.equal(await resolveUsageOwner({ sessionId: "support-a", module: "support", accessToken: "", ...dependencies }), null);
assert.equal(await resolveUsageOwner({ sessionId: "", module: "support", accessToken: "support-token-a", ...dependencies }), null);
// A short public code by itself supplies no session ID or bearer proof and must
// not cause a database lookup.
assert.equal(await resolveUsageOwner({ module: "support", accessToken: "", ...dependencies }), null);
assert.equal(sessionLookups, lookupsBeforeMissingCredentials);

assert.equal(await resolveUsageOwner({
  sessionId: "support-a", module: "support", accessToken: "wrong-token", ...dependencies,
}), null, "an invalid token is rejected");
assert.equal(await resolveUsageOwner({
  sessionId: "support-b", module: "support", accessToken: "support-token-a", ...dependencies,
}), null, "a different patient's token is rejected");
assert.equal(await resolveUsageOwner({
  sessionId: "support-a", module: "body", accessToken: "support-token-a", ...dependencies,
}), null, "a Support session cannot authorize Health");
assert.equal(await resolveUsageOwner({
  sessionId: "legacy-a", module: "support", accessToken: "legacy-token", ...dependencies,
}), null, "legacy access is not accepted for financial history");
assert.equal(await resolveUsageOwner({
  sessionId: "pilot-other", module: "support", accessToken: "other-pilot-token", ...dependencies,
}), null, "a session from a different pilot is rejected");

const mismatchedBodyDeps = {
  ...dependencies,
  findBodyClient: async () => ({ session_id: "body-a", anonymous_owner_id: "owner-someone-else" }),
};
assert.equal(await resolveUsageOwner({
  sessionId: "body-a", module: "body", accessToken: "body-token-a", ...mismatchedBodyDeps,
}), null, "Body session and client owner must match");

assert.equal(accessTokenMatchesHash("support-token-a", sessions.get("support-a").access_token_hash), true);
assert.equal(accessTokenMatchesHash("support-token-b", sessions.get("support-a").access_token_hash), false);
assert.equal(accessTokenMatchesHash("support-token-a", "not-a-sha256-hash"), false);
assert.equal(accessTokenMatchesHash("", sessions.get("support-a").access_token_hash), false);

// Exercise the route's public-code-only paths without Supabase configuration.
// The session resolver must reject these before attempting any database read.
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const { default: usageHandler } = await import("../api/usage.js");
globalThis.setInterval = originalSetInterval;

async function invokeUsage(body) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader() {},
  };
  const request = {
    method: "POST",
    url: "/api/usage",
    headers: { "x-forwarded-for": `synthetic-${Math.random()}` },
    socket: { remoteAddress: "127.0.0.1" },
    body,
  };
  await usageHandler(request, response);
  return response;
}

const shortCodeBalance = await invokeUsage({
  action: "getUsageBalance", module: "support", publicCode: "ТОЧКА-ABCD-1234",
});
const missingCredentialBalance = await invokeUsage({
  action: "getUsageBalance", module: "support", sessionId: "synthetic-session",
});
assert.equal(shortCodeBalance.statusCode, 401);
assert.equal(missingCredentialBalance.statusCode, 401);
assert.deepEqual(shortCodeBalance.body, missingCredentialBalance.body, "short code and missing credential have the same response");
const shortCodeHistory = await invokeUsage({
  action: "getRecentUsage", module: "body", publicCode: "HEALTH-ABCD-123",
});
assert.equal(shortCodeHistory.statusCode, 401, "public Health short code cannot retrieve ledger history");

if (originalPilot === undefined) delete process.env.PILOT_ID;
else process.env.PILOT_ID = originalPilot;

console.log("Usage authorization tests passed: token proof, owner/module/pilot isolation, legacy denial and public-code denial.");
