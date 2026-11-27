import assert from "node:assert/strict";
import {
  authorizeMedicalRecord,
  resolveAuthorizedSpecialistClient,
} from "../api/specialist.js";
import { handleMedicalRecord } from "../lib/clinical/medical-record.js";
import { handlePatientDraft } from "../lib/clinical/patient-draft-summary.js";
import {
  resolveClinicalPatientOwner,
  resolvePatientRelationshipIdentity,
} from "../lib/specialist/patient-owner.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const expertId = id(1);
const foreignExpertId = id(2);
const supportOwnerId = id(3);
const healthOwnerId = id(4);
const otherOwnerId = id(5);
const supportAssignmentId = id(10);
const healthAssignmentId = id(11);
const revokedAssignmentId = id(12);
const conflictAssignmentId = id(13);
const viewerAccessId = id(14);
const clinicianAccessId = id(15);
const legacyAssignmentId = id(16);
const foreignPatientAssignmentId = id(17);
const organizationId = id(20);
const otherOrganizationId = id(21);
const legacyCode = "ТОЧКА-TEST-CANONICAL-LEGACY";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createDb(initial = {}) {
  const tables = Object.fromEntries(Object.entries(initial).map(([name, rows]) => [name, [...rows]]));
  tables.medical_encounter_versions ||= [];
  const calls = [];
  let revision = tables.medical_encounter_versions.length;

  const readPath = (row, key) => {
    if (key === "json_data->>pilot_id") return row.json_data?.pilot_id ?? null;
    return row[key];
  };

  function from(table) {
    const filters = [];
    const ordering = [];
    let maximum = null;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push((row) => readPath(row, key) === value); return query; },
      is(key, value) { filters.push((row) => readPath(row, key) === value); return query; },
      contains(key, value) {
        filters.push((row) => Object.entries(value).every(([entryKey, entryValue]) => row[key]?.[entryKey] === entryValue));
        return query;
      },
      lt(key, value) { filters.push((row) => readPath(row, key) < value); return query; },
      in(key, values) { filters.push((row) => values.includes(readPath(row, key))); return query; },
      order(key, { ascending = true } = {}) { ordering.push({ key, ascending }); return query; },
      limit(value) { maximum = value; return query; },
      async maybeSingle() {
        const rows = execute();
        if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
        return { data: rows[0] || null, error: null };
      },
      then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject); },
    };
    function execute() {
      calls.push({ table, filterCount: filters.length });
      let rows = [...(tables[table] || [])].filter((row) => filters.every((filter) => filter(row)));
      for (const { key, ascending } of ordering) {
        rows.sort((a, b) => {
          const left = readPath(a, key);
          const right = readPath(b, key);
          return (left === right ? 0 : left < right ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (maximum !== null) rows = rows.slice(0, maximum);
      return rows;
    }
    return query;
  }

  async function rpc(name, args) {
    calls.push({ rpc: name, args });
    if (name !== "save_medical_encounter_version") return { data: null, error: { code: "UNKNOWN_RPC" } };
    const previous = tables.medical_encounter_versions
      .filter((row) => row.encounter_id === args.p_encounter_id)
      .sort((a, b) => b.version - a.version)[0];
    if ((previous?.version || 0) !== args.p_expected_version) {
      return { data: null, error: { code: "PT409" } };
    }
    const row = {
      revision_id: ++revision,
      encounter_id: args.p_encounter_id,
      version: (previous?.version || 0) + 1,
      author_id: args.p_author_id,
      owner_type: args.p_owner_type,
      owner_id: args.p_owner_id,
      module: args.p_module,
      organization_id: args.p_organization_id,
      status: args.p_status,
      encounter_at: args.p_encounter_at,
      content: args.p_content,
      amendment_reason: args.p_amendment_reason,
      recorded_at: "2026-11-27T00:00:00.000Z",
    };
    tables.medical_encounter_versions.push(row);
    return { data: row, error: null };
  }

  return { from, rpc, tables, calls };
}

const primaryRelationships = [
  {
    id: supportAssignmentId,
    public_code: null,
    owner_type: "anonymous_case",
    owner_id: supportOwnerId,
    organization_id: null,
    primary_expert_id: expertId,
    status: "active",
    module: "support",
  },
  {
    id: healthAssignmentId,
    public_code: null,
    owner_type: "anonymous_profile",
    owner_id: healthOwnerId,
    organization_id: null,
    primary_expert_id: expertId,
    status: "active",
    module: "body",
  },
  {
    id: revokedAssignmentId,
    public_code: null,
    owner_type: "anonymous_case",
    owner_id: otherOwnerId,
    organization_id: null,
    primary_expert_id: expertId,
    status: "revoked",
    module: "support",
  },
  {
    id: conflictAssignmentId,
    public_code: legacyCode,
    owner_type: "anonymous_case",
    owner_id: supportOwnerId,
    organization_id: null,
    primary_expert_id: expertId,
    status: "active",
    module: "support",
  },
  {
    id: legacyAssignmentId,
    public_code: legacyCode,
    owner_type: null,
    owner_id: null,
    organization_id: null,
    primary_expert_id: expertId,
    status: "active",
    module: "support",
  },
  {
    id: foreignPatientAssignmentId,
    public_code: null,
    owner_type: "anonymous_case",
    owner_id: otherOwnerId,
    organization_id: null,
    primary_expert_id: foreignExpertId,
    status: "active",
    module: "support",
  },
];

const sharedRelationships = [
  {
    id: viewerAccessId,
    public_code: null,
    owner_type: "anonymous_case",
    owner_id: supportOwnerId,
    organization_id: null,
    expert_id: expertId,
    access_role: "viewer",
    status: "active",
    module: "support",
  },
  {
    id: clinicianAccessId,
    public_code: null,
    owner_type: "anonymous_case",
    owner_id: supportOwnerId,
    organization_id: null,
    expert_id: expertId,
    access_role: "clinician",
    status: "active",
    module: "support",
  },
];

const expert = { id: expertId, name: "Синтетический специалист", allowed_modules: ["support", "body"] };
const authResult = { expert, memberships: [] };

function authorizationDependencies(db, auth = async () => authResult) {
  return {
    authorizeSpecialist: auth,
    resolveAuthorizedSpecialistClient: (input) => resolveAuthorizedSpecialistClient(input, {
      getSupabase: () => db,
    }),
    getSupabase: () => db,
    getPilotId: () => null,
    hasVerifiedMedicationAuthorization: async () => false,
  };
}

function medicalRequest({ action = "saveMedicalEncounter", clientRef, module, ownerId = otherOwnerId } = {}) {
  return {
    body: {
      action,
      client_ref: clientRef,
      module,
      organization_id: null,
      // Attacker-controlled fields must never select the clinical owner.
      owner_type: module === "body" ? "anonymous_case" : "anonymous_profile",
      owner_id: ownerId,
      public_code: "ТОЧКА-ATTACKER-CODE",
      encounter_id: id(module === "body" ? 31 : 30),
      expected_version: 0,
      status: "confirmed",
      encounter_at: "2026-11-27T08:00:00.000Z",
      content: { complaints: "Синтетическая запись", medications: [] },
    },
  };
}

// Relationship identity classification mirrors the either/or database trigger.
assert.deepEqual(resolvePatientRelationshipIdentity(primaryRelationships[0], "support"), {
  ok: true,
  identitySource: "canonical",
  publicCode: null,
  ownerType: "anonymous_case",
  ownerId: supportOwnerId,
});
assert.equal(resolvePatientRelationshipIdentity(primaryRelationships[4], "support").identitySource, "legacy");
assert.equal(resolvePatientRelationshipIdentity(primaryRelationships[1], "body").identitySource, "canonical");
assert.equal(resolvePatientRelationshipIdentity(primaryRelationships[3], "support").ok, false,
  "mixed canonical and legacy identity fails closed");
assert.equal(resolvePatientRelationshipIdentity({ owner_type: "anonymous_case", owner_id: null }, "support").ok, false);
assert.equal(resolvePatientRelationshipIdentity({ public_code: legacyCode }, "body").ok, false,
  "Health has no legacy public_code fallback");

const db = createDb({
  patient_assignments: primaryRelationships,
  patient_access: sharedRelationships,
  sessions: [{
    session_id: id(40),
    public_code: legacyCode,
    anonymous_owner_id: supportOwnerId,
    module: "support",
    json_data: {},
  }],
});

const canonicalSupport = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(canonicalSupport.ok, true,
  "trusted canonical Support relationship without public_code authorizes A5");
assert.equal(canonicalSupport.ownerType, "anonymous_case");
assert.equal(canonicalSupport.ownerId, supportOwnerId);
assert.equal(db.calls.some((call) => call.table === "sessions"), false,
  "canonical ownership does not fall back to public_code");

const canonicalHealth = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${healthAssignmentId}`, module: "body" }),
  authorizationDependencies(db),
);
assert.equal(canonicalHealth.ok, true);
assert.equal(canonicalHealth.ownerType, "anonymous_profile");
assert.equal(canonicalHealth.ownerId, healthOwnerId);

const legacySupport = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${legacyAssignmentId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(legacySupport.ok, true, "existing exact historical Support relationship remains supported");
assert.equal(legacySupport.ownerId, supportOwnerId);

const spoofedOwner = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "support", ownerId: otherOwnerId }),
  authorizationDependencies(db),
);
assert.equal(spoofedOwner.ownerId, supportOwnerId, "client owner_id/public_code fields cannot override the relationship owner");

const unauthenticated = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "support" }),
  authorizationDependencies(db, async () => ({ error: "Требуется авторизация", status: 401 })),
);
assert.equal(unauthenticated.ok, false);
assert.equal(unauthenticated.status, 401);

const foreignSpecialist = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "support" }),
  authorizationDependencies(db, async () => ({
    expert: { ...expert, id: foreignExpertId },
    memberships: [],
  })),
);
assert.equal(foreignSpecialist.ok, false);

const wrongPatient = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${foreignPatientAssignmentId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(wrongPatient.ok, false, "another patient's relationship is denied");

const noRelationship = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${id(99)}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(noRelationship.ok, false, "missing patient relationship is denied");

const revoked = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${revokedAssignmentId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(revoked.ok, false, "revoked relationship is denied");

const crossModule = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "body" }),
  authorizationDependencies(db),
);
assert.equal(crossModule.ok, false, "cross-module access is denied");

const conflicting = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `assignment:${conflictAssignmentId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(conflicting.ok, false, "conflicting canonical and legacy identities are denied");

const viewer = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `access:${viewerAccessId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(viewer.ok, false, "viewer grant does not expose A5 clinical data");

const clinician = await authorizeMedicalRecord(
  medicalRequest({ clientRef: `access:${clinicianAccessId}`, module: "support" }),
  authorizationDependencies(db),
);
assert.equal(clinician.ok, true, "explicit clinician grant retains existing expanded-data access");

const orgDb = createDb({
  patient_assignments: [{ ...primaryRelationships[0], organization_id: organizationId }],
});
const organizationRequest = medicalRequest({
  clientRef: `assignment:${supportAssignmentId}`,
  module: "support",
});
organizationRequest.body.organization_id = otherOrganizationId;
const wrongOrganization = await authorizeMedicalRecord(
  organizationRequest,
  authorizationDependencies(orgDb, async () => ({
    expert,
    memberships: [{ organization_id: organizationId }, { organization_id: otherOrganizationId }],
  })),
);
assert.equal(wrongOrganization.ok, false, "organization scope must match the relationship exactly");

const duplicateLegacyDb = createDb({
  sessions: [
    { public_code: legacyCode, anonymous_owner_id: supportOwnerId, module: "support", json_data: {} },
    { public_code: legacyCode, anonymous_owner_id: otherOwnerId, module: "support", json_data: {} },
  ],
});
const ambiguousLegacy = await resolveClinicalPatientOwner({
  resolved: {
    ok: true,
    identitySource: "legacy",
    publicCode: legacyCode,
    ownerType: null,
    ownerId: null,
  },
  module: "support",
  supabase: duplicateLegacyDb,
});
assert.equal(ambiguousLegacy.ok, false, "ambiguous historical identity fails closed");

const pilotDb = createDb({
  sessions: [{
    public_code: legacyCode,
    anonymous_owner_id: supportOwnerId,
    module: "support",
    json_data: { pilot_id: "test-pilot" },
  }],
});
const canonicalPilot = await resolveClinicalPatientOwner({
  resolved: {
    ok: true,
    identitySource: "canonical",
    publicCode: null,
    ownerType: "anonymous_case",
    ownerId: supportOwnerId,
  },
  module: "support",
  supabase: pilotDb,
  pilotId: "test-pilot",
});
assert.equal(canonicalPilot.ok, true, "canonical Support owner retains exact pilot isolation");
const wrongPilot = await resolveClinicalPatientOwner({
  resolved: {
    ok: true,
    identitySource: "canonical",
    publicCode: null,
    ownerType: "anonymous_case",
    ownerId: supportOwnerId,
  },
  module: "support",
  supabase: pilotDb,
  pilotId: "foreign-pilot",
});
assert.equal(wrongPilot.ok, false, "foreign pilot identity is denied");

// Actual A5 handlers: canonical Support and Health save, then read the same row.
for (const fixture of [
  { module: "support", assignmentId: supportAssignmentId, ownerId: supportOwnerId },
  { module: "body", assignmentId: healthAssignmentId, ownerId: healthOwnerId },
]) {
  const routeDb = createDb({ patient_assignments: primaryRelationships });
  const deps = authorizationDependencies(routeDb);
  const saveRequest = medicalRequest({
    clientRef: `assignment:${fixture.assignmentId}`,
    module: fixture.module,
  });
  const saveResponse = response();
  await handleMedicalRecord(saveRequest, saveResponse, {
    enabled: () => true,
    authorize: (request) => authorizeMedicalRecord(request, deps),
    getSupabase: () => routeDb,
  });
  assert.equal(saveResponse.statusCode, 200, `${fixture.module} canonical A5 write succeeds`);
  assert.equal(routeDb.tables.medical_encounter_versions[0].owner_id, fixture.ownerId);

  const listResponse = response();
  await handleMedicalRecord({
    body: {
      action: "listMedicalEncounters",
      client_ref: `assignment:${fixture.assignmentId}`,
      module: fixture.module,
      organization_id: null,
    },
  }, listResponse, {
    enabled: () => true,
    authorize: (request) => authorizeMedicalRecord(request, deps),
    getSupabase: () => routeDb,
  });
  assert.equal(listResponse.statusCode, 200, `${fixture.module} canonical A5 read succeeds`);
  assert.equal(listResponse.body.records.length, 1);
  assert.equal(listResponse.body.records[0].content.complaints, "Синтетическая запись");

  const draftResponse = response();
  await handlePatientDraft({
    body: {
      action: "getPatientDraftSummary",
      client_ref: `assignment:${fixture.assignmentId}`,
      module: fixture.module,
      organization_id: null,
      period: "days30",
    },
  }, draftResponse, {
    enabled: () => true,
    authorize: (request) => authorizeMedicalRecord(request, deps),
    getSupabase: () => routeDb,
    load: async ({ ownerId, module }) => {
      assert.equal(ownerId, fixture.ownerId);
      return {
        coverage: { complete: true },
        events: module === "support"
          ? [{ at: new Date().toISOString(), source: "sessions", provenance: "patient_reported", details: {} }]
          : [{ at: new Date().toISOString(), source: "body_daily_logs", provenance: "patient_reported", details: { weight_kg: 70 } }],
      };
    },
  });
  assert.equal(draftResponse.statusCode, 200, `${fixture.module} canonical clinical summary succeeds`);
  assert.equal(draftResponse.body.draft.items.length, 1);
}

const deniedDb = createDb({ patient_assignments: primaryRelationships });
const deniedWriteResponse = response();
await handleMedicalRecord(
  medicalRequest({ clientRef: `assignment:${supportAssignmentId}`, module: "support" }),
  deniedWriteResponse,
  {
    enabled: () => true,
    authorize: (request) => authorizeMedicalRecord(request, authorizationDependencies(
      deniedDb,
      async () => ({ expert: { ...expert, id: foreignExpertId }, memberships: [] }),
    )),
    getSupabase: () => deniedDb,
  },
);
assert.equal(deniedWriteResponse.statusCode, 403);
assert.equal(deniedDb.tables.medical_encounter_versions.length, 0,
  "denied A5 request creates no clinical side effect");

console.log("PASS A5 canonical owner: Support/Health read-write, summaries, legacy compatibility and isolation matrix.");

// api/specialist imports the shared serverless rate limiter, whose cleanup timer
// intentionally remains alive in production runtimes.
process.exit(0);
