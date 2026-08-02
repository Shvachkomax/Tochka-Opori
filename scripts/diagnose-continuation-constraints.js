// Diagnostic script: check continuation_credentials constraints and data.
// Reads .env.local, uses service role to query schema and data.
// Reports only fingerprints and counts — no raw secrets, tokens, or PII.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import crypto from "crypto";

function loadEnv(path) {
  try {
    const content = readFileSync(path, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
    return env;
  } catch { return {}; }
}

function fp(value) {
  if (!value) return "none";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

const env = loadEnv(".env.local");
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log("=== Continuation Credentials Diagnostic ===\n");

  // 1. Check UNIQUE constraints via information_schema
  const { data: constraints, error: cErr } = await supabase.rpc("exec_sql", {
    query: `
      SELECT conname, contype, conkey::text
      FROM pg_constraint
      WHERE conrelid = 'continuation_credentials'::regclass
        AND contype IN ('u', 'p')
      ORDER BY conname;
    `
  }).catch(() => ({ data: null, error: { message: "rpc not available" } }));

  // Fallback: query information_schema directly
  let uniqueConstraints = [];
  if (cErr || !constraints) {
    const { data: idx } = await supabase
      .from("pg_indexes")
      .select("indexname, indexdef")
      .eq("tablename", "continuation_credentials")
      .like("indexname", "%unique%");

    // Also check via raw query if available
    const { data: rawConstraints } = await supabase.rpc("exec_sql", {
      query: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'continuation_credentials' AND indexname LIKE '%unique%';`
    }).catch(() => ({ data: null }));

    uniqueConstraints = rawConstraints || idx || [];
  } else {
    uniqueConstraints = constraints;
  }

  console.log("1. UNIQUE CONSTRAINTS on continuation_credentials:");
  if (Array.isArray(uniqueConstraints) && uniqueConstraints.length > 0) {
    for (const c of uniqueConstraints) {
      console.log(`   - ${c.conname || c.indexname}: ${c.contype || c.indexdef || ""}`);
    }
  } else {
    console.log("   (query returned no results — check manually in Supabase dashboard)");
  }

  // 2. Total credential count
  const { count: totalCount } = await supabase
    .from("continuation_credentials")
    .select("*", { count: "exact", head: true });
  console.log(`\n2. Total credentials: ${totalCount}`);

  // 3. Credentials per module
  const { data: moduleCounts } = await supabase
    .from("continuation_credentials")
    .select("module")
    .limit(10000);

  const byModule = {};
  for (const row of moduleCounts || []) {
    byModule[row.module] = (byModule[row.module] || 0) + 1;
  }
  console.log("\n3. Credentials by module:");
  for (const [mod, count] of Object.entries(byModule)) {
    console.log(`   - ${mod}: ${count}`);
  }

  // 4. Check for owners with multiple credentials
  const { data: ownerGroups } = await supabase
    .from("continuation_credentials")
    .select("owner_type, owner_id")
    .limit(10000);

  const ownerCounts = {};
  for (const row of ownerGroups || []) {
    const key = `${row.owner_type}:${row.owner_id}`;
    ownerCounts[key] = (ownerCounts[key] || 0) + 1;
  }

  const duplicates = Object.entries(ownerCounts).filter(([, count]) => count > 1);
  console.log(`\n4. Owners with multiple credentials: ${duplicates.length}`);
  if (duplicates.length > 0) {
    for (const [key, count] of duplicates.slice(0, 10)) {
      const [ownerType, ownerId] = key.split(":");
      console.log(`   - ${ownerType} owner_fingerprint:${fp(ownerId)} count:${count}`);
    }
    if (duplicates.length > 10) {
      console.log(`   ... and ${duplicates.length - 10} more`);
    }
  }

  // 5. Active (non-revoked) credentials per owner
  const { data: activeRows } = await supabase
    .from("continuation_credentials")
    .select("owner_type, owner_id, lookup_code, revoked_at, secret_version")
    .is("revoked_at", null)
    .limit(10000);

  const activeByOwner = {};
  for (const row of activeRows || []) {
    const key = `${row.owner_type}:${row.owner_id}`;
    if (!activeByOwner[key]) activeByOwner[key] = [];
    activeByOwner[key].push({
      lookup_fingerprint: fp(row.lookup_code),
      secret_version: row.secret_version,
    });
  }

  const multiActive = Object.entries(activeByOwner).filter(([, creds]) => creds.length > 1);
  console.log(`\n5. Owners with MULTIPLE ACTIVE credentials: ${multiActive.length}`);
  if (multiActive.length > 0) {
    for (const [key, creds] of multiActive.slice(0, 10)) {
      const [ownerType, ownerId] = key.split(":");
      console.log(`   - ${ownerType} owner_fingerprint:${fp(ownerId)} active_count:${creds.length}`);
      for (const c of creds) {
        console.log(`     lookup:${c.lookup_fingerprint} v${c.secret_version}`);
      }
    }
  }

  // 6. Revoked credentials count
  const { count: revokedCount } = await supabase
    .from("continuation_credentials")
    .select("*", { count: "exact", head: true })
    .not("revoked_at", "is", null);
  console.log(`\n6. Revoked credentials: ${revokedCount || 0}`);

  // 7. Schema columns check
  const { data: columns } = await supabase.rpc("exec_sql", {
    query: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'continuation_credentials' ORDER BY ordinal_position;`
  }).catch(() => ({ data: null }));

  if (columns) {
    console.log("\n7. Schema columns:");
    for (const col of columns) {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    }
  }

  console.log("\n=== Diagnostic complete ===");
})().catch(err => {
  console.error("Diagnostic error:", err.message);
  process.exit(1);
});
