// SEC-003 regression tests. Pure local mocks and source-contract checks:
// no network, Supabase, production data, or credential values are used.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolveSessionAccess, validateSessionAccess } from "../lib/security/access-token.js";
import { resolveContinuationRegenerationOwner } from "../lib/session/continuation-access.js";
import { handleGetReportStatus, handleSave } from "../api/session.js";
import { createReportArtifacts } from "../lib/report/finalize.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function makeSupabase({ sessions = [], bodyClients = [] } = {}) {
  const tables = { sessions, body_clients: bodyClients };
  return {
    from(tableName) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        async maybeSingle() {
          const rows = (tables[tableName] || []).filter((row) =>
            filters.every(([column, value]) => row[column] === value));
          if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
          return { data: rows[0] || null, error: null };
        },
      };
      return query;
    },
  };
}

function makeMutableSupabase({
  sessions = [],
  beforeConditionalUpdate = null,
  beforeMaybeSingle = null,
} = {}) {
  const tables = {
    sessions: sessions.map((row) => structuredClone(row)),
    patient_assignments: [],
    patient_access: [],
  };
  const audit = {
    protectedReportReads: 0,
    sessionUpdates: 0,
    inserts: 0,
  };
  let maybeSingleCount = 0;

  function from(tableName) {
    const filters = [];
    let operation = "select";
    let updatePayload = null;
    let selectedColumns = "";
    let beforeUpdateApplied = false;

    const query = {
      select(columns = "*") {
        selectedColumns = columns;
        if (tableName === "sessions" && /user_report|doctor_report/.test(columns)) {
          audit.protectedReportReads += 1;
        }
        return query;
      },
      update(payload) {
        operation = "update";
        updatePayload = structuredClone(payload);
        return query;
      },
      insert(payload) {
        operation = "insert";
        const values = Array.isArray(payload) ? payload : [payload];
        for (const value of values) tables[tableName].push(structuredClone(value));
        audit.inserts += values.length;
        return Promise.resolve({ data: structuredClone(values), error: null });
      },
      eq(column, value) {
        filters.push([column, value]);
        return query;
      },
      async maybeSingle() {
        maybeSingleCount += 1;
        if (beforeMaybeSingle) {
          await beforeMaybeSingle({
            count: maybeSingleCount,
            tableName,
            operation,
            selectedColumns,
            filters: structuredClone(filters),
            tables,
          });
        }
        if (operation === "update" && beforeConditionalUpdate && !beforeUpdateApplied) {
          beforeUpdateApplied = true;
          await beforeConditionalUpdate(tables);
        }
        const rows = (tables[tableName] || []).filter((row) =>
          filters.every(([column, value]) => row[column] === value));
        if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
        if (operation === "update") {
          if (rows.length === 0) return { data: null, error: null };
          Object.assign(rows[0], structuredClone(updatePayload));
          audit.sessionUpdates += tableName === "sessions" ? 1 : 0;
          return { data: structuredClone(rows[0]), error: null };
        }
        return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      },
    };
    return query;
  }

  return { from, tables, audit };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  };
}

function makeSaveDependencies(supabase, counters) {
  return {
    supabase,
    ensureWallet: async () => {
      counters.wallet += 1;
      return { id: "wallet-sec-003" };
    },
    setWalletVisible: async () => { counters.walletVisible += 1; },
    getUsageBalanceForClient: async () => ({ visible: true, balance: 1000 }),
    getOrCreateContinuationCredential: async () => {
      counters.credentials += 1;
      return {
        credential: { lookup_code: "ТОЧКА-SAFE-0001" },
        secret: "SAFE-SECRET",
        isNew: true,
      };
    },
  };
}

async function invokeSave({ row = null, body = {}, beforeConditionalUpdate = null } = {}) {
  const store = makeMutableSupabase({
    sessions: row ? [row] : [],
    beforeConditionalUpdate,
  });
  const counters = { wallet: 0, walletVisible: 0, credentials: 0 };
  const res = makeResponse();
  await handleSave({ body }, res, makeSaveDependencies(store, counters));
  return { res, store, counters };
}

