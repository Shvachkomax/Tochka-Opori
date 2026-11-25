import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createHealthBootstrap,
  generateHealthSessionId,
} from "../lib/session/health-bootstrap.js";
import {
  accessTokenMatchesHash,
  generateSessionAccessToken,
} from "../lib/security/access-token.js";

const healthId = (char) => `health_${char.repeat(22)}`;
const ownerId = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const secretHash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function bootstrapDependencies({ sessionIds, owners, lookupPrefix = "TST" }) {
  let sessionIndex = 0;
  let ownerIndex = 0;
  let tokenIndex = 0;
  let credentialIndex = 0;
  return {
    generateSessionId: () => sessionIds[Math.min(sessionIndex++, sessionIds.length - 1)],
    generateOwnerId: () => owners[Math.min(ownerIndex++, owners.length - 1)],
    generateAccessTokenMaterial: () => {
      tokenIndex += 1;
      const rawToken = `${lookupPrefix}-token-${tokenIndex}`;
      return { rawToken, tokenHash: secretHash(rawToken) };
    },
    generateContinuationCredential: () => {
      credentialIndex += 1;
      const serial = String(credentialIndex).padStart(3, "0");
      const lookupCode = `HEALTH-${lookupPrefix.slice(0, 4).padEnd(4, "X")}-${serial}`;
      return {
        lookupCode,
        secretHash: secretHash(`${lookupPrefix}-secret-${serial}`),
        combinedCode: `${lookupCode}-AAAA-BBBB-CCCC`,
      };
    },
  };
}

function createAtomicBootstrapStore({ sessions = [], bodyClients = [] } = {}) {
  const store = {
    sessions: new Map(sessions.map((row) => [row.session_id, structuredClone(row)])),
    bodyClients: new Map(bodyClients.map((row) => [row.session_id, structuredClone(row)])),
    intakes: new Map(),
    credentials: new Map(),
    wallets: new Map(),
  };
  let barrierSessionId = null;
  let barrierParticipants = 0;
  let barrierArrivals = 0;
  let releaseBarrier;
  let barrierPromise;

  const setBarrier = (sessionId, participants) => {
    barrierSessionId = sessionId;
    barrierParticipants = participants;
    barrierArrivals = 0;
    barrierPromise = new Promise((resolve) => { releaseBarrier = resolve; });
  };

  const supabase = {
    async rpc(name, params) {
      assert.equal(name, "bootstrap_health_intake");
      if (params.p_session_id === barrierSessionId && barrierArrivals < barrierParticipants) {
        barrierArrivals += 1;
        if (barrierArrivals === barrierParticipants) releaseBarrier();
        await barrierPromise;
      }

      const ownerKey = `anonymous_profile:${params.p_owner_id}`;
      const hasConflict = store.sessions.has(params.p_session_id)
        || store.bodyClients.has(params.p_session_id)
        || store.credentials.has(params.p_lookup_code)
        || [...store.credentials.values()].some((row) => row.owner_key === ownerKey);
      if (hasConflict) return { data: null, error: { code: "23505", message: "unique conflict" } };

      const intakeId = crypto.randomUUID();
      const walletId = crypto.randomUUID();
      store.sessions.set(params.p_session_id, {
        session_id: params.p_session_id,
        module: "body",
        anonymous_owner_id: params.p_owner_id,
        public_code: params.p_lookup_code,
        access_token_hash: params.p_access_token_hash,
        patient_text: "",
        conversation_history: [],
        json_data: structuredClone(params.p_session_json),
      });
      store.bodyClients.set(params.p_session_id, {
        session_id: params.p_session_id,
        anonymous_owner_id: params.p_owner_id,
        display_name: params.p_display_name,
      });
      store.intakes.set(intakeId, {
        id: intakeId,
        session_id: params.p_session_id,
        answers: structuredClone(params.p_answers),
      });
      store.credentials.set(params.p_lookup_code, {
        owner_key: ownerKey,
        secret_hash: params.p_secret_hash,
      });
      store.wallets.set(walletId, { id: walletId, owner_id: params.p_owner_id });
      return {
        data: [{
          session_id: params.p_session_id,
          anonymous_owner_id: params.p_owner_id,
          intake_id: intakeId,
          wallet_id: walletId,
          access_token_hash: params.p_access_token_hash,
        }],
        error: null,
      };
    },
  };

  return { store, supabase, setBarrier };
}

class TokenQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.filters = [];
    this.operation = "select";
    this.payload = null;
  }

  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  update(payload) { this.operation = "update"; this.payload = payload; return this; }
  insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
  maybeSingle() { return this.execute(false); }
  single() { return this.execute(true); }

  matches(row) {
    return this.filters.every(([column, value]) => row?.[column] === value);
  }

  async execute(requireRow) {
    const rows = this.database[this.table];
    if (!rows) return { data: null, error: { code: "42P01", message: "missing table" } };

    if (this.operation === "select") {
      const matches = rows.filter((row) => this.matches(row));
      if (matches.length > 1) return { data: null, error: { code: "PGRST116" } };
      if (requireRow && matches.length !== 1) return { data: null, error: { code: "PGRST116" } };
      return { data: matches[0] ? structuredClone(matches[0]) : null, error: null };
    }

    if (this.operation === "update") {
      if (this.database.failUpdate) return { data: null, error: { code: "XX001", message: "forced update failure" } };
      const matches = rows.filter((row) => this.matches(row));
      if (matches.length !== 1) return { data: null, error: null };
      this.database.updatePayloads.push(structuredClone(this.payload));
      Object.assign(matches[0], structuredClone(this.payload));
      return { data: structuredClone(matches[0]), error: null };
    }

    if (this.database.beforeInsert) {
      const hook = this.database.beforeInsert;
      this.database.beforeInsert = null;
      await hook(this.database, this.table, this.payload);
    }
    if (this.table === "sessions" && rows.some((row) => row.session_id === this.payload.session_id)) {
      return { data: null, error: { code: "23505", message: "unique conflict" } };
    }
    rows.push(structuredClone(this.payload));
    return { data: structuredClone(this.payload), error: null };
  }
}

function createTokenSupabase({ sessions = [], bodyClients = [], failUpdate = false, beforeInsert = null } = {}) {
  const database = {
    sessions: structuredClone(sessions),
    body_clients: structuredClone(bodyClients),
    updatePayloads: [],
    failUpdate,
    beforeInsert,
  };
  return {
    database,
    supabase: { from: (table) => new TokenQuery(database, table) },
  };
}

console.log("SEC-003-FIX2 Health session entropy and atomic bootstrap");
const generatedIds = new Set(Array.from({ length: 1000 }, () => generateHealthSessionId()));
assert.equal(generatedIds.size, 1000, "generated Health session IDs are unique in the sample");
for (const id of generatedIds) assert.match(id, /^health_[A-Za-z0-9_-]{22}$/);

const singleStore = createAtomicBootstrapStore();
const single = await createHealthBootstrap({
  supabase: singleStore.supabase,
  intake: { display_name: "TEST patient", goal: "TEST goal", session_id: "client-value" },
  bmi: 22,
}, bootstrapDependencies({
  sessionIds: [healthId("A")],
  owners: [ownerId(1)],
  lookupPrefix: "ONE",
}));
assert.equal(single.success, true);
assert.equal(singleStore.store.sessions.get(single.sessionId).anonymous_owner_id, ownerId(1));
assert.equal(singleStore.store.bodyClients.get(single.sessionId).anonymous_owner_id, ownerId(1));
assert.equal(singleStore.store.intakes.get(single.intakeId).answers.session_id, undefined,
  "client session_id is not persisted as bootstrap identity");
assert.equal(singleStore.store.credentials.size, 1);
assert.equal(singleStore.store.wallets.size, 1);

