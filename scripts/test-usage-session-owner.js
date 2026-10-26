import assert from "node:assert/strict";
import { resolveUsageOwnerFromSession } from "../lib/security/usage-session-owner.js";

const originalPilot = process.env.PILOT_ID;
process.env.PILOT_ID = "pneumointegration";
const session = {
  session_id: "session-pneumo-1",
  anonymous_owner_id: "owner-pneumo-1",
  legacy_access: false,
  json_data: { pilot_id: "pneumointegration" },
};

let validations = 0;
const validateAccess = async (sessionId, token) => {
  validations += 1;
  return sessionId === session.session_id && token === "valid-token";
};

assert.equal(await resolveUsageOwnerFromSession(null, "valid-token", validateAccess), null);
assert.equal(await resolveUsageOwnerFromSession({ ...session, json_data: { pilot_id: "anmed" } }, "valid-token", validateAccess), null);
assert.equal(await resolveUsageOwnerFromSession(session, "", validateAccess), null);
assert.equal(validations, 0, "missing tokens must be rejected before token validation");
assert.equal(await resolveUsageOwnerFromSession(session, "wrong-token", validateAccess), null);
assert.equal(await resolveUsageOwnerFromSession(session, "valid-token", validateAccess), "owner-pneumo-1");
assert.equal(validations, 2);

const legacy = { ...session, legacy_access: true, json_data: {} };
assert.equal(await resolveUsageOwnerFromSession(legacy, null, validateAccess), "owner-pneumo-1");

if (originalPilot === undefined) delete process.env.PILOT_ID;
else process.env.PILOT_ID = originalPilot;

console.log("Usage session owner tests passed: tenant match and mandatory access token for modern sessions.");