async function invokeReportStatus({ rows, body, beforeMaybeSingle = null }) {
  const store = makeMutableSupabase({ sessions: rows, beforeMaybeSingle });
  const res = makeResponse();
  await handleGetReportStatus({ body }, res, { supabase: store });
  return { res, store };
}

const sessions = [
  {
    session_id: "legacy-support",
    module: "support",
    anonymous_owner_id: "support-owner",
    access_token_hash: hash("legacy-legitimate-token"),
    legacy_access: true,
  },
  {
    session_id: "modern-support",
    module: "support",
    anonymous_owner_id: "support-owner",
    access_token_hash: hash("modern-support-token"),
    legacy_access: false,
  },
  {
    session_id: "foreign-support",
    module: "support",
    anonymous_owner_id: "foreign-owner",
    access_token_hash: hash("foreign-token"),
    legacy_access: false,
  },
  {
    session_id: "body-session",
    module: "body",
    anonymous_owner_id: "body-owner",
    access_token_hash: hash("body-token"),
    legacy_access: false,
  },
  {
    session_id: "body-owner-mismatch",
    module: "body",
    anonymous_owner_id: "session-owner",
    access_token_hash: hash("mismatch-token"),
    legacy_access: false,
  },
  {
    session_id: "body-owner-recovery",
    module: "body",
    anonymous_owner_id: null,
    access_token_hash: hash("recovery-token"),
    legacy_access: true,
  },
  {
    session_id: "legacy-no-hash",
    module: "support",
    anonymous_owner_id: "no-hash-owner",
    access_token_hash: null,
    legacy_access: true,
  },
];

const bodyClients = [
  { session_id: "body-session", anonymous_owner_id: "body-owner" },
  { session_id: "body-owner-mismatch", anonymous_owner_id: "body-client-owner" },
  { session_id: "body-owner-recovery", anonymous_owner_id: "recovered-body-owner" },
];
const supabase = makeSupabase({ sessions, bodyClients });

console.log("SEC-003 token verification");
assert.equal(await validateSessionAccess("legacy-support", "arbitrary-token", { supabase }), false,
  "legacy session + arbitrary non-empty token is denied");
assert.equal(await validateSessionAccess("legacy-support", "legacy-legitimate-token", { supabase }), true,
  "a legacy row with the exact retained token remains accessible");
assert.equal(await validateSessionAccess("modern-support", "modern-support-token", { supabase }), true,
  "valid modern token is accepted");
assert.equal(await validateSessionAccess("foreign-support", "modern-support-token", { supabase }), false,
  "another user's token is denied");
assert.equal(await validateSessionAccess("legacy-no-hash", "anything", { supabase }), false,
  "legacy flag cannot replace a stored token hash");
assert.equal(await validateSessionAccess("modern-support", "modern-support-token", {
  expectedModule: "body", supabase,
}), false, "Support credential cannot authorize Health");
assert.equal(await validateSessionAccess("body-session", "body-token", {
  expectedModule: "support", supabase,
}), false, "Health credential cannot authorize Support");

const resolvedModern = await resolveSessionAccess("modern-support", "modern-support-token", {
  expectedModule: "support", supabase,
});
assert.deepEqual(resolvedModern, {
  sessionId: "modern-support",
  module: "support",
  anonymousOwnerId: "support-owner",
  legacyAccess: false,
});