console.log("SEC-003-FIX2 forced identifier collision");
const victimSessionId = healthId("B");
const victimSession = {
  session_id: victimSessionId,
  module: "body",
  anonymous_owner_id: ownerId(2),
  access_token_hash: secretHash("victim-token"),
  patient_text: "victim medical narrative",
  conversation_history: [{ role: "user", content: "victim history" }],
  json_data: { private: "victim metadata" },
  user_report: "victim report",
};
const victimClient = {
  session_id: victimSessionId,
  anonymous_owner_id: ownerId(2),
  display_name: "victim",
  goal: "victim goal",
};
const collisionStore = createAtomicBootstrapStore({
  sessions: [victimSession],
  bodyClients: [victimClient],
});
const victimBefore = {
  session: structuredClone(collisionStore.store.sessions.get(victimSessionId)),
  client: structuredClone(collisionStore.store.bodyClients.get(victimSessionId)),
};
const collisionResult = await createHealthBootstrap({
  supabase: collisionStore.supabase,
  intake: { display_name: "attacker" },
  bmi: 25,
}, bootstrapDependencies({
  sessionIds: [victimSessionId, healthId("C")],
  owners: [ownerId(3), ownerId(4)],
  lookupPrefix: "COLL",
}));
assert.equal(collisionResult.success, true);
assert.equal(collisionResult.attempts, 2);
assert.notEqual(collisionResult.sessionId, victimSessionId);
assert.deepEqual(collisionStore.store.sessions.get(victimSessionId), victimBefore.session,
  "collision leaves the existing medical session byte-for-byte unchanged");
assert.deepEqual(collisionStore.store.bodyClients.get(victimSessionId), victimBefore.client,
  "collision never reuses or updates the existing Health owner");

const exhaustedStore = createAtomicBootstrapStore({
  sessions: [victimSession],
  bodyClients: [victimClient],
});
const exhaustedBefore = {
  session: structuredClone(exhaustedStore.store.sessions.get(victimSessionId)),
  client: structuredClone(exhaustedStore.store.bodyClients.get(victimSessionId)),
};
const exhausted = await createHealthBootstrap({
  supabase: exhaustedStore.supabase,
  intake: { display_name: "bounded retry" },
  bmi: 24,
}, {
  ...bootstrapDependencies({
    sessionIds: [victimSessionId],
    owners: [ownerId(15)],
    lookupPrefix: "FAIL",
  }),
  maxAttempts: 3,
});
assert.equal(exhausted.success, false);
assert.equal(exhausted.reason, "identifier_conflict");
assert.equal(exhausted.accessToken, undefined, "failed bootstrap returns no token");
assert.deepEqual(exhaustedStore.store.sessions.get(victimSessionId), exhaustedBefore.session);
assert.deepEqual(exhaustedStore.store.bodyClients.get(victimSessionId), exhaustedBefore.client);
assert.equal(exhaustedStore.store.intakes.size, 0);
assert.equal(exhaustedStore.store.credentials.size, 0);
assert.equal(exhaustedStore.store.wallets.size, 0);

const databaseFailure = await createHealthBootstrap({
  supabase: { rpc: async () => ({ data: null, error: { code: "XX001", message: "forced failure" } }) },
  intake: { display_name: "database failure" },
  bmi: 24,
}, bootstrapDependencies({
  sessionIds: [healthId("Z")],
  owners: [ownerId(16)],
  lookupPrefix: "DBER",
}));
assert.equal(databaseFailure.success, false);
assert.equal(databaseFailure.reason, "database_error");
assert.equal(databaseFailure.accessToken, undefined, "database failure returns no token");

