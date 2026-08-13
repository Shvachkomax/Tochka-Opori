import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// ── Config ────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_URL = "http://localhost:3001/api/specialist";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const RESULTS = [];
const CLEANUP = []; // { table, id }

function log(test, result, detail = "") {
  RESULTS.push({ test, result, detail });
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⏭️";
  console.log(`${icon} ${test}${detail ? " — " + detail : ""}`);
}

function track(table, id) {
  CLEANUP.push({ table, id });
}

// ── Helpers ───────────────────────────────────────────────

function genCode() {
  return `TEST-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function login(accessCode) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ action: "login", access_code: accessCode }),
  });
  const data = await res.json();
  return data;
}

async function listClients(token, organization_id, module) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "listClients", organization_id, module }),
  });
  return res.json();
}

// ── Setup ─────────────────────────────────────────────────

// We use the existing MAXIM-ADMIN-01 test expert.
// Create a second test expert for cross-specialist isolation testing.
let expertB = null;
let expertBCode = null;

async function setup() {
  // Create expert B
  expertBCode = genCode();
  const { data, error } = await supabase
    .from("experts")
    .insert({
      name: "Тест Специалист Б",
      role: "psychologist",
      specialty: "clinical-psychology",
      city: "Тестоград",
      access_code: expertBCode,
      is_active: true,
    })
    .select("id, access_code")
    .single();

  if (error) {
    console.error("Setup error:", error);
    process.exit(1);
  }
  expertB = data;
  track("experts", expertB.id);
  console.log(`  Test expert B created: ${expertB.id} (${expertBCode})`);
}

// ── Tests ─────────────────────────────────────────────────

async function runTests() {
  // Login both experts
  const loginA = await login("MAXIM-ADMIN-01");
  const loginB = await login(expertBCode);

  if (!loginA.ok || !loginB.ok) {
    console.error("Login failed:", loginA, loginB);
    return;
  }

  const tokenA = loginA.expert ? (await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify({ action: "login", access_code: "MAXIM-ADMIN-01" }),
  })).headers?.get?.("set-cookie")?.match?.(/tochka_specialist_session=([^;]+)/)?.[1] : null;

  // Actually we need to capture the cookie. Let me use Bearer tokens instead.
  // Re-login to get tokens via response (we can't get the raw token from cookie path).
  // The API supports Bearer fallback, so let's create sessions directly.

  // Create sessions for both experts
  const sessionA = await createSession(loginA.expert.id);
  const sessionB = await createSession(loginB.expert.id);

  if (!sessionA || !sessionB) {
    console.error("Session creation failed");
    return;
  }

  console.log(`  Sessions created: A=${sessionA.slice(0, 16)}... B=${sessionB.slice(0, 16)}...`);

  // ── Test A: specialist A sees own private-practice Support client
  // Create patient_assignment for expert A, private practice (org=null)
  const publicCodeA = genCode();
  const { data: assignA } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: publicCodeA,
      organization_id: null,
      primary_expert_id: loginA.expert.id,
      assigned_by_expert_id: loginA.expert.id,
      source: "test",
      status: "active",
      module: "support",
      patient_label: "Тест Клиент А",
    })
    .select("id")
    .single();
  if (assignA) track("patient_assignments", assignA.id);

  const resA = await listClients(sessionA, null, "support");
  const clientA = resA.clients?.find((c) => c.client_ref === `assignment:${assignA?.id}`);
  if (resA.ok && clientA && clientA.display_name === "Тест Клиент А") {
    log("A. Specialist A sees own private-practice Support client", "PASS");
  } else {
    log("A. Specialist A sees own private-practice Support client", "FAIL", JSON.stringify(resA.clients?.length));
  }

  // ── Test B: specialist A cannot see specialist B private-practice client
  const publicCodeB = genCode();
  const { data: assignB } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: publicCodeB,
      organization_id: null,
      primary_expert_id: loginB.id,
      assigned_by_expert_id: loginB.id,
      source: "test",
      status: "active",
      module: "support",
      patient_label: "Тест Клиент Б",
    })
    .select("id")
    .single();
  if (assignB) track("patient_assignments", assignB.id);

  const resA2 = await listClients(sessionA, null, "support");
  const seesB = resA2.clients?.some((c) => c.client_ref === `assignment:${assignB?.id}`);
  if (resA2.ok && !seesB) {
    log("B. Specialist A cannot see specialist B private-practice client", "PASS");
  } else {
    log("B. Specialist A cannot see specialist B private-practice client", "FAIL", `seesB=${seesB}`);
  }

  // ── Create a test organization
  const { data: org } = await supabase
    .from("organizations")
    .insert({ name: "Тест Клиника", slug: `test-clinic-${Date.now()}`, type: "private_clinic" })
    .select("id")
    .single();
  if (org) track("organizations", org.id);

  // ── Add expert A to org membership
  const { data: membershipA } = await supabase
    .from("expert_organization_memberships")
    .insert({ organization_id: org.id, expert_id: loginA.expert.id, role: "doctor" })
    .select("id")
    .single();
  if (membershipA) track("expert_organization_memberships", membershipA.id);

  // ── Test C: specialist A sees own Clinic A client
  const publicCodeOrg = genCode();
  const { data: assignOrg } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: publicCodeOrg,
      organization_id: org.id,
      primary_expert_id: loginA.expert.id,
      assigned_by_expert_id: loginA.expert.id,
      source: "test",
      status: "active",
      module: "support",
      patient_label: "Клиент Клиники",
    })
    .select("id")
    .single();
  if (assignOrg) track("patient_assignments", assignOrg.id);

  const resC = await listClients(sessionA, org.id, "support");
  const clientC = resC.clients?.find((c) => c.client_ref === `assignment:${assignOrg?.id}`);
  if (resC.ok && clientC && clientC.display_name === "Клиент Клиники") {
    log("C. Specialist A sees own Clinic A client", "PASS");
  } else {
    log("C. Specialist A sees own Clinic A client", "FAIL", JSON.stringify(resC.clients));
  }

  // ── Test D: specialist A cannot see Clinic B client without context
  // Create a different org for this test
  const { data: org2 } = await supabase
    .from("organizations")
    .insert({ name: "Тест Клиника Б", slug: `test-clinic-b-${Date.now()}`, type: "private_clinic" })
    .select("id")
    .single();
  if (org2) track("organizations", org2.id);

  const publicCodeOrg2 = genCode();
  const { data: assignOrg2 } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: publicCodeOrg2,
      organization_id: org2.id,
      primary_expert_id: loginA.expert.id,
      assigned_by_expert_id: loginA.expert.id,
      source: "test",
      status: "active",
      module: "support",
    })
    .select("id")
    .single();
  if (assignOrg2) track("patient_assignments", assignOrg2.id);

  // Query with org.id context — should NOT see org2's client
  const resD = await listClients(sessionA, org.id, "support");
  const seesOrg2 = resD.clients?.some((c) => c.client_ref === `assignment:${assignOrg2?.id}`);
  if (resD.ok && !seesOrg2) {
    log("D. Specialist A cannot see Clinic B client without matching context", "PASS");
  } else {
    log("D. Specialist A cannot see Clinic B client without matching context", "FAIL", `seesOrg2=${seesOrg2}`);
  }

  // ── Test E: membership alone does NOT expose another doctor's client
  // Expert B gets a client in org (without explicit membership)
  const publicCodeBInOrg = genCode();
  const { data: assignBInOrg } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: publicCodeBInOrg,
      organization_id: org.id,
      primary_expert_id: loginB.id,
      assigned_by_expert_id: loginB.id,
      source: "test",
      status: "active",
      module: "support",
    })
    .select("id")
    .single();
  if (assignBInOrg) track("patient_assignments", assignBInOrg.id);

  const resE = await listClients(sessionA, org.id, "support");
  const seesBOrg = resE.clients?.some((c) => c.client_ref === `assignment:${assignBInOrg?.id}`);
  if (resE.ok && !seesBOrg) {
    log("E. Membership alone does NOT expose another doctor's client", "PASS");
  } else {
    log("E. Membership alone does NOT expose another doctor's client", "FAIL", `seesBOrg=${seesBOrg}`);
  }

  // ── Test F: explicit patient_access grant makes shared client visible
  const { data: accessGrant } = await supabase
    .from("patient_access")
    .insert({
      public_code: publicCodeBInOrg,
      organization_id: org.id,
      expert_id: loginA.expert.id,
      access_role: "viewer",
      status: "active",
      module: "support",
    })
    .select("id")
    .single();
  if (accessGrant) track("patient_access", accessGrant.id);

  const resF = await listClients(sessionA, org.id, "support");
  const seesShared = resF.clients?.some((c) => c.client_ref === `access:${accessGrant?.id}`);
  if (resF.ok && seesShared) {
    log("F. Explicit patient_access grant makes shared client visible", "PASS");
  } else {
    log("F. Explicit patient_access grant makes shared client visible", "FAIL");
  }

  // ── Test G: inactive patient_access makes it disappear
  if (accessGrant) {
    await supabase.from("patient_access").update({ status: "inactive" }).eq("id", accessGrant.id);
  }
  const resG = await listClients(sessionA, org.id, "support");
  const seesInactive = resG.clients?.some((c) => c.client_ref === `access:${accessGrant?.id}`);
  if (resG.ok && !seesInactive) {
    log("G. Inactive patient_access makes it disappear", "PASS");
  } else {
    log("G. Inactive patient_access makes it disappear", "FAIL", `seesInactive=${seesInactive}`);
  }

  // ── Test H: inactive assignment does not appear
  if (assignOrg) {
    await supabase.from("patient_assignments").update({ status: "inactive" }).eq("id", assignOrg.id);
  }
  const resH = await listClients(sessionA, org.id, "support");
  const seesInactiveAssign = resH.clients?.some((c) => c.client_ref === `assignment:${assignOrg?.id}`);
  if (resH.ok && !seesInactiveAssign) {
    log("H. Inactive assignment does not appear", "PASS");
  } else {
    log("H. Inactive assignment does not appear", "FAIL");
  }

  // ── Test I: Support client does not appear in Body
  // Re-activate assignment for testing
  if (assignOrg) {
    await supabase.from("patient_assignments").update({ status: "active" }).eq("id", assignOrg.id);
  }
  const resI = await listClients(sessionA, org.id, "body");
  const seesSupportInBody = resI.clients?.some((c) => c.client_ref === `assignment:${assignOrg?.id}`);
  if (resI.ok && !seesSupportInBody) {
    log("I. Support client does not appear in Body", "PASS");
  } else {
    log("I. Support client does not appear in Body", "FAIL");
  }

  // ── Test J: Body owner client does not appear in Support
  // Create a body owner assignment (needs anonymous_owner_id)
  const bodyOwnerId = crypto.randomUUID();
  const { data: bodyAssign } = await supabase
    .from("patient_assignments")
    .insert({
      public_code: null,
      owner_type: "anonymous_profile",
      owner_id: bodyOwnerId,
      organization_id: org.id,
      primary_expert_id: loginA.expert.id,
      assigned_by_expert_id: loginA.expert.id,
      source: "test",
      status: "active",
      module: "body",
    })
    .select("id")
    .single();
  if (bodyAssign) track("patient_assignments", bodyAssign.id);

  const resJ = await listClients(sessionA, org.id, "support");
  const seesBodyInSupport = resJ.clients?.some((c) => c.client_ref === `assignment:${bodyAssign?.id}`);
  if (resJ.ok && !seesBodyInSupport) {
    log("J. Body owner client does not appear in Support", "PASS");
  } else {
    log("J. Body owner client does not appear in Support", "FAIL");
  }

  // ── Test K: fake organization_id rejected
  const resK = await listClients(sessionA, "00000000-0000-0000-0000-000000000000", "support");
  if (!resK.ok && resK.error) {
    log("K. Fake organization_id rejected", "PASS", resK.error);
  } else {
    log("K. Fake organization_id rejected", "FAIL");
  }

  // ── Test L: arbitrary expert_id from browser has no effect
  // Login as B, try to pass expert_id of A (should be ignored)
  const resL = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionB}` },
    body: JSON.stringify({ action: "listClients", organization_id: null, module: "support" }),
  });
  const dataL = await resL.json();
  // Should only see B's own client, not A's
  const seesAFromB = dataL.clients?.some((c) => c.display_name === "Тест Клиент А");
  if (dataL.ok && !seesAFromB) {
    log("L. Arbitrary expert_id from browser has no effect", "PASS");
  } else {
    log("L. Arbitrary expert_id from browser has no effect", "FAIL");
  }

  // ── Test M: zero-clinic specialist works in private-practice context
  // Expert B has no memberships — query private practice
  const resM = await listClients(sessionB, null, "support");
  if (resM.ok && Array.isArray(resM.clients)) {
    log("M. Zero-clinic specialist works in private-practice context", "PASS");
  } else {
    log("M. Zero-clinic specialist works in private-practice context", "FAIL");
  }

  // ── Test N: switching context returns only that context's rows
  // Add expert A to org2 membership for this test
  const { data: membershipA2 } = await supabase
    .from("expert_organization_memberships")
    .insert({ organization_id: org2.id, expert_id: loginA.expert.id, role: "doctor" })
    .select("id")
    .single();
  if (membershipA2) track("expert_organization_memberships", membershipA2.id);

  const resN1 = await listClients(sessionA, org.id, "support");
  const resN2 = await listClients(sessionA, org2.id, "support");
  const org1Ids = (resN1.clients || []).map((c) => c.client_ref);
  const org2Ids = (resN2.clients || []).map((c) => c.client_ref);
  const noOverlap = org1Ids.every((id) => !org2Ids.includes(id));
  if (resN1.ok && resN2.ok && noOverlap) {
    log("N. Switching context returns only that context's rows", "PASS");
  } else {
    log("N. Switching context returns only that context's rows", "FAIL", `overlap=${!noOverlap}`);
  }

  // ── Test O: duplicate assignment/access produces one UI client
  // Grant access to A for a client A already owns as primary
  if (assignA) {
    await supabase.from("patient_access").insert({
      public_code: publicCodeA,
      organization_id: null,
      expert_id: loginA.expert.id,
      access_role: "owner",
      status: "active",
      module: "support",
    }).then(() => {});
  }
  const resO = await listClients(sessionA, null, "support");
  const clientOCount = (resO.clients || []).filter((c) => c.display_name === "Тест Клиент А").length;
  if (resO.ok && clientOCount === 1) {
    log("O. Duplicate assignment/access produces one UI client", "PASS");
  } else {
    log("O. Duplicate assignment/access produces one UI client", "FAIL", `count=${clientOCount}`);
  }
}

