// Local API E2E test for continuation credential flow.
// Imports handlers directly and invokes them with mock req/res objects.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTINUATION_SECRET_PEPPER in .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnv(path) {
  try {
    const content = readFileSync(path, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
      }
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv(".env.local");
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
process.env.CONTINUATION_SECRET_PEPPER = env.CONTINUATION_SECRET_PEPPER;

import sessionHandler from "../api/session.js";

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function mockReq(body, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    url: "/api/session",
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
  };
  return res;
}

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message, "got:", JSON.stringify(condition));
    process.exit(1);
  }
  console.log("PASS:", message);
}

async function invokeSessionHandler(body) {
  const req = mockReq(body);
  const res = mockRes();
  await sessionHandler(req, res);
  return { status: res.statusCode, body: res.body };
}

async function cleanup() {
  await supabase.from("continuation_credentials").delete().like("lookup_code", "E2E-%");
  await supabase.from("continuation_failed_attempts").delete().like("attempt_key", "%");
  await supabase.from("sessions").delete().like("session_id", "e2e-%");
}

async function runSupportE2E() {
  console.log("\n--- Support E2E ---");

  const sessionId = `e2e-support-${Date.now()}`;

  // Save support session
  const saveResult = await invokeSessionHandler({
    action: "save",
    sessionId,
    patient_text: "E2E support test",
    user_report: "E2E user report",
    doctor_report: "E2E doctor report",
    riskLevel: "low",
    dialogDepth: 0,
    module: "support",
  });
  assert(saveResult.status === 200, "save returns 200");
  assert(saveResult.body.ok === true, "save returns ok");
  assert(saveResult.body.continuation_code, "save returns continuation_code");
  assert(saveResult.body.access_token, "save returns access_token");

  const continuationCode = saveResult.body.continuation_code;
  const accessToken = saveResult.body.access_token;

  // Exchange continuation code
  const exchangeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "support",
    continuation_code: continuationCode,
  });
  assert(exchangeResult.status === 200, "exchange returns 200");
  assert(exchangeResult.body.ok === true, "exchange returns ok");
  assert(exchangeResult.body.access_token, "exchange returns new access_token");
  assert(exchangeResult.body.cabinet, "exchange returns cabinet");
  assert(!exchangeResult.body.anonymous_owner_id, "exchange does not leak anonymous_owner_id");
  assert(!exchangeResult.body.secret_hash, "exchange does not leak secret_hash");

  const newAccessToken = exchangeResult.body.access_token;

  // Regenerate continuation code using the new access token from exchange
  const regenerateResult = await invokeSessionHandler({
    action: "regenerateContinuationCredential",
    module: "support",
    session_id: sessionId,
    access_token: newAccessToken,
  });
  if (regenerateResult.status !== 200) {
    console.error("regenerate failed:", regenerateResult.status, regenerateResult.body);
  }
  assert(regenerateResult.status === 200, "regenerate returns 200");
  assert(regenerateResult.body.continuation_code, "regenerate returns new continuation_code");

  const newCode = regenerateResult.body.continuation_code;

  // Old code should no longer work
  const oldCodeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "support",
    continuation_code: continuationCode,
  });
  assert(oldCodeResult.status === 401, "old continuation code rejected after rotation");

  // New code should work
  const newCodeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "support",
    continuation_code: newCode,
  });
  if (newCodeResult.status !== 200) {
    console.error("new code exchange failed:", newCodeResult.status, newCodeResult.body);
  }
  assert(newCodeResult.status === 200, "new continuation code works after rotation");

  // Wrong code attempts should not enumerate existence
  const wrongCode = "ТОЧКА-ABCD-ABCD-1234-5678-90AB";
  const wrongStatuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await invokeSessionHandler({
      action: "exchangeContinuationCredential",
      module: "support",
      continuation_code: wrongCode,
    });
    wrongStatuses.push(r.status);
  }
  assert(wrongStatuses.slice(0, 4).every(s => s === 401), "first 4 wrong attempts return 401");
  assert(wrongStatuses[5] === 429, "6th wrong attempt returns 429");

  console.log("Support E2E passed");
}

async function runHealthE2E() {
  console.log("\n--- Health E2E ---");

  const sessionId = `e2e-health-${Date.now()}`;
  const ownerId = crypto.randomUUID();

  // Insert a body credential directly (simulating first intake completion)
  const { data: credential, error: credError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "body",
      owner_type: "anonymous_profile",
      owner_id: ownerId,
      lookup_code: `E2E-HEALTH-${Date.now()}`,
      secret_hash: "deadbeef",
      secret_version: 1,
    })
    .select("lookup_code")
    .single();

  assert(!credError && credential, "body credential inserted");

  // Also create a body_clients row
  await supabase.from("body_clients").insert({
    session_id: sessionId,
    anonymous_owner_id: ownerId,
    source: "self_signup",
    status: "active",
  });

  // Exchange body code (wrong secret)
  const wrongCodeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: `HEALTH-ABCD-ABC-1234-5678-90AB`,
  });
  assert(wrongCodeResult.status === 401, "wrong body code returns 401");

  console.log("Health E2E passed");
}

import crypto from "crypto";

(async () => {
  await cleanup();
  try {
    await runSupportE2E();
    await runHealthE2E();
    console.log("\n=== All continuation E2E tests passed ===");
  } finally {
    await cleanup();
  }
})().catch(err => {
  console.error("E2E error:", err);
  process.exit(1);
});
