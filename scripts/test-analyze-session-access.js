import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validateAnalyzeSessionAccess } from "../lib/security/analyze-session-access.js";
import { hasBodySessionReference, isModuleAvailable, rejectUnavailableModule } from "../lib/security/module-availability.js";
import { withSessionAccess } from "../src/lib/sessionAccess.js";

function mockSupabase(rowsByTable) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq(_column, value) {
              return {
                async maybeSingle() {
                  const row = rowsByTable[table];
                  return { data: row?.session_id === value ? row : null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const sessionA = {
  session_id: "session-a",
  anonymous_owner_id: "owner-a",
  module: "support",
  legacy_access: false,
};
const validateAccess = async (sessionId, token) => (
  (sessionId === "session-a" && token === "token-a")
  || (sessionId === "session-b" && token === "token-b")
);

assert.equal(isModuleAvailable("support", { supportOnly: "true" }), true);
assert.equal(isModuleAvailable("body", { supportOnly: "true" }), false);
assert.equal(isModuleAvailable("body", { brand: "anmed" }), false);
assert.equal(isModuleAvailable("body", { supportOnly: "false", brand: "anmed" }), false);
assert.equal(isModuleAvailable("body", { supportOnly: "false", brand: "tochka-opory" }), true);
assert.equal(isModuleAvailable("body", { brand: "pneumointegration" }), false);
assert.equal(isModuleAvailable("body", { supportOnly: "false", brand: "pneumointegration" }), false);
assert.equal(isModuleAvailable("support", { brand: "pneumointegration" }), true);
assert.equal(isModuleAvailable("body", { supportOnly: "false", brand: "tochka-opory" }), true);
assert.equal(hasBodySessionReference({ previousSessionId: "HEALTH-ABCD-123" }), true);
assert.equal(hasBodySessionReference({ sessionId: "sess_support_123" }), false);

const moduleResponse = {
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(data) { this.body = data; return this; },
};
assert.equal(rejectUnavailableModule(moduleResponse, "body", { supportOnly: "true" }), true);
assert.equal(moduleResponse.statusCode, 403);
assert.equal(rejectUnavailableModule(moduleResponse, "body", { supportOnly: "false", brand: "tochka-opory" }), false);

const ownSession = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "support",
  accessToken: "token-a",
}, { supabase: mockSupabase({ sessions: sessionA }), validateAccess });
assert.deepEqual(ownSession, { allowed: true, missingSession: false });

const foreignSession = await validateAnalyzeSessionAccess({
  sessionId: "session-b",
  module: "support",
  accessToken: "token-a",
}, {
  supabase: mockSupabase({ sessions: { ...sessionA, session_id: "session-b", anonymous_owner_id: "owner-b" } }),
  validateAccess,
});
assert.equal(foreignSession.allowed, false, "a token for another session must not authorize this session");

let checkedMissingSessionToken = false;
const nonexistentSession = await validateAnalyzeSessionAccess({
  sessionId: "missing-session",
  module: "support",
  accessToken: "token-a",
}, {
  supabase: mockSupabase({ sessions: null }),
  validateAccess: async () => { checkedMissingSessionToken = true; return false; },
});
assert.equal(nonexistentSession.allowed, false);
assert.equal(checkedMissingSessionToken, false, "a nonexistent session must be rejected before token validation");

let checkedMissingCredential = false;
const missingCredential = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "support",
  accessToken: "",
}, {
  supabase: mockSupabase({ sessions: sessionA }),
  validateAccess: async () => { checkedMissingCredential = true; return true; },
});
assert.equal(missingCredential.allowed, false);
assert.equal(checkedMissingCredential, false, "missing credentials must not reach token validation");

const wrongCredential = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "support",
  accessToken: "wrong-token",
}, { supabase: mockSupabase({ sessions: sessionA }), validateAccess });
assert.equal(wrongCredential.allowed, false);

