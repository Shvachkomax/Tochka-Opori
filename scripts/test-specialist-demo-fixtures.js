// API isolation checks for the deterministic specialist manual-E2E fixtures.
// Requires TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY.

const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";
const SUPPORT_CODE = "DEMO-SUP-C1-ISOLATION";
const HEALTH_CODE = "DEMO-HLT-C1-ISOLATION";
const SUPPORT_OWNER = "c1000000-0000-4000-8000-000000000011";
const BODY_OWNER = "c1000000-0000-4000-8000-000000000012";

const url = process.env.TEST_SUPABASE_URL || "";
const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
if (ref !== TEST_PROJECT_REF) throw new Error(`Refusing non-TEST project: ${ref || "unknown"}`);
if (!key) throw new Error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY");

process.env.SUPABASE_URL = url;
process.env.SUPABASE_SERVICE_ROLE_KEY = key;

const { default: specialistHandler } = await import("../api/specialist.js");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

function invoke(body, cookie = null) {
  return new Promise(async (resolve) => {
    const headers = {
      "content-type": "application/json",
      origin: "https://tochka-opori.online",
    };
    if (cookie) headers.cookie = cookie;
    const req = { method: "POST", headers, socket: { remoteAddress: "127.0.0.1" }, body };
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      json(data) { this.body = data; resolve({ status: this.statusCode, headers: this.headers, body: data }); },
    };
    await specialistHandler(req, res);
  });
}

function cookieFromLogin(result) {
  const setCookie = result.headers["Set-Cookie"] || result.headers["set-cookie"];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return value?.split(";")[0] || null;
}

async function login(code) {
  const result = await invoke({ action: "login", access_code: code });
  assert(result.status === 200 && result.body?.ok, `${code} login succeeds`);
  return cookieFromLogin(result);
}

console.log(`\n=== Specialist Demo Fixture API Isolation (${TEST_PROJECT_REF}) ===\n`);

const supportCookie = await login(SUPPORT_CODE);
const healthCookie = await login(HEALTH_CODE);

const supportClients = await invoke({ action: "listClients", organization_id: null, module: "support" }, supportCookie);
assert(supportClients.status === 200 && supportClients.body.clients?.length === 1, "Support sees exactly one Support client");
assert(supportClients.body.clients?.[0]?.display_name === "Demo Support Client", "Support client label is correct");

const supportBodyClients = await invoke({ action: "listClients", organization_id: null, module: "body" }, supportCookie);
assert(supportBodyClients.status === 403, "Support-only specialist is denied Body clients");

const healthClients = await invoke({ action: "listClients", organization_id: null, module: "body" }, healthCookie);
assert(healthClients.status === 200 && healthClients.body.clients?.length === 1, "Health sees exactly one Health client");
assert(healthClients.body.clients?.[0]?.display_name === "Demo Health Client", "Health client label is correct");

const healthSupportClients = await invoke({ action: "listClients", organization_id: null, module: "support" }, healthCookie);
assert(healthSupportClients.status === 403, "Health-only specialist is denied Support clients");

const supportRequests = await invoke({ action: "listServiceRequests", module: "support" }, supportCookie);
assert(supportRequests.status === 200 && supportRequests.body.requests?.length === 1, "Support sees only Support request");
assert(supportRequests.body.requests?.[0]?.module === "support", "Support request module is Support");

const supportBodyRequests = await invoke({ action: "listServiceRequests", module: "body" }, supportCookie);
assert(supportBodyRequests.status === 403, "Support-only specialist is denied Body requests");

const healthRequests = await invoke({ action: "listServiceRequests", module: "body" }, healthCookie);
assert(healthRequests.status === 200 && healthRequests.body.requests?.length === 1, "Health sees only Health request");
assert(healthRequests.body.requests?.[0]?.module === "body", "Health request module is Body");

const healthSupportRequests = await invoke({ action: "listServiceRequests", module: "support" }, healthCookie);
assert(healthSupportRequests.status === 403, "Health-only specialist is denied Support requests");

const healthClientRef = healthClients.body.clients?.[0]?.client_ref;
const bodyDetail = await invoke({ action: "getBodyClientOverview", client_ref: healthClientRef, organization_id: null, module: "body" }, healthCookie);
assert(bodyDetail.status === 200 && bodyDetail.body.client?.display_name === "Demo Health Client", "Health detail is readable");
assert(bodyDetail.body.recent_days?.length === 1, "Health detail contains synthetic diary data");

const supportBodyDetail = await invoke({ action: "getBodyClientOverview", client_ref: healthClientRef, organization_id: null, module: "body" }, supportCookie);
assert(supportBodyDetail.status === 403, "Support cannot open Health detail");

const healthMedication = await invoke({ action: "listMedicationConcepts", organization_id: null, module: "body" }, healthCookie);
assert(healthMedication.status === 403, "Health medication runtime remains disabled");

const supportClientRef = supportClients.body.clients?.[0]?.client_ref;
const supportMedication = await invoke({ action: "listPatientMedicationOrders", client_ref: supportClientRef, organization_id: null, module: "support" }, supportCookie);
assert(supportMedication.status === 200 && supportMedication.body.can_manage === false, "Support read-only medication path remains non-prescribing");

if (supportCookie) await invoke({ action: "logout" }, supportCookie);
if (healthCookie) await invoke({ action: "logout" }, healthCookie);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