console.log("SEC-003 continuation regeneration binding");
assert.deepEqual(await resolveContinuationRegenerationOwner({
  sessionId: "modern-support",
  accessToken: "modern-support-token",
  module: "support",
  supabase,
}), {
  ownerId: "support-owner",
  ownerType: "anonymous_case",
  module: "support",
  sessionId: "modern-support",
}, "Support regeneration resolves the authenticated canonical owner");
assert.equal(await resolveContinuationRegenerationOwner({
  sessionId: "legacy-support",
  accessToken: "arbitrary-token",
  module: "support",
  supabase,
}), null, "arbitrary token cannot regenerate a legacy credential");
assert.equal(await resolveContinuationRegenerationOwner({
  sessionId: "modern-support",
  accessToken: "modern-support-token",
  module: "body",
  supabase,
}), null, "module substitution is denied during regeneration");
assert.deepEqual(await resolveContinuationRegenerationOwner({
  sessionId: "body-session",
  accessToken: "body-token",
  module: "body",
  supabase,
}), {
  ownerId: "body-owner",
  ownerType: "anonymous_profile",
  module: "body",
  sessionId: "body-session",
}, "Health regeneration requires the matching body canonical owner");
assert.equal(await resolveContinuationRegenerationOwner({
  sessionId: "body-owner-mismatch",
  accessToken: "mismatch-token",
  module: "body",
  supabase,
}), null, "conflicting sessions/body_clients owners fail closed");
assert.deepEqual(await resolveContinuationRegenerationOwner({
  sessionId: "body-owner-recovery",
  accessToken: "recovery-token",
  module: "body",
  supabase,
}), {
  ownerId: "recovered-body-owner",
  ownerType: "anonymous_profile",
  module: "body",
  sessionId: "body-owner-recovery",
}, "a valid retained token can use an existing Health canonical owner without mutating data");

console.log("SEC-003 route-level save authorization");
const saveToken = "save-modern-token";
const foreignSaveToken = "save-foreign-token";
const modernSaveRow = {
  id: "row-save-modern",
  session_id: "save-modern-01",
  module: "support",
  public_code: "ТОЧКА-SAVE-0001",
  organization_id: null,
  primary_expert_id: null,
  invite_token: null,
  access_token_hash: hash(saveToken),
  legacy_access: false,
  anonymous_owner_id: "owner-save-modern",
  patient_text: "before",
  user_report: "before-report",
  doctor_report: "before-doctor",
  json_data: {},
};

async function assertSaveDenied({ label, row = modernSaveRow, body, expectedStatus }) {
  const before = row ? structuredClone(row) : null;
  const result = await invokeSave({ row, body });
  assert.equal(result.res.statusCode, expectedStatus, label);
  assert.equal(result.store.audit.sessionUpdates, 0, `${label}: no protected update`);
  assert.equal(result.counters.credentials, 0, `${label}: no credential creation`);
  assert.equal(result.counters.wallet, 0, `${label}: no wallet side effect`);
  if (before) assert.deepEqual(result.store.tables.sessions[0], before, `${label}: row remains unchanged`);
  else assert.equal(result.store.tables.sessions.length, 0, `${label}: caller-chosen id is not inserted`);
}

await assertSaveDenied({
  label: "existing save without token is denied",
  body: { action: "save", sessionId: modernSaveRow.session_id, module: "support", patient_text: "attack" },
  expectedStatus: 401,
});
await assertSaveDenied({
  label: "existing save with arbitrary token is denied",
  body: { action: "save", sessionId: modernSaveRow.session_id, module: "support", access_token: "arbitrary", patient_text: "attack" },
  expectedStatus: 403,
});
await assertSaveDenied({
  label: "existing save with another session token is denied",
  body: { action: "save", sessionId: modernSaveRow.session_id, module: "support", access_token: foreignSaveToken, patient_text: "attack" },
  expectedStatus: 403,
});
await assertSaveDenied({
  label: "module substitution during save is denied",
  body: { action: "save", sessionId: modernSaveRow.session_id, module: "body", access_token: saveToken, patient_text: "attack" },
  expectedStatus: 403,
});
await assertSaveDenied({
  label: "client-supplied owner substitution is denied",
  body: {
    action: "save",
    sessionId: modernSaveRow.session_id,
    module: "support",
    access_token: saveToken,
    anonymous_owner_id: "attacker-owner",
    patient_text: "attack",
  },
  expectedStatus: 403,
});
await assertSaveDenied({
  label: "legacy save remains denied even with its retained exact token",
  row: { ...modernSaveRow, id: "row-save-legacy", session_id: "save-legacy-01", legacy_access: true },
  body: { action: "save", sessionId: "save-legacy-01", module: "support", access_token: saveToken, patient_text: "attack" },
  expectedStatus: 403,
});
await assertSaveDenied({
  label: "a missing row requires the server bootstrap instead of client-id insertion",
  row: null,
  body: { action: "save", sessionId: "client-chosen-01", module: "support", access_token: saveToken },
  expectedStatus: 409,
});

