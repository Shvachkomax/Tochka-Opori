// DB access-isolation tests for getBodyClientOverview specialist endpoint.
// Creates temporary fixtures, runs authorization tests, cleans up.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import crypto from "node:crypto";
import { hashToken } from "../lib/security/council-token.js";

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

const env = loadEnv(".env.local");
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

import specialistHandler from "../api/specialist.js";

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Test fixtures ──────────────────────────────────────────

const E2E_PREFIX = `e2e-body-spec-${Date.now()}`;
const testIds = {
  expertA: crypto.randomUUID(),
  expertB: crypto.randomUUID(),
  orgClinic: crypto.randomUUID(),
  orgOther: crypto.randomUUID(),
  ownerA: crypto.randomUUID(),
  ownerB: crypto.randomUUID(),
  assignmentA: crypto.randomUUID(),
  assignmentB: crypto.randomUUID(),
  accessShared: crypto.randomUUID(),
  accessWrongOrg: crypto.randomUUID(),
  accessRevoked: crypto.randomUUID(),
  inactiveAssignment: crypto.randomUUID(),
  sessionAToken: crypto.randomUUID(),
  sessionBToken: crypto.randomUUID(),
  sessionIdA: `e2e-sess-a-${Date.now()}`,
  sessionIdB: `e2e-sess-b-${Date.now()}`,
  bodyClientA: crypto.randomUUID(),
  bodyClientB: crypto.randomUUID(),
  dailyLogA: crypto.randomUUID(),
  dailyLogB: crypto.randomUUID(),
  plateA: crypto.randomUUID(),
  plateB: crypto.randomUUID(),
  weeklyA: crypto.randomUUID(),
  weeklyB: crypto.randomUUID(),
  insightA: crypto.randomUUID(),
  srA: crypto.randomUUID(),
  srB: crypto.randomUUID(),
};

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failCount++;
  } else {
    console.log(`  PASS: ${message}`);
    passCount++;
  }
}

function mockReq(body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.cookie = `tochka_specialist_session=${token}`;
  return {
    method: "POST",
    headers,
    socket: { remoteAddress: "127.0.0.1" },
    url: "/api/specialist",
    body,
  };
}

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (data) { res.body = data; return res; };
  res.setHeader = function (k, v) { res.headers[k] = v; return res; };
  return res;
}

async function invoke(body, token) {
  const req = mockReq(body, token);
  const res = mockRes();
  await specialistHandler(req, res);
  return { status: res.statusCode, body: res.body };
}

// ── Setup fixtures ─────────────────────────────────────────

