// Deterministic TEST-only fixtures for Pneumointegration pilot.
// Refuses every Supabase project except the dedicated Pneumo TEST ref.
// Idempotent: re-runs skip existing rows and never rotate issued codes.
// Codes are written to .pneumointegration-codes.json (gitignored, 0600).
// Usage: node scripts/seed-pneumointegration-fixtures.js [--cleanup]
// Requires TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY,
// TEST_CONTINUATION_SECRET_PEPPER.

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CODES_FILE = path.join(ROOT, ".pneumointegration-codes.json");
const CODES_FILE_MODE = 0o600;

const TEST_PROJECT_REF = "jvezfycyztaqtracmesu";
const REQUIRED_SUPABASE_URL = "https://jvezfycyztaqtracmesu.supabase.co";
const ORG_SLUG = "pneumointegration";
let ORG_ID = null;
const PILOT_ID = "pneumointegration";

// Deterministic row IDs (idempotent cleanup on --cleanup)
// Must be valid UUIDs (hex digits only) for UUID-typed Supabase columns.
const ids = {
  expert: "a1000000-0000-4000-8000-000000000001",
  owner: "a1000000-0000-4000-8000-000000000011",
  session: "a1000000-0000-4000-8000-000000000021",
  assignment: "a1000000-0000-4000-8000-000000000031",
  credential: "a1000000-0000-4000-8000-000000000071",
  membership: "a1000000-0000-4000-8000-000000000081",
};

// Validate all IDs are well-formed UUIDs at load time.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
for (const [name, value] of Object.entries(ids)) {
  if (!UUID_RE.test(value)) {
    throw new Error(`Fixture ID "${name}" is not a valid UUID: ${value}`);
  }
}

const SESSION_ID = "demo-pneumo-support-001";
const PUBLIC_CODE = "PNEU-CASE-0001";

// ── Crypto-safe code generation ──────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCodeSegment(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function generateAccessCode() {
  return `PNEU-${randomCodeSegment(4)}-${randomCodeSegment(4)}`;
}

function generateLookupCode() {
  return `ТОЧКА-PN${randomCodeSegment(2)}-${randomCodeSegment(4)}`;
}

function generateSecret() {
  return `${randomCodeSegment(4)}-${randomCodeSegment(4)}-${randomCodeSegment(4)}`;
}

// ── Codes file (local-only, gitignored) ─────────────────────────────────

function loadCodes() {
  try {
    return JSON.parse(fs.readFileSync(CODES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveCodes(data) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2) + "\n", { mode: CODES_FILE_MODE });
  fs.chmodSync(CODES_FILE, CODES_FILE_MODE);
}

function ensureGitignored() {
  const gitignorePath = path.join(ROOT, ".gitignore");
  const entry = ".pneumointegration-codes.json";
  let content = "";
  try { content = fs.readFileSync(gitignorePath, "utf8"); } catch {}
  if (!content.split("\n").includes(entry)) {
    fs.writeFileSync(gitignorePath, content + (content.endsWith("\n") ? "" : "\n") + entry + "\n");
  }
}

// ── Environment guard ────────────────────────────────────────────────────

function extractSupabaseProjectRef(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || null;
  } catch {
    return null;
  }
}