const authorizedSave = await invokeSave({
  row: modernSaveRow,
  body: {
    action: "save",
    sessionId: modernSaveRow.session_id,
    module: "support",
    access_token: saveToken,
    patient_text: "authorized update",
    user_report: "authorized report",
    doctor_report: "authorized doctor report",
    conversationHistory: [],
  },
});
assert.equal(authorizedSave.res.statusCode, 200, "server-bootstrapped session saves with its exact token");
assert.equal(authorizedSave.store.audit.sessionUpdates, 1, "authorized save updates exactly one row");
assert.equal(authorizedSave.store.tables.sessions[0].patient_text, "authorized update");
assert.equal(authorizedSave.store.tables.sessions[0].module, modernSaveRow.module, "module stays canonical");
assert.equal(authorizedSave.store.tables.sessions[0].anonymous_owner_id, modernSaveRow.anonymous_owner_id, "owner stays canonical");
assert.equal(authorizedSave.store.tables.sessions[0].access_token_hash, modernSaveRow.access_token_hash, "token hash is not replaced");
assert.equal(authorizedSave.res.body.access_token, undefined, "save never reissues the access token");
assert.equal(authorizedSave.counters.credentials, 1, "credential creation happens only after authorized persistence");

const raceSave = await invokeSave({
  row: modernSaveRow,
  body: {
    action: "save",
    sessionId: modernSaveRow.session_id,
    module: "support",
    access_token: saveToken,
    patient_text: "must not win race",
  },
  beforeConditionalUpdate: async (tables) => {
    tables.sessions[0].access_token_hash = hash("rotated-during-save");
  },
});
assert.equal(raceSave.res.statusCode, 409, "authorization CAS rejects a token change between check and update");
assert.equal(raceSave.store.audit.sessionUpdates, 0, "CAS race performs no protected update");
assert.equal(raceSave.store.tables.sessions[0].patient_text, modernSaveRow.patient_text, "CAS race preserves protected payload");
assert.equal(raceSave.counters.credentials, 0, "CAS race issues no credential");

const concurrentStore = makeMutableSupabase({ sessions: [modernSaveRow] });
const concurrentCounters = { wallet: 0, walletVisible: 0, credentials: 0 };
const legitimateResponse = makeResponse();
const attackerResponse = makeResponse();
await Promise.all([
  handleSave({ body: {
    action: "save", sessionId: modernSaveRow.session_id, module: "support",
    access_token: saveToken, patient_text: "legitimate first save",
  } }, legitimateResponse, makeSaveDependencies(concurrentStore, concurrentCounters)),
  handleSave({ body: {
    action: "save", sessionId: modernSaveRow.session_id, module: "support",
    access_token: foreignSaveToken, patient_text: "attacker first save",
  } }, attackerResponse, makeSaveDependencies(concurrentStore, concurrentCounters)),
]);
assert.equal(legitimateResponse.statusCode, 200, "legitimate concurrent first save succeeds");
assert.equal(attackerResponse.statusCode, 403, "foreign concurrent first save is denied");
assert.equal(concurrentStore.tables.sessions[0].patient_text, "legitimate first save", "foreign request cannot capture the session");
assert.equal(concurrentStore.tables.sessions[0].anonymous_owner_id, modernSaveRow.anonymous_owner_id, "concurrent save preserves canonical owner");

console.log("SEC-003 route-level report polling authorization");
const reportToken = "report-modern-token";
const reportRequestId = "support-final:report-modern-01:3";
const reportRow = {
  id: "row-report-modern",
  session_id: "report-modern-01",
  module: "support",
  anonymous_owner_id: "owner-report-modern",
  access_token_hash: hash(reportToken),
  legacy_access: false,
  public_code: "ТОЧКА-REPT-0001",
  report_generation_status: "ready",
  report_request_id: reportRequestId,
  user_report: "private user report",
  doctor_report: "private doctor report",
  care_recommendation: { level: "self_support" },
};
const foreignReportRow = {
  ...reportRow,
  id: "row-report-foreign",
  session_id: "report-foreign-01",
  anonymous_owner_id: "owner-report-foreign",
  access_token_hash: hash("foreign-report-token"),
  report_request_id: "support-final:report-foreign-01:3",
};
const healthReportRow = {
  ...reportRow,
  id: "row-report-health",
  session_id: "report-health-01",
  module: "body",
  anonymous_owner_id: "owner-report-health",
  access_token_hash: hash("health-report-token"),
  report_request_id: "support-final:report-health-01:3",
};