async function setup() {
  console.log(`\nSetting up fixtures (prefix: ${E2E_PREFIX})...`);

  // Experts
  await supabase.from("experts").insert([
    { id: testIds.expertA, name: "E2E Spec A", role: "doctor", specialty: "Терапевт", city: "Москва", is_active: true, access_code: `${E2E_PREFIX}-code-a` },
    { id: testIds.expertB, name: "E2E Spec B", role: "doctor", specialty: "Психиатр", city: "СПб", is_active: true, access_code: `${E2E_PREFIX}-code-b` },
  ]);

  // Organizations
  await supabase.from("organizations").insert([
    { id: testIds.orgClinic, name: "E2E Clinic", slug: `${E2E_PREFIX}-clinic` },
    { id: testIds.orgOther, name: "E2E Other Org", slug: `${E2E_PREFIX}-other` },
  ]);

  // Memberships
  await supabase.from("expert_organization_memberships").insert([
    { organization_id: testIds.orgClinic, expert_id: testIds.expertA, role: "doctor", status: "active" },
    { organization_id: testIds.orgClinic, expert_id: testIds.expertB, role: "doctor", status: "active" },
    { organization_id: testIds.orgOther, expert_id: testIds.expertB, role: "doctor", status: "active" },
  ]);

  // Specialist sessions (tokens for auth)
  await supabase.from("specialist_sessions").insert([
    { id: testIds.sessionAToken, expert_id: testIds.expertA, token_hash: hashToken(testIds.sessionAToken), expires_at: new Date(Date.now() + 3600000).toISOString() },
    { id: testIds.sessionBToken, expert_id: testIds.expertB, token_hash: hashToken(testIds.sessionBToken), expires_at: new Date(Date.now() + 3600000).toISOString() },
  ]);

  // Body clients
  await supabase.from("body_clients").insert([
    { id: testIds.bodyClientA, session_id: testIds.sessionIdA, anonymous_owner_id: testIds.ownerA, display_name: "E2E Клиент A", goal: "Похудеть", status: "active", source: "self_signup" },
    { id: testIds.bodyClientB, session_id: testIds.sessionIdB, anonymous_owner_id: testIds.ownerB, display_name: "E2E Клиент B", goal: "Набрать массу", status: "active", source: "self_signup" },
  ]);

  // Patient assignments (body module)
  // Note: pa_owner_org_module_uniq partial unique index prevents duplicate active
  // assignments for the same (owner_type, owner_id, organization_id, module).
  await supabase.from("patient_assignments").insert([
    // A: specialist A → owner A, clinic context
    { id: testIds.assignmentA, owner_type: "anonymous_profile", owner_id: testIds.ownerA, organization_id: testIds.orgClinic, primary_expert_id: testIds.expertA, assigned_by_expert_name: "test", module: "body", status: "active", patient_label: "E2E Assignment A" },
    // B: specialist B → owner B, clinic context
    { id: testIds.assignmentB, owner_type: "anonymous_profile", owner_id: testIds.ownerB, organization_id: testIds.orgClinic, primary_expert_id: testIds.expertB, assigned_by_expert_name: "test", module: "body", status: "active", patient_label: "E2E Assignment B" },
    // Inactive assignment (same owner as A, but inactive — no unique conflict)
    { id: testIds.inactiveAssignment, owner_type: "anonymous_profile", owner_id: testIds.ownerA, organization_id: testIds.orgClinic, primary_expert_id: testIds.expertA, assigned_by_expert_name: "test", module: "body", status: "inactive", patient_label: "E2E Inactive" },
  ]);

  // Patient access (shared)
  await supabase.from("patient_access").insert([
    // Shared: specialist B gets read access to owner A
    { id: testIds.accessShared, owner_type: "anonymous_profile", owner_id: testIds.ownerA, organization_id: testIds.orgClinic, expert_id: testIds.expertB, access_role: "viewer", granted_by_expert_name: "test", module: "body", status: "active" },
    // Wrong org: specialist B tries to access via orgOther
    { id: testIds.accessWrongOrg, owner_type: "anonymous_profile", owner_id: testIds.ownerA, organization_id: testIds.orgOther, expert_id: testIds.expertB, access_role: "viewer", granted_by_expert_name: "test", module: "body", status: "active" },
    // Revoked access
    { id: testIds.accessRevoked, owner_type: "anonymous_profile", owner_id: testIds.ownerA, organization_id: testIds.orgClinic, expert_id: testIds.expertB, access_role: "viewer", granted_by_expert_name: "test", module: "body", status: "revoked" },
  ]);

  // Daily logs
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from("body_daily_logs").insert([
    { id: testIds.dailyLogA, session_id: testIds.sessionIdA, module: "body", log_date: today, weight_kg: 75.5, steps: 8000, sleep_hours: 7.5, mood_level: 4, calories: 2000 },
    { id: testIds.dailyLogB, session_id: testIds.sessionIdB, module: "body", log_date: today, weight_kg: 90.0, steps: 3000, sleep_hours: 6, mood_level: 3, calories: 2500 },
  ]);

  // Plate history
  await supabase.from("body_plate_history").insert([
    { id: testIds.plateA, owner_type: "anonymous_profile", owner_id: testIds.ownerA, session_id: testIds.sessionIdA, log_date: today, meal_type: "obed", balance_summary: "Сбалансировано", vegetables_assessment: "Хорошо" },
    { id: testIds.plateB, owner_type: "anonymous_profile", owner_id: testIds.ownerB, session_id: testIds.sessionIdB, log_date: today, meal_type: "obed", balance_summary: "Много углеводов", protein_assessment: "Мало" },
  ]);

  // Weekly summaries
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await supabase.from("body_weekly_summaries").insert([
    { id: testIds.weeklyA, owner_type: "anonymous_profile", owner_id: testIds.ownerA, summary_type: "weekly", period_start: weekAgo, period_end: today, source_days: 5, source_plate_count: 3, user_summary: "Неделя A", summary_json: { period_summary: "Неделя A", positive_changes: ["Больше шагов"], patterns: [], next_week_focus: ["Сон"], questions_for_specialist: [] }, request_id: "e2e", generation_status: "ready" },
    { id: testIds.weeklyB, owner_type: "anonymous_profile", owner_id: testIds.ownerB, summary_type: "weekly", period_start: weekAgo, period_end: today, source_days: 3, source_plate_count: 1, user_summary: "Неделя B", summary_json: { period_summary: "Неделя B", positive_changes: [], patterns: ["Мало сна"], next_week_focus: [], questions_for_specialist: [] }, request_id: "e2e", generation_status: "ready" },
  ]);

  // Insights
  await supabase.from("body_insights").insert([
    { id: testIds.insightA, owner_type: "anonymous_profile", owner_id: testIds.ownerA, insight_type: "activity_pattern", insight_date: today, title: "Мало шагов", insight_text: "3 дня подряд менее 5000 шагов", priority: "normal", fingerprint: "e2e-steps-low", status: "active" },
  ]);

  // Service requests
  await supabase.from("service_requests").insert([
    { id: testIds.srA, module: "body", owner_type: "anonymous_profile", owner_id: testIds.ownerA, request_type: "text_question", status: "submitted", message: "E2E request A", created_at: new Date().toISOString() },
    { id: testIds.srB, module: "body", owner_type: "anonymous_profile", owner_id: testIds.ownerB, request_type: "diary_review", status: "completed", message: "E2E request B", created_at: new Date().toISOString() },
  ]);

  console.log("Fixtures created.\n");
}

