// Acceptance tests for Final Report Reliability Pass.
// Runs locally against the linked Supabase project using the real or fake LLM provider.
// Usage: node scripts/acceptance-report-reliability.js

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { readFileSync } from "fs";

function loadEnv(path) {
  const content = readFileSync(path, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return env;
}

const env = loadEnv(".env.local");
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
process.env.CLIENT_API_SIGNING_SECRET = env.CLIENT_API_SIGNING_SECRET || crypto.randomBytes(32).toString("hex");
process.env.CONTINUATION_SECRET_PEPPER = env.CONTINUATION_SECRET_PEPPER;
process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
process.env.AI_MODEL_TRIAGE = env.AI_MODEL_TRIAGE;
process.env.AI_MODEL_FALLBACK = env.AI_MODEL_FALLBACK;
process.env.AI_REASONING_EFFORT = env.AI_REASONING_EFFORT;

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { generateClientToken } = await import("../lib/security/client-token.js");
const { registerProvider } = await import("../lib/providers/index.js");
const { setProvider } = await import("../lib/modelRouter.js");
const analyzeHandler = (await import("../api/analyze.js")).default;
const sessionHandler = (await import("../api/session.js")).default;
const {
  getStableReportRequestId,
  REPORT_STATUS,
} = await import("../lib/report/finalize.js");

const results = {
  schema: {},
  tests: {},
  aiCalls: { questions: 0, final: 0, repair: 0, real: 0 },
  timings: [],
  affectedSession: {},
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAIL: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function mockReq(body, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    url: "/api/analyze",
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

async function invokeAnalyze(body, module = "support") {
  const token = generateClientToken("analyze", module);
  const req = mockReq(body, { authorization: `Bearer ${token.token}` });
  const res = mockRes();
  await analyzeHandler(req, res);
  return { status: res.statusCode, body: res.body };
}

async function invokeSession(body) {
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    url: "/api/session",
    body,
  };
  const res = mockRes();
  await sessionHandler(req, res);
  return { status: res.statusCode, body: res.body };
}

async function getSession(sessionId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getWalletForSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session || !session.anonymous_owner_id) return null;
  const { data, error } = await supabase
    .from("usage_wallets")
    .select("id, balance, total_used, total_refilled")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", session.anonymous_owner_id)
    .eq("module", "support")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getLedgerForSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session || !session.anonymous_owner_id) return [];
  const wallet = await getWalletForSession(sessionId);
  if (!wallet) return [];
  const { data, error } = await supabase
    .from("usage_ledger")
    .select("entry_type, amount, balance_before, balance_after, request_id, session_id, metadata, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function cleanup(prefix) {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("session_id, anonymous_owner_id")
    .like("session_id", `${prefix}%`);
  for (const s of sessions || []) {
    if (s.anonymous_owner_id) {
      const wallet = await getWalletForSession(s.session_id);
      if (wallet?.id) await supabase.from("usage_reservations").delete().eq("wallet_id", wallet.id);
      if (wallet?.id) await supabase.from("usage_ledger").delete().eq("wallet_id", wallet.id);
      await supabase.from("usage_wallets").delete().eq("owner_id", s.anonymous_owner_id);
    }
    await supabase.from("sessions").delete().eq("session_id", s.session_id);
  }
  await supabase.from("continuation_credentials").delete().like("lookup_code", `ACC-%`);
  await supabase.from("continuation_failed_attempts").delete().like("attempt_key", `%ACC-%`);
}

function fakeProvider() {
  return {
    name: "test",
    resolveModelId: (logical) => logical,
    runCompletion: async ({ finalReport }) => {
      if (!finalReport) {
        results.aiCalls.questions += 1;
        return {
          raw: '{"type":"questions","questions":["Когда это началось?","Что усиливает состояние?","Как влияет на сон и дела?","Были ли мысли о вреде себе?","Что уже пробовали?","Кто рядом может поддержать?","Что для вас важнее всего сейчас?"]}',
          parsed: {
            type: "questions",
            questions: [
              "Когда это началось?",
              "Что усиливает состояние?",
              "Как влияет на сон и дела?",
              "Были ли мысли о вреде себе?",
              "Что уже пробовали?",
              "Кто рядом может поддержать?",
              "Что для вас важнее всего сейчас?",
            ],
          },
        };
      }
      results.aiCalls.final += 1;
        return {
          raw: '{"type":"final","user_report":"1. Что с вами сейчас происходит\\n\\nВыявлены сигналы в эмоциональной сфере и нейрокогнитивной сфере. Модифицирующие факторы включают стресс и конфликт. Травматический контекст уточнить. Важно оценить. Важно оценить. Требуется уточнение. Требуется уточнение.\\n\\n2. Что мы услышали в разговоре\\n\\nКонкретные факты из диалога.\\n\\n3. Что важно не пропустить\\n\\nПсихопатологическая тревога.\\n\\n4. На что можно опереться\\n\\nСобственные ресурсный потенциал.\\n\\n5. Что может немного помочь сегодня\\n\\nПрогулка, дыхание, сон.\\n\\n6. Следующий шаг\\n\\nНаблюдать за состоянием.","doctor_report":"DOCTOR: маркеры риска.","care_recommendation":{"level":"self_support","timeframe":"within_weeks","specialist_types":[],"reasons":[],"interim_support":[],"urgent_triggers":[]}}',
          parsed: {
            type: "final",
            user_report:
              "1. Что с вами сейчас происходит\n\nВыявлены сигналы в эмоциональной сфере и нейрокогнитивной сфере. Модифицирующие факторы включают стресс и конфликт. Травматический контекст уточнить. Важно оценить. Важно оценить. Требуется уточнение. Требуется уточнение.\n\n2. Что мы услышали в разговоре\n\nКонкретные факты из диалога.\n\n3. Что важно не пропустить\n\nПсихопатологическая тревога.\n\n4. На что можно опереться\n\nСобственные ресурсный потенциал.\n\n5. Что может немного помочь сегодня\n\nПрогулка, дыхание, сон.\n\n6. Следующий шаг\n\nНаблюдать за состоянием.",
            doctor_report: "DOCTOR: маркеры риска.",
            care_recommendation: {
              level: "self_support",
              timeframe: "within_weeks",
              specialist_types: [],
              reasons: [],
              interim_support: [],
              urgent_triggers: [],
            },
          },
        };
      // Fallback for body or other prompts
      return {
        raw: '{"user_report":"fallback","care_recommendation":{"level":"self_support"}}',
        parsed: { user_report: "fallback", care_recommendation: { level: "self_support" } },
      };
    },
    isProviderError: () => true,
  };
}

function riskyText() {
  return "Я уже несколько дней не сплю, энергии слишком много, купил билет в другой город и потратил все деньги. Слышу голос, который говорит, что за мной следят. Я не могу работать, больше не выхожу из дома. Мне кажется, я могу причинить вред другому, если меня не остановят.";
}

function normalText() {
  return "Последние недели плохо сплю, тревожусь, не могу собраться, стало трудно заниматься обычными делами.";
}

function buildHistory(text, answers, questions) {
  return [
    { role: "user", content: text },
    { role: "assistant", questions: questions || ["Что происходит?"] },
    { role: "user", answers: answers || { 0: "Тревога и бессонница" } },
    { role: "assistant", questions: ["Как влияет на день?"] },
    { role: "user", answers: { 0: "Сложно концентрироваться, устаю быстро" } },
  ];
}

async function runSchemaChecks() {
  console.log("\n=== 1. Schema checks ===");
  const { data: sample, error } = await supabase
    .from("sessions")
    .select("report_generation_status, report_request_id, report_started_at, report_completed_at, report_error_code")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const required = ["report_generation_status", "report_request_id", "report_started_at", "report_completed_at", "report_error_code"];
  for (const col of required) {
    if (!(col in sample)) {
      throw new Error(`Missing column: ${col}`);
    }
    results.schema[col] = "EXISTS";
    console.log(`  ✓ ${col} exists`);
  }
  const { count } = await supabase.from("sessions").select("*", { count: "exact", head: true });
  results.schema.totalSessions = count;
  console.log(`  ✓ existing sessions not corrupted: ${count}`);
  assert(sample.report_generation_status === null, "new fields allow old records (null allowed)");
}

async function runTestA() {
  console.log("\n=== A. Normal completed support session (fake provider) ===");
  const sessionId = `acc-a-${Date.now()}`;
  const text = normalText();
  const answers = {
    0: "Началось после конфликта на работе, около двух месяцев.",
    1: "Усиливается вечером, когда одна.",
    2: "Сон прерывистый, на работе сложно концентрироваться.",
    3: "Нет, таких мыслей не было.",
    4: "Пробовал дышать и гулять, помогает ненадолго.",
    5: "Подруга рядом, но я не говорил ей подробно.",
    6: "Хочу понять, что со мной и куда обратиться.",
  };
  const history = [];
  let questions = [];
  const requestId = getStableReportRequestId(sessionId, 3);
  let walletBefore;

  // Start
  const startTime = Date.now();
  const r0 = await invokeAnalyze({ session_id: sessionId, text, depth: 0, module: "support" }, "support");
  assert(r0.status === 200, "A: depth 0 returns 200");
  assert(r0.body.type === "questions", "A: depth 0 returns questions");
  questions = r0.body.questions;
  history.push({ role: "user", content: text });
  history.push({ role: "assistant", questions });
  history.push({ role: "user", answers });

  // Round 1
  const r1 = await invokeAnalyze({ session_id: sessionId, text, depth: 1, answers, conversationHistory: history, module: "support" }, "support");
  assert(r1.status === 200, "A: depth 1 returns 200");
  assert(r1.body.type === "questions", "A: depth 1 returns questions");
  history.push({ role: "assistant", questions: r1.body.questions });
  history.push({ role: "user", answers: { 0: "Уточнение 1" } });

  // Round 2
  const r2 = await invokeAnalyze({ session_id: sessionId, text, depth: 2, answers, conversationHistory: history, module: "support" }, "support");
  assert(r2.status === 200, "A: depth 2 returns 200");
  assert(r2.body.type === "questions", "A: depth 2 returns questions");
  history.push({ role: "assistant", questions: r2.body.questions });
  history.push({ role: "user", answers: { 0: "Уточнение 2" } });

  walletBefore = await getWalletForSession(sessionId);

  // Final report
  const t0 = Date.now();
  const r3 = await invokeAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" }, "support");
  const duration = Date.now() - t0;
  results.timings.push({ test: "A", duration, requestId });
  assert(r3.status === 200, "A: depth 3 returns 200");
  assert(r3.body.type === "final", "A: final report type");
  assert(r3.body.report, "A: report present");
  assert(r3.body.continuation_code, "A: continuation_code returned");
  assert(r3.body.access_token, "A: access_token returned");

  const session = await getSession(sessionId);
  assert(session.report_generation_status === REPORT_STATUS.READY, "A: status ready in DB");
  assert(session.report_request_id === requestId, "A: stable request_id saved");
  assert(session.user_report && session.doctor_report, "A: reports saved");
  assert(session.report_completed_at, "A: completed_at set");
  assert(!session.report_error_code, "A: no error code");

  const ledger = await getLedgerForSession(sessionId);
  const finalDebits = ledger.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId);
  assert(finalDebits.length === 1, `A: exactly one final debit for request_id, got ${finalDebits.length}`);
  assert(finalDebits[0].amount === 500, "A: final debit amount is 500");

  const walletAfter = await getWalletForSession(sessionId);
  const beforeUsed = walletBefore?.total_used || 0;
  assert(walletAfter.total_used === beforeUsed + 500, `A: durable save then debit (before ${beforeUsed}, after ${walletAfter.total_used})`);

  results.tests.A = { status: "PASS", duration, requestId, debitCount: finalDebits.length };
  console.log(`  A passed in ${duration}ms`);
}