const noProofStatus = await invokeReportStatus({
  rows: [reportRow],
  body: { action: "getReportStatus", module: "support", sessionId: reportRow.session_id, reportRequestId },
});
assert.equal(noProofStatus.res.statusCode, 401, "report status without proof is denied");
assert.equal(noProofStatus.store.audit.protectedReportReads, 0, "no-proof polling does not read report fields");

const wrongProofStatus = await invokeReportStatus({
  rows: [reportRow, foreignReportRow],
  body: {
    action: "getReportStatus", module: "support", sessionId: reportRow.session_id,
    reportRequestId, access_token: "foreign-report-token",
  },
});
assert.equal(wrongProofStatus.res.statusCode, 403, "report status with foreign proof is denied");
assert.equal(wrongProofStatus.store.audit.protectedReportReads, 0, "foreign proof does not read report fields");

const moduleMismatchStatus = await invokeReportStatus({
  rows: [reportRow, healthReportRow],
  body: {
    action: "getReportStatus", module: "body", sessionId: reportRow.session_id,
    reportRequestId, access_token: reportToken,
  },
});
assert.equal(moduleMismatchStatus.res.statusCode, 403, "Support/Health polling mismatch is denied");
assert.equal(moduleMismatchStatus.store.audit.protectedReportReads, 0, "module mismatch reads no report fields");

const legacyStatus = await invokeReportStatus({
  rows: [{ ...reportRow, id: "row-report-legacy", session_id: "report-legacy-01", legacy_access: true }],
  body: {
    action: "getReportStatus", module: "support", sessionId: "report-legacy-01",
    reportRequestId, access_token: reportToken,
  },
});
assert.equal(legacyStatus.res.statusCode, 403, "legacy report polling is denied");
assert.equal(legacyStatus.store.audit.protectedReportReads, 0, "legacy denial occurs before protected read");

const mismatchedRequestStatus = await invokeReportStatus({
  rows: [reportRow],
  body: {
    action: "getReportStatus", module: "support", sessionId: reportRow.session_id,
    reportRequestId: `${reportRequestId}-tampered`, access_token: reportToken,
  },
});
assert.equal(mismatchedRequestStatus.res.statusCode, 409, "tampered report request id gets a neutral conflict");
assert.equal(mismatchedRequestStatus.store.audit.sessionUpdates, 0, "request-id mismatch changes no state");
assert.equal(mismatchedRequestStatus.store.audit.protectedReportReads, 0, "request-id mismatch reads no report fields");

const validStatus = await invokeReportStatus({
  rows: [reportRow],
  body: {
    action: "getReportStatus", module: "support", sessionId: reportRow.session_id,
    reportRequestId, access_token: reportToken,
  },
});
assert.equal(validStatus.res.statusCode, 200, "report status with exact proof succeeds");
assert.equal(validStatus.res.body.type, "final");
assert.match(validStatus.res.body.report, /private user report/);
assert.equal(validStatus.res.body.access_token, undefined, "polling never returns an access token");
assert.equal(validStatus.res.body.continuation_code, undefined, "polling never returns a continuation secret");
assert.equal(validStatus.res.headers["cache-control"], "no-store", "authorized report polling is non-cacheable");
assert.equal(validStatus.store.audit.sessionUpdates, 0, "authorized polling remains read-only");

const repeatedStatus = await invokeReportStatus({
  rows: [reportRow],
  body: {
    action: "getReportStatus", module: "support", sessionId: reportRow.session_id,
    reportRequestId, access_token: reportToken,
  },
});
assert.equal(repeatedStatus.res.statusCode, 200, "repeated authorized polling remains available");
assert.equal(repeatedStatus.res.body.access_token, undefined);
assert.equal(repeatedStatus.res.body.continuation_code, undefined);
assert.deepEqual(repeatedStatus.store.tables.sessions[0], reportRow, "repeated polling mutates no session or credential state");

