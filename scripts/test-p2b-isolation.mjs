import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

// ── Config ────────────────────────────────────────────────

const RUN_ID = crypto.randomUUID().slice(0, 8);
const ADMIN_TOKEN = "test_admin_token_123";
process.env.SUPER_ADMIN_TOKEN = ADMIN_TOKEN;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const API = "http://localhost:3001/api/specialist";
const ADMIN = "http://localhost:3001/api/admin";
const RESULTS = [];
const FIXTURE_IDS = { experts: [], sessions: [], orgs: [], memberships: [], bodyClients: [], assignments: [], access: [] };
let controlAssignmentId = null;
let controlBodyClientId = null;

function log(test, result, detail = "") {
  RESULTS.push({ test, result, detail });
  const icon = result === "PASS" ? "✅" : result === "FAIL" ? "❌" : "⏭️";
  console.log(`${icon} ${test}${detail ? " — " + detail : ""}`);
}

function genCode() { return `P2B-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }

async function createSession(expertId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data } = await supabase.from("specialist_sessions").insert({ expert_id: expertId, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString() }).select("id").single();
  if (data) FIXTURE_IDS.sessions.push(data.id);
  return raw;
}

async function listClients(token, orgId, module) {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "listClients", organization_id: orgId, module }) });
  return res.json();
}

async function adminAction(action, extra = {}) {
  const res = await fetch(ADMIN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, password: ADMIN_TOKEN, ...extra }),
  });
  return res.json();
}

// ── Cleanup ───────────────────────────────────────────────

async function cleanup() {
  console.log("\n── Cleanup ──");
  for (const id of FIXTURE_IDS.assignments) await supabase.from("patient_assignments").delete().eq("id", id);
  for (const id of FIXTURE_IDS.access) await supabase.from("patient_access").delete().eq("id", id);
  for (const id of FIXTURE_IDS.memberships) await supabase.from("expert_organization_memberships").delete().eq("id", id);
  for (const id of FIXTURE_IDS.orgs) await supabase.from("organizations").delete().eq("id", id);
  for (const id of FIXTURE_IDS.sessions) await supabase.from("specialist_sessions").delete().eq("id", id);
  for (const id of FIXTURE_IDS.experts) await supabase.from("experts").delete().eq("id", id);
  for (const id of FIXTURE_IDS.bodyClients) await supabase.from("body_clients").delete().eq("id", id);
  console.log(`  Removed fixture IDs`);
}

// ── Main ──────────────────────────────────────────────────

(async () => {
  try {
    console.log(`── Test run ${RUN_ID} ──`);

    // ── Setup ────────────────────────────────────────────
    const codeA = genCode();
    const { data: expertA } = await supabase.from("experts").insert({
      name: "P2B Spec A", role: "psychologist", access_code: codeA, is_active: true,
    }).select("id").single();
    FIXTURE_IDS.experts.push(expertA.id);

    const codeB = genCode();
    const { data: expertB } = await supabase.from("experts").insert({
      name: "P2B Spec B", role: "psychiatrist", access_code: codeB, is_active: true,
    }).select("id").single();
    FIXTURE_IDS.experts.push(expertB.id);

    const tokenA = await createSession(expertA.id);
    const tokenB = await createSession(expertB.id);

    // Body clients
    const owner1 = crypto.randomUUID();
    const owner2 = crypto.randomUUID();
    const { data: bc1 } = await supabase.from("body_clients").insert({
      session_id: genCode(), anonymous_owner_id: owner1, display_name: "Тест Боди 1", source: "self_signup", status: "active",
    }).select("id").single();
    FIXTURE_IDS.bodyClients.push(bc1.id);

    const { data: bc2 } = await supabase.from("body_clients").insert({
      session_id: genCode(), anonymous_owner_id: owner2, display_name: "Тест Боди 2", source: "alena_client", specialist_id: "alena_zhukova", specialist_name: "Алена Жукова", status: "active",
    }).select("id").single();
    FIXTURE_IDS.bodyClients.push(bc2.id);

    // ── CONTROL ROW ──
    const controlOwnerId = crypto.randomUUID();
    const { data: controlBc } = await supabase.from("body_clients").insert({
      session_id: genCode(), anonymous_owner_id: controlOwnerId, display_name: "Control Row", source: "self_signup", status: "active",
    }).select("id").single();
    controlBodyClientId = controlBc.id;
    const { data: controlAssignment } = await supabase.from("patient_assignments").insert({
      public_code: null, owner_type: "anonymous_profile", owner_id: controlOwnerId,
      organization_id: null, primary_expert_id: expertA.id, assigned_by_expert_id: null,
      assigned_by_expert_name: "admin", source: "admin_body_assignment", status: "active", module: "body",
    }).select("id").single();
    controlAssignmentId = controlAssignment.id;
    console.log(`  Control: assignment=${controlAssignmentId}, body_client=${controlBodyClientId}`);

    // ── A: legacy specialist_id alone does NOT make Body client visible ──
    const resA = await listClients(tokenA, null, "body");
    const seesA = (resA.clients || []).some((c) => c.display_name === "Тест Боди 2");
    log("A. Legacy specialist_id alone does NOT make Body client visible", !seesA ? "PASS" : "FAIL");

    // ── B: explicit Body patient_assignment makes client visible ──
    const assignData = await adminAction("assignBodyClientToExpert", { body_client_ref: bc1.id, expert_id: expertA.id, organization_id: null });
    if (assignData.ok && assignData.assignment_id) FIXTURE_IDS.assignments.push(assignData.assignment_id);
    if (!assignData.ok) { log("B. Explicit Body patient_assignment makes client visible", "FAIL", assignData.error); }
    else {
      const resB = await listClients(tokenA, null, "body");
      const seesB = (resB.clients || []).some((c) => c.display_name === "Тест Боди 1");
      log("B. Explicit Body patient_assignment makes client visible", seesB ? "PASS" : "FAIL");
    }

    // ── C: specialist B cannot see specialist A's Body client ──
    const resC = await listClients(tokenB, null, "body");
    const seesC = (resC.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("C. Specialist B cannot see specialist A's Body client", !seesC ? "PASS" : "FAIL");

    // ── D: private-practice Body assignment works ──
    const resD = await listClients(tokenA, null, "body");
    const hasD = (resD.clients || []).length > 0;
    log("D. Private-practice Body assignment works", hasD ? "PASS" : "FAIL");

    // ── E: clinic Body assignment works only in correct context ──
    const { data: org } = await supabase.from("organizations").insert({
      name: "P2B Clinic", slug: `test-p2b-${RUN_ID}`, type: "private_clinic",
    }).select("id").single();
    FIXTURE_IDS.orgs.push(org.id);
    const { data: mem } = await supabase.from("expert_organization_memberships").insert({ organization_id: org.id, expert_id: expertA.id, role: "doctor" }).select("id").single();
    FIXTURE_IDS.memberships.push(mem.id);

    const assignOrgData = await adminAction("assignBodyClientToExpert", { body_client_ref: bc2.id, expert_id: expertA.id, organization_id: org.id });
    if (assignOrgData.ok && assignOrgData.assignment_id) FIXTURE_IDS.assignments.push(assignOrgData.assignment_id);
    if (!assignOrgData.ok) { log("E. Clinic Body assignment works", "FAIL", assignOrgData.error); }
    else {
      const resE1 = await listClients(tokenA, org.id, "body");
      const seesE1 = (resE1.clients || []).some((c) => c.display_name === "Тест Боди 2");
      const resE2 = await listClients(tokenA, null, "body");
      const seesE2 = (resE2.clients || []).some((c) => c.display_name === "Тест Боди 2");
      log("E. Clinic Body assignment works only in correct context", seesE1 && !seesE2 ? "PASS" : "FAIL", `clinic=${seesE1} private=${seesE2}`);
    }

    // ── F: clinic membership alone does not expose Body client ──
    const resF = await listClients(tokenB, org.id, "body");
    const seesF = (resF.clients || []).some((c) => c.display_name === "Тест Боди 2");
    log("F. Clinic membership alone does not expose Body client", !seesF ? "PASS" : "FAIL");

    // ── G: same assignment request twice does not duplicate ──
    const dupData = await adminAction("assignBodyClientToExpert", { body_client_ref: bc1.id, expert_id: expertA.id, organization_id: null });
    log("G. Same assignment request twice does not duplicate", dupData.ok && dupData.noop ? "PASS" : "FAIL", dupData.message || dupData.error);

    // ── H: conflicting primary specialist is not silently replaced ──
    const dupData2 = await adminAction("assignBodyClientToExpert", { body_client_ref: bc1.id, expert_id: expertB.id, organization_id: null });
    log("H. Conflicting primary specialist is not silently replaced", !dupData2.ok && dupData2.error ? "PASS" : "FAIL", dupData2.error);

    // ── I: inactive Body assignment disappears ──
    await supabase.from("patient_assignments").update({ status: "inactive" }).eq("owner_type", "anonymous_profile").eq("owner_id", owner1).eq("module", "body");
    const resI = await listClients(tokenA, null, "body");
    const seesI = (resI.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("I. Inactive Body assignment disappears", !seesI ? "PASS" : "FAIL");
    await supabase.from("patient_assignments").update({ status: "active" }).eq("owner_type", "anonymous_profile").eq("owner_id", owner1).eq("module", "body");

    // ── J: Support list unaffected ──
    const resJ = await listClients(tokenA, null, "support");
    const seesJBody = (resJ.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("J. Support list unaffected by Body assignments", !seesJBody ? "PASS" : "FAIL");

    // ── K: no owner_id / continuation credential leaks ──
    const bodyStr = JSON.stringify(resD);
    const hasOwnerId = bodyStr.includes(owner1) || bodyStr.includes(owner2);
    const hasOwnerType = bodyStr.includes("anonymous_profile");
    log("K. No owner_id / continuation credential leaks", !hasOwnerId && !hasOwnerType ? "PASS" : "FAIL", `ownerId=${hasOwnerId} ownerType=${hasOwnerType}`);

    // ── L: body_clients legacy specialist fields remain unchanged ──
    const { data: bc1Check } = await supabase.from("body_clients").select("specialist_id, specialist_name").eq("id", bc1.id).single();
    log("L. Body_clients legacy fields unchanged", bc1Check?.specialist_id === null && bc1Check?.specialist_name === null ? "PASS" : "FAIL");
    const { data: bc2Check } = await supabase.from("body_clients").select("specialist_id, specialist_name").eq("id", bc2.id).single();
    log("L2. Body_clients legacy fields unchanged (with data)", bc2Check?.specialist_id === "alena_zhukova" ? "PASS" : "FAIL");

    // ── M: Body display name resolves only after authorization ──
    const resM = await listClients(tokenB, null, "body");
    const seesM = (resM.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("M. Body display name resolves only after authorization", !seesM ? "PASS" : "FAIL");

    // ── N: client without display_name uses fallback ──
    const ownerNoName = crypto.randomUUID();
    const { data: bcNoName } = await supabase.from("body_clients").insert({
      session_id: genCode(), anonymous_owner_id: ownerNoName, source: "self_signup", status: "active",
    }).select("id").single();
    FIXTURE_IDS.bodyClients.push(bcNoName.id);
    const assignNoNameData = await adminAction("assignBodyClientToExpert", { body_client_ref: bcNoName.id, expert_id: expertA.id, organization_id: null });
    if (assignNoNameData.ok && assignNoNameData.assignment_id) FIXTURE_IDS.assignments.push(assignNoNameData.assignment_id);
    const resN = await listClients(tokenA, null, "body");
    const hasFallback = (resN.clients || []).some((c) => c.display_name === "Клиент без имени");
    log("N. Client without display_name uses fallback", hasFallback ? "PASS" : "FAIL");

    // ═══ REASSIGNMENT TESTS ═══════════════════════════════

    // ── R-A: successful reassignment ──
    // First assign bc1 to expertA (already done above)
    // Now reassign to expertB
    const reassignData = await adminAction("reassignBodyClientExpert", { body_client_ref: bc1.id, expert_id: expertB.id, organization_id: null });
    if (reassignData.ok && reassignData.assignment_id) FIXTURE_IDS.assignments.push(reassignData.assignment_id);
    // Verify: expertB can now see it, expertA cannot
    const resRB = await listClients(tokenB, null, "body");
    const seesRB = (resRB.clients || []).some((c) => c.display_name === "Тест Боди 1");
    const resRA = await listClients(tokenA, null, "body");
    const seesRA = (resRA.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("R-A. Successful reassignment: old inactive, new active", seesRB && !seesRA ? "PASS" : "FAIL", `B=${seesRB} A=${seesRA}`);

    // ── R-B: forced failure creating new assignment ──
    // Try reassigning to a non-existent expert (RPC should fail, old should remain)
    const invalidExpertId = crypto.randomUUID();
    const reassignFail = await adminAction("reassignBodyClientExpert", { body_client_ref: bc1.id, expert_id: invalidExpertId, organization_id: null });
    // Verify expertB still has the assignment
    const resRB2 = await listClients(tokenB, null, "body");
    const seesRB2 = (resRB2.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("R-B. Forced failure: old assignment remains active", !reassignFail.ok && seesRB2 ? "PASS" : "FAIL", `error=${reassignFail.error} visible=${seesRB2}`);

    // ── R-C: invalid new expert ──
    const reassignInvalid = await adminAction("reassignBodyClientExpert", { body_client_ref: bc1.id, expert_id: "00000000-0000-0000-0000-000000000000", organization_id: null });
    const resRC = await listClients(tokenB, null, "body");
    const seesRC = (resRC.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("R-C. Invalid new expert: old assignment unchanged", !reassignInvalid.ok && seesRC ? "PASS" : "FAIL");

    // ── R-D: invalid organization membership ──
    const { data: fakeOrg } = await supabase.from("organizations").insert({
      name: "P2B Fake Clinic", slug: `test-p2b-fake-${RUN_ID}`, type: "private_clinic",
    }).select("id").single();
    FIXTURE_IDS.orgs.push(fakeOrg.id);
    const reassignBadOrg = await adminAction("reassignBodyClientExpert", { body_client_ref: bc1.id, expert_id: expertB.id, organization_id: fakeOrg.id });
    const resRD = await listClients(tokenB, null, "body");
    const seesRD = (resRD.clients || []).some((c) => c.display_name === "Тест Боди 1");
    log("R-D. Invalid org membership: old assignment unchanged", !reassignBadOrg.ok && seesRD ? "PASS" : "FAIL", reassignBadOrg.error);

    // ── R-E: repeated same reassignment (noop) ──
    const reassignSame = await adminAction("reassignBodyClientExpert", { body_client_ref: bc1.id, expert_id: expertB.id, organization_id: null });
    log("R-E. Repeated same reassignment: noop", reassignSame.ok && reassignSame.noop ? "PASS" : "FAIL", reassignSame.message);

    // ── R-F: competing reassignment → at most one active ──
    // Assign to A, then B quickly
    await adminAction("assignBodyClientToExpert", { body_client_ref: bc1.id, expert_id: expertA.id, organization_id: null });
    // Now both A and B have attempted — check count of active assignments for this owner
    const { count } = await supabase.from("patient_assignments").select("id", { count: "exact", head: true })
      .eq("owner_type", "anonymous_profile").eq("owner_id", owner1).eq("module", "body").eq("status", "active");
    log("R-F. Competing reassignment: at most one active primary", count <= 1 ? "PASS" : "FAIL", `active_count=${count}`);

    // ── R-G: body_clients legacy specialist fields unchanged after reassignment ──
    const { data: bc1Post } = await supabase.from("body_clients").select("specialist_id, specialist_name").eq("id", bc1.id).single();
    log("R-G. Legacy fields unchanged after reassignment", bc1Post?.specialist_id === null && bc1Post?.specialist_name === null ? "PASS" : "FAIL");

    // ── SAFETY: control row exists before cleanup ──
    const { data: controlCheck } = await supabase.from("patient_assignments").select("id").eq("id", controlAssignmentId).maybeSingle();
    log("SAFETY. Control row exists before cleanup", controlCheck ? "PASS" : "FAIL");

    // ── Audit log: test actions create rows (verify they exist) ──
    const { count: auditCount } = await supabase.from("admin_audit_log").select("id", { count: "exact", head: true })
      .in("action", ["assign_body_client", "reassign_body_client", "list_unassigned_body_clients"]);
    log("AUDIT. Test actions created audit-log rows", auditCount > 0 ? "PASS" : "FAIL", `count=${auditCount}`);

  } finally {
    await cleanup();

    // ── CONTROL ROW: verify it survived fixture cleanup, then delete it ──
    if (controlAssignmentId) {
      const { data: survived } = await supabase.from("patient_assignments").select("id").eq("id", controlAssignmentId).maybeSingle();
      console.log(`  Control row survived cleanup: ${survived ? "YES" : "NO"}`);

      // Explicitly delete control row by exact ID
      if (survived) {
        await supabase.from("patient_assignments").delete().eq("id", controlAssignmentId);
        const { data: deleted } = await supabase.from("patient_assignments").select("id").eq("id", controlAssignmentId).maybeSingle();
        console.log(`  Control row deleted: ${!deleted ? "YES" : "NO"}`);
        log("CONTROL. Control row explicitly deleted after verification", !deleted ? "PASS" : "FAIL");
      }
    }

    // ── Verify no test fixture assignments remain ──
    const { count: remaining } = await supabase.from("patient_assignments").select("id", { count: "exact", head: true })
      .in("id", FIXTURE_IDS.assignments);
    console.log(`  Test fixture assignments remaining: ${remaining} (expected 0)`);
    log("CLEANUP. No test fixture assignments remain", remaining === 0 ? "PASS" : "FAIL");
  }

  console.log("\n═══════════════════════════════════════════");
  const passed = RESULTS.filter((r) => r.result === "PASS").length;
  const failed = RESULTS.filter((r) => r.result === "FAIL").length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
})();