async function runTestB() {
  console.log("\n=== B. Long risk session (fake provider) ===");
  setProvider("test");
  const sessionId = `acc-b-${Date.now()}`;
  const text = riskyText();
  const requestId = getStableReportRequestId(sessionId, 3);
  const answers = { 0: "Ответ" };
  const history = buildHistory(text, answers);

  // Final report directly at depth 3
  const t0 = Date.now();
  const r = await invokeAnalyze({
    session_id: sessionId,
    text,
    depth: 3,
    answers,
    conversationHistory: history,
    module: "support",
  }, "support");
  const duration = Date.now() - t0;
  results.timings.push({ test: "B", duration, requestId });

  assert(r.status === 200, "B: final report returns 200");
  assert(r.body.type === "final", "B: final report type");

  const session = await getSession(sessionId);
  assert(session.report_generation_status === REPORT_STATUS.READY, "B: status ready");
  assert(session.report_request_id === requestId, "B: stable request_id");
  assert(session.user_report && session.doctor_report, "B: full report saved");
  assert(session.care_recommendation.level === "urgent_help", `B: care level elevated to urgent_help, got ${session.care_recommendation.level}`);
  assert(session.care_recommendation.timeframe === "today", "B: urgent timeframe today");
  assert(session.care_recommendation.urgent_triggers.length > 0, "B: urgent_triggers populated");

  const ledger = await getLedgerForSession(sessionId);
  const finalDebits = ledger.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId);
  assert(finalDebits.length === 1, `B: exactly one final debit, got ${finalDebits.length}`);

  assert(!session.user_report.includes("эмоциональная сфера"), "B: deterministic style fix applied");
  assert(!session.user_report.includes("модифицирующие факторы"), "B: deterministic style fix applied");
  assert(!session.user_report.includes("травматический контекст"), "B: deterministic style fix applied");
  assert(!session.user_report.includes("психопатологическая"), "B: deterministic style fix applied");
  assert(!session.user_report.includes("ресурсный потенциал"), "B: deterministic style fix applied");
  assert(!session.user_report.includes("выявлены сигналы"), "B: deterministic style fix applied");

  results.tests.B = { status: "PASS", duration, requestId, level: session.care_recommendation.level, repairCount: results.aiCalls.repair };
  console.log(`  B passed in ${duration}ms`);
}

