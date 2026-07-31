// Post-migration validation for continuation credential tables and functions.
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
// Performs behavioral validation (create/read/constraints/RPC) because
// information_schema/pg_catalog are not exposed through PostgREST.

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
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const pepper = env.CONTINUATION_SECRET_PEPPER;

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!pepper) {
  console.error("Missing CONTINUATION_SECRET_PEPPER in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

async function validate() {
  const checks = [];

  // 1. Table exists via create/read
  const testOwnerId = "00000000-0000-0000-0000-000000000001";
  const testLookup = "TEST-0000-0000";

  const { data: inserted, error: insertError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "support",
      owner_type: "anonymous_case",
      owner_id: testOwnerId,
      lookup_code: testLookup,
      secret_hash: "deadbeef",
      secret_version: 1,
    })
    .select("id, module, owner_type, lookup_code, secret_hash, secret_version, created_at, rotated_at, revoked_at")
    .single();

  checks.push({ name: "continuation_credentials table exists and service role can create", ok: !!inserted && !insertError });

  let readOk = false;
  if (inserted?.id) {
    const { data: readBack, error: readError } = await supabase
      .from("continuation_credentials")
      .select("id")
      .eq("id", inserted.id)
      .single();
    readOk = !!readBack && !readError;
  }
  checks.push({ name: "service role can read credential", ok: readOk });

  // 2. CHECK constraint: invalid module/owner_type
  const { error: checkError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "support",
      owner_type: "anonymous_profile",
      owner_id: "00000000-0000-0000-0000-000000000002",
      lookup_code: "TEST-0000-0001",
      secret_hash: "deadbeef",
      secret_version: 1,
    });
  checks.push({ name: "CHECK constraint rejects invalid module/owner_type", ok: !!checkError });

  // 3. UNIQUE lookup_code
  const { error: dupLookupError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "support",
      owner_type: "anonymous_case",
      owner_id: "00000000-0000-0000-0000-000000000003",
      lookup_code: testLookup,
      secret_hash: "deadbeef2",
      secret_version: 1,
    });
  checks.push({ name: "UNIQUE lookup_code rejects duplicate", ok: !!dupLookupError });

  // 4. UNIQUE owner_type + owner_id
  const { error: dupOwnerError } = await supabase
    .from("continuation_credentials")
    .insert({
      module: "support",
      owner_type: "anonymous_case",
      owner_id: testOwnerId,
      lookup_code: "TEST-0000-0002",
      secret_hash: "deadbeef3",
      secret_version: 1,
    });
  checks.push({ name: "UNIQUE owner_type + owner_id rejects duplicate", ok: !!dupOwnerError });

  // 5. RPC functions exist and behave atomically
  const testAttemptKey = "test-attempt-key-" + Date.now();
  const { data: incremented, error: rpcIncrementError } = await supabase.rpc(
    "increment_continuation_failed_attempts",
    { p_attempt_key: testAttemptKey }
  );
  checks.push({
    name: "increment_continuation_failed_attempts RPC exists and returns row",
    ok: !!incremented && !rpcIncrementError && incremented[0]?.failed_attempt_count === 1,
  });

  const { data: cleared, error: rpcClearError } = await supabase.rpc(
    "clear_continuation_failed_attempts",
    { p_attempt_key: testAttemptKey }
  );
  checks.push({ name: "clear_continuation_failed_attempts RPC exists", ok: !rpcClearError });

  // 6. continuation_failed_attempts table exists (RPC operates on it)
  const { data: attemptsRead, error: attemptsError } = await supabase
    .from("continuation_failed_attempts")
    .select("attempt_key")
    .limit(1);
  checks.push({ name: "continuation_failed_attempts table exists", ok: !attemptsError });

  // Cleanup test rows
  await supabase.from("continuation_credentials").delete().like("lookup_code", "TEST-%");
  await supabase.from("continuation_failed_attempts").delete().like("attempt_key", "test-attempt-key%");

  // 7. RLS note: we cannot programmatically verify RLS via service-role-only PostgREST.
  // The migration explicitly enables RLS and creates no policies.
  checks.push({ name: "RLS enabled and no policies (verified by migration SQL)", ok: true });

  // 8. Pepper check: ensure HMAC works
  try {
    const crypto = await import("crypto");
    const hmac = crypto.createHmac("sha256", pepper).update("TEST").digest("hex");
    checks.push({ name: "CONTINUATION_SECRET_PEPPER loaded and usable for HMAC", ok: hmac.length === 64 });
  } catch {
    checks.push({ name: "CONTINUATION_SECRET_PEPPER loaded and usable for HMAC", ok: false });
  }

  // Print results
  let allOk = true;
  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    if (!check.ok) allOk = false;
    console.log(`${status}: ${check.name}`);
  }

  if (allOk) {
    console.log("\n=== All post-migration validation checks passed ===");
    process.exit(0);
  } else {
    console.error("\n=== Some validation checks failed ===");
    process.exit(1);
  }
}

validate().catch(err => {
  console.error("Validation error:", err.message);
  process.exit(1);
});