// ── Cleanup ────────────────────────────────────────────────

async function cleanup() {
  console.log("\nCleaning up fixtures...");

  // Delete in reverse dependency order
  await supabase.from("service_requests").delete().eq("id", testIds.srA);
  await supabase.from("service_requests").delete().eq("id", testIds.srB);
  await supabase.from("body_insights").delete().eq("id", testIds.insightA);
  await supabase.from("body_weekly_summaries").delete().eq("id", testIds.weeklyA);
  await supabase.from("body_weekly_summaries").delete().eq("id", testIds.weeklyB);
  await supabase.from("body_plate_history").delete().eq("id", testIds.plateA);
  await supabase.from("body_plate_history").delete().eq("id", testIds.plateB);
  await supabase.from("body_daily_logs").delete().eq("id", testIds.dailyLogA);
  await supabase.from("body_daily_logs").delete().eq("id", testIds.dailyLogB);
  await supabase.from("patient_access").delete().eq("id", testIds.accessShared);
  await supabase.from("patient_access").delete().eq("id", testIds.accessWrongOrg);
  await supabase.from("patient_access").delete().eq("id", testIds.accessRevoked);
  await supabase.from("patient_assignments").delete().eq("id", testIds.assignmentA);
  await supabase.from("patient_assignments").delete().eq("id", testIds.assignmentB);
  await supabase.from("patient_assignments").delete().eq("id", testIds.inactiveAssignment);
  await supabase.from("body_clients").delete().eq("id", testIds.bodyClientA);
  await supabase.from("body_clients").delete().eq("id", testIds.bodyClientB);
  await supabase.from("specialist_sessions").delete().eq("id", testIds.sessionAToken);
  await supabase.from("specialist_sessions").delete().eq("id", testIds.sessionBToken);
  await supabase.from("expert_organization_memberships").delete().eq("expert_id", testIds.expertA);
  await supabase.from("expert_organization_memberships").delete().eq("expert_id", testIds.expertB);
  await supabase.from("organizations").delete().eq("id", testIds.orgClinic);
  await supabase.from("organizations").delete().eq("id", testIds.orgOther);
  await supabase.from("experts").delete().eq("id", testIds.expertA);
  await supabase.from("experts").delete().eq("id", testIds.expertB);

  console.log("Cleanup complete.");
}

