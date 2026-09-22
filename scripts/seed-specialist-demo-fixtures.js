// Deterministic TEST-only fixtures for Support/Health specialist manual E2E.
// The script refuses every Supabase project except the linked Preview-Test ref.
// Usage requires TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY and
// TEST_CONTINUATION_SECRET_PEPPER (the latter may be passed from Preview env).

import { createClient } from "@supabase/supabase-js";

const TEST_PROJECT_REF = "eehyehlhiyztciaezaus";
const MANUAL_BASE_URL = process.env.TEST_MANUAL_BASE_URL || "https://tochka-opori-git-clinical-c1-maxim-shvachko-s-projects.vercel.app";
const SPECIALIST_URL = `${MANUAL_BASE_URL}/specialist`;
const SUPPORT_CLIENT_URL = MANUAL_BASE_URL;
const HEALTH_CLIENT_URL = `${MANUAL_BASE_URL}/?module=body`;

const ACCESS_CODES = {
  support: "DEMO-SUP-C1-ISOLATION",
  body: "DEMO-HLT-C1-ISOLATION",
};

const CONTINUATION_CODES = {
  support: "ТОЧКА-C1SP-PORT-ABCD-EFGH-JKMN",
  body: "HEALTH-C1HL-TST-ABCD-EFGH-JKMN",
};

const ids = {
  supportExpert: "c1000000-0000-4000-8000-000000000001",
  bodyExpert: "c1000000-0000-4000-8000-000000000002",
  supportOwner: "c1000000-0000-4000-8000-000000000011",
  bodyOwner: "c1000000-0000-4000-8000-000000000012",
  supportSession: "c1000000-0000-4000-8000-000000000021",
  bodySession: "c1000000-0000-4000-8000-000000000022",
  supportAssignment: "c1000000-0000-4000-8000-000000000031",
  bodyAssignment: "c1000000-0000-4000-8000-000000000032",
  supportRequest: "c1000000-0000-4000-8000-000000000041",
  bodyRequest: "c1000000-0000-4000-8000-000000000042",
  bodyClient: "c1000000-0000-4000-8000-000000000051",
  bodyLog: "c1000000-0000-4000-8000-000000000061",
  bodyIntake: "c1000000-0000-4000-8000-000000000062",
  bodyOnboarding: "c1000000-0000-4000-8000-000000000063",
  supportCredential: "c1000000-0000-4000-8000-000000000071",
  bodyCredential: "c1000000-0000-4000-8000-000000000072",
};

const supportSessionId = "demo-support-c1-isolation";
const bodySessionId = "demo-health-c1-isolation";
const supportPublicCode = "DEMO-SUP-CASE-C1";
const bodyPublicCode = "HEALTH-DEMO-CASE-C1";

function requireTestEnvironment() {
  const url = process.env.TEST_SUPABASE_URL || "";
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";
  const pepper = process.env.TEST_CONTINUATION_SECRET_PEPPER || process.env.CONTINUATION_SECRET_PEPPER || "";
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];

  if (ref !== TEST_PROJECT_REF) {
    throw new Error(`Refusing fixture operation: expected TEST project ${TEST_PROJECT_REF}, got ${ref || "unknown"}.`);
  }
  if (!key) throw new Error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY.");
  if (!pepper) throw new Error("Missing TEST_CONTINUATION_SECRET_PEPPER.");

  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.CONTINUATION_SECRET_PEPPER = pepper;
  return { url, key };
}

