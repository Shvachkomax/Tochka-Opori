import assert from "node:assert/strict";
import { buildReportResponsePayload } from "../lib/report/finalize.js";

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const { syncPracticesFromReport } = await import("../api/session.js");
globalThis.setInterval = originalSetInterval;

function createPracticeStore() {
  const records = new Map();
  let nextId = 1;
  return {
    records,
    from(table) {
      assert.equal(table, "support_owner_practices");
      return {
        select() {
          const filters = {};
          const query = {
            eq(column, value) {
              filters[column] = value;
              return query;
            },
            async maybeSingle() {
              const row = [...records.values()].find((item) => (
                Object.entries(filters).every(([key, value]) => item[key] === value)
              ));
              return { data: row ? structuredClone(row) : null, error: null };
            },
          };
          return query;
        },
        async insert(input) {
          const row = { ...structuredClone(input), id: `practice-${nextId++}` };
          records.set(`${row.owner_type}:${row.owner_id}:${row.practice_key}`, row);
          return { data: row, error: null };
        },
        update(patch) {
          return {
            async eq(column, value) {
              const row = [...records.values()].find((item) => item[column] === value);
              if (row) Object.assign(row, structuredClone(patch));
              return { error: null };
            },
          };
        },
      };
    },
  };
}

const store = createPracticeStore();
const syncInput = {
  supabase: store,
  ownerId: "synthetic-owner-001",
  sessionId: "synthetic-session-001",
  userReport: "Рекомендуем попробовать заземление 5-4-3-2-1.",
  careRecommendation: { interim_support: [] },
  supportPlan: { selected_practices: [{ id: "breathing" }] },
};

await syncPracticesFromReport(syncInput);
assert.deepEqual([...store.records.keys()].sort(), [
  "anonymous_case:synthetic-owner-001:breathing",
  "anonymous_case:synthetic-owner-001:grounding",
]);

const breathing = store.records.get("anonymous_case:synthetic-owner-001:breathing");
const grounding = store.records.get("anonymous_case:synthetic-owner-001:grounding");
assert.equal(breathing.title, "Дыхание 4–6 минут при тревоге");
assert.equal(grounding.title, "Заземление 5–4–3–2–1");
assert.deepEqual(breathing.source_session_ids, ["synthetic-session-001"]);

breathing.user_status = "tried";
await syncPracticesFromReport(syncInput);
assert.equal(breathing.recommendation_count, 2, "repeated recommendation increments its count");
assert.deepEqual(breathing.source_session_ids, ["synthetic-session-001"], "source sessions remain deduplicated");
assert.equal(breathing.user_status, "tried", "sync preserves the user's practice status");
assert.equal(grounding.recommendation_count, 2);

const loggedErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => loggedErrors.push(args);
try {
  const failedSync = syncPracticesFromReport({
    ...syncInput,
    supabase: { from() { throw new Error("synthetic store failure"); } },
  }).catch((error) => console.error("[analyze] practice sync non-blocking error:", error.message));
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const payload = buildReportResponsePayload({
    userReport: "Искусственный отчёт для проверки.",
    doctorReport: "Искусственная сводка для специалиста.",
    careRecommendation: { level: "self_support", timeframe: "within_weeks" },
  });
  response.status(200).json(payload);
  await failedSync;

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.type, "final");
  assert.match(response.body.report, /Искусственный отчёт/);
  assert(loggedErrors.some((args) => args[0] === "[syncPracticesFromReport] non-blocking error:"));
} finally {
  console.error = originalConsoleError;
}

console.log("Practice sync regression tests passed.");
