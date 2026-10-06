// Medication reference runtime checks via PostgREST against TEST only.
// Refuses any Supabase URL other than the TEST project. No secrets are printed.
// Usage: node scripts/test-medication-reference-runtime-postgrest.js
//
// Repeatable by design:
// - Immutable reference fixtures (concepts, documents, snapshots, summaries) use
//   stable IDs and are created once. On re-runs they are reused only when their
//   content matches the expected synthetic fixture exactly; any mismatch fails
//   closed before anything is mutated. Append-only fixtures are never deleted
//   or updated for cleanup.
// - Patient orders are mutable run state. Fixed order IDs are reused, verified
//   by identity, and restored to the unresolved baseline (only when needed)
//   before each scenario. Only synthetic test_only fixtures are ever written.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const REQUIRED_REF = "eehyehlhiyztciaezaus";

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([A-Za-z_]+)=(.*)$/);
      if (match) env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, "$1");
    }
  } catch {
    return env;
  }
  return env;
}

const env = loadEnv(".env.local");
const url = process.env.TEST_SUPABASE_URL || env.TEST_SUPABASE_URL || "";
const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY || env.TEST_SUPABASE_SERVICE_ROLE_KEY || "";

const refMatch = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
const actualRef = refMatch?.[1] || "unknown";
if (actualRef !== REQUIRED_REF) {
  console.error(`Refusing: expected TEST ref ${REQUIRED_REF}, got ${actualRef}.`);
  process.exit(1);
}
if (!key) {
  console.error("Missing TEST_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
console.log(`Target: ${actualRef} (TEST) — OK`);

const supabase = createClient(url, key, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
}

function failClosed(label) {
  check(false, label);
  console.error("Fail closed: aborting before mutating any further rows.");
  console.log(`\nPostgREST runtime checks: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const ownerHealth = "11111111-1111-4111-8111-111111111111";
const ownerSupport = "22222222-2222-4222-8222-222222222222";
const ownerOther = "99999999-9999-4999-8999-999999999999";

const conceptTestId = "b8000000-0000-4000-8000-00000000a001";
const conceptUnusedId = "b8000000-0000-4000-8000-00000000a002";
const docId = "b8000000-0000-4000-8000-00000000a011";
const snapshotId = "b8000000-0000-4000-8000-00000000a012";
const summaryId = "b8000000-0000-4000-8000-00000000a013";
const orderTextId = "b8000000-0000-4000-8000-00000000a021";
const orderGateId = "b8000000-0000-4000-8000-00000000a023";
const orderSupplementId = "b8000000-0000-4000-8000-00000000a024";

const originalText = "Синтетик-Тест  50 мг (API)";

function errCode(error) {
  return String(error?.code || error?.details || error?.message || "");
}

// Legacy runs stamped fixture codes with a numeric run marker. Reuse accepts
// the stable code or exactly that legacy shape; anything else fails closed.
function fixtureCodeOk(actual, stable, legacyPrefix) {
  if (actual === stable) return true;
  if (typeof actual !== "string" || !actual.startsWith(legacyPrefix)) return false;
  return /^\d+$/.test(actual.slice(legacyPrefix.length));
}

function fieldMismatch(label, actual, expected) {
  return actual === expected ? null : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function verifyConceptTest(row) {
  if (!fixtureCodeOk(row?.concept_code, "medref.runtime.test.fixture", "medref.runtime.test.")) return "concept_code is not the synthetic runtime fixture code";
  return fieldMismatch("source_system", row.source_system, "internal")
    || fieldMismatch("jurisdiction", row.jurisdiction, "RU")
    || fieldMismatch("canonical_name", row.canonical_name, "Synthetic runtime test concept")
    || fieldMismatch("display_name", row.display_name, "Synthetic runtime test concept")
    || fieldMismatch("concept_kind", row.concept_kind, "single_ingredient")
    || fieldMismatch("status", row.status, "active")
    || fieldMismatch("test_only", row.test_only, true);
}

function verifyConceptUnused(row) {
  if (!fixtureCodeOk(row?.concept_code, "medref.runtime.unused.fixture", "medref.runtime.unused.")) return "concept_code is not the synthetic runtime fixture code";
  return fieldMismatch("source_system", row.source_system, "internal")
    || fieldMismatch("jurisdiction", row.jurisdiction, "RU")
    || fieldMismatch("canonical_name", row.canonical_name, "Synthetic runtime unused concept")
    || fieldMismatch("display_name", row.display_name, "Synthetic runtime unused concept")
    || fieldMismatch("concept_kind", row.concept_kind, "single_ingredient")
    || fieldMismatch("status", row.status, "active")
    || fieldMismatch("test_only", row.test_only, false);
}

function verifyDocument(row) {
  if (!fixtureCodeOk(row?.source_document_id, "runtime-doc-fixture", "runtime-doc-")) return "source_document_id is not the synthetic runtime fixture code";
  if (!fixtureCodeOk(row?.canonical_identifier, "fixture:runtime-doc-fixture", "fixture:runtime-doc-")) return "canonical_identifier is not the synthetic runtime fixture code";
  return fieldMismatch("source_provider", row.source_provider, "fixture")
    || fieldMismatch("source_title", row.source_title, "Synthetic runtime fixture document, not medical information")
    || fieldMismatch("source_version", row.source_version, "v1")
    || fieldMismatch("country", row.country, "RU")
    || fieldMismatch("language", row.language, "ru")
    || fieldMismatch("content_hash", row.content_hash, "a".repeat(64))
    || fieldMismatch("verification_status", row.verification_status, "verified")
    || fieldMismatch("test_only", row.test_only, true)
    || fieldMismatch("verified_by", row.verified_by, "runtime-test-only-fixture");
}

function verifySnapshot(row) {
  return fieldMismatch("source_document_id", row?.source_document_id, docId)
    || fieldMismatch("medication_concept_id", row.medication_concept_id, conceptTestId)
    || fieldMismatch("snapshot_version", row.snapshot_version, "v1")
    || fieldMismatch("source_facts", JSON.stringify(row.source_facts), JSON.stringify({ mechanism_summary: "Synthetic runtime fixture only; no medical content." }))
    || fieldMismatch("content_hash", row.content_hash, "b".repeat(64))
    || fieldMismatch("test_only", row.test_only, true);
}

function verifySummary(row) {
  return fieldMismatch("reference_snapshot_id", row?.reference_snapshot_id, snapshotId)
    || fieldMismatch("summary_language", row.summary_language, "ru")
    || fieldMismatch("summary_text", row.summary_text, "Synthetic runtime summary fixture; not medical information.")
    || fieldMismatch("model_provider", row.model_provider, "fixture")
    || fieldMismatch("model_name", row.model_name, "fixture-model")
    || fieldMismatch("prompt_version", row.prompt_version, "runtime-v1")
    || fieldMismatch("review_status", row.review_status, "draft")
    || fieldMismatch("test_only", row.test_only, true);
}

async function ensureReferenceFixture(label, table, insertRow, verifyRow) {
  const { error: insertError } = await supabase.from(table).insert(insertRow);
  if (!insertError) {
    check(true, `${label} fixture created (synthetic, immutable)`);
    return insertRow;
  }
  if (!errCode(insertError).includes("23505")) {
    failClosed(`${label} fixture insert failed (${insertError.message})`);
  }
  const { data: existing, error: readError } = await supabase.from(table).select("*").eq("id", insertRow.id).maybeSingle();
  if (readError || !existing) failClosed(`${label} fixture exists but cannot be read for verification`);
  const mismatch = verifyRow(existing);
  if (mismatch) failClosed(`${label} fixture content mismatch, fail closed: ${mismatch}`);
  check(true, `${label} fixture reused (content verified)`);
  return existing;
}

const orderBaseline = {
  reference_status: "unresolved",
  reference_candidate_concepts: [],
  reference_confidence: null,
  reference_matched_by: null,
  reference_match_method: null,
  reference_matched_at: null,
  reference_source_provider: null,
  reference_source_snapshot_id: null,
  medication_concept_id: null,
};

async function ensureOrder(label, insertRow) {
  const { error: insertError } = await supabase.from("patient_medication_orders").insert(insertRow);
  if (!insertError) return { created: true, reset: false };
  if (!errCode(insertError).includes("23505")) failClosed(`${label} order insert failed (${insertError.message})`);
  const { data: existing, error: readError } = await supabase.from("patient_medication_orders")
    .select("id, name, owner_type, owner_id, source_module, item_type, single_dose, dose_unit, reference_status, reference_candidate_concepts, medication_concept_id, reference_confidence, reference_matched_by, reference_match_method, reference_matched_at, reference_source_provider, reference_source_snapshot_id")
    .eq("id", insertRow.id).maybeSingle();
  if (readError || !existing) failClosed(`${label} order exists but cannot be read for verification`);
  const identityMismatch = fieldMismatch("name", existing.name, insertRow.name)
    || fieldMismatch("owner_type", existing.owner_type, insertRow.owner_type)
    || fieldMismatch("owner_id", existing.owner_id, insertRow.owner_id)
    || fieldMismatch("source_module", existing.source_module, insertRow.source_module)
    || fieldMismatch("item_type", existing.item_type, insertRow.item_type)
    || fieldMismatch("single_dose", Number(existing.single_dose), insertRow.single_dose)
    || fieldMismatch("dose_unit", existing.dose_unit, insertRow.dose_unit);
  if (identityMismatch) failClosed(`${label} order content mismatch, fail closed: ${identityMismatch}`);
  const atBaseline = existing.reference_status === "unresolved"
    && existing.medication_concept_id === null
    && (existing.reference_candidate_concepts || []).length === 0
    && existing.reference_confidence === null
    && existing.reference_matched_by === null
    && existing.reference_match_method === null
    && existing.reference_matched_at === null
    && existing.reference_source_provider === null
    && existing.reference_source_snapshot_id === null;
  if (atBaseline) return { created: false, reset: false };
  const { error: resetError } = await supabase.from("patient_medication_orders").update(orderBaseline).eq("id", insertRow.id);
  if (resetError) failClosed(`${label} order baseline restore failed (${resetError.message})`);
  return { created: false, reset: true };
}

function orderFixtureLabel(label, result) {
  return result.created
    ? `${label} order fixture created (insert defaults)`
    : result.reset
      ? `${label} order fixture reused (baseline restored)`
      : `${label} order fixture reused (baseline confirmed)`;
}

async function main() {
  console.log("\nReference fixtures (synthetic, immutable, reused across runs)");
  await ensureReferenceFixture("test-only concept", "medication_concepts", {
    id: conceptTestId,
    concept_code: "medref.runtime.test.fixture",
    source_system: "internal",
    jurisdiction: "RU",
    canonical_name: "Synthetic runtime test concept",
    display_name: "Synthetic runtime test concept",
    concept_kind: "single_ingredient",
    status: "active",
    test_only: true,
  }, verifyConceptTest);
  const conceptUnusedRow = await ensureReferenceFixture("non-test concept", "medication_concepts", {
    id: conceptUnusedId,
    concept_code: "medref.runtime.unused.fixture",
    source_system: "internal",
    jurisdiction: "RU",
    canonical_name: "Synthetic runtime unused concept",
    display_name: "Synthetic runtime unused concept",
    concept_kind: "single_ingredient",
    status: "active",
    test_only: false,
  }, verifyConceptUnused);
  await ensureReferenceFixture("test-only document", "medication_reference_documents", {
    id: docId,
    source_provider: "fixture",
    source_document_id: "runtime-doc-fixture",
    canonical_identifier: "fixture:runtime-doc-fixture",
    source_title: "Synthetic runtime fixture document, not medical information",
    source_version: "v1",
    retrieved_at: new Date().toISOString(),
    country: "RU",
    language: "ru",
    content_hash: "a".repeat(64),
    verification_status: "verified",
    test_only: true,
    verified_at: new Date().toISOString(),
    verified_by: "runtime-test-only-fixture",
  }, verifyDocument);
  await ensureReferenceFixture("test-only snapshot", "medication_reference_snapshots", {
    id: snapshotId,
    source_document_id: docId,
    medication_concept_id: conceptTestId,
    snapshot_version: "v1",
    source_facts: { mechanism_summary: "Synthetic runtime fixture only; no medical content." },
    content_hash: "b".repeat(64),
    retrieved_at: new Date().toISOString(),
    test_only: true,
  }, verifySnapshot);
  await ensureReferenceFixture("test-only summary", "medication_reference_summaries", {
    id: summaryId,
    reference_snapshot_id: snapshotId,
    summary_language: "ru",
    summary_text: "Synthetic runtime summary fixture; not medical information.",
    model_provider: "fixture",
    model_name: "fixture-model",
    prompt_version: "runtime-v1",
    test_only: true,
  }, verifySummary);

  console.log("\nCheck 1: patient order text is preserved verbatim");
  const textOrderState = await ensureOrder("patient", {
    id: orderTextId,
    owner_type: "anonymous_profile",
    owner_id: ownerHealth,
    source_module: "health",
    item_type: "medication",
    name: originalText,
    single_dose: 50,
    dose_unit: "мг",
    frequency_type: "times_per_day",
    times_per_day: 1,
    start_date: "2026-10-06",
    ongoing: true,
  });
  check(true, orderFixtureLabel("patient", textOrderState));
  const { data: orderTextRow } = await supabase
    .from("patient_medication_orders")
    .select("name, reference_status, medication_concept_id")
    .eq("id", orderTextId)
    .single();
  check(orderTextRow?.name === originalText, "stored name equals original patient-entered text (no normalization)");
  check(
    orderTextRow?.reference_status === "unresolved" && orderTextRow?.medication_concept_id === null,
    "order starts from unresolved baseline without concept link",
  );

  console.log("\nChecks 2-3: exact candidate is recorded, never auto-matched");
  const candidatePayload = {
    reference_status: "candidate",
    reference_candidate_concepts: [
      {
        medication_concept_id: conceptUnusedId,
        concept_code: conceptUnusedRow.concept_code,
        display_name: conceptUnusedRow.display_name,
        confidence: 1,
        confidence_method: "exact_normalized_name",
      },
    ],
    reference_confidence: 1,
    reference_match_method: "exact_normalized_name",
    reference_source_provider: "internal",
  };
  const { error: candidateError } = await supabase
    .from("patient_medication_orders")
    .update(candidatePayload)
    .eq("id", orderTextId);
  check(!candidateError, `candidate state saved${candidateError ? ` (${candidateError.message})` : ""}`);
  const { data: candidateRow } = await supabase
    .from("patient_medication_orders")
    .select("reference_status, medication_concept_id, reference_candidate_concepts")
    .eq("id", orderTextId)
    .single();
  check(
    candidateRow?.reference_status === "candidate"
      && candidateRow?.medication_concept_id === null
      && candidateRow?.reference_candidate_concepts?.length === 1,
    "candidate keeps exactly one proposal and no concept link",
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const { data: autoMatchRows } = await supabase
    .from("patient_medication_reference_matches")
    .select("reference_status")
    .eq("medication_order_id", orderTextId);
  check(
    !(autoMatchRows || []).some((row) => ["matched", "verified"].includes(row.reference_status)),
    "no matched/verified history event appears without explicit confirmation",
  );

  console.log("\nCheck 5: fail-closed reference states are rejected");
  const supplementState = await ensureOrder("supplement", {
    id: orderSupplementId,
    owner_type: "anonymous_case",
    owner_id: ownerSupport,
    source_module: "support",
    item_type: "supplement",
    name: "Synthetic runtime supplement",
    single_dose: 1,
    dose_unit: "capsule",
    frequency_type: "as_needed",
    start_date: "2026-10-06",
    ongoing: true,
  });
  check(true, orderFixtureLabel("supplement", supplementState));
  const { error: supplementLinkError } = await supabase
    .from("patient_medication_orders")
    .update(candidatePayload)
    .eq("id", orderSupplementId);
  check(!!supplementLinkError && errCode(supplementLinkError).includes("23514"), "supplement cannot enter a medication candidate state (23514)");
  const gateState = await ensureOrder("gate", {
    id: orderGateId,
    owner_type: "anonymous_case",
    owner_id: ownerSupport,
    source_module: "support",
    item_type: "medication",
    name: "Synthetic runtime gate order",
    single_dose: 1,
    dose_unit: "tablet",
    frequency_type: "times_per_day",
    times_per_day: 1,
    start_date: "2026-10-06",
    ongoing: true,
  });
  check(true, orderFixtureLabel("gate", gateState));
  const { error: verifiedMissingSnapshotError } = await supabase
    .from("patient_medication_orders")
    .update({
      reference_status: "verified",
      medication_concept_id: conceptUnusedId,
      reference_matched_by: "patient",
      reference_matched_at: new Date().toISOString(),
      reference_match_method: "explicit",
      reference_source_provider: "internal",
    })
    .eq("id", orderGateId);
  check(
    !!verifiedMissingSnapshotError && errCode(verifiedMissingSnapshotError).includes("23514"),
    "verified state without a source snapshot is rejected (23514)",
  );
  const { error: matchedBareError } = await supabase
    .from("patient_medication_orders")
    .update({ reference_status: "matched", medication_concept_id: conceptUnusedId })
    .eq("id", orderGateId);
  check(
    !!matchedBareError && errCode(matchedBareError).includes("23514"),
    "matched state without confirmation metadata is rejected (23514)",
  );
  const { error: matchedTestOnlyError } = await supabase
    .from("patient_medication_orders")
    .update({
      reference_status: "matched",
      medication_concept_id: conceptTestId,
      reference_matched_by: "patient",
      reference_matched_at: new Date().toISOString(),
      reference_match_method: "explicit",
      reference_source_provider: "internal",
    })
    .eq("id", orderGateId);
  check(
    !!matchedTestOnlyError && errCode(matchedTestOnlyError).includes("23514"),
    "matched state cannot reference a test-only concept (23514)",
  );
  const { error: verifiedTestOnlyError } = await supabase
    .from("patient_medication_orders")
    .update({
      reference_status: "verified",
      medication_concept_id: conceptTestId,
      reference_matched_by: "patient",
      reference_matched_at: new Date().toISOString(),
      reference_match_method: "explicit",
      reference_source_provider: "fixture",
      reference_source_snapshot_id: snapshotId,
    })
    .eq("id", orderGateId);
  check(
    !!verifiedTestOnlyError && errCode(verifiedTestOnlyError).includes("23514"),
    "verified state cannot use a test-only snapshot (23514)",
  );

  console.log("\nCheck 9: snapshot and version provenance is preserved");
  const { data: provenanceRows } = await supabase
    .from("medication_reference_snapshots")
    .select("id, snapshot_version, content_hash, test_only, medication_concept_id, source_document_id, source_facts, medication_reference_documents(source_provider, source_document_id, source_version, content_hash, verification_status, test_only)")
    .eq("id", snapshotId);
  const provenance = provenanceRows?.[0];
  check(provenance?.snapshot_version === "v1", "snapshot version preserved");
  check(provenance?.content_hash === "b".repeat(64), "snapshot content hash preserved");
  check(provenance?.medication_concept_id === conceptTestId, "snapshot keeps concept binding");
  check(provenance?.source_document_id === docId, "snapshot keeps source document binding");
  check(provenance?.source_facts?.mechanism_summary?.includes("Synthetic runtime fixture"), "source facts stored verbatim");
  const doc = Array.isArray(provenance?.medication_reference_documents)
    ? provenance?.medication_reference_documents?.[0]
    : provenance?.medication_reference_documents;
  check(doc?.source_provider === "fixture" && doc?.source_version === "v1", "document provider and version preserved");
  check(doc?.content_hash === "a".repeat(64) && doc?.verification_status === "verified", "document hash and verification status preserved");

  console.log("\nCheck 10: AI summary is stored separately from source facts");
  const { data: summaryRows } = await supabase
    .from("medication_reference_summaries")
    .select("id, reference_snapshot_id, summary_text, model_provider, model_name, prompt_version, test_only")
    .eq("id", summaryId);
  const summary = summaryRows?.[0];
  check(summary?.reference_snapshot_id === snapshotId, "summary references its snapshot");
  check(summary?.summary_text?.includes("Synthetic runtime summary"), "summary text kept in its own record");
  const { data: snapshotAfterSummary } = await supabase
    .from("medication_reference_snapshots")
    .select("source_facts")
    .eq("id", snapshotId)
    .single();
  check(
    JSON.stringify(snapshotAfterSummary?.source_facts) === JSON.stringify(provenance?.source_facts),
    "source facts are unchanged after summary insert",
  );

  console.log("\nCheck 11: reference provenance is append-only for the server role");
  const { error: docUpdateError } = await supabase
    .from("medication_reference_documents")
    .update({ source_title: "changed" })
    .eq("id", docId);
  check(!!docUpdateError, "source document update is rejected");
  const { error: docDeleteError } = await supabase
    .from("medication_reference_documents")
    .delete()
    .eq("id", docId);
  check(!!docDeleteError, "source document delete is rejected");
  const { error: snapshotUpdateError } = await supabase
    .from("medication_reference_snapshots")
    .update({ snapshot_version: "changed" })
    .eq("id", snapshotId);
  check(!!snapshotUpdateError, "snapshot update is rejected");
  const { error: snapshotDeleteError } = await supabase
    .from("medication_reference_snapshots")
    .delete()
    .eq("id", snapshotId);
  check(!!snapshotDeleteError, "snapshot delete is rejected");
  const { error: summaryUpdateError } = await supabase
    .from("medication_reference_summaries")
    .update({ summary_text: "changed" })
    .eq("id", summaryId);
  check(!!summaryUpdateError, "summary update is rejected");
  const { error: summaryDeleteError } = await supabase
    .from("medication_reference_summaries")
    .delete()
    .eq("id", summaryId);
  check(!!summaryDeleteError, "summary delete is rejected");
  const { data: snapshotStill } = await supabase
    .from("medication_reference_snapshots")
    .select("snapshot_version")
    .eq("id", snapshotId)
    .single();
  check(snapshotStill?.snapshot_version === "v1", "old snapshot version is not overwritten");

  console.log("\nCheck 13: owner isolation on match history");
  const { error: ownerFkError } = await supabase.from("patient_medication_reference_matches").insert({
    medication_order_id: orderTextId,
    owner_type: "anonymous_profile",
    owner_id: ownerOther,
    reference_status: "candidate",
    candidate_concepts: [{ medication_concept_id: conceptUnusedId }],
    match_method: "explicit",
    source_provider: "internal",
  });
  check(
    !!ownerFkError && errCode(ownerFkError).includes("23503"),
    "match history row with a foreign owner is rejected by the composite owner FK (23503)",
  );

  console.log("\nCheck 6 (API surface): test-only concept cannot be confirmed for a patient order");
  check(!!matchedTestOnlyError, "explicit confirmation path rejects test-only concepts at the database layer");

  console.log(`\nPostgREST runtime checks: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("Runtime check runner crashed:", error?.message || error);
  process.exit(1);
});
