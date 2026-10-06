// Medication reference ingestion runtime checks via PostgREST against TEST only.
// Refuses any Supabase URL other than the TEST project. No secrets are printed.
// Usage: node scripts/test-medication-reference-ingestion-postgrest.js
//
// Repeatable by design (v1 strategy):
// - stable synthetic IDs; immutable fixture rows are created once and reused
//   only after exact-content verification; any mismatch fails closed;
// - no UPDATE/DELETE on append-only reference rows;
// - concepts/documents/snapshots/orders do not grow across re-runs; append-only
//   order history grows only on real state transitions (first run only).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { computeReferenceContentHash } from "../lib/clinical/medication-reference-canonical.js";
import {
  ingestProviderRevision,
  promoteReferenceRevision,
  rejectReferenceRevision,
  retireReferenceRevision,
} from "../lib/clinical/medication-reference-ingestion.js";
import { loadVerifiedMedicationReferences } from "../lib/clinical/medication-reference.js";

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
  console.log(`\nIngestion runtime checks: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

function errCode(error) {
  return String(error?.code || error?.details || error?.message || "");
}

const providerId = "fixture-ingest";
const conceptId = "b8000000-0000-4000-8000-00000000a101";
const ownerHealth = "11111111-1111-4111-8111-111111111111";

const revisionR1 = {
  document: {
    source_document_id: "ingest-doc-1",
    canonical_identifier: "fixture:ingest-doc-1@r1",
    source_title: "Synthetic ingestion fixture document R1, not medical information",
    source_version: "fixture-v1",
    country: "RU",
    language: "ru",
  },
  facts: {
    trade_name: "Synthetic Ingestion Fixture",
    active_ingredient: "synthetic-ingestion-compound",
    mechanism_summary: "Synthetic ingestion revision R1; no medical content.",
  },
};
const revisionR2 = {
  document: {
    source_document_id: "ingest-doc-1",
    canonical_identifier: "fixture:ingest-doc-1@r2",
    source_title: "Synthetic ingestion fixture document R2, not medical information",
    source_version: "fixture-v1",
    country: "RU",
    language: "ru",
  },
  facts: {
    trade_name: "Synthetic Ingestion Fixture",
    active_ingredient: "synthetic-ingestion-compound",
    mechanism_summary: "Synthetic ingestion revision R2; no medical content.",
  },
};
const revisionR3 = {
  document: {
    source_document_id: "ingest-doc-1",
    canonical_identifier: "fixture:ingest-doc-1@r3",
    source_title: "Synthetic ingestion fixture document R3, not medical information",
    source_version: "fixture-v2",
    country: "RU",
    language: "ru",
  },
  facts: {
    trade_name: "Synthetic Ingestion Fixture",
    active_ingredient: "synthetic-ingestion-compound",
    mechanism_summary: "Synthetic ingestion revision R3; no medical content.",
  },
};

const stateRowIds = {
  stagedR1: "b8000000-0000-4000-8000-00000000a111",
  verifiedR1: "b8000000-0000-4000-8000-00000000a112",
  retiredR1: "b8000000-0000-4000-8000-00000000a113",
  verifiedR2: "b8000000-0000-4000-8000-00000000a121",
  verifiedR3: "b8000000-0000-4000-8000-00000000a131",
  rejectedR3: "b8000000-0000-4000-8000-00000000a132",
};
const snapshotIds = {
  r1: "b8000000-0000-4000-8000-00000000a141",
  r2: "b8000000-0000-4000-8000-00000000a142",
  r3: "b8000000-0000-4000-8000-00000000a143",
};
const orderIds = {
  r1: "b8000000-0000-4000-8000-00000000a151",
  r2: "b8000000-0000-4000-8000-00000000a152",
  r3: "b8000000-0000-4000-8000-00000000a153",
};

const fixedMatchedAt = "2026-01-01T00:00:00.000Z";

async function ensureConcept() {
  const expected = {
    id: conceptId,
    concept_code: "medref.ingest.fixture.concept",
    source_system: "internal",
    jurisdiction: "RU",
    canonical_name: "Synthetic ingestion fixture concept",
    display_name: "Synthetic ingestion fixture concept",
    concept_kind: "single_ingredient",
    status: "active",
    test_only: false,
  };
  const { data: existing, error: readError } = await supabase.from("medication_concepts")
    .select("*").eq("id", conceptId).maybeSingle();
  if (readError) failClosed(`concept lookup failed (${readError.message})`);
  if (existing) {
    for (const [field, value] of Object.entries(expected)) {
      if (existing[field] !== value) failClosed(`concept fixture content mismatch on ${field}, fail closed`);
    }
    return { created: false };
  }
  const { error: insertError } = await supabase.from("medication_concepts").insert(expected);
  if (insertError) {
    if (errCode(insertError).includes("23505")) {
      const { data: raced } = await supabase.from("medication_concepts").select("*").eq("id", conceptId).maybeSingle();
      if (raced) return { created: false };
    }
    failClosed(`concept insert failed (${insertError.message})`);
  }
  return { created: true };
}

async function ensureOrder(orderId, name) {
  const insertRow = {
    id: orderId,
    owner_type: "anonymous_profile",
    owner_id: ownerHealth,
    source_module: "health",
    item_type: "medication",
    name,
    single_dose: 1,
    dose_unit: "unit",
    frequency_type: "as_needed",
    start_date: "2026-01-01",
    ongoing: true,
    reported_as_doctor_order: true,
  };
  const { error: insertError } = await supabase.from("patient_medication_orders").insert(insertRow);
  if (!insertError) return { created: true };
  if (!errCode(insertError).includes("23505")) failClosed(`order insert failed (${insertError.message})`);
  const { data: existing, error: readError } = await supabase.from("patient_medication_orders")
    .select("id, name, owner_type, owner_id, source_module, item_type").eq("id", orderId).maybeSingle();
  if (readError || !existing) failClosed("order exists but cannot be read for verification");
  for (const field of ["name", "owner_type", "owner_id", "source_module", "item_type"]) {
    if (existing[field] !== insertRow[field]) failClosed(`order fixture content mismatch on ${field}, fail closed`);
  }
  return { created: false };
}

async function linkOrderToVerifiedChain(orderId, snapshotId) {
  const payload = {
    reference_status: "verified",
    medication_concept_id: conceptId,
    reference_source_snapshot_id: snapshotId,
    reference_confidence: 1,
    reference_matched_by: "patient",
    reference_match_method: "runtime_ingestion_fixture",
    reference_matched_at: fixedMatchedAt,
    reference_source_provider: providerId,
  };
  const { data, error } = await supabase.from("patient_medication_orders")
    .update(payload)
    .eq("id", orderId).eq("owner_type", "anonymous_profile").eq("owner_id", ownerHealth)
    .select("*").maybeSingle();
  if (error || !data) failClosed(`order verified link failed (${error?.message || "not_found"})`);
  return data;
}

function loaderOrder(orderId, snapshotId) {
  return {
    id: orderId,
    item_type: "medication",
    name: "Synthetic ingestion fixture order",
    reference_status: "verified",
    medication_concept_id: conceptId,
    reference_source_snapshot_id: snapshotId,
    reference_source_provider: providerId,
  };
}

async function loaderHas(orderId, snapshotId) {
  const refs = await loadVerifiedMedicationReferences(supabase, [loaderOrder(orderId, snapshotId)]);
  return refs.get(orderId) || null;
}

async function main() {
  console.log("\nFixture concept (stable synthetic id, reused across runs)");
  const conceptState = await ensureConcept();
  check(true, conceptState.created
    ? "concept fixture created (synthetic, non-test: verified orders require a non-test chain)"
    : "concept fixture reused (content verified)");

  console.log("\nRevision R1: stage -> promote -> loader -> retire -> loader");
  const staged1 = await ingestProviderRevision(supabase, {
    providerId, document: revisionR1.document, facts: revisionR1.facts,
    testOnly: false, retrievedAt: fixedMatchedAt, documentId: stateRowIds.stagedR1,
  });
  check(staged1.document.verification_status === "unverified" && ["created", "reused"].includes(staged1.status),
    staged1.status === "created" ? "stage inserts the unverified state row" : "stage reuses the existing unverified state row");
  const staged2 = await ingestProviderRevision(supabase, {
    providerId, document: revisionR1.document, facts: revisionR1.facts,
    testOnly: false, retrievedAt: fixedMatchedAt, documentId: stateRowIds.stagedR1,
  });
  check(staged2.status === "reused" && staged2.contentHash === staged1.contentHash, "stage retry reuses the exact state row (no duplicate, deterministic hash)");
  check(staged1.contentHash === computeReferenceContentHash(revisionR1.facts, "fixture-v1"), "content hash matches canonical facts + source_version framing");

  const promoted1 = await promoteReferenceRevision(supabase, {
    providerId, document: revisionR1.document, facts: revisionR1.facts, conceptId,
    testOnly: false, verifiedBy: "runtime-ingestion-fixture", retrievedAt: fixedMatchedAt,
    documentId: stateRowIds.verifiedR1, snapshotId: snapshotIds.r1,
  });
  check(["created", "reused"].includes(promoted1.documentStatus) && ["created", "reused"].includes(promoted1.snapshotStatus),
    promoted1.documentStatus === "created" ? "promote inserts the verified state row and the snapshot" : "promote reuses the verified state row and the snapshot");
  check(promoted1.snapshot.source_document_id === promoted1.document.id, "snapshot is bound to the verified document row");
  const promoted1Again = await promoteReferenceRevision(supabase, {
    providerId, document: revisionR1.document, facts: revisionR1.facts, conceptId,
    testOnly: false, verifiedBy: "runtime-ingestion-fixture", retrievedAt: fixedMatchedAt,
    documentId: stateRowIds.verifiedR1, snapshotId: snapshotIds.r1,
  });
  check(promoted1Again.documentStatus === "reused" && promoted1Again.snapshotStatus === "reused", "promote retry is idempotent (verified document and snapshot reused)");

  const order1 = await ensureOrder(orderIds.r1, "Synthetic ingestion fixture order R1");
  check(true, order1.created ? "order fixture created (insert defaults)" : "order fixture reused (identity verified)");
  await linkOrderToVerifiedChain(orderIds.r1, snapshotIds.r1);
  const visibleBeforeRetire = await loaderHas(orderIds.r1, snapshotIds.r1);

  const retired1 = await retireReferenceRevision(supabase, promoted1.document, { stateRowId: stateRowIds.retiredR1 });
  check(retired1.document.verification_status === "retired" && ["created", "reused"].includes(retired1.status),
    retired1.status === "created" ? "retire appends the retired state row of the exact revision" : "retire reuses the existing retired state row");
  check(
    retired1.status === "created"
      ? visibleBeforeRetire?.verified === true
      : !visibleBeforeRetire,
    retired1.status === "created"
      ? "loader saw the verified chain before the first retire transition"
      : "loader already fails closed before this run's retire call (revision retired in an earlier run)",
  );
  const retired1Again = await retireReferenceRevision(supabase, promoted1.document, { stateRowId: stateRowIds.retiredR1 });
  check(retired1Again.status === "reused", "retire retry is idempotent");
  const visibleAfterRetire = await loaderHas(orderIds.r1, snapshotIds.r1);
  check(!visibleAfterRetire, "loader fails closed after the exact revision is retired");

  console.log("\nRevision R2: different content_hash, same source_version stays independent");
  const promoted2 = await promoteReferenceRevision(supabase, {
    providerId, document: revisionR2.document, facts: revisionR2.facts, conceptId,
    testOnly: false, verifiedBy: "runtime-ingestion-fixture", retrievedAt: fixedMatchedAt,
    documentId: stateRowIds.verifiedR2, snapshotId: snapshotIds.r2,
  });
  check(["created", "reused"].includes(promoted2.documentStatus) && promoted2.contentHash !== promoted1.contentHash, "R2 is a distinct content_hash revision of the same source_version");
  await ensureOrder(orderIds.r2, "Synthetic ingestion fixture order R2");
  await linkOrderToVerifiedChain(orderIds.r2, snapshotIds.r2);
  const visibleR2 = await loaderHas(orderIds.r2, snapshotIds.r2);
  check(visibleR2?.verified === true, "retirement of R1 does not block R2 at the same source_version");

  console.log("\nRevision R3: verified -> rejected fails closed as well");
  const promoted3 = await promoteReferenceRevision(supabase, {
    providerId, document: revisionR3.document, facts: revisionR3.facts, conceptId,
    testOnly: false, verifiedBy: "runtime-ingestion-fixture", retrievedAt: fixedMatchedAt,
    documentId: stateRowIds.verifiedR3, snapshotId: snapshotIds.r3,
  });
  check(["created", "reused"].includes(promoted3.documentStatus), "R3 verified state row in place");
  await ensureOrder(orderIds.r3, "Synthetic ingestion fixture order R3");
  await linkOrderToVerifiedChain(orderIds.r3, snapshotIds.r3);
  const visibleR3Before = await loaderHas(orderIds.r3, snapshotIds.r3);
  const rejected3 = await rejectReferenceRevision(supabase, promoted3.document, { stateRowId: stateRowIds.rejectedR3 });
  check(["created", "reused"].includes(rejected3.status),
    rejected3.status === "created" ? "reject appends the rejected state row of the exact revision" : "reject reuses the existing rejected state row");
  check(
    rejected3.status === "created"
      ? visibleR3Before?.verified === true
      : !visibleR3Before,
    rejected3.status === "created"
      ? "loader saw R3 before the first reject transition"
      : "loader already fails closed before this run's reject call (revision rejected in an earlier run)",
  );
  const visibleR3After = await loaderHas(orderIds.r3, snapshotIds.r3);
  check(!visibleR3After, "loader fails closed after the exact revision is rejected");

  console.log("\nFixture growth guards (stable synthetic rows only)");
  const { count: documentCount } = await supabase.from("medication_reference_documents")
    .select("id", { count: "exact", head: true })
    .eq("source_provider", providerId).eq("source_document_id", "ingest-doc-1");
  check(documentCount === 6, `document state rows stay at 6 (3 R1 + 1 R2 + 2 R3), found ${documentCount}`);
  const { count: snapshotCount } = await supabase.from("medication_reference_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("medication_concept_id", conceptId);
  check(snapshotCount === 3, `snapshots stay at 3, found ${snapshotCount}`);
  const { count: conceptCount } = await supabase.from("medication_concepts")
    .select("id", { count: "exact", head: true }).eq("id", conceptId);
  check(conceptCount === 1, "concept fixture stays at 1");

  console.log(`\nIngestion runtime checks: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error("Ingestion check runner crashed:", error?.message || error);
  process.exit(1);
});
