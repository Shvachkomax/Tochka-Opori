// Execute real API handlers against an in-memory Supabase double; no live data.
// Run: node --experimental-test-module-mocks scripts/test-reviews-access.js
import assert from "node:assert/strict";
import { mock } from "node:test";
import crypto from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const expertId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const ownCode = "ТОЧКА-AAAA-AAAA";
const otherCode = "ТОЧКА-BBBB-BBBB";
const sharedCode = "ТОЧКА-CCCC-CCCC";
const headers = { authorization: "Bearer specialist-token", origin: "http://localhost:5173" };
let tables, calls, failTable;

function reset() {
  calls = [];
  failTable = null;
  tables = {
    experts: [{ id: expertId, name: "Test", role: "psychologist", is_active: true,
      allowed_modules: ["support"], access_code: "TEST-CODE" }],
    specialist_sessions: [{ id: "auth-1", expert_id: expertId, token_hash: hash("specialist-token"),
      expires_at: new Date(Date.now() + 3600000).toISOString(), revoked_at: null }],
    expert_organization_memberships: [{ expert_id: expertId, organization_id: "clinic-a", status: "active", role: "doctor" }],
    patient_assignments: [{ public_code: ownCode, organization_id: "clinic-a", module: "support", status: "active", primary_expert_id: expertId }],
    patient_access: [{ public_code: sharedCode, organization_id: null, module: "support", status: "active", expert_id: expertId, access_role: "viewer" }],
    sessions: [
      { session_id: "session-own", public_code: ownCode, module: "support", organization_id: "clinic-a", access_token_hash: hash("patient-token"), legacy_access: false, json_data: {} },
      { session_id: "session-other", public_code: otherCode, module: "support", organization_id: "clinic-b", access_token_hash: hash("other-token"), legacy_access: false, json_data: {} },
      { session_id: "session-shared", public_code: sharedCode, module: "support", organization_id: null, json_data: {} },
    ],
    case_reviews: [
      { id: "review-own", session_id: "session-own", public_code: ownCode, module: "support", organization_id: "clinic-a", json_data: { status: "pending", admin_secret: "old-secret" } },
      { id: "review-other", session_id: "session-other", public_code: otherCode, module: "support", organization_id: "clinic-b", json_data: { status: "pending" } },
      { id: "review-shared", session_id: "session-shared", public_code: sharedCode, module: "support", organization_id: null, json_data: {} },
    ],
    training_sessions: [
      { id: "train-own", session_id: "session-own", public_code: ownCode, organization_id: "clinic-a", expert_id: expertId, json_data: {} },
      { id: "train-other", session_id: "session-other", public_code: otherCode, organization_id: "clinic-b", expert_id: otherId, json_data: {} },
      { id: "train-shared", public_code: sharedCode, organization_id: null, expert_id: otherId, json_data: {} },
      { id: "train-wrong-org", public_code: ownCode, organization_id: "clinic-b", expert_id: expertId, json_data: {} },
      { id: "train-exercise", public_code: null, session_id: null, case_review_id: null, organization_id: null, expert_id: expertId, json_data: {} },
      { id: "train-health", public_code: "HEALTH-AAAA-AAA", expert_id: expertId, json_data: {} },
    ],
    quality_review_insights: [],
  };
}

