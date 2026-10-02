import assert from "node:assert/strict";
import crypto from "node:crypto";

// ── Pilot isolation & brand regression tests ──────────────────────────────
// No network, no Supabase, no OpenAI. Pure logic + mocked API handlers.

process.env.CLIENT_API_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");

// ── 1. Module availability: Body blocking per brand ────────────────────────

const { isModuleAvailable, isAnMedSupportOnlyDeployment, isSupportOnlyPilot, getPilotId, isPilotSessionMatch } =
  await import("../lib/security/module-availability.js");

// Default brand (tochka-opory): Body available
assert.equal(isModuleAvailable("body", { brand: "tochka-opory", supportOnly: "false" }), true, "default brand allows Body");
assert.equal(isModuleAvailable("support", { brand: "tochka-opory", supportOnly: "false" }), true, "default brand allows Support");

// AnMed: Body blocked
assert.equal(isModuleAvailable("body", { brand: "anmed" }), false, "anmed blocks Body");
assert.equal(isModuleAvailable("support", { brand: "anmed" }), true, "anmed allows Support");

// Pneumointegration: Body blocked
assert.equal(isModuleAvailable("body", { brand: "pneumointegration" }), false, "pneumointegration blocks Body");
assert.equal(isModuleAvailable("support", { brand: "pneumointegration" }), true, "pneumointegration allows Support");

// ANMED_SUPPORT_ONLY alone blocks Body for any brand
assert.equal(isModuleAvailable("body", { brand: "tochka-opory", supportOnly: "true" }), false, "ANMED_SUPPORT_ONLY=true blocks Body even for default");

// Pneumointegration blocks Body even if ANMED_SUPPORT_ONLY is explicitly false
assert.equal(isModuleAvailable("body", { brand: "pneumointegration", supportOnly: "false" }), false, "pneumointegration blocks Body regardless of ANMED_SUPPORT_ONLY");

// AnMed blocks Body even if ANMED_SUPPORT_ONLY is explicitly false
assert.equal(isModuleAvailable("body", { brand: "anmed", supportOnly: "false" }), false, "anmed blocks Body regardless of ANMED_SUPPORT_ONLY");

// isSupportOnlyPilot alias
assert.equal(isSupportOnlyPilot({ brand: "anmed" }), true);
assert.equal(isSupportOnlyPilot({ brand: "pneumointegration" }), true);
assert.equal(isSupportOnlyPilot({ brand: "tochka-opory" }), false);

console.log("PASS module availability: Body blocked for both pilots, available for default");

// ── 2. Pilot ID derivation ────────────────────────────────────────────────

const origPilot = process.env.PILOT_ID;
const origBrand = process.env.VITE_APP_BRAND;

delete process.env.PILOT_ID;
process.env.VITE_APP_BRAND = "pneumointegration";
assert.equal(getPilotId(), "pneumointegration", "pilot_id falls back to VITE_APP_BRAND");

process.env.PILOT_ID = "custom-pilot";
assert.equal(getPilotId(), "custom-pilot", "pilot_id prefers PILOT_ID env");

delete process.env.PILOT_ID;
delete process.env.VITE_APP_BRAND;
assert.equal(getPilotId(), null, "pilot_id is null without env");

console.log("PASS pilot_id derivation from server env");

// ── 3. Pilot session match ────────────────────────────────────────────────

process.env.PILOT_ID = "pneumointegration";

assert.equal(isPilotSessionMatch({ pilot_id: "pneumointegration" }), true, "matching pilot accepted");
assert.equal(isPilotSessionMatch({ pilot_id: "anmed" }), false, "mismatched pilot rejected");
assert.equal(isPilotSessionMatch({}), true, "session without pilot_id allowed (legacy, pepper protects)");
assert.equal(isPilotSessionMatch(null), true, "null json_data allowed");
assert.equal(isPilotSessionMatch({ pilot_id: null }), true, "null pilot_id allowed");

delete process.env.PILOT_ID;
assert.equal(isPilotSessionMatch({ pilot_id: "anmed" }), true, "no server pilot = no check");

console.log("PASS pilot session ownership check");

// ── 4. Pilot ID injection in usage metadata ───────────────────────────────

process.env.PILOT_ID = "pneumointegration";

