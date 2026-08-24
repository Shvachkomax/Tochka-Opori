// Local API E2E test for continuation credential flow.
// Imports handlers directly and invokes them with mock req/res objects.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTINUATION_SECRET_PEPPER in .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { generateContinuationCredential, formatContinuationCredential } from "../lib/session/continuation-credential.js";

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
  const { data: sessions } = await supabase
    .from("sessions")
    .select("anonymous_owner_id, module")
    .like("session_id", "e2e-%");
  for (const session of sessions || []) {
    if (!session.anonymous_owner_id) continue;
    const ownerType = session.module === "body" ? "anonymous_profile" : "anonymous_case";
    const { data: wallets } = await supabase
      .from("usage_wallets")
      .select("id")
      .eq("owner_type", ownerType)
      .eq("owner_id", session.anonymous_owner_id)
      .eq("module", session.module || "support");
    for (const wallet of wallets || []) {
      const reservations = await supabase.from("usage_reservations").delete().eq("wallet_id", wallet.id);
      if (reservations.error && !["PGRST205", "42P01"].includes(reservations.error.code)) throw reservations.error;
      await supabase.from("usage_ledger").delete().eq("wallet_id", wallet.id);
      await supabase.from("usage_wallets").delete().eq("id", wallet.id);
    }
  }
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

  // Generate a proper body credential
  const generated = generateContinuationCredential("body");

  // Insert a body credential directly (simulating first intake completion)
  const { data: credential, error: credError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "body",
      owner_type: "anonymous_profile",
      owner_id: ownerId,
      lookup_code: generated.lookupCode,
      secret_hash: generated.secretHash,
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

  // Ensure wallet exists for the owner so usage_balance can be returned
  const { ensureWallet, setWalletVisible } = await import("../lib/usage/wallet.js");
  const wallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId, module: "body" });
  assert(wallet, "wallet created for body owner");
  await setWalletVisible({ walletId: wallet.id });

  const fullCode = formatContinuationCredential("body", generated.lookupCode, generated.secret);

  // Exchange body code with correct secret
  const exchangeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: fullCode,
  });
  assert(exchangeResult.status === 200, "correct body code returns 200");
  assert(exchangeResult.body.ok === true, "correct body exchange returns ok");
  assert(exchangeResult.body.session_id === sessionId, "exchange returns the same session_id");
  assert(exchangeResult.body.access_token, "exchange returns new access_token");
  assert(exchangeResult.body.usage_balance && exchangeResult.body.usage_balance.visible, "exchange returns usage_balance");
  assert(!exchangeResult.body.anonymous_owner_id, "exchange does not leak anonymous_owner_id");

  // Use returned access_token to fetch usage balance via handler
  const usageHandler = (await import("../api/usage.js")).default;
  const usageReq = mockReq({ action: "getUsageBalance", sessionId: exchangeResult.body.session_id, module: "body", access_token: exchangeResult.body.access_token });
  const usageRes = mockRes();
  await usageHandler(usageReq, usageRes);
  const usageData = usageRes.body;
  assert(usageData.ok && usageData.visible, "usage balance readable with new access_token");

  // Exchange body code (wrong secret)
  const wrongCodeResult = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: `HEALTH-ABCD-ABC-1234-5678-90AB`,
  });
  assert(wrongCodeResult.status === 401, "wrong body code returns 401");

  console.log("Health E2E passed");
}

