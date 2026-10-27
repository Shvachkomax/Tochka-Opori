import assert from "node:assert/strict";
import handler, { validateSpecialistContext } from "../api/specialist.js";
import { handlePartnerProgram } from "../lib/partners/program-handler.js";

function response() {
  return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.code = v; return this; }, json(body) { this.body = body; return this; } };
}
const calls = [];
let fault = null;
const deps = {
  authorizeSpecialist: async () => ({ expert: { id: "verified-expert", allowed_modules: ["support", "body"] }, memberships: [{ organization_id: "allowed-org" }] }),
  validateSpecialistContext,
  getPilotId: () => "anmed",
  getSupabase: () => ({ rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name === "partner_test_summary" ? { earned_credits: 250 } : [], error: fault };
  } }),
};
const req = { method: "POST", headers: {}, body: { action: "getPartnerProgram", module: "support", organization_id: "allowed-org", expert_id: "attacker-choice", pilot_id: "foreign" } };
let res = response();
await handler({ ...req, body: { action: "getPartnerProgram", module: "support" } }, res);
assert.equal(res.code, 401, "actual endpoint denies unauthenticated users");
res = response();
await handlePartnerProgram(req, res, deps);
assert.equal(res.code, 200);
assert.equal(res.headers["Cache-Control"], "no-store");
for (const call of calls) assert.deepEqual(call.args, { p_expert_id: "verified-expert", p_module: "support", p_organization_id: "allowed-org", p_pilot_id: "anmed" });
for (const change of [{ organization_id: "foreign" }, { module: "invalid" }]) {
  calls.length = 0; res = response();
  await handlePartnerProgram({ ...req, body: { ...req.body, ...change } }, res, deps);
  assert.equal(res.code, 403);
  assert.equal(calls.length, 0);
}
res = response(); calls.length = 0;
await handlePartnerProgram(req, res, { ...deps, authorizeSpecialist: async () => ({ status: 401, error: "Сессия истекла" }) });
assert.equal(res.code, 401); assert.equal(calls.length, 0);
for (const [code, expected] of [["PGRST202", 503], ["XX000", 500]]) {
  fault = { code }; res = response();
  await handlePartnerProgram(req, res, deps);
  assert.equal(res.code, expected);
  assert.equal(res.body.summary, undefined, "database failures never become a zero balance");
}
console.log("Partner API tests passed: session identity, scope, no-store, errors and missing migration.");

// The imported application rate limiter owns a recurring cleanup timer.
process.exit(0);
