import assert from "node:assert/strict";
import specialistHandler from "../api/specialist.js";

const ENV_KEYS = [
  "ANMED_SUPPORT_ONLY",
  "DEPLOYMENT_PURPOSE",
  "MEDICAL_STAGING_ALLOWED_SUPABASE_REF",
  "MEDICAL_STAGING_NO_PATIENT_DATA",
  "MY_PRACTICE_REQUIRE_TEST_DB",
  "MY_PRACTICE_SERVER_ENABLED",
  "SUPABASE_LOCAL_REHEARSAL",
  "SUPABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_PROJECT_ID",
  "VITE_APP_BRAND",
];
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(action, module) {
  const res = response();
  await specialistHandler({
    method: "POST",
    url: "/api/specialist",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    body: { action, module },
  }, res);
  return res;
}

function configureLocalRehearsal(enabled) {
  for (const key of [
    "DEPLOYMENT_PURPOSE",
    "MEDICAL_STAGING_ALLOWED_SUPABASE_REF",
    "MY_PRACTICE_REQUIRE_TEST_DB",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_PROJECT_ID",
  ]) delete process.env[key];
  process.env.ANMED_SUPPORT_ONLY = "false";
  process.env.MEDICAL_STAGING_NO_PATIENT_DATA = "false";
  process.env.MY_PRACTICE_SERVER_ENABLED = enabled ? "true" : "false";
  process.env.SUPABASE_LOCAL_REHEARSAL = "1";
  process.env.SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.VITE_APP_BRAND = "tochka-opory";
}

try {
  configureLocalRehearsal(true);
  for (const module of ["support", "body"]) {
    for (const action of ["listMedicalEncounters", "saveMedicalEncounter"]) {
      const res = await invoke(action, module);
      assert.equal(res.statusCode, 401,
        `${action}/${module} must reach specialist authorization without a runtime ReferenceError`);
      assert.equal(res.body?.error, "Требуется авторизация");
    }
    const draft = await invoke("getPatientDraftSummary", module);
    assert.equal(draft.statusCode, 401,
      `patient draft/${module} must share the working server gate`);
  }

  configureLocalRehearsal(false);
  for (const module of ["support", "body"]) {
    for (const action of ["listMedicalEncounters", "saveMedicalEncounter", "getPatientDraftSummary"]) {
      const res = await invoke(action, module);
      assert.equal(res.statusCode, 404,
        `${action}/${module} must fail closed while My Practice server mode is disabled`);
    }
  }

  console.log("PASS A5 runtime route: Support/Health handlers resolve the canonical feature gate and fail closed.");
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// The real specialist handler imports the shared in-memory rate limiter, whose
// cleanup interval intentionally stays alive in a serverless runtime.
process.exit(0);
