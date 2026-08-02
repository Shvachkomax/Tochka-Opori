// Preview acceptance tests for Final Report Reliability Pass.
// Exercises the deployed Vercel Preview backend via API calls.
// Usage: node scripts/preview-acceptance.js

import crypto from "crypto";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const PREVIEW_URL = "https://tochka-opori-pfoqkws79-maxim-shvachko-s-projects.vercel.app";

function loadEnv(path) {
  const content = readFileSync(path, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return env;
}

const env = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? process.env
  : loadEnv(".env.local");

const { getStableReportRequestId } = await import("../lib/report/finalize.js");

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function fetchWithRetry(url, options, { retries = 3, delayMs = 1000 } = {}) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (error) {
      lastError = error;
      console.log(`  ! fetch attempt ${i + 1}/${retries} failed: ${error.message}`);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

async function postAnalyze(body) {
  const tokenRes = await fetchWithRetry(`${PREVIEW_URL}/api/client-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "analyze", module: body.module || "support" }),
  });
  if (tokenRes.status !== 200) {
    const err = await tokenRes.text();
    throw new Error(`client-token failed: ${tokenRes.status} ${err}`);
  }
  const { token } = await tokenRes.json();
  const res = await fetchWithRetry(`${PREVIEW_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

async function postSession(body) {
  const res = await fetchWithRetry(`${PREVIEW_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: data };
}

async function getSession(sessionId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("session_id, report_generation_status, report_request_id, report_completed_at, report_error_code, user_report, doctor_report, care_recommendation, anonymous_owner_id, public_code")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getWalletForSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session?.anonymous_owner_id) return null;
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

async function getDebits(sessionId, requestId) {
  const wallet = await getWalletForSession(sessionId);
  if (!wallet) return [];
  const { data, error } = await supabase
    .from("usage_ledger")
    .select("entry_type, amount, request_id, session_id, resource_type, created_at")
    .eq("wallet_id", wallet.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter((e) => e.session_id === sessionId && e.request_id === requestId);
}

async function runScenarioA() {
  console.log("\n=== Preview Scenario A: normal support session ===");
  const sessionId = `prev-a-${Date.now()}`;
  const text = "Последние недели плохо сплю, тревожусь, не могу собраться, стало трудно заниматься обычными делами.";

  const r0 = await postAnalyze({ session_id: sessionId, text, depth: 0, module: "support" });
  assert(r0.status === 200 && r0.body.type === "questions", "A: depth 0 returns questions");

  const answers = {
    0: "Началось после конфликта на работе, около двух месяцев.",
    1: "Усиливается вечером, когда одна.",
    2: "Сон прерывистый, на работе сложно концентрироваться.",
    3: "Нет, таких мыслей не было.",
    4: "Пробовал дышать и гулять, помогает ненадолго.",
    5: "Подруга рядом, но я не говорил ей подробно.",
    6: "Хочу понять, что со мной и куда обратиться.",
  };
  const history = [
    { role: "user", content: text },
    { role: "assistant", questions: r0.body.questions },
    { role: "user", answers },
  ];

  const r1 = await postAnalyze({ session_id: sessionId, text, depth: 1, answers, conversationHistory: history, module: "support" });
  assert(r1.status === 200 && r1.body.type === "questions", "A: depth 1 returns questions");
  history.push({ role: "assistant", questions: r1.body.questions });
  history.push({ role: "user", answers: { 0: "Уточнение 1" } });

  const r2 = await postAnalyze({ session_id: sessionId, text, depth: 2, answers, conversationHistory: history, module: "support" });
  assert(r2.status === 200 && r2.body.type === "questions", "A: depth 2 returns questions");
  history.push({ role: "assistant", questions: r2.body.questions });
  history.push({ role: "user", answers: { 0: "Уточнение 2" } });

  const t0 = Date.now();
  const r3 = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  const duration = Date.now() - t0;
  assert(r3.status === 200 && r3.body.type === "final", "A: final report returned");
  assert(r3.body.continuation_code && r3.body.access_token, "A: continuation code and access token returned");
  console.log(`  A: final report duration ${duration}ms`);

  const session = await getSession(sessionId);
  assert(session.report_generation_status === "ready", "A: report status ready");
  assert(session.report_request_id === getStableReportRequestId(sessionId, 3), "A: stable report request id");
  assert(session.user_report && session.doctor_report, "A: report saved in DB");

  const requestId = getStableReportRequestId(sessionId, 3);
  const debits = await getDebits(sessionId, requestId);
  assert(debits.length === 1 && debits[0].amount === 500, "A: exactly one final debit of 500");

  // Continuation exchange
  const exchange = await postSession({ action: "exchangeContinuationCredential", module: "support", continuation_code: r3.body.continuation_code });
  assert(exchange.status === 200 && exchange.body.ok, "A: continuation exchange succeeds");
  assert(exchange.body.cabinet && exchange.body.cabinet.sessions && exchange.body.cabinet.sessions.length > 0, "A: cabinet returned");
  assert(exchange.body.access_token, "A: exchanged access token returned");
  assert(!exchange.body.anonymous_owner_id, "A: anonymous_owner_id not leaked");

  const getReport = await postSession({ action: "getReportStatus", sessionId, reportRequestId: requestId, access_token: exchange.body.access_token });
  assert(getReport.status === 200 && getReport.body.status === "ready", "A: getReportStatus returns ready");
  assert(getReport.body.type === "final" && getReport.body.report, "A: report recovered via getReportStatus");

  console.log("  Scenario A passed");
  return { sessionId, duration };
}

async function runScenarioB() {
  console.log("\n=== Preview Scenario B: long risk session with recovery ===");
  const sessionId = `prev-b-${Date.now()}`;
  const text = "Я уже несколько дней не сплю, энергии слишком много, купил билет в другой город и потратил все деньги. Слышу голос, который говорит, что за мной следят. Я не могу работать, больше не выхожу из дома. Мне кажется, я могу причинить вред другому, если меня не остановят.";
  const answers = { 0: "Ответ" };
  const history = [
    { role: "user", content: text },
    { role: "assistant", questions: ["Что происходит?"] },
    { role: "user", answers },
    { role: "assistant", questions: ["Как давно?"] },
    { role: "user", answers: { 0: "Несколько дней" } },
  ];
  const requestId = getStableReportRequestId(sessionId, 3);

  const t0 = Date.now();
  const r1 = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  const duration = Date.now() - t0;
  assert(r1.status === 200 && r1.body.type === "final", "B: final report returned");
  console.log(`  B: final report duration ${duration}ms`);

  const session = await getSession(sessionId);
  assert(session.report_generation_status === "ready", "B: report status ready");
  assert(session.care_recommendation.level === "urgent_help", `B: care level urgent_help, got ${session.care_recommendation.level}`);
  assert(session.care_recommendation.timeframe === "today", "B: urgent timeframe today");
  assert(session.care_recommendation.urgent_triggers.length > 0, "B: urgent triggers present");

  const debitsAfterFirst = await getDebits(sessionId, requestId);
  assert(debitsAfterFirst.length === 1, "B: exactly one debit after first call");

  // Simulate recovery: call getReportStatus
  const status = await postSession({ action: "getReportStatus", sessionId, reportRequestId: requestId });
  assert(status.status === 200 && status.body.status === "ready", "B: getReportStatus ready");
  assert(status.body.type === "final" && status.body.report, "B: report recovered");

  // Re-call analyze with same request id
  const r2 = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  assert(r2.status === 200 && r2.body.type === "final" && r2.body._debug?.cached, "B: second call returns cached report");

  const debitsAfterSecond = await getDebits(sessionId, requestId);
  assert(debitsAfterSecond.length === 1, "B: no second debit after recovery");

  console.log("  Scenario B passed");
  return { sessionId, duration };
}

async function runScenarioC() {
  console.log("\n=== Preview Scenario C: third-party suicide event, no own intent ===");
  const sessionId = `prev-c-${Date.now()}`;
  const text = "Мой близкий друг недавно покончил с собой. Мне очень тяжело, я не могу в это поверить, плохо сплю и постоянно плачу. Но сама я не думаю о суициде, мне не нужно умирать.";
  const answers = { 0: "Нет, таких мыслей не было.", 1: "Нет, плана нет.", 2: "Да, есть близкие, с которыми могу поговорить." };
  const history = [
    { role: "user", content: text },
    { role: "assistant", questions: ["Были ли у вас мысли о себе?", "Есть ли план?", "Кто рядом?"] },
    { role: "user", answers },
  ];

  const r = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  assert(r.status === 200 && r.body.type === "final", "C: final report returned");

  const session = await getSession(sessionId);
  assert(session.care_recommendation.level !== "urgent_help", `C: not urgent_help, got ${session.care_recommendation.level}`);
  console.log(`  C: care level ${session.care_recommendation.level}`);
  console.log("  Scenario C passed");
}

async function runScenarioD() {
  console.log("\n=== Preview Scenario D: own current suicidal thoughts ===");
  const sessionId = `prev-d-${Date.now()}`;
  const text = "Я уже несколько недель думаю, что лучше умереть. У меня есть план: накоплены таблетки, я знаю, когда и как сделаю это. Написала прощальное письмо.";
  const answers = { 0: "Да, мысли есть каждый день.", 1: "Да, план есть.", 2: "Нет, никому не сказала." };
  const history = [
    { role: "user", content: text },
    { role: "assistant", questions: ["Есть ли мысли?", "Есть ли план?", "Кому сказали?"] },
    { role: "user", answers },
  ];

  const r = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  assert(r.status === 200 && r.body.type === "final", "D: final report returned");

  const session = await getSession(sessionId);
  assert(session.care_recommendation.level === "urgent_help", `D: urgent_help, got ${session.care_recommendation.level}`);
  assert(session.care_recommendation.timeframe === "today", "D: timeframe today");
  assert(session.care_recommendation.urgent_triggers.includes("suicidal_thoughts") || session.care_recommendation.reasons.includes("suicidal_thoughts"), "D: suicidal thoughts flagged");
  console.log("  Scenario D passed");
}

async function runScenarioE() {
  console.log("\n=== Preview Scenario E: continuation opens same owner/wallet ===");
  const sessionId = `prev-e-${Date.now()}`;
  const text = "Тревожусь, не сплю, не могу сосредоточиться.";
  const answers = { 0: "Нет мыслей о вреде себе.", 1: "Сплю плохо.", 2: "Работа страдает.", 3: "Подруга рядом.", 4: "Хочу разобраться.", 5: "Пробовал дыхание.", 6: "Важно понять, куда идти." };
  const history = [
    { role: "user", content: text },
    { role: "assistant", questions: ["1", "2", "3", "4", "5", "6", "7"] },
    { role: "user", answers },
  ];

  const r = await postAnalyze({ session_id: sessionId, text, depth: 3, answers, conversationHistory: history, module: "support" });
  assert(r.status === 200 && r.body.type === "final", "E: final report returned");
  const code = r.body.continuation_code;
  const ownerId = (await getSession(sessionId)).anonymous_owner_id;

  const exchange = await postSession({ action: "exchangeContinuationCredential", module: "support", continuation_code: code });
  assert(exchange.status === 200 && exchange.body.ok, "E: exchange succeeds");
  assert(exchange.body.cabinet && exchange.body.cabinet.sessions && exchange.body.cabinet.sessions.some((s) => s.sessionId === sessionId), "E: cabinet contains session");

  const wallet = await getWalletForSession(sessionId);
  assert(wallet, "E: wallet exists");
  assert(wallet.total_used >= 500, "E: wallet has at least one debit");
  console.log("  Scenario E passed");
}

async function runAll() {
  console.log(`Preview URL: ${PREVIEW_URL}`);
  // Verify the frontend loads
  const home = await fetch(PREVIEW_URL);
  assert(home.status === 200, "Preview homepage loads");

  const a = await runScenarioA();
  const b = await runScenarioB();
  await runScenarioC();
  await runScenarioD();
  await runScenarioE();

  console.log("\n=== Preview acceptance summary ===");
  console.log(`Scenario A final report duration: ${a.duration}ms`);
  console.log(`Scenario B final report duration: ${b.duration}ms`);
  console.log("All preview scenarios passed.");
}

runAll().catch((err) => {
  console.error("\nPREVIEW ACCEPTANCE FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