async function runBodyRotationE2E() {
  console.log("\n--- Body Rotation E2E ---");

  const sessionId = `e2e-body-rot-${Date.now()}`;
  const ownerId = crypto.randomUUID();

  // Create credential and body_clients row
  const generated = generateContinuationCredential("body");
  const { data: credential } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "body",
      owner_type: "anonymous_profile",
      owner_id: ownerId,
      lookup_code: generated.lookupCode,
      secret_hash: generated.secretHash,
      secret_version: 1,
    })
    .select("id, lookup_code")
    .single();

  assert(credential, "credential created");

  await supabase.from("body_clients").insert({
    session_id: sessionId,
    anonymous_owner_id: ownerId,
    source: "self_signup",
    status: "active",
  });

  // Also create a sessions row so validateSessionAccess works
  await supabase.from("sessions").insert({
    session_id: sessionId,
    module: "body",
    anonymous_owner_id: ownerId,
    public_code: `E2E-${Date.now()}`,
    patient_text: "",
    conversation_history: [],
    json_data: {},
    legacy_access: false,
  });

  // Generate access token for the session
  const { generateSessionAccessToken } = await import("../lib/security/access-token.js");
  const accessToken = await generateSessionAccessToken(sessionId, {
    module: "body",
    anonymousOwnerId: ownerId,
    publicCode: `E2E-${Date.now()}`,
  });
  assert(accessToken, "access token generated");

  // Ensure wallet
  const { ensureWallet, setWalletVisible } = await import("../lib/usage/wallet.js");
  const wallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId, module: "body" });
  assert(wallet, "wallet created");
  await setWalletVisible({ walletId: wallet.id });

  const oldCode = formatContinuationCredential("body", generated.lookupCode, generated.secret);

  // A. Exchange old code → 200
  const exchange1 = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: oldCode,
  });
  assert(exchange1.status === 200, "A: exchange old code → 200");

  // B. Rotate with valid access token → 200
  const rotateResult = await invokeSessionHandler({
    action: "regenerateContinuationCredential",
    module: "body",
    session_id: sessionId,
    access_token: accessToken,
  });
  assert(rotateResult.status === 200, "B: rotate → 200");
  assert(rotateResult.body.continuation_code, "B: rotation returns continuation_code");

  const newCode = rotateResult.body.continuation_code;

  // C. Exchange old code → 401 (rejected)
  const exchangeOld = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: oldCode,
  });
  assert(exchangeOld.status === 401, "C: old code rejected after rotation");

  // D. Exchange new code → 200
  const exchangeNew = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: newCode,
  });
  assert(exchangeNew.status === 200, "D: new code works after rotation");

  // E. Owner fingerprint matches
  assert(exchangeNew.body.session_id === sessionId, "E: same session_id returned");

  // F. Credential count for owner = 1
  const { count } = await supabase
    .from("continuation_credentials")
    .select("*", { count: "exact", head: true })
    .eq("owner_type", "anonymous_profile")
    .eq("owner_id", ownerId);
  assert(count === 1, `F: exactly 1 credential for owner (got ${count})`);

  // G. Balance unchanged (wallet was created with default balance)
  const { data: walletAfter } = await supabase
    .from("usage_wallets")
    .select("balance")
    .eq("owner_id", ownerId)
    .eq("module", "body")
    .maybeSingle();
  assert(walletAfter?.balance === wallet.balance, "G: balance unchanged");

  // H. Parallel rotation safety — second rotate should still produce exactly 1 credential
  const rotate2 = await invokeSessionHandler({
    action: "regenerateContinuationCredential",
    module: "body",
    session_id: sessionId,
    access_token: accessToken,
  });
  assert(rotate2.status === 200, "H: second rotation succeeds");

  const { count: countAfter2 } = await supabase
    .from("continuation_credentials")
    .select("*", { count: "exact", head: true })
    .eq("owner_type", "anonymous_profile")
    .eq("owner_id", ownerId);
  assert(countAfter2 === 1, `H: still 1 credential after second rotation (got ${countAfter2})`);

  // I. Third rotation's code works
  const exchangeThird = await invokeSessionHandler({
    action: "exchangeContinuationCredential",
    module: "body",
    continuation_code: rotate2.body.continuation_code,
  });
  assert(exchangeThird.status === 200, "I: third rotation code works");

  console.log("Body Rotation E2E passed");
}

import crypto from "crypto";

(async () => {
  await cleanup();
  try {
    await runSupportE2E();
    await runHealthE2E();
    await runBodyRotationE2E();
    console.log("\n=== All continuation E2E tests passed ===");
  } finally {
    await cleanup();
  }
})().catch(err => {
  console.error("E2E error:", err);
  process.exit(1);
});