console.log("SEC-003-FIX2 concurrent bootstrap with a start barrier");
const concurrentId = healthId("D");
const concurrentStore = createAtomicBootstrapStore();
concurrentStore.setBarrier(concurrentId, 2);
const [concurrentA, concurrentB] = await Promise.all([
  createHealthBootstrap({
    supabase: concurrentStore.supabase,
    intake: { display_name: "parallel A" },
    bmi: 20,
  }, bootstrapDependencies({
    sessionIds: [concurrentId, healthId("E")],
    owners: [ownerId(5), ownerId(6)],
    lookupPrefix: "PRA",
  })),
  createHealthBootstrap({
    supabase: concurrentStore.supabase,
    intake: { display_name: "parallel B" },
    bmi: 21,
  }, bootstrapDependencies({
    sessionIds: [concurrentId, healthId("F")],
    owners: [ownerId(7), ownerId(8)],
    lookupPrefix: "PRB",
  })),
]);
assert.equal(concurrentA.success, true);
assert.equal(concurrentB.success, true);
assert.notEqual(concurrentA.sessionId, concurrentB.sessionId);
assert.notEqual(concurrentA.ownerId, concurrentB.ownerId);
assert.equal(concurrentStore.store.sessions.size, 2);
assert.equal(concurrentStore.store.bodyClients.size, 2);
assert.equal(concurrentStore.store.intakes.size, 2);
assert.equal(concurrentStore.store.credentials.size, 2);
assert.equal(concurrentStore.store.wallets.size, 2);
for (const result of [concurrentA, concurrentB]) {
  assert.equal(concurrentStore.store.sessions.get(result.sessionId).anonymous_owner_id, result.ownerId);
  assert.equal(concurrentStore.store.bodyClients.get(result.sessionId).anonymous_owner_id, result.ownerId);
}

console.log("SEC-003-FIX2 canonical access-token issuance");
const protectedSession = {
  session_id: "support-sec003-fix2",
  module: "support",
  anonymous_owner_id: ownerId(9),
  access_token_hash: secretHash("old-token"),
  legacy_access: false,
  patient_text: "protected narrative",
  conversation_history: [{ role: "user", content: "protected history" }],
  json_data: { protected: true },
  user_report: "protected report",
  doctor_report: "protected doctor report",
};
const exactTokenStore = createTokenSupabase({ sessions: [protectedSession] });
const exactToken = await generateSessionAccessToken(protectedSession.session_id, {
  module: "support",
  anonymousOwnerId: protectedSession.anonymous_owner_id,
  supabase: exactTokenStore.supabase,
});
assert.ok(exactToken);
assert.equal(accessTokenMatchesHash(exactToken, exactTokenStore.database.sessions[0].access_token_hash), true);
for (const field of ["patient_text", "conversation_history", "json_data", "user_report", "doctor_report"]) {
  assert.deepEqual(exactTokenStore.database.sessions[0][field], protectedSession[field], `${field} is unchanged`);
}
assert.deepEqual(Object.keys(exactTokenStore.database.updatePayloads[0]).sort(), [
  "access_token_generated_at", "access_token_hash", "legacy_access",
]);

const existingHealthSession = {
  ...protectedSession,
  session_id: "health_existing_sec003_fix2",
  module: "body",
  anonymous_owner_id: ownerId(17),
  patient_text: "existing Health protected narrative",
};
const existingHealthStore = createTokenSupabase({ sessions: [existingHealthSession] });
const existingHealthToken = await generateSessionAccessToken(existingHealthSession.session_id, {
  module: "body",
  anonymousOwnerId: existingHealthSession.anonymous_owner_id,
  supabase: existingHealthStore.supabase,
});
assert.ok(existingHealthToken, "existing canonical Health session receives a new token");
assert.equal(accessTokenMatchesHash(existingHealthToken, existingHealthStore.database.sessions[0].access_token_hash), true);
assert.equal(existingHealthStore.database.sessions[0].patient_text, existingHealthSession.patient_text);
assert.deepEqual(existingHealthStore.database.sessions[0].conversation_history, existingHealthSession.conversation_history);
assert.deepEqual(existingHealthStore.database.sessions[0].json_data, existingHealthSession.json_data);

const wrongOwnerStore = createTokenSupabase({ sessions: [protectedSession] });
assert.equal(await generateSessionAccessToken(protectedSession.session_id, {
  module: "support",
  anonymousOwnerId: ownerId(10),
  supabase: wrongOwnerStore.supabase,
}), null);
assert.deepEqual(wrongOwnerStore.database.sessions[0], protectedSession);

const wrongModuleStore = createTokenSupabase({ sessions: [protectedSession] });
assert.equal(await generateSessionAccessToken(protectedSession.session_id, {
  module: "body",
  anonymousOwnerId: protectedSession.anonymous_owner_id,
  supabase: wrongModuleStore.supabase,
}), null);
assert.deepEqual(wrongModuleStore.database.sessions[0], protectedSession);