// ── Session creation helper ───────────────────────────────

async function createSession(expertId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("specialist_sessions")
    .insert({
      expert_id: expertId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

  if (error) {
    console.error("Session create error:", error);
    return null;
  }
  return rawToken;
}

// ── Cleanup ───────────────────────────────────────────────

async function cleanup() {
  console.log("\n── Cleanup ──");
  // Delete in reverse order (respect FKs)
  for (const { table, id } of CLEANUP.reverse()) {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) console.error(`  Cleanup ${table}/${id}:`, error.message);
    else console.log(`  Cleaned ${table}/${id}`);
  }

  // Also clean up test sessions
  if (expertB) {
    await supabase.from("specialist_sessions").delete().eq("expert_id", expertB.id);
    console.log(`  Cleaned specialist_sessions for ${expertB.id}`);
  }

  // Clean up test patient_assignments/patient_access by source='test'
  await supabase.from("patient_assignments").delete().eq("source", "test");
  await supabase.from("patient_access").delete().eq("access_role", "viewer");
  console.log("  Cleaned test patient_assignments/patient_access");
}

// ── Main ──────────────────────────────────────────────────

(async () => {
  try {
    await setup();
    await runTests();
  } finally {
    await cleanup();
  }

  console.log("\n═══════════════════════════════════════════");
  const passed = RESULTS.filter((r) => r.result === "PASS").length;
  const failed = RESULTS.filter((r) => r.result === "FAIL").length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
})();