function field(row, key) {
  const [name, nested] = key.split(/->>?/);
  return nested ? row[name]?.[nested] : row[name];
}
function splitExpressions(value) {
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    if (value[i] === ")") depth--;
    if (value[i] === "," && !depth) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
  return parts;
}
function expression(row, value) {
  if (value.startsWith("and(")) return splitExpressions(value.slice(4, -1)).every(item => expression(row, item));
  const match = value.match(/^(.+?)\.(eq|is|in)\.(.*)$/);
  assert.ok(match, `Unsupported mock expression: ${value}`);
  const [, key, op, expected] = match;
  const actual = field(row, key);
  if (op === "is") return expected === "null" && actual == null;
  if (op === "in") return expected.slice(1, -1).split(",").includes(actual);
  return String(actual) === expected;
}
class Query {
  constructor(table) { this.table = table; this.filters = []; this.operation = "read"; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => field(row, key) === value); return this; }
  is(key, value) { this.filters.push(row => value === null ? field(row, key) == null : field(row, key) === value); return this; }
  not(key, op, value) { assert.equal(op, "is"); this.filters.push(row => value === null ? field(row, key) != null : field(row, key) !== value); return this; }
  filter(key, op, value) { return op === "is" ? this.is(key, value) : this.eq(key, value); }
  or(value) { this.filters.push(row => splitExpressions(value).some(item => expression(row, item))); return this; }
  order() { return this; }
  limit(value) { this.max = value; return this; }
  ilike(key, value) { this.filters.push(row => String(field(row, key)).includes(value.replaceAll("%", ""))); return this; }
  update(value) { this.operation = "update"; this.payload = value; return this; }
  insert(value) { this.operation = "insert"; this.payload = value; return this; }
  maybeSingle() { this.singleRow = true; return this; }
  single() { this.singleRow = true; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
  execute() {
    calls.push({ table: this.table, operation: this.operation, payload: this.payload });
    if (this.table === failTable) return { data: null, error: { message: "Test database failure" } };
    let rows = (tables[this.table] || []).filter(row => this.filters.every(filter => filter(row)));
    if (this.operation === "insert") {
      const inserted = { id: `new-${this.table}`, ...this.payload };
      tables[this.table].push(inserted);
      rows = [inserted];
    }
    if (this.operation === "update") rows.forEach(row => Object.assign(row, this.payload));
    rows = rows.slice(0, this.max ?? rows.length);
    return { data: structuredClone(this.singleRow ? rows[0] || null : rows), error: null };
  }
}
const db = { from: table => new Query(table) };
process.env.ADMIN_SECRET = "test-admin-secret";
process.env.SUPABASE_URL = "https://example.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.NODE_ENV = "production";
// The production rate limiter owns a housekeeping interval. Do not keep this
// offline test process alive for that timer after assertions finish.
const originalInterval = globalThis.setInterval;
mock.method(globalThis, "setInterval", (...args) => originalInterval(...args).unref());
mock.method(globalThis, "fetch", () => { throw new Error("Network is forbidden in reviews access tests"); });
process.env.KV_URL = "";
process.env.KV_REST_API_URL = "";
process.env.VERCEL_KV_URL = "";
mock.module("../lib/supabase.js", { namedExports: { getSupabase: () => db } });
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => db } });
const { default: handler } = await import("../api/reviews.js");
const { default: specialist } = await import("../api/specialist.js");