// ── Test cases ─────────────────────────────────────────────

async function runTests() {
  console.log("\n=== DB Access-Isolation Tests: getBodyClientOverview ===\n");

  const tokenA = testIds.sessionAToken;
  const tokenB = testIds.sessionBToken;

  // A. Specialist A opens own Body client
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    assert(r.status === 200, "A: specialist A opens own Body client (200)");
    assert(r.body.ok === true, "A: response ok=true");
    assert(r.body.client?.display_name === "E2E Клиент A", "A: correct display_name");
    assert(r.body.overview?.diary_days >= 1, "A: diary_days >= 1");
  }

  // B. Specialist B cannot open A's client
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenB);
    assert(r.status === 403, "B: specialist B rejected from A's client (403)");
  }

  // C. Wrong clinic context rejected
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgOther, module: "body" }, tokenA);
    assert(r.status === 400 || r.status === 403, "C: wrong clinic context rejected");
  }

  // D. Private-practice Body assignment works
  {
    // Create a private-practice assignment
    const privateAssignmentId = crypto.randomUUID();
    await supabase.from("patient_assignments").insert({
      id: privateAssignmentId, owner_type: "anonymous_profile", owner_id: testIds.ownerA,
      organization_id: null, primary_expert_id: testIds.expertA,
      assigned_by_expert_name: "test", module: "body", status: "active", patient_label: "E2E Private",
    });
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${privateAssignmentId}`, organization_id: null, module: "body" }, tokenA);
    assert(r.status === 200, "D: private-practice Body assignment works (200)");
    await supabase.from("patient_assignments").delete().eq("id", privateAssignmentId);
  }

  // E. module=support rejected by getBodyClientOverview
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "support" }, tokenA);
    assert(r.status === 400, "E: module=support rejected (400)");
  }

  // F. Forged client_ref rejected
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: "assignment:00000000-0000-0000-0000-000000000000", organization_id: testIds.orgClinic, module: "body" }, tokenA);
    assert(r.status === 404 || r.status === 403, "F: forged client_ref rejected");
  }

  // G. Inactive assignment rejected
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.inactiveAssignment}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    assert(r.status === 404, "G: inactive assignment rejected (404)");
  }

  // H. Shared patient_access works read-only
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `access:${testIds.accessShared}`, organization_id: testIds.orgClinic, module: "body" }, tokenB);
    assert(r.status === 200, "H: shared patient_access works (200)");
    assert(r.body.client?.relationship === "shared", "H: relationship=shared");
    assert(r.body.client?.access_role === "viewer", "H: access_role=viewer");
  }

  // I. Membership alone insufficient (expert B with membership but no assignment/access for owner A via assignment path)
  {
    // Expert B tries to open A's assignment (not their own)
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenB);
    assert(r.status === 403, "I: membership alone insufficient (403)");
  }

  // J. owner_id absent from response
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes(testIds.ownerA), "J: owner_id absent from response");
  }

  // K. anonymous_owner_id absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes("anonymous_owner_id"), "K: anonymous_owner_id absent from response");
  }

  // L. session_id absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes(testIds.sessionIdA), "L: session_id absent from response");
  }

  // M. Continuation credentials absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes("continuation") || !jsonStr.includes("HEALTH-"), "M: continuation credentials absent");
    assert(!jsonStr.includes("access_token"), "M: access_token absent");
  }

  // N. Legacy specialist_id alone grants nothing
  {
    // Try accessing with a non-existent assignment that uses old-style specialist_id
    const r = await invoke({ action: "getBodyClientOverview", client_ref: "assignment:nonexistent-uuid", organization_id: testIds.orgClinic, module: "body" }, tokenA);
    assert(r.status !== 200 || r.body.ok === false, "N: legacy specialist_id alone grants nothing");
  }

  // O. Only authorized owner's diary rows returned
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const days = r.body.recent_days || [];
    // All returned days should be from owner A's sessions
    assert(days.length >= 1, "O: owner A has diary rows");
    // Owner B's log (weight 90.0) should NOT appear
    const hasOwnerBData = days.some((d) => d.weight_kg === 90.0);
    assert(!hasOwnerBData, "O: owner B's diary rows absent from A's response");
  }

  // P. Another owner's plate history absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const plates = r.body.plate_summary?.recent_plates || [];
    const hasOwnerBPlate = plates.some((p) => p.balance_summary === "Много углеводов");
    assert(!hasOwnerBPlate, "P: owner B's plate history absent from A's response");
  }

  // Q. Another owner's weekly summaries absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const weeks = r.body.weekly_summaries || [];
    const hasOwnerBWeekly = weeks.some((w) => w.user_summary === "Неделя B");
    assert(!hasOwnerBWeekly, "Q: owner B's weekly summaries absent from A's response");
  }

  // R. Another owner's service requests absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const srs = r.body.service_requests || [];
    const hasOwnerBReq = srs.some((sr) => sr.request_type === "diary_review");
    assert(!hasOwnerBReq, "R: owner B's service requests absent from A's response");
  }

  // S. Zero-data Body client returns valid 200
  {
    // Create an owner with no daily logs, no plates, no summaries
    const emptyOwnerId = crypto.randomUUID();
    const emptyClientId = crypto.randomUUID();
    const emptySessionId = `e2e-empty-${Date.now()}`;
    const emptyAssignmentId = crypto.randomUUID();

    await supabase.from("body_clients").insert({
      id: emptyClientId, session_id: emptySessionId, anonymous_owner_id: emptyOwnerId,
      display_name: "E2E Пустой клиент", status: "active", source: "self_signup",
    });
    await supabase.from("patient_assignments").insert({
      id: emptyAssignmentId, owner_type: "anonymous_profile", owner_id: emptyOwnerId,
      organization_id: testIds.orgClinic, primary_expert_id: testIds.expertA,
      assigned_by_expert_name: "test", module: "body", status: "active", patient_label: "E2E Empty",
    });

    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${emptyAssignmentId}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    assert(r.status === 200, "S: zero-data client returns 200");
    assert(r.body.ok === true, "S: zero-data response ok=true");
    assert(r.body.overview?.diary_days === 0, "S: diary_days=0");
    assert(r.body.recent_days?.length === 0, "S: recent_days empty");
    assert(r.body.plate_summary?.total_plates === 0, "S: total_plates=0");
    assert(r.body.weekly_summaries?.length === 0, "S: weekly_summaries empty");
    assert(r.body.service_requests?.length === 0, "S: service_requests empty");

    // Cleanup empty fixtures
    await supabase.from("patient_assignments").delete().eq("id", emptyAssignmentId);
    await supabase.from("body_clients").delete().eq("id", emptyClientId);
  }

  // T. body_ai_chat data absent
  {
    // Insert a fake AI chat message for owner A
    await supabase.from("body_ai_chat").insert({
      owner_type: "anonymous_profile", owner_id: testIds.ownerA,
      role: "user", message_text: "E2E secret chat message",
    });
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes("E2E secret chat message"), "T: body_ai_chat data absent from response");
    assert(!jsonStr.includes("ai_chat"), "T: ai_chat key absent from response");
    // Cleanup
    await supabase.from("body_ai_chat").delete().eq("owner_id", testIds.ownerA).eq("message_text", "E2E secret chat message");
  }

  // U. plate_photos/base64 absent
  {
    const r = await invoke({ action: "getBodyClientOverview", client_ref: `assignment:${testIds.assignmentA}`, organization_id: testIds.orgClinic, module: "body" }, tokenA);
    const jsonStr = JSON.stringify(r.body);
    assert(!jsonStr.includes("plate_photos"), "U: plate_photos key absent");
    assert(!jsonStr.includes("data:image"), "U: base64 image data absent");
    assert(!jsonStr.includes("day_text"), "U: day_text absent");
  }
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error("Test error:", err);
    failCount++;
  } finally {
    await cleanup();
  }

  console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount > 0 ? 1 : 0);
}

main();