const rotatedDuringPoll = await invokeReportStatus({
  rows: [reportRow],
  body: {
    action: "getReportStatus", module: "support", sessionId: reportRow.session_id,
    reportRequestId, access_token: reportToken,
  },
  beforeMaybeSingle: async ({ count, tables }) => {
    // First read validates the token. Simulate a concurrent token rotation
    // immediately before the handler's metadata SELECT.
    if (count === 2) tables.sessions[0].access_token_hash = hash("rotated-during-poll");
  },
});
assert.equal(rotatedDuringPoll.res.statusCode, 404,
  "polling rejects a token rotated between validation and report lookup");
assert.equal(rotatedDuringPoll.store.audit.protectedReportReads, 0,
  "polling token race cannot read report fields");
assert.equal(rotatedDuringPoll.store.audit.sessionUpdates, 0,
  "polling token race performs no handler mutation");

console.log("SEC-003 authorized report artifact delivery");
const artifactStore = makeMutableSupabase({ sessions: [reportRow] });
let artifactCredentialExists = false;
let artifactCredentialCalls = 0;
const artifactDependencies = {
  getOrCreateContinuationCredential: async () => {
    artifactCredentialCalls += 1;
    if (artifactCredentialExists) {
      return { credential: { lookup_code: "ТОЧКА-ARTF-0001" }, secret: null, isNew: false };
    }
    artifactCredentialExists = true;
    return { credential: { lookup_code: "ТОЧКА-ARTF-0001" }, secret: "ONE-TIME-SECRET", isNew: true };
  },
  ensureWallet: async () => ({ id: "wallet-artifact" }),
  setWalletVisible: async () => {},
};
const firstArtifacts = await createReportArtifacts({
  supabase: artifactStore,
  sessionId: reportRow.session_id,
  module: "support",
  anonymousOwnerId: reportRow.anonymous_owner_id,
  accessToken: reportToken,
}, artifactDependencies);
assert.equal(firstArtifacts.authorized, true, "authorized finalization can create the first continuation credential");
assert.equal(firstArtifacts.accessToken, null, "finalization never mints or reissues an access token");
assert.equal(firstArtifacts.continuationCode, "ТОЧКА-ARTF-0001-ONE-TIME-SECRET");

const repeatedArtifacts = await createReportArtifacts({
  supabase: artifactStore,
  sessionId: reportRow.session_id,
  module: "support",
  anonymousOwnerId: reportRow.anonymous_owner_id,
  accessToken: reportToken,
}, artifactDependencies);
assert.equal(repeatedArtifacts.authorized, true);
assert.equal(repeatedArtifacts.continuationCode, null, "repeated authorized finalization does not reissue the full credential");

const deniedArtifacts = await createReportArtifacts({
  supabase: artifactStore,
  sessionId: reportRow.session_id,
  module: "support",
  anonymousOwnerId: reportRow.anonymous_owner_id,
  accessToken: "wrong-artifact-token",
}, artifactDependencies);
assert.equal(deniedArtifacts.authorized, false, "invalid proof cannot create report artifacts");
assert.equal(deniedArtifacts.continuationCode, null);
assert.equal(artifactCredentialCalls, 2, "invalid proof never reaches credential storage");

const rotatedArtifactStore = makeMutableSupabase({
  sessions: [reportRow],
  beforeMaybeSingle: async ({ count, tables }) => {
    if (count === 2) tables.sessions[0].access_token_hash = hash("rotated-during-finalization");
  },
});
const rotatedArtifacts = await createReportArtifacts({
  supabase: rotatedArtifactStore,
  sessionId: reportRow.session_id,
  module: "support",
  anonymousOwnerId: reportRow.anonymous_owner_id,
  accessToken: reportToken,
}, artifactDependencies);
assert.equal(rotatedArtifacts.authorized, false,
  "credential creation rejects a token rotated after initial validation");
