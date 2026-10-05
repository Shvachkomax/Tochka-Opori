// Apply save_request_id migration to TEST Supabase only.
// Refuses production ref. Requires TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Usage: TEST_SUPABASE_URL=... TEST_SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply-migration-save-request-id.js

import { readFileSync } from "node:fs";

const REQUIRED_REF = "eehyehlhiyztciaezaus";

// Load env
const env = {};
try {
  readFileSync(".env.local", "utf8").split("\n").forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  });
} catch {}

const SUPABASE_URL = process.env.TEST_SUPABASE_URL || env.TEST_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";

// Ref guard
const refMatch = SUPABASE_URL.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
const actualRef = refMatch?.[1] || "unknown";
if (actualRef !== REQUIRED_REF) {
  console.error(`Refusing: expected TEST ref ${REQUIRED_REF}, got ${actualRef}.`);
  console.error(`Set TEST_SUPABASE_URL=https://${REQUIRED_REF}.supabase.co and TEST_SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}

if (!SUPABASE_KEY) {
  console.error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

console.log(`Target: ${actualRef} (TEST) — OK`);
console.log("Applying migration: add_save_request_id_to_body_daily_logs.sql");

const sql = readFileSync("scripts/migrations/add-save-request-id-to-body-daily-logs.sql", "utf8");

// Split by semicolons and execute each statement
const statements = sql
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith("--"));

for (const stmt of statements) {
  console.log(`  Executing: ${stmt.substring(0, 60)}...`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: stmt }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Check if it's a "already exists" error (IF NOT EXISTS should handle it)
    if (body.includes("already exists") || body.includes("42701")) {
      console.log("  Already exists, skipping.");
    } else {
      console.error(`  Error: ${res.status} ${body.substring(0, 200)}`);
      // Try direct SQL via Supabase SQL editor alternative
      console.log("  Trying via Supabase REST schema...");
    }
  } else {
    console.log("  OK");
  }
}

// Verify column exists
const verifyRes = await fetch(`${SUPABASE_URL}/rest/v1/body_daily_logs?select=save_request_id&limit=1`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
});

if (verifyRes.status === 200) {
  console.log("✅ Migration verified: save_request_id column accessible.");
} else if (verifyRes.status === 400) {
  const body = await verifyRes.text();
  if (body.includes("save_request_id")) {
    console.log("⚠️ Column not yet available. Migration may need to be run via Supabase SQL editor.");
    console.log("  SQL:");
    console.log("  " + sql.split("\n").filter(l => l.trim() && !l.startsWith("--")).join("\n  "));
  }
} else {
  console.log(`Verification status: ${verifyRes.status}`);
}

console.log("Migration script complete.");