async function run() {
  const { url, key } = requireTestEnvironment();
  const supabase = createClient(url, key);
  const { hashContinuationSecret } = await import("../lib/session/continuation-credential.js");
  const { ensureWallet, setWalletVisible } = await import("../lib/usage/wallet.js");
  const cleanupOnly = process.argv.includes("--cleanup");

  async function ensure(result, label) {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data;
  }

  async function remove(table, column, values) {
    const result = await supabase.from(table).delete().in(column, values);
    if (result.error) throw new Error(`cleanup ${table}: ${result.error.message}`);
  }

  async function cleanup() {
    await remove("service_requests", "id", [ids.supportRequest, ids.bodyRequest]);
    await remove("body_daily_logs", "id", [ids.bodyLog]);
    await remove("body_intake_forms", "id", [ids.bodyIntake]);
    await remove("body_onboarding", "id", [ids.bodyOnboarding]);

    const { data: wallets, error: walletError } = await supabase
      .from("usage_wallets")
      .select("id")
      .in("owner_id", [ids.supportOwner, ids.bodyOwner]);
    if (walletError) throw new Error(`cleanup usage_wallets lookup: ${walletError.message}`);
    for (const wallet of wallets || []) {
      await ensure(await supabase.from("usage_ledger").delete().eq("wallet_id", wallet.id), "cleanup usage_ledger");
      await ensure(await supabase.from("usage_reservations").delete().eq("wallet_id", wallet.id), "cleanup usage_reservations");
    }
    await remove("usage_wallets", "owner_id", [ids.supportOwner, ids.bodyOwner]);
    await remove("continuation_credentials", "id", [ids.supportCredential, ids.bodyCredential]);
    await remove("patient_assignments", "id", [ids.supportAssignment, ids.bodyAssignment]);
    await remove("body_clients", "id", [ids.bodyClient]);
    await remove("sessions", "id", [ids.supportSession, ids.bodySession]);
    await remove("experts", "id", [ids.supportExpert, ids.bodyExpert]);
  }

  if (cleanupOnly) {
    await cleanup();
    console.log(JSON.stringify({ project_ref: TEST_PROJECT_REF, cleaned: true }));
    return;
  }

  // Remove only rows owned by this deterministic fixture before recreating them.
  await cleanup();

  await ensure(await supabase.from("experts").insert([
    {
      id: ids.supportExpert,
      name: "Demo Support Specialist",
      role: "doctor",
      specialty: "Тестовый специалист — Support",
      city: "TEST",
      access_code: ACCESS_CODES.support,
      is_active: true,
      allowed_modules: ["support"],
    },
    {
      id: ids.bodyExpert,
      name: "Demo Health Specialist",
      role: "specialist",
      specialty: "Тестовый специалист — Health",
      city: "TEST",
      access_code: ACCESS_CODES.body,
      is_active: true,
      allowed_modules: ["body"],
    },
  ]), "experts");

  await ensure(await supabase.from("sessions").insert([
    {
      id: ids.supportSession,
      session_id: supportSessionId,
      public_code: supportPublicCode,
      module: "support",
      anonymous_owner_id: ids.supportOwner,
      patient_text: "Synthetic Support demo case.",
      user_report: "Synthetic Support report for manual TEST verification.",
      doctor_report: "Synthetic Support specialist report.",
      care_recommendation: { level: "self_support", reasons: [] },
      report_generation_status: "ready",
      conversation_history: [],
      json_data: { demo_fixture: "specialist-module-isolation-c1" },
      legacy_access: false,
    },
    {
      id: ids.bodySession,
      session_id: bodySessionId,
      public_code: bodyPublicCode,
      module: "body",
      anonymous_owner_id: ids.bodyOwner,
      conversation_history: [],
      json_data: { demo_fixture: "specialist-module-isolation-c1" },
      legacy_access: false,
    },
  ]), "sessions");

  await ensure(await supabase.from("body_clients").insert({
    id: ids.bodyClient,
    session_id: bodySessionId,
    anonymous_owner_id: ids.bodyOwner,
    display_name: "Demo Health Client",
    source: "test_fixture",
    status: "active",
    goal: "Наблюдать дневник здоровья",
  }), "body_clients");

  const today = new Date().toISOString().slice(0, 10);
  await ensure(await supabase.from("body_intake_forms").insert({
    id: ids.bodyIntake,
    session_id: bodySessionId,
    module: "body",
    version: "body-intake-v0.1",
    answers: { display_name: "Demo Health Client", goal: "Наблюдать дневник здоровья", height_cm: 170, weight_kg: 70 },
    bmi: 24.2,
    care_recommendation: "self_care",
    source: "test_fixture",
  }), "body_intake_forms");

  await ensure(await supabase.from("body_onboarding").insert({
    id: ids.bodyOnboarding,
    owner_type: "anonymous_profile",
    owner_id: ids.bodyOwner,
    intro_completed: true,
    intro_completed_at: new Date().toISOString(),
    tracked_metrics: ["weight", "steps", "sleep"],
    priority_metrics: ["energy"],
  }), "body_onboarding");

  await ensure(await supabase.from("body_daily_logs").insert({
    id: ids.bodyLog,
    session_id: bodySessionId,
    module: "body",
    log_date: today,
    weight_kg: 70,
    steps: 8000,
    sleep_hours: 7.5,
    sleep_quality: 4,
    energy_level: 4,
    mood_level: 4,
    meals_count: 3,
    water_l: 1.8,
  }), "body_daily_logs");

  await ensure(await supabase.from("patient_assignments").insert([
    {
      id: ids.supportAssignment,
      public_code: supportPublicCode,
      primary_expert_id: ids.supportExpert,
      module: "support",
      status: "active",
      patient_label: "Demo Support Client",
      source: "test_fixture",
    },
    {
      id: ids.bodyAssignment,
      owner_type: "anonymous_profile",
      owner_id: ids.bodyOwner,
      primary_expert_id: ids.bodyExpert,
      module: "body",
      status: "active",
      patient_label: "Demo Health Client",
      source: "test_fixture",
    },
  ]), "patient_assignments");

  await ensure(await supabase.from("service_requests").insert([
    {
      id: ids.supportRequest,
      module: "support",
      owner_type: "anonymous_case",
      owner_id: ids.supportOwner,
      specialist_id: ids.supportExpert,
      specialist_name: "Demo Support Specialist",
      request_type: "text_question",
      title: "TEST Support request",
      message: "Synthetic Support request for manual module isolation verification.",
      status: "submitted",
    },
    {
      id: ids.bodyRequest,
      module: "body",
      owner_type: "anonymous_profile",
      owner_id: ids.bodyOwner,
      specialist_id: ids.bodyExpert,
      specialist_name: "Demo Health Specialist",
      request_type: "diary_review",
      title: "TEST Health request",
      message: "Synthetic Health request for manual module isolation verification.",
      status: "submitted",
    },
  ]), "service_requests");

  const credentials = [
    {
      id: ids.supportCredential,
      module: "support",
      owner_type: "anonymous_case",
      owner_id: ids.supportOwner,
      lookup_code: "ТОЧКА-C1SP-PORT",
      secret: "ABCD-EFGH-JKMN",
    },
    {
      id: ids.bodyCredential,
      module: "body",
      owner_type: "anonymous_profile",
      owner_id: ids.bodyOwner,
      lookup_code: "HEALTH-C1HL-TST",
      secret: "ABCD-EFGH-JKMN",
    },
  ];
  for (const credential of credentials) {
    await ensure(await supabase.from("continuation_credentials").insert({
      id: credential.id,
      module: credential.module,
      owner_type: credential.owner_type,
      owner_id: credential.owner_id,
      lookup_code: credential.lookup_code,
      secret_hash: hashContinuationSecret(credential.secret),
      secret_version: 1,
    }), `${credential.module} continuation_credentials`);
  }

  for (const [ownerType, ownerId, module] of [
    ["anonymous_case", ids.supportOwner, "support"],
    ["anonymous_profile", ids.bodyOwner, "body"],
  ]) {
    const wallet = await ensureWallet({ ownerType, ownerId, module });
    if (!wallet) throw new Error(`wallet setup failed for ${module}`);
    if (!(await setWalletVisible({ walletId: wallet.id }))) throw new Error(`wallet visibility setup failed for ${module}`);
  }

  console.log(JSON.stringify({
    project_ref: TEST_PROJECT_REF,
    fixture: "specialist-module-isolation-c1",
    support: {
      client_url: SUPPORT_CLIENT_URL,
      continuation_code: CONTINUATION_CODES.support,
      specialist_url: SPECIALIST_URL,
      specialist_access_code: ACCESS_CODES.support,
    },
    health: {
      client_url: HEALTH_CLIENT_URL,
      continuation_code: CONTINUATION_CODES.body,
      specialist_url: SPECIALIST_URL,
      specialist_access_code: ACCESS_CODES.body,
    },
    medication_authorization_created: false,
  }, null, 2));
}

run().catch((error) => {
  console.error(`Fixture operation failed: ${error.message}`);
  process.exit(1);
});