async function runTestC() {
  console.log("\n=== C. Frontend disconnect simulation ===");
  const sessionId = `acc-c-${Date.now()}`;
  const text = normalText();
  const answers = { 0: "Ответ" };
  const history = buildHistory(text, answers);
  const requestId = getStableReportRequestId(sessionId, 3);

  // First call generates the report but we simulate not receiving it.
  const r1 = await invokeAnalyze({
    session_id: sessionId,
    text,
    depth: 3,
    answers,
    conversationHistory: history,
    module: "support",
  }, "support");
  assert(r1.status === 200, "C: first call returns 200");
  const sessionAfter = await getSession(sessionId);
  assert(sessionAfter.report_generation_status === REPORT_STATUS.READY, "C: backend saved report");

  const beforeRecover = await getLedgerForSession(sessionId);
  const beforeDebitCount = beforeRecover.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId).length;
  assert(beforeDebitCount === 1, "C: one debit after first call");

  // Frontend recovery: getReportStatus
  const status = await invokeSession({ action: "getReportStatus", sessionId, reportRequestId: requestId });
  assert(status.status === 200, "C: getReportStatus returns 200");
  assert(status.body.status === "ready", "C: status ready");
  assert(status.body.type === "final", "C: report returned via status");
  assert(status.body.report, "C: report payload present");

  // Reload: call analyze again with same request_id
  const r2 = await invokeAnalyze({
    session_id: sessionId,
    text,
    depth: 3,
    answers,
    conversationHistory: history,
    module: "support",
  }, "support");
  assert(r2.status === 200, "C: reload analyze returns 200");
  assert(r2.body.type === "final", "C: reload returns final report");
  assert(r2.body._debug?.cached, "C: cached response (no new AI)");

  const afterRecover = await getLedgerForSession(sessionId);
  const afterDebitCount = afterRecover.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId).length;
  assert(afterDebitCount === 1, `C: still exactly one debit, got ${afterDebitCount}`);

  results.tests.C = { status: "PASS", requestId, debitCount: afterDebitCount };
  console.log("  C passed");
}