const { enrichMetadataWithPilot } = await import("../lib/usage/wallet.js");

// Test: pilot_id is injected into metadata
const meta1 = enrichMetadataWithPilot({});
assert.equal(meta1?.pilot_id, "pneumointegration", "pilot_id injected into empty metadata");

const meta2 = enrichMetadataWithPilot(null);
assert.equal(meta2?.pilot_id, "pneumointegration", "pilot_id injected into null metadata");

const meta3 = enrichMetadataWithPilot({ custom: "data" });
assert.equal(meta3?.pilot_id, "pneumointegration", "pilot_id injected alongside existing metadata");
assert.equal(meta3?.custom, "data", "existing metadata preserved");

console.log("PASS pilot_id injected into usage metadata via enrichMetadataWithPilot");

// ── 5. Pilot ID NOT accepted from client ──────────────────────────────────

// Server pilot_id overrides any client-supplied value
const meta4 = enrichMetadataWithPilot({ pilot_id: "hacked-pilot", custom: "data" });
assert.equal(meta4?.pilot_id, "pneumointegration", "server pilot_id overrides client-supplied value");
assert.equal(meta4?.custom, "data", "non-pilot metadata preserved");

// Without PILOT_ID: client value passes through (but no server pilot = no isolation guarantee)
delete process.env.PILOT_ID;
const meta5 = enrichMetadataWithPilot({ pilot_id: "hacked-pilot" });
assert.equal(meta5?.pilot_id, "hacked-pilot", "without server PILOT_ID, metadata passes through");

console.log("PASS server pilot_id overrides client-supplied pilot_id");

// ── 6. Continuation secret: different peppers = different hashes ──────────

const { hashContinuationSecret, verifyContinuationSecret } = await import("../lib/session/continuation-credential.js");

process.env.CONTINUATION_SECRET_PEPPER = "pepper-anmed-unique";
const hashAnmed = hashContinuationSecret("ABCD-EFGH-IJKL");

process.env.CONTINUATION_SECRET_PEPPER = "pepper-pneumo-unique";
const hashPneumo = hashContinuationSecret("ABCD-EFGH-IJKL");

assert.notEqual(hashAnmed, hashPneumo, "different peppers produce different hashes for same secret");

// Verify with correct pepper works
process.env.CONTINUATION_SECRET_PEPPER = "pepper-anmed-unique";
assert.equal(verifyContinuationSecret("ABCD-EFGH-IJKL", hashAnmed), true, "correct pepper verifies hash");

// Verify with wrong pepper fails
process.env.CONTINUATION_SECRET_PEPPER = "pepper-pneumo-unique";
assert.equal(verifyContinuationSecret("ABCD-EFGH-IJKL", hashAnmed), false, "wrong pepper rejects hash");

console.log("PASS continuation secret: different peppers = cross-pilot code rejection");

// ── 7. API handler Body rejection for pneumointegration ────────────────────

process.env.ANMED_SUPPORT_ONLY = "true";
process.env.VITE_APP_BRAND = "pneumointegration";

const { rejectUnavailableModule } = await import("../lib/security/module-availability.js");

const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
};

const res1 = mockRes();
assert.equal(rejectUnavailableModule(res1, "body", { brand: "pneumointegration" }), true, "rejectUnavailableModule blocks body for pneumo");
assert.equal(res1.statusCode, 403);

const res2 = mockRes();
assert.equal(rejectUnavailableModule(res2, "support", { brand: "pneumointegration" }), false, "rejectUnavailableModule allows support for pneumo");

const res3 = mockRes();
assert.equal(rejectUnavailableModule(res3, "body", { brand: "anmed" }), true, "rejectUnavailableModule blocks body for anmed");

const res4 = mockRes();
assert.equal(rejectUnavailableModule(res4, "body", { brand: "tochka-opory", supportOnly: "false" }), false, "rejectUnavailableModule allows body for default");

console.log("PASS API handler Body rejection works independently of UI");

// ── Restore env ───────────────────────────────────────────────────────────

if (origPilot === undefined) delete process.env.PILOT_ID;
else process.env.PILOT_ID = origPilot;
if (origBrand === undefined) delete process.env.VITE_APP_BRAND;
else process.env.VITE_APP_BRAND = origBrand;

console.log("\n=== All pilot isolation regression tests passed ===");