const bodySession = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "body",
  stage: "daily_log_submitted",
  accessToken: "token-a",
}, {
  supabase: mockSupabase({
    body_clients: { session_id: "session-a", anonymous_owner_id: "owner-a" },
    sessions: { session_id: "session-a", anonymous_owner_id: "owner-a", module: "body", legacy_access: false },
  }),
  validateAccess,
});
assert.equal(bodySession.allowed, true, "body session ownership must use body_clients plus the session access token");

const mismatchedBodyOwner = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "body",
  stage: "daily_log_submitted",
  accessToken: "token-a",
}, {
  supabase: mockSupabase({
    body_clients: { session_id: "session-a", anonymous_owner_id: "owner-a" },
    sessions: { session_id: "session-a", anonymous_owner_id: "owner-b", module: "body", legacy_access: false },
  }),
  validateAccess,
});
assert.equal(mismatchedBodyOwner.allowed, false, "body client and session owners must match");

const unownedLegacySession = await validateAnalyzeSessionAccess({
  sessionId: "session-a",
  module: "support",
  accessToken: "token-a",
}, {
  supabase: mockSupabase({ sessions: { ...sessionA, legacy_access: true } }),
  validateAccess: async () => true,
});
assert.equal(unownedLegacySession.allowed, false, "legacy access must not bypass session credential validation");

const sessionlessAnalysis = await validateAnalyzeSessionAccess({
  module: "support",
  stage: undefined,
  depth: 0,
});
assert.deepEqual(sessionlessAnalysis, { allowed: true, missingSession: false });

const sessionlessFinalReport = await validateAnalyzeSessionAccess({
  module: "support",
  stage: undefined,
  depth: 3,
});
assert.deepEqual(sessionlessFinalReport, { allowed: false, missingSession: true });

const missingRequiredStageSession = await validateAnalyzeSessionAccess({
  module: "body",
  stage: "daily_log_submitted",
});
assert.deepEqual(missingRequiredStageSession, { allowed: false, missingSession: true });

const requestBody = withSessionAccess({ text: "test" }, { sessionId: "session-a", accessToken: "token-a" });
assert.equal(requestBody.session_id, "session-a");
assert.equal(requestBody.access_token, "token-a");
assert.deepEqual(withSessionAccess({ text: "test" }, { sessionId: "session-a" }), {
  text: "test",
  session_id: "session-a",
});
assert.deepEqual(withSessionAccess({ text: "test" }, null), { text: "test" });

process.env.CLIENT_API_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const { default: analyzeHandler } = await import("../api/analyze.js");
const { default: clientTokenHandler } = await import("../api/client-token.js");
const { default: transcribeHandler } = await import("../api/transcribe.js");
const { default: startSessionHandler } = await import("../api/start-session.js");
const { default: sessionHandler } = await import("../api/session.js");
const { default: usageHandler } = await import("../api/usage.js");
const { default: specialistHandler } = await import("../api/specialist.js");
const { default: expertsHandler } = await import("../api/experts.js");
const { default: adminHandler } = await import("../api/admin.js");
const { default: reviewsHandler } = await import("../api/reviews.js");
const { generateClientToken } = await import("../lib/security/client-token.js");
globalThis.setInterval = originalSetInterval;

function createApiResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader() {},
  };
}

function createApiRequest(body, token = null) {
  return {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: "127.0.0.1" },
    url: "/api/test",
    body,
  };
}

async function requestAnMedBodyAnalysis(clientTokenModule) {
  const token = generateClientToken("analyze", clientTokenModule).token;
  const response = createApiResponse();
  await analyzeHandler(createApiRequest({ module: "body", stage: "intake_completed", answers: {} }, token), response);
  return response;
}

