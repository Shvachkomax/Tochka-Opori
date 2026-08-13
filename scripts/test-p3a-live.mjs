import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SPEC = "http://localhost:3001/api/specialist";
const FIXTURES = { experts: [], sessions: [], assignments: [], bodyClients: [], testSessions: [] };

function log(t, r, d = "") { console.log((r === "PASS" ? "✅" : "❌") + " " + t + (d ? " — " + d : "")); }

async function createSessionToken(expertId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data } = await sb.from("specialist_sessions").insert({ expert_id: expertId, token_hash: hash, expires_at: new Date(Date.now() + 43200000).toISOString() }).select("id").single();
  if (data) FIXTURES.sessions.push(data.id);
  return raw;
}

async function api(token, body) {
  const res = await fetch(SPEC, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  return res.json();
}

(async () => {
  try {
    // Pre-cleanup: remove any leftover test data from previous runs
    await sb.from("sessions").delete().like("session_id", "ph3a-%");
    await sb.from("sessions").delete().like("public_code", "SESSION-CODE-A-%");
    await sb.from("sessions").delete().like("public_code", "SAFETY-%");
    await sb.from("sessions").delete().like("public_code", "OTHER-%");
    await sb.from("patient_assignments").delete().in("source", ["ph3a_test", "ph3a_safety"]);
    await sb.from("patient_access").delete().eq("granted_by_expert_name", "ph3a_test");
    await sb.from("experts").delete().like("access_code", "TEST-%");

    // Create test experts
    const { data: eA } = await sb.from("experts").insert({ name: "Ph3A Test A", role: "psychologist", access_code: "TEST-A-" + Date.now(), is_active: true }).select("id").single();
    FIXTURES.experts.push(eA.id);
    const tokA = await createSessionToken(eA.id);

    const { data: eB } = await sb.from("experts").insert({ name: "Ph3A Test B", role: "psychiatrist", access_code: "TEST-B-" + Date.now(), is_active: true }).select("id").single();
    FIXTURES.experts.push(eB.id);
    const tokB = await createSessionToken(eB.id);

    const { data: eC } = await sb.from("experts").insert({ name: "Ph3A Test C", role: "other", access_code: "TEST-C-" + Date.now(), is_active: true }).select("id").single();
    FIXTURES.experts.push(eC.id);

    // ── A: zero sessions ──
    const { data: eZero } = await sb.from("experts").insert({ name: "Ph3A Zero", role: "psychologist", access_code: "TEST-ZERO-" + Date.now(), is_active: true }).select("id").single();
    FIXTURES.experts.push(eZero.id);
    const { data: assignZero } = await sb.from("patient_assignments").insert({
      public_code: "ZERO-CODE-" + Date.now(), organization_id: null, primary_expert_id: eZero.id,
      assigned_by_expert_id: eZero.id, source: "ph3a_test", status: "active", module: "support", patient_label: "Zero Sessions Client",
    }).select("id").single();
    FIXTURES.assignments.push(assignZero.id);
    const tokZero = await createSessionToken(eZero.id);
    const resA = await api(tokZero, { action: "getClientOverview", client_ref: "assignment:" + assignZero.id, organization_id: null, module: "support" });
    log("A. Zero sessions => 200 with empty card", resA.ok && resA.overview?.session_count === 0 ? "PASS" : "FAIL", JSON.stringify({ ok: resA.ok, count: resA.overview?.session_count }));

    // Create sessions for expert A — each with unique public_code, same owner
    const runId = Math.random().toString(36).slice(2, 8);
    const ownerIdA = crypto.randomUUID();
    const firstPublicCode = "PCODE-" + runId;
    const sessIds = [];
    for (let i = 0; i < 3; i++) {
      const publicCode = i === 0 ? firstPublicCode : "PCODE-" + runId + "-" + i;
      const sessionId = "ph3a-sess-" + runId + "-" + i;
      const { data: s, error: sErr } = await sb.from("sessions").insert({
        session_id: sessionId, public_code: publicCode, module: "support",
        patient_text: "Test " + i, care_recommendation: i === 2 ? { level: "urgent_help", reasons: ["suicidal_ideation"], timeframe: "today" } : { level: "self_support", reasons: [], timeframe: "routine" },
        doctor_report: "Professional summary for session " + (i + 1) + ". Key signals observed.", report_generation_status: "ready", anonymous_owner_id: ownerIdA,
      }).select("id").single();
      if (sErr) { console.error("Session insert error:", sErr.message); continue; }
      sessIds.push(s.id); FIXTURES.testSessions.push(s.id);
    }
    // Assignment uses the first session's public_code
    const publicCodeA = firstPublicCode;

    const { data: assignA } = await sb.from("patient_assignments").insert({
      public_code: publicCodeA, organization_id: null, primary_expert_id: eA.id,
      assigned_by_expert_id: eA.id, source: "ph3a_test", status: "active", module: "support", patient_label: "Анна Тест",
    }).select("id").single();
    FIXTURES.assignments.push(assignA.id);

    const { data: accessB } = await sb.from("patient_access").insert({
      public_code: publicCodeA, organization_id: null, expert_id: eB.id, access_role: "viewer",
      status: "active", module: "support", granted_by_expert_name: "ph3a_test",
    }).select("id").single();
    FIXTURES.assignments.push(accessB.id);

    // ── B: specialist A opens own client ──
    const resB = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("B. Specialist A opens own client", resB.ok && resB.sessions?.length === 3 && resB.client?.display_name === "Анна Тест" ? "PASS" : "FAIL", "count=" + resB.sessions?.length);

    // ── C: specialist B cannot open A's client_ref ──
    const resC = await api(tokB, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("C. Specialist B cannot open A client_ref", !resC.ok ? "PASS" : "FAIL", resC.error);

    // ── D: forged assignment UUID ──
    const resD = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + crypto.randomUUID(), organization_id: null, module: "support" });
    log("D. Forged assignment UUID rejected", !resD.ok ? "PASS" : "FAIL", resD.error);

    // ── E: forged access UUID ──
    const resE = await api(tokA, { action: "getClientOverview", client_ref: "access:" + crypto.randomUUID(), organization_id: null, module: "support" });
    log("E. Forged access UUID rejected", !resE.ok ? "PASS" : "FAIL", resE.error);

    // ── F: wrong org context ──
    const resF = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: crypto.randomUUID(), module: "support" });
    log("F. Wrong org context rejected", !resF.ok ? "PASS" : "FAIL", resF.error);

    // ── G: module=body rejected ──
    const resG = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "body" });
    log("G. module=body rejected", !resG.ok ? "PASS" : "FAIL", resG.error);

    // ── H: inactive assignment ──
    await sb.from("patient_assignments").update({ status: "inactive" }).eq("id", assignA.id);
    const resH = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("H. Inactive assignment rejected", !resH.ok ? "PASS" : "FAIL", resH.error);
    await sb.from("patient_assignments").update({ status: "active" }).eq("id", assignA.id);

    // ── I: inactive patient_access ──
    await sb.from("patient_access").update({ status: "inactive" }).eq("id", accessB.id);
    const resI = await api(tokB, { action: "getClientOverview", client_ref: "access:" + accessB.id, organization_id: null, module: "support" });
    log("I. Inactive patient_access rejected", !resI.ok ? "PASS" : "FAIL", resI.error);
    await sb.from("patient_access").update({ status: "active" }).eq("id", accessB.id);

    // ── J: shared patient_access works ──
    const resJ = await api(tokB, { action: "getClientOverview", client_ref: "access:" + accessB.id, organization_id: null, module: "support" });
    log("J. Shared patient_access works", resJ.ok && resJ.sessions?.length === 3 ? "PASS" : "FAIL", "count=" + resJ.sessions?.length);

    // ── K: membership alone insufficient ──
    const tokC = await createSessionToken(eC.id);
    const resK = await api(tokC, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("K. Membership alone insufficient", !resK.ok ? "PASS" : "FAIL", resK.error);

    // ── L: public_code never returned ──
    const resL = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("L. public_code never returned", !JSON.stringify(resL).includes(publicCodeA) ? "PASS" : "FAIL");

    // ── M: forbidden fields never returned ──
    const mStr = JSON.stringify(resL);
    log("M. Forbidden raw fields never returned", !mStr.includes("patient_text") && !mStr.includes("conversation_history") && !mStr.includes("user_report") && !mStr.includes("json_data") ? "PASS" : "FAIL");

    // ── N: only authorized sessions ──
    const { data: otherSess } = await sb.from("sessions").insert({
      session_id: "ph3a-other-" + runId, public_code: "OTHER-" + runId, module: "support",
      patient_text: "Other", care_recommendation: { level: "self_support", reasons: [] },
      doctor_report: "Other", report_generation_status: "ready", anonymous_owner_id: crypto.randomUUID(),
    }).select("id").single();
    FIXTURES.testSessions.push(otherSess.id);
    const resN = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + assignA.id, organization_id: null, module: "support" });
    log("N. Only authorized sessions returned", !resN.sessions?.some(s => s.session_ref === "support-session:" + otherSess.id) ? "PASS" : "FAIL");

    // ── O: Body records never appear ──
    log("O. Body records never appear", !JSON.stringify(resN).includes("body") ? "PASS" : "FAIL");

    // ── Safety fixture tests ──
    const safetyCode = "SAFETY-" + runId;
    const safetyOwner = crypto.randomUUID();
    const { data: ss1, error: ss1Err } = await sb.from("sessions").insert({
      session_id: "ph3a-safe-1-" + runId, public_code: safetyCode, module: "support",
      patient_text: "S1", care_recommendation: { level: "urgent_help", reasons: ["suicidal_ideation"] },
      doctor_report: "Urgent", report_generation_status: "ready", anonymous_owner_id: safetyOwner,
    }).select("id").single(); if (ss1) FIXTURES.testSessions.push(ss1.id); else console.error("ss1:", ss1Err?.message);
    const { data: ss2, error: ss2Err } = await sb.from("sessions").insert({
      session_id: "ph3a-safe-2-" + runId, public_code: safetyCode + "-2", module: "support",
      patient_text: "S2", care_recommendation: { level: "self_support", reasons: [] },
      doctor_report: "Normal", report_generation_status: "ready", anonymous_owner_id: safetyOwner,
    }).select("id").single(); if (ss2) FIXTURES.testSessions.push(ss2.id); else console.error("ss2:", ss2Err?.message);
    const { data: safetyAssign } = await sb.from("patient_assignments").insert({
      public_code: safetyCode, organization_id: null, primary_expert_id: eA.id,
      assigned_by_expert_id: eA.id, source: "ph3a_safety", status: "active", module: "support", patient_label: "Safety Test",
    }).select("id").single(); FIXTURES.assignments.push(safetyAssign.id);

    // Latest is self_support, older was urgent
    const resS1 = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + safetyAssign.id, organization_id: null, module: "support" });
    log("SAFETY-1. Latest self_support overrides old urgent", resS1.ok && resS1.overview?.safety?.level === "self_support" && !resS1.overview?.safety?.has_active_flags ? "PASS" : "FAIL");

    // Add latest medical_consultation
    const { data: ss3, error: ss3Err } = await sb.from("sessions").insert({
      session_id: "ph3a-safe-3-" + runId, public_code: safetyCode + "-3", module: "support",
      patient_text: "S3", care_recommendation: { level: "medical_consultation", reasons: ["functional_impairment"] },
      doctor_report: "Medical", report_generation_status: "ready", anonymous_owner_id: safetyOwner,
    }).select("id").single(); if (ss3) FIXTURES.testSessions.push(ss3.id); else console.error("ss3:", ss3Err?.message);
    const resS2 = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + safetyAssign.id, organization_id: null, module: "support" });
    log("SAFETY-2. Latest medical_consultation = active flags", resS2.ok && resS2.overview?.safety?.level === "medical_consultation" && resS2.overview?.safety?.has_active_flags ? "PASS" : "FAIL");

    // Add latest urgent_help
    const { data: ss4, error: ss4Err } = await sb.from("sessions").insert({
      session_id: "ph3a-safe-4-" + runId, public_code: safetyCode + "-4", module: "support",
      patient_text: "S4", care_recommendation: { level: "urgent_help", reasons: ["suicidal_plan"] },
      doctor_report: "Urgent", report_generation_status: "ready", anonymous_owner_id: safetyOwner,
    }).select("id").single(); if (ss4) FIXTURES.testSessions.push(ss4.id); else console.error("ss4:", ss4Err?.message);
    const resS3 = await api(tokA, { action: "getClientOverview", client_ref: "assignment:" + safetyAssign.id, organization_id: null, module: "support" });
    log("SAFETY-3. Latest urgent_help = active flags", resS3.ok && resS3.overview?.safety?.level === "urgent_help" && resS3.overview?.safety?.has_active_flags ? "PASS" : "FAIL");
    log("SAFETY-4. Historical sessions preserved", (resS3.sessions?.length || 0) === 4 ? "PASS" : "FAIL", "count=" + resS3.sessions?.length);

  } finally {
    console.log("\n── Cleanup ──");
    // Delete test sessions by pattern
    await sb.from("sessions").delete().like("session_id", "ph3a-%");
    // Delete test patient assignments by source
    await sb.from("patient_assignments").delete().in("source", ["ph3a_test", "ph3a_safety"]);
    // Delete test patient_access by granted_by
    await sb.from("patient_access").delete().eq("granted_by_expert_name", "ph3a_test");
    // Delete specialist sessions
    for (const id of FIXTURES.sessions) await sb.from("specialist_sessions").delete().eq("id", id);
    // Delete test experts
    for (const id of FIXTURES.experts) await sb.from("experts").delete().eq("id", id);
    // Delete test body clients
    for (const id of FIXTURES.bodyClients) await sb.from("body_clients").delete().eq("id", id);
    console.log("  All fixtures removed");
  }
})();