function requireTestEnvironment() {
  const testUrl = process.env.TEST_SUPABASE_URL || "";
  const genericUrl = process.env.SUPABASE_URL || "";
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
  const pepper = process.env.TEST_CONTINUATION_SECRET_PEPPER || "";
  const testRef = extractSupabaseProjectRef(testUrl);
  const genericRef = genericUrl ? extractSupabaseProjectRef(genericUrl) : null;

  // Both names are checked before createClient so a Production .env cannot be used accidentally.
  if (testRef !== TEST_PROJECT_REF) throw new Error("Refusing: TEST_SUPABASE_URL is not the dedicated Pneumo TEST project.");
  if (genericUrl && genericRef !== TEST_PROJECT_REF) throw new Error("Refusing: SUPABASE_URL conflicts with the dedicated Pneumo TEST project.");
  if (!key) throw new Error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY.");
  if (!pepper) throw new Error("Missing TEST_CONTINUATION_SECRET_PEPPER.");

  process.env.SUPABASE_URL = REQUIRED_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.CONTINUATION_SECRET_PEPPER = pepper;
  return { url: REQUIRED_SUPABASE_URL };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function run() {
  const { url } = requireTestEnvironment();
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { hashContinuationSecret } = await import("../lib/session/continuation-credential.js");
  const { ensureWallet, setWalletVisible } = await import("../lib/usage/wallet.js");
  const cleanupOnly = process.argv.includes("--cleanup");
  const existingCodes = loadCodes();

  if (existingCodes && existingCodes.project_ref !== TEST_PROJECT_REF) {
    throw new Error("Refusing: local fixture codes belong to another project.");
  }

  async function ensure(result, label) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data;
  }

  async function resolveOrganizationId({ createIfMissing }) {
    const { data, error } = await supabase.from("organizations")
      .select("id").eq("slug", ORG_SLUG).maybeSingle();
    if (error) throw new Error(`Pneumo organization lookup: ${error.message}`);
    if (data?.id) return data.id;
    if (!createIfMissing) throw new Error("Refusing cleanup: Pneumo organization is missing.");
    const created = await ensure(await supabase.from("organizations").insert({
      name: "Pneumointegration",
      slug: ORG_SLUG,
      type: "private_clinic",
      status: "active",
    }).select("id").single(), "create Pneumo organization");
    return created.id;
  }

  if (cleanupOnly) {
    if (!existingCodes?.organization_id || existingCodes.project_ref !== TEST_PROJECT_REF) {
      throw new Error("Refusing cleanup: local fixture metadata does not identify this TEST project and organization.");
    }
    ORG_ID = existingCodes.organization_id;
  } else {
    ORG_ID = await resolveOrganizationId({ createIfMissing: true });
  }

  async function remove(table, column, values) {
    const result = await supabase.from(table).delete().in(column, values);
    if (result.error) throw new Error(`cleanup ${table}: ${result.error.message}`);
  }

  // --cleanup deletes ONLY rows with fixture IDs from the `ids` constant.
  // No wildcard or ownerless deletes. Each table is scoped by exact ID match.
  async function cleanup() {
    if (!existingCodes?.wallet_id || existingCodes.organization_id !== ORG_ID) {
      throw new Error("Refusing cleanup: fixture metadata is incomplete or does not match the Pneumo organization.");
    }

    const [expertRow, sessionRow, credentialRow, assignmentRow, membershipRow, walletRows] = await Promise.all([
      supabase.from("experts").select("id, name, specialty").eq("id", ids.expert).maybeSingle(),
      supabase.from("sessions").select("id, session_id, public_code, anonymous_owner_id, organization_id, json_data").eq("id", ids.session).maybeSingle(),
      supabase.from("continuation_credentials").select("id, owner_type, owner_id, module, lookup_code").eq("id", ids.credential).maybeSingle(),
      supabase.from("patient_assignments").select("id, public_code, owner_id, organization_id, source").eq("id", ids.assignment).maybeSingle(),
      supabase.from("expert_organization_memberships").select("id, organization_id, expert_id").eq("id", ids.membership).maybeSingle(),
      supabase.from("usage_wallets").select("id, owner_id, module").eq("id", existingCodes.wallet_id),
    ]);
    for (const [label, result] of [["expert", expertRow], ["session", sessionRow], ["credential", credentialRow], ["assignment", assignmentRow], ["membership", membershipRow], ["wallet", walletRows]]) {
      if (result.error) throw new Error(`Refusing cleanup: ${label} verification failed: ${result.error.message}`);
    }
    if (expertRow.data && (expertRow.data.name !== "Тестовый Специалист Пневмо" || expertRow.data.specialty !== "Психологическая поддержка (тест)")) {
      throw new Error("Refusing cleanup: expert ID is not owned by this fixture.");
    }
    if (sessionRow.data && (
      sessionRow.data.session_id !== SESSION_ID
      || sessionRow.data.public_code !== PUBLIC_CODE
      || sessionRow.data.anonymous_owner_id !== ids.owner
      || sessionRow.data.organization_id !== ORG_ID
      || sessionRow.data.json_data?.pilot_id !== PILOT_ID
      || sessionRow.data.json_data?.demo_fixture !== "pneumointegration-test-001"
    )) throw new Error("Refusing cleanup: session ID is not owned by this fixture.");
    if (credentialRow.data && (
      credentialRow.data.owner_type !== "anonymous_case"
      || credentialRow.data.owner_id !== ids.owner
      || credentialRow.data.module !== "support"
      || credentialRow.data.lookup_code !== existingCodes.patient?.lookup_code
    )) throw new Error("Refusing cleanup: continuation credential is not owned by this fixture.");
    if (assignmentRow.data && (
      assignmentRow.data.public_code !== PUBLIC_CODE
      || assignmentRow.data.owner_id !== ids.owner
      || assignmentRow.data.organization_id !== ORG_ID
      || assignmentRow.data.source !== "test_fixture"
    )) throw new Error("Refusing cleanup: assignment ID is not owned by this fixture.");
    if (membershipRow.data && (membershipRow.data.organization_id !== ORG_ID || membershipRow.data.expert_id !== ids.expert)) {
      throw new Error("Refusing cleanup: membership ID is not owned by this fixture.");
    }
    if (walletRows.data?.length > 1 || walletRows.data?.some(row => row.owner_id !== ids.owner || row.module !== "support")) {
      throw new Error("Refusing cleanup: wallet identity is not owned by this fixture.");
    }

    const walletId = existingCodes?.wallet_id;
    if (walletId) {
      await ensure(await supabase.from("usage_ledger").delete().eq("wallet_id", walletId), "cleanup usage_ledger");
      await ensure(await supabase.from("usage_reservations").delete().eq("wallet_id", walletId), "cleanup usage_reservations");
      await ensure(
        await supabase.from("usage_wallets").delete()
          .eq("id", walletId).eq("owner_id", ids.owner).eq("module", "support"),
        "cleanup usage_wallets",
      );
    } else {
      const { data: wallets, error: walletError } = await supabase
        .from("usage_wallets").select("id").eq("owner_id", ids.owner).eq("module", "support");
      if (walletError) throw new Error(`cleanup usage_wallets lookup: ${walletError.message}`);
      if (wallets?.length) throw new Error("Refusing cleanup: fixture wallet identity is not recorded locally.");
    }
    await remove("continuation_credentials", "id", [ids.credential]);
    await remove("patient_assignments", "id", [ids.assignment]);
    await remove("sessions", "id", [ids.session]);
    await remove("expert_organization_memberships", "id", [ids.membership]);
    await remove("experts", "id", [ids.expert]);
    // Remove codes file
    try { fs.unlinkSync(CODES_FILE); } catch {}
  }

  if (cleanupOnly) {
    await cleanup();
    console.log(JSON.stringify({ project_ref: TEST_PROJECT_REF, cleaned: true }));
    return;
  }

  // ── Idempotency: detect existing fixture rows ──────────────────────────

  const { data: existingExpert } = await supabase
    .from("experts").select("id, name, specialty, allowed_modules").eq("id", ids.expert).maybeSingle();
  const { data: existingSession } = await supabase
    .from("sessions").select("id, session_id, public_code, anonymous_owner_id, organization_id, json_data").eq("id", ids.session).maybeSingle();
  const { data: existingCred } = await supabase
    .from("continuation_credentials").select("id, lookup_code").eq("id", ids.credential).maybeSingle();
  const { data: existingAssignment } = await supabase
    .from("patient_assignments").select("id, public_code, owner_id, organization_id, source").eq("id", ids.assignment).maybeSingle();
  const { data: existingMembership } = await supabase
    .from("expert_organization_memberships").select("id, organization_id, expert_id").eq("id", ids.membership).maybeSingle();
  const { data: existingWallets, error: walletLookupError } = await supabase
    .from("usage_wallets").select("id, owner_id, module").eq("owner_id", ids.owner).eq("module", "support");

  if (walletLookupError) throw new Error(`fixture wallet lookup failed: ${walletLookupError.message}`);
  if (existingExpert && (existingExpert.name !== "Тестовый Специалист Пневмо" || existingExpert.specialty !== "Психологическая поддержка (тест)")) {
    throw new Error("Refusing cleanup: expert ID is not owned by this fixture.");
  }
  if (existingSession && (
    existingSession.session_id !== SESSION_ID
    || existingSession.public_code !== PUBLIC_CODE
    || existingSession.anonymous_owner_id !== ids.owner
    || existingSession.organization_id !== ORG_ID
    || existingSession.json_data?.pilot_id !== PILOT_ID
    || existingSession.json_data?.demo_fixture !== "pneumointegration-test-001"
  )) {
    throw new Error("Refusing cleanup: session ID is not owned by this fixture.");
  }
  if (existingCred && !String(existingCred.lookup_code || "").startsWith("ТОЧКА-PN")) {
    throw new Error("Refusing cleanup: continuation credential is not owned by this fixture.");
  }
  if (existingAssignment && (
    existingAssignment.public_code !== PUBLIC_CODE
    || existingAssignment.owner_id !== ids.owner
    || existingAssignment.organization_id !== ORG_ID
    || existingAssignment.source !== "test_fixture"
  )) {
    throw new Error("Refusing cleanup: assignment ID is not owned by this fixture.");
  }
  if (existingMembership && (
    existingMembership.organization_id !== ORG_ID
    || existingMembership.expert_id !== ids.expert
  )) {
    throw new Error("Refusing cleanup: membership ID is not owned by this fixture.");
  }
  if (existingWallets?.length && (!existingCodes?.wallet_id || existingWallets.length !== 1 || existingWallets[0].id !== existingCodes.wallet_id)) {
    throw new Error("Refusing cleanup: wallet identity is not owned by this fixture.");
  }

  if (existingExpert && existingSession && existingCred && existingCodes) {
    console.log(JSON.stringify({
      project_ref: TEST_PROJECT_REF,
      pilot_id: PILOT_ID,
      status: "already_exists",
      specialist: {
        url: "https://pneumo-test.tochka-opori.online/specialist",
        access_code: existingCodes.access_code,
        name: "Тестовый Специалист Пневмо",
        allowed_modules: ["support"],
      },
      patient: {
        session_id: SESSION_ID,
        public_code: PUBLIC_CODE,
        continuation_code: existingCodes.continuation_code,
      },
      assignment: {
        id: ids.assignment,
        patient_label: "Тестовый Пациент Пневмо",
      },
    }, null, 2));
    return;
  }

  // Clean partial state before fresh create
  if (existingExpert || existingSession || existingCred) {
    await cleanup();
  }

  // ── Generate codes ─────────────────────────────────────────────────────

  const accessCode = generateAccessCode();
  const lookupCode = generateLookupCode();
  const secret = generateSecret();
  const continuationCode = `${lookupCode}-${secret}`;

  // ── Create rows ────────────────────────────────────────────────────────

  // 1. Specialist — Support only
  await ensure(await supabase.from("experts").insert({
    id: ids.expert,
    name: "Тестовый Специалист Пневмо",
    role: "psychologist",
    specialty: "Психологическая поддержка (тест)",
    city: "TEST",
    access_code: accessCode,
    is_active: true,
    allowed_modules: ["support"],
  }), "experts");

  // 2. Membership in Pneumointegration org
  await ensure(await supabase.from("expert_organization_memberships").insert({
    id: ids.membership,
    organization_id: ORG_ID,
    expert_id: ids.expert,
    role: "psychologist",
    status: "active",
  }), "expert_organization_memberships");

  // 3. Patient session with pilot_id
  await ensure(await supabase.from("sessions").insert({
    id: ids.session,
    session_id: SESSION_ID,
    public_code: PUBLIC_CODE,
    module: "support",
    anonymous_owner_id: ids.owner,
    organization_id: ORG_ID,
    primary_expert_id: ids.expert,
    patient_text: "Синтетический тестовый случай для проверки пилота ПневмоИнтеграции.",
    user_report: "Тестовый отчёт пациента (синтетические данные).",
    doctor_report: "Тестовый отчёт специалиста (синтетические данные).",
    care_recommendation: { level: "self_support", reasons: [] },
    report_generation_status: "ready",
    conversation_history: [],
    json_data: {
      pilot_id: PILOT_ID,
      demo_fixture: "pneumointegration-test-001",
    },
    legacy_access: false,
  }), "sessions");

  // 4. Assignment
  await ensure(await supabase.from("patient_assignments").insert({
    id: ids.assignment,
    public_code: PUBLIC_CODE,
    owner_type: "anonymous_case",
    owner_id: ids.owner,
    primary_expert_id: ids.expert,
    organization_id: ORG_ID,
    module: "support",
    status: "active",
    patient_label: "Тестовый Пациент Пневмо",
    source: "test_fixture",
  }), "patient_assignments");

  // 5. Continuation credential (hashed)
  await ensure(await supabase.from("continuation_credentials").insert({
    id: ids.credential,
    module: "support",
    owner_type: "anonymous_case",
    owner_id: ids.owner,
    lookup_code: lookupCode,
    secret_hash: hashContinuationSecret(secret),
    secret_version: 1,
  }), "continuation_credentials");

  // 6. Wallet
  const wallet = await ensureWallet({ ownerType: "anonymous_case", ownerId: ids.owner, module: "support" });
  if (!wallet) throw new Error("wallet setup failed");
  if (!(await setWalletVisible({ walletId: wallet.id }))) throw new Error("wallet visibility setup failed");

  // ── Save codes locally ─────────────────────────────────────────────────

  ensureGitignored();
  const codesData = {
    project_ref: TEST_PROJECT_REF,
    pilot_id: PILOT_ID,
    organization_id: ORG_ID,
    generated_at: new Date().toISOString(),
    specialist: {
      access_code: accessCode,
      name: "Тестовый Специалист Пневмо",
      url: "https://pneumo-test.tochka-opori.online/specialist",
      allowed_modules: ["support"],
    },
    patient: {
      session_id: SESSION_ID,
      public_code: PUBLIC_CODE,
      continuation_code: continuationCode,
      lookup_code: lookupCode,
    },
    wallet_id: wallet.id,
  };
  saveCodes(codesData);

  console.log(JSON.stringify({
    project_ref: TEST_PROJECT_REF,
    pilot_id: PILOT_ID,
    status: "created",
    specialist: {
      url: "https://pneumo-test.tochka-opori.online/specialist",
      access_code: accessCode,
      name: "Тестовый Специалист Пневмо",
      allowed_modules: ["support"],
    },
    patient: {
      session_id: SESSION_ID,
      public_code: PUBLIC_CODE,
      continuation_code: continuationCode,
    },
    assignment: {
      id: ids.assignment,
      patient_label: "Тестовый Пациент Пневмо",
    },
    codes_saved_to: CODES_FILE,
  }, null, 2));
}

run().catch((error) => {
  console.error(`Fixture operation failed: ${error.message}`);
  process.exit(1);
});