const originalSupportOnly = process.env.ANMED_SUPPORT_ONLY;
process.env.ANMED_SUPPORT_ONLY = "true";
const supportTokenBodyRequest = await requestAnMedBodyAnalysis("support");
assert.equal(supportTokenBodyRequest.statusCode, 403, "the shared API must reject Body even with a valid Support client token");
const bodyTokenRequest = await requestAnMedBodyAnalysis("body");
assert.equal(bodyTokenRequest.statusCode, 403, "the shared API must reject a Body-scoped client token");

const bodyClientTokenResponse = createApiResponse();
await clientTokenHandler(createApiRequest({ action: "analyze", module: "body" }), bodyClientTokenResponse);
assert.equal(bodyClientTokenResponse.statusCode, 403, "AnMed must not issue Body client tokens");

const transcribeBodyToken = generateClientToken("transcribe", "body").token;
const transcribeResponse = createApiResponse();
await transcribeHandler(createApiRequest(new Uint8Array(), transcribeBodyToken), transcribeResponse);
assert.equal(transcribeResponse.statusCode, 403, "AnMed must reject Body-scoped transcription requests");

const startSessionBodyToken = generateClientToken("analyze", "body").token;
const startSessionResponse = createApiResponse();
await startSessionHandler(createApiRequest({}, startSessionBodyToken), startSessionResponse);
assert.equal(startSessionResponse.statusCode, 403, "AnMed must not accept a Body-scoped token at session start");

const bodySessionActionResponse = createApiResponse();
await sessionHandler(createApiRequest({ action: "getBodyCabinet" }), bodySessionActionResponse);
assert.equal(bodySessionActionResponse.statusCode, 403, "AnMed must reject Body-specific session actions");

const bodyUsageResponse = createApiResponse();
await usageHandler(createApiRequest({ action: "getUsageBalance", sessionId: "HEALTH-ABCD-123", module: "body" }), bodyUsageResponse);
assert.equal(bodyUsageResponse.statusCode, 403, "AnMed must reject Body usage requests");
const healthCodeUsageResponse = createApiResponse();
await usageHandler(createApiRequest({ action: "getUsageBalance", publicCode: "HEALTH-ABCD-123", module: "support" }), healthCodeUsageResponse);
assert.equal(healthCodeUsageResponse.statusCode, 403, "AnMed must reject Health codes even when mislabeled as Support");

const bodySpecialistResponse = createApiResponse();
await specialistHandler(createApiRequest({ action: "listClients", module: "body" }), bodySpecialistResponse);
assert.equal(bodySpecialistResponse.statusCode, 403, "AnMed must reject Body specialist API requests");

const bodyExpertsResponse = createApiResponse();
await expertsHandler(createApiRequest({ action: "listMyPatients", module: "body" }), bodyExpertsResponse);
assert.equal(bodyExpertsResponse.statusCode, 403, "AnMed must reject Body legacy expert API requests");

const bodyAdminResponse = createApiResponse();
await adminHandler(createApiRequest({ action: "listBodyIntake" }), bodyAdminResponse);
assert.equal(bodyAdminResponse.statusCode, 403, "AnMed must reject Body admin API actions");

const bodyReviewsResponse = createApiResponse();
await reviewsHandler(createApiRequest({ action: "save", module: "body" }), bodyReviewsResponse);
assert.equal(bodyReviewsResponse.statusCode, 403, "AnMed must reject Body review API requests");
if (originalSupportOnly === undefined) delete process.env.ANMED_SUPPORT_ONLY;
else process.env.ANMED_SUPPORT_ONLY = originalSupportOnly;

const originalBrand = process.env.VITE_APP_BRAND;
process.env.VITE_APP_BRAND = "pneumointegration";
process.env.ANMED_SUPPORT_ONLY = "true";
const pneumoSupportTokenBodyRequest = await requestAnMedBodyAnalysis("support");
assert.equal(pneumoSupportTokenBodyRequest.statusCode, 403, "Pneumo pilot must reject Body with a valid Support client token");
const pneumoBodyTokenRequest = await requestAnMedBodyAnalysis("body");
assert.equal(pneumoBodyTokenRequest.statusCode, 403, "Pneumo pilot must reject a Body-scoped client token");