async function request(body, requestHeaders = {}, api = handler) {
  const res = {
    code: 200, headers: {}, body: null,
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
  await api({ method: "POST", url: "/api/reviews", headers: requestHeaders, body: structuredClone(body) }, res);
  return res;
}
let passed = 0;
async function test(name, run) {
  reset();
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
const source = readFileSync(new URL("../api/reviews.js", import.meta.url), "utf8");
const actions = [...source.matchAll(/case "([^"]+)":/g)].map(match => match[1]);
const cwd = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), "reviews-auth-"));
process.chdir(scratch);
try {
  for (const action of actions) {
    await test(`${action}: missing credentials and forged expert_id denied`, async () => {
      for (const body of [{ action }, { action, expert_id: expertId }]) {
        const res = await request(body);
        assert.equal(res.code, 401);
      }
      assert.equal(calls.length, 0, "No DB operations before authentication");
    });
  }
  await test("bad admin password and expert_code are not sessions", async () => {
    assert.equal((await request({ action: "list", admin_secret: "wrong" })).code, 401);
    assert.equal((await request({ action: "listTrainingSessions", expert_code: "TEST-CODE" })).code, 401);
  });
  for (const state of ["expired", "revoked", "inactive", "wrong-token", "wrong-module"]) {
    await test(`specialist ${state} denied`, async () => {
      if (state === "expired") tables.specialist_sessions[0].expires_at = "2000-01-01";
      if (state === "revoked") tables.specialist_sessions[0].revoked_at = new Date().toISOString();
      if (state === "inactive") tables.experts[0].is_active = false;
      if (state === "wrong-module") tables.experts[0].allowed_modules = ["body"];
      const res = await request({ action: "listTrainingSessions" }, state === "wrong-token" ? { ...headers, authorization: "Bearer incorrect-token" } : headers);
      assert.equal(res.code, state === "wrong-module" ? 403 : 401);
      assert.ok(!calls.some(call => call.table === "training_sessions"));
    });
  }
  await test("verified specialist sees only current grants and standalone own exercises", async () => {
    const res = await request({ action: "listTrainingSessions", expert_id: otherId }, headers);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.sessions.map(row => row.id), ["train-own", "train-shared", "train-exercise"]);
    assert.equal(res.body.count, 3);
  });
  await test("revoked grants remove access despite historical expert_id", async () => {
    tables.patient_assignments[0].status = "revoked";
    const res = await request({ action: "listTrainingSessions" }, headers);
    assert.ok(!res.body.sessions.some(row => row.id === "train-own"));
    assert.equal((await request({ action: "getSessionTimelineDetails", session_id: "session-own" }, headers)).code, 403);
  });
  await test("inactive organization membership removes clinic access", async () => {
    tables.expert_organization_memberships[0].status = "inactive";
    const res = await request({ action: "getSessionTimeline", public_code: ownCode }, headers);
    assert.equal(res.code, 403);
  });
  await test("DB error in grants fails closed", async () => {
    failTable = "patient_access";
    const log = mock.method(console, "error", () => {});
    const res = await request({ action: "listTrainingSessions" }, headers);
    log.mock.restore();
    assert.equal(res.code, 500);
    assert.ok(!calls.some(call => call.table === "training_sessions"));
  });
  await test("timeline and details accept an assigned patient without trusting expert_id fields", async () => {
    const timeline = await request({ action: "getSessionTimeline", public_code: ownCode }, headers);
    assert.equal(timeline.code, 200);
    assert.ok(timeline.body.items.length > 0);
    const detail = await request({ action: "getSessionTimelineDetails", session_id: "session-own" }, headers);
    assert.equal(detail.code, 200);
    assert.equal(detail.body.session.session_id, "session-own");
  });
  await test("foreign patient denied on all read/write reference paths", async () => {
    for (const body of [
      { action: "getSessionTimeline", public_code: otherCode },
      { action: "getSessionTimelineDetails", case_review_id: "review-other" },
      { action: "getSessionTimelineDetails", session_id: "session-other" },
      { action: "getSessionTimelineDetails", training_session_id: "train-other" },
      { action: "createTrainingFromReview", review_id: "review-other" },
      { action: "updateTrainingSession", id: "train-other", updates: { status: "reviewed" } },
      { action: "saveTrainingSession", public_code: ownCode, session_id: "session-other" },
      { action: "saveTrainingSession", case_review_id: "review-other" },
    ]) assert.equal((await request(body, headers)).code, 403, body.action);
    assert.ok(!calls.some(call => call.operation === "insert" || (call.operation === "update" && call.table !== "specialist_sessions")));
  });
  await test("own patient plus hidden foreign identifier cannot bypass detail authorization", async () => {
    assert.equal((await request({ action: "getSessionTimelineDetails", case_review_id: "review-own", session_id: "session-other" }, headers)).code, 403);
  });
  await test("linked foreign training data is omitted from allowed detail", async () => {
    tables.training_sessions = [{ id: "foreign-link", session_id: "session-own", public_code: otherCode, expert_id: otherId }];
    const res = await request({ action: "getSessionTimelineDetails", session_id: "session-own" }, headers);
    assert.equal(res.code, 200);
    assert.equal(res.body.session.training_session_id, null);
  });
  await test("viewer can read but cannot create or alter feedback", async () => {
    assert.equal((await request({ action: "getSessionTimelineDetails", case_review_id: "review-shared" }, headers)).code, 200);
    assert.equal((await request({ action: "createTrainingFromReview", review_id: "review-shared" }, headers)).code, 403);
    assert.equal((await request({ action: "saveTrainingSession", public_code: sharedCode }, headers)).code, 403);
  });
  await test("author can update permitted feedback but cannot reassign patient", async () => {
    assert.equal((await request({ action: "updateTrainingSession", id: "train-own", updates: { status: "reviewed" } }, headers)).code, 200);
    assert.equal(tables.training_sessions[0].status, "reviewed");
    assert.equal((await request({ action: "updateTrainingSession", id: "train-own", updates: { public_code: otherCode } }, headers)).code, 403);
  });
  await test("create training resolves author from verified session and checks patient links", async () => {
    const res = await request({ action: "saveTrainingSession", expert_id: otherId, session_id: "session-own", public_code: ownCode, expert_code: "secret", json_data: { admin_secret: "nested-secret" } }, headers);
    assert.equal(res.code, 200);
    const row = tables.training_sessions.at(-1);
    assert.equal(row.expert_id, expertId);
    assert.equal(row.organization_id, "clinic-a");
    assert.ok(!JSON.stringify(row).includes("nested-secret"));
  });
  await test("create from review uses authorized source and rejects code replacement", async () => {
    assert.equal((await request({ action: "createTrainingFromReview", review_id: "review-own", public_code: otherCode }, headers)).code, 403);
    const res = await request({ action: "createTrainingFromReview", review_id: "review-own" }, headers);
    assert.equal(res.code, 200);
    assert.equal(tables.training_sessions.at(-1).organization_id, "clinic-a");
  });
  await test("CSV export excludes foreign clinic and Health records", async () => {
    const res = await request({ action: "exportTrainingCsv", expert_id: otherId }, headers);
    assert.equal(res.code, 200);
    const output = JSON.stringify(res.body);
    assert.ok(!output.includes(otherCode));
    assert.ok(!output.includes("HEALTH-"));
  });
  await test("admin list, debug and mutation remain available; secrets never echoed", async () => {
    for (const debug of [undefined, "1"]) {
      const res = await request({ action: "list", admin_secret: process.env.ADMIN_SECRET, status: "all", debug });
      assert.equal(res.code, 200);
      assert.equal(res.body.reviews.length, 3);
      assert.ok(!JSON.stringify(res.body).includes("old-secret"));
    }
    const res = await request({ action: "updateStatus", admin_secret: process.env.ADMIN_SECRET, review_id: "review-own", status: "approved" });
    assert.equal(res.code, 200);
  });
  await test("specialists cannot call global admin routes or debug list", async () => {
    for (const action of ["list", "exportJsonl", "deleteFullTestSession", "getQualityAnalysisStats", "listQualityInsights"]) {
      assert.equal((await request({ action, debug: "1", admin_secret: "wrong" }, headers)).code, 403);
    }
  });
  await test("patient save needs exact nonlegacy session token and canonical identifiers", async () => {
    for (const extra of [{ access_token: "wrong" }, { publicCode: otherCode }, { module: "body" }, { session_id: "session-other" }]) {
      const res = await request({ action: "save", sessionId: "session-own", access_token: "patient-token", ...extra });
      assert.equal(res.code, 403);
    }
    tables.sessions[0].legacy_access = true;
    assert.equal((await request({ action: "save", sessionId: "session-own", access_token: "patient-token" })).code, 403);
    assert.equal(tables.case_reviews.length, 3);
  });
  await test("patient feedback and report autosave succeed without storing credentials or forged authors", async () => {
    const res = await request({ action: "save", sessionId: "session-own", access_token: "patient-token", expert_id: otherId, patient_feedback: { rating: 5 }, nested: { token: "hidden-token" } });
    assert.equal(res.code, 200);
    assert.equal(res.body.ok, true);
    const row = tables.case_reviews.at(-1);
    assert.equal(row.public_code, ownCode);
    assert.equal(row.expert_id, null);
    assert.equal(row.json_data.patient_feedback.rating, 5);
    assert.ok(!JSON.stringify(row).includes("patient-token"));
    assert.ok(!JSON.stringify(row).includes("hidden-token"));
  });
  await test("cookie authentication requires allowed Origin; Bearer works without Origin", async () => {
    const cookie = { cookie: "tochka_specialist_session=specialist-token" };
    assert.equal((await request({ action: "listTrainingSessions" }, cookie)).code, 403);
    assert.equal((await request({ action: "listTrainingSessions" }, { ...cookie, origin: "https://evil.invalid" })).code, 403);
    assert.equal((await request({ action: "listTrainingSessions" }, { ...cookie, origin: headers.origin })).code, 200);
    assert.equal((await request({ action: "listTrainingSessions" }, { authorization: headers.authorization })).code, 200);
  });
  await test("login issues shared HttpOnly cookie and clears legacy path; logout revokes it", async () => {
    const login = await request({ action: "login", access_code: "TEST-CODE" }, { origin: headers.origin }, specialist);
    assert.equal(login.code, 200);
    const cookies = login.headers["Set-Cookie"];
    assert.ok(cookies.some(cookie => cookie.includes("Path=/api/specialist;") && cookie.includes("Max-Age=0")));
    const shared = cookies.find(cookie => cookie.includes("Path=/api;"));
    assert.match(shared, /HttpOnly; SameSite=Lax; Path=\/api; Max-Age=43200; Secure/);
    assert.ok(!login.body.token);
    const cookie = shared.split(";")[0];
    const requestHeaders = { cookie, origin: headers.origin };
    assert.equal((await request({ action: "listTrainingSessions" }, requestHeaders)).code, 200);
    const logout = await request({ action: "logout" }, requestHeaders, specialist);
    assert.equal(logout.code, 200);
    assert.equal(logout.headers["Set-Cookie"].length, 2);
    assert.equal((await request({ action: "listTrainingSessions" }, requestHeaders)).code, 401);
  });
  console.log(`\n${passed} reviews access tests passed.`);
} finally {
  process.chdir(cwd);
  rmSync(scratch, { recursive: true, force: true });
  mock.restoreAll();
}