const failedUpdateStore = createTokenSupabase({ sessions: [protectedSession], failUpdate: true });
assert.equal(await generateSessionAccessToken(protectedSession.session_id, {
  module: "support",
  anonymousOwnerId: protectedSession.anonymous_owner_id,
  supabase: failedUpdateStore.supabase,
}), null);
assert.deepEqual(failedUpdateStore.database.sessions[0], protectedSession,
  "failed token update cannot alter protected data");

const legacyHealthId = "HEALTH-ABCD-XYZ";
const legacyHealthOwner = ownerId(11);
const missingSessionStore = createTokenSupabase({
  bodyClients: [{ session_id: legacyHealthId, anonymous_owner_id: legacyHealthOwner }],
});
const recoveredHealthToken = await generateSessionAccessToken(legacyHealthId, {
  module: "body",
  anonymousOwnerId: legacyHealthOwner,
  publicCode: "HEALTH-WXYZ-234",
  supabase: missingSessionStore.supabase,
});
assert.ok(recoveredHealthToken, "a proven legacy Health owner can receive a canonical sessions row");
assert.equal(missingSessionStore.database.sessions[0].anonymous_owner_id, legacyHealthOwner);
assert.equal(missingSessionStore.database.sessions[0].public_code, "HEALTH-WXYZ-234");

const conflictingInsertStore = createTokenSupabase({
  bodyClients: [{ session_id: legacyHealthId, anonymous_owner_id: legacyHealthOwner }],
  beforeInsert: async (database) => {
    database.sessions.push({
      session_id: legacyHealthId,
      module: "support",
      anonymous_owner_id: ownerId(12),
      patient_text: "foreign protected data",
      access_token_hash: secretHash("foreign-token"),
    });
  },
});
assert.equal(await generateSessionAccessToken(legacyHealthId, {
  module: "body",
  anonymousOwnerId: legacyHealthOwner,
  publicCode: "HEALTH-WXYZ-234",
  supabase: conflictingInsertStore.supabase,
}), null);
assert.equal(conflictingInsertStore.database.sessions[0].patient_text, "foreign protected data");
assert.equal(conflictingInsertStore.database.sessions[0].anonymous_owner_id, ownerId(12));

console.log("SEC-003-FIX2 PostgreSQL transaction contract");
const migrationSql = await readFile(
  new URL("../supabase/migrations/20261123223548_sec_003_health_bootstrap.sql", import.meta.url),
  "utf8",
);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text NOT NULL UNIQUE,
    module text,
    anonymous_owner_id uuid,
    public_code text NOT NULL UNIQUE,
    patient_text text,
    conversation_history jsonb,
    json_data jsonb,
    access_token_hash text,
    access_token_generated_at timestamptz,
    legacy_access boolean NOT NULL DEFAULT true
  );
  CREATE TABLE public.body_clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text NOT NULL UNIQUE,
    anonymous_owner_id uuid,
    display_name text,
    source text NOT NULL DEFAULT 'self_signup',
    specialist_id text,
    specialist_name text,
    goal text,
    status text NOT NULL DEFAULT 'active',
    updated_at timestamptz
  );
  CREATE TABLE public.body_intake_forms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id text,
    module text NOT NULL DEFAULT 'body',
    version text NOT NULL DEFAULT 'body-intake-v0.1',
    answers jsonb NOT NULL,
    bmi numeric,
    care_recommendation text,
    source text,
    specialist_id text,
    specialist_name text
  );
  CREATE TABLE public.continuation_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module text NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    lookup_code text NOT NULL UNIQUE,
    secret_hash text NOT NULL,
    secret_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_type, owner_id)
  );
  CREATE TABLE public.usage_wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    module text NOT NULL,
    visible_to_client boolean NOT NULL DEFAULT false,
    UNIQUE(owner_type, owner_id, module)
  );
  CREATE OR REPLACE FUNCTION public.ensure_usage_wallet(p_owner_type text, p_owner_id uuid, p_module text)
  RETURNS public.usage_wallets LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
  DECLARE v_wallet public.usage_wallets%rowtype;
  BEGIN
    INSERT INTO public.usage_wallets(owner_type, owner_id, module)
    VALUES (p_owner_type, p_owner_id, p_module)
    RETURNING * INTO v_wallet;
    RETURN v_wallet;
  END;
  $$;