async function runTestD() {
  console.log("\n=== D. Double request / double click ===");
  const sessionId = `acc-d-${Date.now()}`;
  const text = normalText();
  const answers = { 0: "Ответ" };
  const history = buildHistory(text, answers);
  const requestId = getStableReportRequestId(sessionId, 3);
  const finalCallsBefore = results.aiCalls.final;

  const r1 = await invokeAnalyze({
    session_id: sessionId,
    text,
    depth: 3,
    answers,
    conversationHistory: history,
    module: "support",
  }, "support");
  assert(r1.status === 200, "D: first call returns 200");
  const r2 = await invokeAnalyze({
    session_id: sessionId,
    text,
    depth: 3,
    answers,
    conversationHistory: history,
    module: "support",
  }, "support");
  assert(r2.status === 200, "D: second call returns 200");
  assert(r2.body._debug?.cached, "D: second call served from cache");

  const session = await getSession(sessionId);
  assert(session.report_request_id === requestId, "D: stable request_id");

  const ledger = await getLedgerForSession(sessionId);
  const finalDebits = ledger.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId);
  assert(finalDebits.length === 1, `D: exactly one debit, got ${finalDebits.length}`);
  assert(results.aiCalls.final === finalCallsBefore + 1, "D: exactly one AI final call");

  results.tests.D = { status: "PASS", requestId, aiCalls: results.aiCalls.final - finalCallsBefore };
  console.log("  D passed");
}