assert.equal(rotatedArtifacts.continuationCode, null);
assert.equal(artifactCredentialCalls, 2,
  "credential rotation race never reaches continuation credential storage");

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} exists after ${name}`);
  return source.slice(start, end);
}

console.log("SEC-003 route source contracts");
const [sessionSource, analyzeSource, transcribeSource, accessSource, inventorySql, appSource, finalizeSource, startSessionSource] = await Promise.all([
  readFile(new URL("../api/session.js", import.meta.url), "utf8"),
  readFile(new URL("../api/analyze.js", import.meta.url), "utf8"),
  readFile(new URL("../api/transcribe.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/security/access-token.js", import.meta.url), "utf8"),
  readFile(new URL("./sec-003-legacy-access-inventory.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/report/finalize.js", import.meta.url), "utf8"),
  readFile(new URL("../api/start-session.js", import.meta.url), "utf8"),
]);

assert.equal(accessSource.includes("if (data.legacy_access === true) return true"), false,
  "central validator has no legacy authorization bypass");

const loadBlock = functionBlock(sessionSource, "handleLoad", "makeSessionSummary");
const loadAuthIndex = loadBlock.indexOf("validateSessionAccess");
const protectedReadIndex = loadBlock.indexOf('"session_id, module, public_code, patient_text');
assert.ok(loadAuthIndex > 0 && protectedReadIndex > loadAuthIndex,
  "public-code lookup verifies the token before selecting protected report fields");
assert.equal(loadBlock.includes("!data.legacy_access"), false,
  "load has no legacy tokenless branch");

const saveBlock = functionBlock(sessionSource, "handleSave", "handleLoad");
assert.ok(saveBlock.includes("SESSION_BOOTSTRAP_REQUIRED"),
  "save cannot bootstrap from a caller-chosen session id");
assert.ok(saveBlock.includes("resolveSessionAccess(sessionId, access_token"),
  "save requires the exact existing access token");
for (const predicate of [
  '.eq("module", storedSession.module)',
  '.eq("anonymous_owner_id", anonymousOwnerId)',
  '.eq("access_token_hash", storedSession.access_token_hash)',
  '.eq("legacy_access", false)',
]) {
  assert.ok(saveBlock.includes(predicate), `save CAS includes ${predicate}`);
}
assert.ok(saveBlock.indexOf("updatedSession") < saveBlock.indexOf("getOrCreateCredential"),
  "save issues continuation material only after the conditional update succeeds");

const bootstrapInsertIndex = startSessionSource.indexOf('.from("sessions").insert');
const bootstrapTokenIndex = startSessionSource.indexOf("generateSessionAccessToken(sessionId, {");
assert.ok(startSessionSource.includes("crypto.randomBytes(16)"),
  "Support bootstrap uses a cryptographically random server session id");
assert.ok(startSessionSource.includes("crypto.randomUUID()"),
  "Support bootstrap creates the canonical owner on the server");
assert.ok(bootstrapInsertIndex > 0 && bootstrapTokenIndex > bootstrapInsertIndex,
  "Support bootstrap persists the canonical row before issuing proof of possession");
assert.ok(startSessionSource.includes("legacy_access: false"),
  "Support bootstrap creates a modern non-legacy session");
assert.ok(appSource.includes("const sessionData = await ensureStartSession()"),
  "the first patient round waits for secure bootstrap before analysis");

const reportStatusBlock = functionBlock(sessionSource, "handleGetReportStatus", "handleGetBodyCabinet");
assert.ok(reportStatusBlock.includes('expectedModule: "support"'),
  "report polling binds proof to Support");
assert.ok(reportStatusBlock.includes('reportRequestId !== session.report_request_id'),
  "report polling binds the status request to the exact report operation");
assert.ok(reportStatusBlock.includes('.eq("access_token_hash", accessTokenHash)'),
  "report polling repeats the token-hash condition in protected reads");
assert.ok(reportStatusBlock.includes('.eq("legacy_access", false)'),
  "report polling repeats the modern-session condition in protected reads");
assert.equal(reportStatusBlock.includes("createReportArtifacts"), false,
  "report polling never creates credentials");
assert.equal(reportStatusBlock.includes("response.access_token"), false,
  "report polling never returns access tokens");
assert.equal(reportStatusBlock.includes("response.continuation_code"), false,
  "report polling never returns continuation secrets");

assert.ok(appSource.includes("reportRequestId") && appSource.includes("access_token: proof.accessToken"),
  "client polling sends the stored credential pair and exact report request id");
assert.ok(appSource.includes("getReportStatusProof"),
  "client never falls back to a token belonging to another session");
assert.equal(finalizeSource.includes("generateSessionAccessToken"), false,
  "report finalization cannot mint an access token");
assert.ok(finalizeSource.includes("resolveAccess(sessionId, accessToken"),
  "report credential creation requires the existing session proof");
assert.ok(finalizeSource.includes('.eq("access_token_hash", accessTokenHash)'),
  "report credential creation repeats the token-hash condition before issuing a secret");
assert.ok(analyzeSource.includes("reportRequestId: finalReportRequestId")
  && analyzeSource.includes("reportRequestId,"),
"final and cached report responses expose the bound request id for safe recovery");

const updatePlanBlock = functionBlock(sessionSource, "handleUpdateSupportPlan", "handleSaveConversationPairs");
assert.ok(updatePlanBlock.includes('expectedModule: "support"'), "support-plan update binds token to Support");
assert.ok(updatePlanBlock.includes('.eq("session_id", sessionData.session_id)'),
  "support-plan update mutates the authenticated row, not a second public code");
assert.equal(updatePlanBlock.includes("legacy_access"), false, "support-plan update has no legacy bypass");

const pairsBlock = functionBlock(sessionSource, "handleSaveConversationPairs", "mergePairs");
assert.ok(pairsBlock.includes('expectedModule: "support"'), "conversation writes bind token to Support");
assert.equal(pairsBlock.includes(".insert("), false, "protected conversation route cannot create an unauthenticated row");
assert.equal(pairsBlock.includes("legacy_access"), false, "conversation writes have no legacy bypass");

const diaryBlock = functionBlock(sessionSource, "handleListBodyDailyLogs", "handleValidateInviteToken");
assert.ok(diaryBlock.includes('expectedModule: "body"'), "diary reads bind token to Health");
assert.equal(diaryBlock.includes("legacy_access"), false, "diary reads have no legacy bypass");

const regenerateBlock = functionBlock(sessionSource, "handleRegenerateContinuationCredential", "handleGetReportStatus");
assert.ok(regenerateBlock.includes("resolveContinuationRegenerationOwner"),
  "regeneration resolves authenticated module and canonical owner");
assert.equal(regenerateBlock.includes('module === "body" ? "body_clients" : "sessions"'), false,
  "regeneration does not choose an owner table from an unverified requested module");
assert.equal(transcribeSource.includes("if (!session.legacy_access)"), false,
  "transcription has no legacy tokenless branch");
for (const handlerName of [
  "handleDailyLogAnalysis",
  "handleDailyLogAiAnalysis",
  "handleCheckSaveStatus",
  "handlePlatePhotoAnalysis",
]) {
  const handlerStart = analyzeSource.indexOf(`function ${handlerName}`);
  assert.notEqual(handlerStart, -1, `${handlerName} exists`);
  const handlerSlice = analyzeSource.slice(handlerStart, handlerStart + 1800);
  assert.ok(handlerSlice.includes('validateSessionAccess(session_id, access_token, { expectedModule: "body" })'),
    `${handlerName} binds its credential to Health`);
}

assert.match(inventorySql, /begin transaction read only;/i, "inventory explicitly starts a read-only transaction");
assert.doesNotMatch(inventorySql, /\b(insert|update|delete|alter|drop|create|truncate|merge|call|do)\b/i,
  "inventory contains no data-changing statement");
assert.doesNotMatch(inventorySql, /\b(patient_text|conversation_history|user_report|doctor_report|support_plan|json_data)\b/i,
  "inventory does not reference medical or report fields");

console.log("SEC-003 PASS: legacy bypass closed, module/owner binding enforced, inventory is aggregate-only.");
process.exit(0); // Importing the API handler keeps the shared rate-limiter interval alive.