`);
await db.exec(migrationSql);

async function callBootstrapRpc({ sessionId, owner, lookup }) {
  return db.query(`
    SELECT * FROM public.bootstrap_health_intake(
      $1, $2::uuid, $3, $4, $5, $6::jsonb, $7::numeric,
      'self_signup', NULL, NULL, 'TEST', 'TEST goal', '{}'::jsonb
    )
  `, [sessionId, owner, secretHash("access"), lookup, secretHash("continuation"), JSON.stringify({ test: true }), 23]);
}

const sqlSessionId = healthId("G");
await callBootstrapRpc({ sessionId: sqlSessionId, owner: ownerId(13), lookup: "HEALTH-SQLA-234" });
for (const table of ["sessions", "body_clients", "body_intake_forms", "continuation_credentials", "usage_wallets"]) {
  const result = await db.query(`SELECT count(*)::int AS count FROM public.${table}`);
  assert.equal(result.rows[0].count, 1, `${table} created in the successful transaction`);
}

const beforeConflict = {};
for (const table of ["sessions", "body_clients", "body_intake_forms", "continuation_credentials", "usage_wallets"]) {
  const result = await db.query(`SELECT count(*)::int AS count FROM public.${table}`);
  beforeConflict[table] = result.rows[0].count;
}
await assert.rejects(
  callBootstrapRpc({ sessionId: sqlSessionId, owner: ownerId(14), lookup: "HEALTH-SQLB-234" }),
  /unique|duplicate/i,
);
for (const table of Object.keys(beforeConflict)) {
  const result = await db.query(`SELECT count(*)::int AS count FROM public.${table}`);
  assert.equal(result.rows[0].count, beforeConflict[table], `${table} unchanged after transactional collision`);
}
await db.close();

console.log("SEC-003-FIX2 source contracts");
const [sessionSource, analyzeSource, accessSource] = await Promise.all([
  readFile(new URL("../api/session.js", import.meta.url), "utf8"),
  readFile(new URL("../api/analyze.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/security/access-token.js", import.meta.url), "utf8"),
]);
const exchangeStart = sessionSource.indexOf("async function handleExchangeContinuationCredential");
const exchangeEnd = sessionSource.indexOf("async function handleRegenerateContinuationCredential", exchangeStart);
const exchangeBlock = sessionSource.slice(exchangeStart, exchangeEnd);
assert.equal(exchangeBlock.includes(".upsert("), false, "continuation exchange contains no fallback upsert");
assert.equal(exchangeBlock.includes('patient_text: ""'), false, "continuation exchange never clears medical text");
assert.equal(exchangeBlock.includes("conversation_history: []"), false, "continuation exchange never clears history");
assert.equal(exchangeBlock.includes("json_data:"), false, "continuation exchange never replaces session metadata");
assert.ok(exchangeBlock.includes("canonical token issuance failed"));
assert.equal(analyzeSource.includes("function generateBodyCode"), false);
assert.equal(analyzeSource.includes("trySaveIntake"), false);
assert.ok(analyzeSource.includes("createHealthBootstrap"));
assert.ok(accessSource.includes('.eq("module", module)'));
assert.ok(accessSource.includes('.eq("anonymous_owner_id", anonymousOwnerId)'));
assert.equal(accessSource.includes(".upsert("), false);
assert.ok(migrationSql.includes("SECURITY INVOKER"));
assert.ok(migrationSql.includes("REVOKE ALL ON FUNCTION"));
assert.equal(migrationSql.includes("ON CONFLICT DO UPDATE"), false);

console.log("SEC-003-FIX2 PASS: Health bootstrap is atomic and token recovery preserves medical data.");
