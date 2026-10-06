// Medication reference runtime checks via PostgREST against TEST only.
// Refuses any Supabase URL other than the TEST project. No secrets are printed.
// Usage: node scripts/test-medication-reference-runtime-postgrest.js

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

const RUN = Date.now();
const ownerHealth = "11111111-1111-4111-8111-111111111111";
const ownerSupport = "22222222-2222-4222-8222-222222222222";
const ownerOther = "99999999-9999-4999-8999-999999999999";

const conceptTestId = "b8000000-0000-4000-8000-00000000a001";
const conceptUnusedId = "b8000000-0000-4000-8000-00000000a002";
const docId = "b8000000-0000-4000-8000-00000000a011";
const snapshotId = "b8000000-0000-4000-8000-00000000a012";
const summaryId = "b8000000-0000-4000-8000-00000000a013";
const orderTextId = "b8000000-0000-4000-8000-00000000a021";
const orderCandidateId = "b8000000-0000-4000-8000-00000000a022";
const orderGateId = "b8000000-0000-4000-8000-00000000a023";
const orderSupplementId = "b8000000-0000-4000-8000-00000000a024";

const originalText = "Синтетик-Тест  50 мг (API)";

function errCode(error) {
  return String(error?.code || error?.details || error?.message || "");
}

async function main() {
  console.log("\nFixtures (synthetic, test_only)");
  const { error: conceptError } = await supabase.from("medication_concepts").insert([
    {
      id: conceptTestId,
      concept_code: `medref.runtime.test.${RUN}`,
      source_system: "internal",
      jurisdiction: "RU",
      canonical_name: "Synthetic runtime test concept",
      display_name: "Synthetic runtime test concept",
      concept_kind: "single_ingredient",
      status: "active",
      test_only: true,
    },
    {
      id: conceptUnusedId,
      concept_code: `medref.runtime.unused.${RUN}`,
      source_system: "internal",
      jurisdiction: "RU",
      canonical_name: "Synthetic runtime unused concept",
      display_name: "Synthetic runtime unused concept",
      concept_kind: "single_ingredient",
      status: "active",
      test_only: false,
    },
  ]);
  check(!conceptError, `synthetic concepts inserted${conceptError ? ` (${conceptError.message})` : ""}`);

  const { error: docError } = await supabase.from("medication_reference_documents").insert({
    id: docId,
    source_provider: "fixture",
    source_document_id: `runtime-doc-${RUN}`,
    canonical_identifier: `fixture:runtime-doc-${RUN}`,
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
  });
  check(!docError, `test-only document inserted${docError ? ` (${docError.message})` : ""}`);

  const { error: snapshotError } = await supabase.from("medication_reference_snapshots").insert({
    id: snapshotId,
    source_document_id: docId,
    medication_concept_id: conceptTestId,
    snapshot_version: "v1",
    source_facts: { mechanism_summary: "Synthetic runtime fixture only; no medical content." },
    content_hash: "b".repeat(64),
    retrieved_at: new Date().toISOString(),
    test_only: true,
  });
  check(!snapshotError, `test-only snapshot inserted${snapshotError ? ` (${snapshotError.message})` : ""}`);

  const { error: summaryError } = await supabase.from("medication_reference_summaries").insert({
    id: summaryId,
    reference_snapshot_id: snapshotId,
    summary_language: "ru",
    summary_text: "Synthetic runtime summary fixture; not medical information.",
    model_provider: "fixture",
    model_name: "fixture-model",
    prompt_version: "runtime-v1",
    test_only: true,
  });
  check(!summaryError, `test-only summary inserted${summaryError ? ` (${summaryError.message})` : ""}`);

  console.log("\nCheck 1: patient order text is preserved verbatim");
  const { error: orderError } = await supabase.from("patient_medication_orders").insert({
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
  check(!orderError, `patient order inserted${orderError ? ` (${orderError.message})` : ""}`);
  const { data: orderTextRow } = await supabase
    .from("patient_medication_orders")
    .select("name, reference_status, medication_concept_id")
    .eq("id", orderTextId)
    .single();
  check(orderTextRow?.name === originalText, "stored name equals original patient-entered text (no normalization)");
  check(
    orderTextRow?.reference_status === "unresolved" && orderTextRow?.medication_concept_id === null,
    "new order starts unresolved without concept link",
  );

  console.log("\nChecks 2-3: exact candidate is recorded, never auto-matched");
  const candidatePayload = {
    reference_status: "candidate",
    reference_candidate_concepts: [
      {
        medication_concept_id: conceptUnusedId,
        concept_code: `medref.runtime.unused.${RUN}`,
        display_name: "Synthetic runtime unused concept",
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
  const { error: supplementInsertError } = await supabase.from("patient_medication_orders").insert({
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
  check(!supplementInsertError, `supplement order inserted${supplementInsertError ? ` (${supplementInsertError.message})` : ""}`);
  const { error: supplementLinkError } = await supabase
    .from("patient_medication_orders")
    .update(candidatePayload)
    .eq("id", orderSupplementId);
  check(!!supplementLinkError && errCode(supplementLinkError).includes("23514"), "supplement cannot enter a medication candidate state (23514)");
  const { error: gateInsertError } = await supabase.from("patient_medication_orders").insert({
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
  check(!gateInsertError, `gate order inserted${gateInsertError ? ` (${gateInsertError.message})` : ""}`);
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