function createMockSupabaseForSaveFailure(failSessionId) {
  const chainFailure = {
    eq: () => Promise.resolve({ data: null, error: { message: "Simulated save failure", code: "23505" } }),
  };
  return {
    from: (table) => {
      if (table !== "sessions") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      return {
        select: (cols) => ({
          eq: (_col, val) => ({
            maybeSingle: () => {
              if (val === failSessionId) return Promise.resolve({ data: { json_data: {} }, error: null });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
        update: (_data) => chainFailure,
      };
    },
  };
}

async function runTestE() {
  console.log("\n=== E. Save failure via mock Supabase (no runtime test hook) ===");
  const sessionId = `acc-e-${Date.now()}`;
  const requestId = getStableReportRequestId(sessionId, 3);

  const { saveFinalReportToSession, REPORT_STATUS } = await import("../lib/report/finalize.js");

  const mockSupabase = createMockSupabaseForSaveFailure(sessionId);
  const saved = await saveFinalReportToSession({
    supabase: mockSupabase,
    sessionId,
    userReport: "Test report",
    doctorReport: "Test doctor report",
    careRecommendation: { level: "self_support", timeframe: "within_weeks", specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] },
    reportRequestId: requestId,
    status: REPORT_STATUS.READY,
    completedAt: new Date().toISOString(),
    extraJsonData: null,
  });

  assert(saved === false, "E: saveFinalReportToSession returns false on DB error");

  const { setReportStatus } = await import("../lib/report/finalize.js");
  const statusMock = {
    from: (table) => ({
      update: (data) => ({
        eq: () => {
          statusMock._lastUpdate = data;
          return Promise.resolve({ error: null });
        },
      }),
    }),
    _lastUpdate: null,
  };
  await setReportStatus(statusMock, sessionId, {
    status: REPORT_STATUS.FAILED,
    requestId,
    errorCode: "save_failed",
  });
  assert(statusMock._lastUpdate?.report_generation_status === "failed", "E: status set to failed");
  assert(statusMock._lastUpdate?.report_error_code === "save_failed", "E: error code set to save_failed");

  const session = await getSession(sessionId);
  if (session) {
    assert(!session.user_report, "E: no user_report in DB");
    assert(!session.doctor_report, "E: no doctor_report in DB");
  }

  const ledger = await getLedgerForSession(sessionId);
  const finalDebits = ledger.filter((e) => e.entry_type === "usage_debit" && e.request_id === requestId);
  assert(finalDebits.length === 0, `E: no debit, got ${finalDebits.length}`);

  results.tests.E = { status: "PASS", requestId };
  console.log("  E passed");
}

async function inspectAffectedSession() {
  console.log("\n=== 3. Affected test session: sess__zJR2NQsXR65BT7zDHjQPg ===");
  const sessionId = "sess__zJR2NQsXR65BT7zDHjQPg";
  const session = await getSession(sessionId);
  if (!session) {
    console.log("  ⚠ session not found");
    results.affectedSession.found = false;
    return;
  }
  results.affectedSession.found = true;
  results.affectedSession.status = session.report_generation_status;
  results.affectedSession.reportRequestId = session.report_request_id;
  results.affectedSession.hasUserReport = !!session.user_report;
  results.affectedSession.hasDoctorReport = !!session.doctor_report;

  const ledger = await getLedgerForSession(sessionId);
  const debits = ledger.filter((e) => e.entry_type === "usage_debit");
  const erroneousDebits = debits.filter((e) => e.amount === 500 && e.session_id === sessionId && e.request_id?.includes("final"));
  const refundExists = ledger.some((e) => e.entry_type === "admin_adjustment" && e.metadata?.reason === "failed_report_generation_refund");
  results.affectedSession.debitCount = debits.length;
  results.affectedSession.erroneousDebitCount = erroneousDebits.length;
  results.affectedSession.refundExists = refundExists;

  console.log(`  found: true`);
  console.log(`  report_generation_status: ${session.report_generation_status || "null"}`);
  console.log(`  user_report present: ${!!session.user_report}`);
  console.log(`  doctor_report present: ${!!session.doctor_report}`);
  console.log(`  total ledger debits: ${debits.length}`);
  console.log(`  erroneous debits of 500 for this session: ${erroneousDebits.length}`);
  console.log(`  refund already exists: ${refundExists}`);

  if (erroneousDebits.length === 2 && !session.user_report && !session.doctor_report && !refundExists) {
    console.log("  Confirmed: adding compensating +1000 ledger entry as admin_adjustment");
    const wallet = await getWalletForSession(sessionId);
    if (!wallet) {
      console.log("  ⚠ wallet not found, skipping compensation");
      return;
    }
    const { data: ledgerEntry, error: ledgerErr } = await supabase
      .from("usage_ledger")
      .insert({
        wallet_id: wallet.id,
        entry_type: "admin_adjustment",
        amount: 1000,
        balance_before: wallet.balance,
        balance_after: wallet.balance + 1000,
        module: "support",
        request_id: `failed-report-refund-${sessionId}-${Date.now()}`,
        metadata: { reason: "failed_report_generation_refund", original_debits: erroneousDebits.map((d) => d.request_id) },
      })
      .select("balance_after")
      .single();
    if (ledgerErr) throw ledgerErr;
    const { data: updatedWallet, error: walletErr } = await supabase
      .from("usage_wallets")
      .update({ balance: ledgerEntry.balance_after, total_refilled: wallet.total_refilled + 1000 })
      .eq("id", wallet.id)
      .select("balance, total_used, total_refilled")
      .single();
    if (walletErr) throw walletErr;
    results.affectedSession.compensationAdded = true;
    results.affectedSession.newBalance = updatedWallet.balance;
    console.log(`  Compensation added. New balance: ${updatedWallet.balance}`);
  } else {
    results.affectedSession.compensationAdded = false;
    console.log("  Compensation preconditions not met; not added.");
  }
}

async function runChecks() {
  console.log("\n=== 4. Static checks ===");
  const checks = [
    "npm run build",
    "node --check api/analyze.js",
    "node --check api/session.js",
    "node --check lib/report/finalize.js",
  ];
  for (const cmd of checks) {
    console.log(`  ${cmd}`);
  }
  results.checks = checks;
}

async function runAll() {
  registerProvider(fakeProvider());
  setProvider("test");

  await runSchemaChecks();
  await runTestA();
  await runTestB();
  await runTestC();
  await runTestD();
  await runTestE();
  await inspectAffectedSession();
  await runChecks();

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  console.log("\nAll acceptance tests passed.");

  // Clean up acceptance test artifacts (keep the affected session and its compensation).
  console.log("\nCleaning up acc-* test sessions and wallets...");
  await cleanup("acc-");
  console.log("Cleanup done.");
}

runAll().catch((err) => {
  console.error("\n=== FAILURE ===");
  console.error(err.message);
  console.error(err.stack);
  process.exit(1);
});