const pneumoBodyClientTokenResponse = createApiResponse();
await clientTokenHandler(createApiRequest({ action: "analyze", module: "body" }), pneumoBodyClientTokenResponse);
assert.equal(pneumoBodyClientTokenResponse.statusCode, 403, "Pneumo pilot must not issue Body client tokens");

const pneumoTranscribeBodyToken = generateClientToken("transcribe", "body").token;
const pneumoTranscribeResponse = createApiResponse();
await transcribeHandler(createApiRequest(new Uint8Array(), pneumoTranscribeBodyToken), pneumoTranscribeResponse);
assert.equal(pneumoTranscribeResponse.statusCode, 403, "Pneumo pilot must reject Body-scoped transcription requests");

const pneumoStartSessionBodyToken = generateClientToken("analyze", "body").token;
const pneumoStartSessionResponse = createApiResponse();
await startSessionHandler(createApiRequest({}, pneumoStartSessionBodyToken), pneumoStartSessionResponse);
assert.equal(pneumoStartSessionResponse.statusCode, 403, "Pneumo pilot must not accept a Body-scoped token at session start");

const pneumoBodySessionActionResponse = createApiResponse();
await sessionHandler(createApiRequest({ action: "getBodyCabinet" }), pneumoBodySessionActionResponse);
assert.equal(pneumoBodySessionActionResponse.statusCode, 403, "Pneumo pilot must reject Body-specific session actions");

const pneumoBodyUsageResponse = createApiResponse();
await usageHandler(createApiRequest({ action: "getUsageBalance", sessionId: "HEALTH-ABCD-123", module: "body" }), pneumoBodyUsageResponse);
assert.equal(pneumoBodyUsageResponse.statusCode, 403, "Pneumo pilot must reject Body usage requests");
const pneumoHealthCodeUsageResponse = createApiResponse();
await usageHandler(createApiRequest({ action: "getUsageBalance", publicCode: "HEALTH-ABCD-123", module: "support" }), pneumoHealthCodeUsageResponse);
assert.equal(pneumoHealthCodeUsageResponse.statusCode, 403, "Pneumo pilot must reject Health codes even when mislabeled as Support");

const pneumoBodySpecialistResponse = createApiResponse();
await specialistHandler(createApiRequest({ action: "listClients", module: "body" }), pneumoBodySpecialistResponse);
assert.equal(pneumoBodySpecialistResponse.statusCode, 403, "Pneumo pilot must reject Body specialist API requests");

const pneumoBodyExpertsResponse = createApiResponse();
await expertsHandler(createApiRequest({ action: "listMyPatients", module: "body" }), pneumoBodyExpertsResponse);
assert.equal(pneumoBodyExpertsResponse.statusCode, 403, "Pneumo pilot must reject Body legacy expert API requests");

const pneumoBodyAdminResponse = createApiResponse();
await adminHandler(createApiRequest({ action: "listBodyIntake" }), pneumoBodyAdminResponse);
assert.equal(pneumoBodyAdminResponse.statusCode, 403, "Pneumo pilot must reject Body admin API actions");

const pneumoBodyReviewsResponse = createApiResponse();
await reviewsHandler(createApiRequest({ action: "save", module: "body" }), pneumoBodyReviewsResponse);
assert.equal(pneumoBodyReviewsResponse.statusCode, 403, "Pneumo pilot must reject Body review API requests");
if (originalSupportOnly === undefined) delete process.env.ANMED_SUPPORT_ONLY;
else process.env.ANMED_SUPPORT_ONLY = originalSupportOnly;
if (originalBrand === undefined) delete process.env.VITE_APP_BRAND;
else process.env.VITE_APP_BRAND = originalBrand;

console.log("Analyze session access regression tests passed.");
