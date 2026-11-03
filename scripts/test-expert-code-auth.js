import assert from "node:assert/strict";
import { resolveExpertByAccessCode } from "../lib/security/expert-code-auth.js";

const experts = new Map([
  ["EXPERT-ALPHA", { id: "expert-a", is_active: true, allowed_modules: ["support"] }],
  ["EXPERT-INACTIVE", { id: "expert-inactive", is_active: false, allowed_modules: ["support"] }],
]);
let lookups = 0;
const findActiveExpert = async (code) => {
  lookups += 1;
  return experts.get(code) || null;
};

assert.deepEqual(await resolveExpertByAccessCode({
  expertId: "expert-a", expertCode: " expert-alpha ", findActiveExpert,
}), experts.get("EXPERT-ALPHA"));
assert.equal(await resolveExpertByAccessCode({
  expertId: "attacker-chosen", expertCode: "EXPERT-ALPHA", findActiveExpert,
}), null, "body expert_id cannot override code identity");
assert.equal(await resolveExpertByAccessCode({
  expertId: "expert-inactive", expertCode: "EXPERT-INACTIVE", findActiveExpert,
}), null, "inactive experts are denied");
assert.equal(await resolveExpertByAccessCode({
  expertId: "expert-a", expertCode: "UNKNOWN", findActiveExpert,
}), null, "unknown access codes are denied");
const beforeMissingCode = lookups;
assert.equal(await resolveExpertByAccessCode({ expertId: "expert-a", expertCode: "", findActiveExpert }), null);
assert.equal(lookups, beforeMissingCode, "missing credentials do not trigger a lookup");

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const { default: reviewsHandler } = await import("../api/reviews.js");
globalThis.setInterval = originalSetInterval;

async function invokeReviews(body) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader() {},
  };
  await reviewsHandler({
    method: "POST",
    url: "/api/reviews",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    body,
  }, response);
  return response;
}

assert.equal((await invokeReviews({ action: "list" })).statusCode, 401, "case review list requires admin authentication");
assert.equal((await invokeReviews({ action: "getSessionTimeline", public_code: "ТОЧКА-ABCD-1234", expert_id: "expert-a" })).statusCode, 401, "timeline does not trust a caller-supplied expert ID");
assert.equal((await invokeReviews({ action: "getSessionTimelineDetails", session_id: "synthetic-session", expert_id: "expert-a" })).statusCode, 401, "timeline details require an existing expert credential");

console.log("Expert code auth tests passed: server-derived identity, mismatch and inactive expert denial.");
