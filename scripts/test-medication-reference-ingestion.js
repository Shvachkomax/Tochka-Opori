import assert from "node:assert/strict";
import { computeReferenceContentHash } from "../lib/clinical/medication-reference-canonical.js";
import {
  ingestProviderRevision,
  loadRevisionStateRows,
  promoteReferenceRevision,
  rejectReferenceRevision,
  resolveDocumentStatusOfRecord,
  retireReferenceRevision,
  sameDocumentRevision,
} from "../lib/clinical/medication-reference-ingestion.js";
import { loadVerifiedMedicationReferences } from "../lib/clinical/medication-reference.js";

let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log(`  OK ${label}`);
}

function createSupabaseMock(initialTables = {}) {
  const tables = new Map();
  let clockTick = 0;
  for (const [name, rows] of Object.entries(initialTables)) tables.set(name, rows.map((row) => ({ ...row })));
  function rowsOf(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }
  const uniqueKeys = {
    medication_reference_documents: ["source_provider", "source_document_id", "source_version", "content_hash", "verification_status", "test_only"],
    medication_reference_snapshots: ["source_document_id", "medication_concept_id", "content_hash"],
  };
  function matches(row, filters) {
    return filters.every(([op, column, value]) => {
      if (op === "eq") return row[column] === value;
      if (op === "in") return (value || []).includes(row[column]);
      return true;
    });
  }
  function exec(state) {
    const rows = rowsOf(state.name);
    if (state.op === "insert") {
      const row = { id: `mock-${state.name}-${rows.length + 1}`, created_at: new Date(Date.UTC(2026, 0, 2, 0, 0, clockTick++)).toISOString(), ...state.payload };
      const keys = uniqueKeys[state.name];
      if (keys && rows.some((existing) => keys.every((key) => existing[key] === row[key]))) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      rows.push(row);
      return { data: row, error: null };
    }
    const matched = rows.filter((row) => matches(row, state.filters));
    if (state.mode === "single") {
      return matched.length === 1 ? { data: matched[0], error: null } : { data: null, error: { code: "PGRST116", message: "no single row" } };
    }
    if (state.mode === "maybe") return { data: matched[0] || null, error: null };
    return { data: matched, error: null };
  }
  function from(name) {
    const state = { name, op: "select", payload: null, filters: [], mode: null };
    const builder = {
      select() { return builder; },
      insert(row) { state.op = "insert"; state.payload = row; return builder; },
      update(row) { state.op = "update"; state.payload = row; return builder; },
      eq(column, value) { state.filters.push(["eq", column, value]); return builder; },
      in(column, value) { state.filters.push(["in", column, value]); return builder; },
      order() { return builder; },
      limit() { return builder; },
      single() { state.mode = "single"; return builder; },
      maybeSingle() { state.mode = "maybe"; return builder; },
      then(resolve) { resolve(exec(state)); },
    };
    return builder;
  }
  return { from, tables };
}

const factsV1 = {
  trade_name: "Synthetic Ingestion Fixture",
  active_ingredient: "synthetic-ingestion-compound",
  mechanism_summary: "Synthetic ingestion fixture facts; no medical content.",
};
const factsV1b = {
  trade_name: "Synthetic Ingestion Fixture",
  active_ingredient: "synthetic-ingestion-compound",
  mechanism_summary: "Synthetic ingestion fixture facts revision B; no medical content.",
};
const documentRef = {
  source_document_id: "ingest-doc-1",
  canonical_identifier: "fixture:ingest-doc-1@fixture-v1",
  source_title: "Synthetic ingestion fixture document, not medical information",
  source_version: "fixture-v1",
  country: "RU",
  language: "ru",
};
const providerId = "fixture-ingest";

console.log("Deterministic status-of-record (amendment 1)");
const t = (seconds) => `2026-01-01T00:00:0${seconds}.000Z`;
const row = (id, created_at, verification_status, content_hash = "a".repeat(64)) => ({
  id, created_at, verification_status, content_hash, test_only: false,
  source_provider: providerId, source_document_id: "ingest-doc-1", source_version: "fixture-v1",
});
check(
  resolveDocumentStatusOfRecord([row("a1", t(1), "unverified"), row("a2", t(2), "verified")])?.verification_status === "verified",
  "unverified -> verified: newer verified row is the state of record",
);
check(
  resolveDocumentStatusOfRecord([row("a1", t(1), "unverified"), row("a2", t(2), "verified"), row("a3", t(3), "retired")])?.id === "a3",
  "verified -> retired: newer retired row fails closed as the state of record",
);
check(
  resolveDocumentStatusOfRecord([row("a1", t(1), "verified"), row("a2", t(2), "rejected")])?.verification_status === "rejected",
  "verified -> rejected: newer rejected row is the state of record",
);
const tieRows = [row("a1", t(1), "verified"), row("a2", t(1), "retired")];
check(resolveDocumentStatusOfRecord(tieRows)?.id === "a2" && resolveDocumentStatusOfRecord([...tieRows].reverse())?.id === "a2", "deterministic tie handling: equal created_at breaks on id DESC regardless of input order");
check(sameDocumentRevision(row("a1", t(1), "verified"), row("a2", t(2), "verified")) === true, "same provider/doc/version/hash/test_only is one exact revision");
check(sameDocumentRevision(row("a1", t(1), "verified"), row("a2", t(2), "verified", "b".repeat(64))) === false, "different content_hash is a different revision even at the same source_version");

const isolationMock = createSupabaseMock({
  medication_reference_documents: [
    { ...row("a1", t(1), "verified"), verified_at: t(1), verified_by: "tester" },
    { ...row("a2", t(2), "verified", "b".repeat(64)), content_hash: "b".repeat(64), verified_at: t(2), verified_by: "tester" },
    row("a3", t(3), "retired"),
  ],
});
const revA = await loadRevisionStateRows(isolationMock, { source_provider: providerId, source_document_id: "ingest-doc-1", source_version: "fixture-v1", content_hash: "a".repeat(64), test_only: false });
const revB = await loadRevisionStateRows(isolationMock, { source_provider: providerId, source_document_id: "ingest-doc-1", source_version: "fixture-v1", content_hash: "b".repeat(64), test_only: false });
check(revA.length === 2 && resolveDocumentStatusOfRecord(revA)?.verification_status === "retired", "revision rows are loaded for the exact content_hash only");
check(revB.length === 1 && resolveDocumentStatusOfRecord(revB)?.verification_status === "verified", "retirement of one revision does not block a second content_hash at the same source_version");

console.log("\nIngestion stage/promote/retire (mock)");
const mock = createSupabaseMock();
const staged = await ingestProviderRevision(mock, { providerId, document: documentRef, facts: factsV1, testOnly: true, retrievedAt: t(1) });
check(staged.status === "created" && staged.document.verification_status === "unverified", "stage inserts an unverified document state row");
check(staged.contentHash === computeReferenceContentHash(factsV1, "fixture-v1"), "stage hashes the canonical facts with the explicit source_version framing");
const stagedAgain = await ingestProviderRevision(mock, { providerId, document: documentRef, facts: factsV1, testOnly: true, retrievedAt: t(9) });
check(stagedAgain.status === "reused" && mock.tables.get("medication_reference_documents").length === 1, "stage retry is idempotent and creates no extra rows");

const mismatchMock = createSupabaseMock({
  medication_reference_documents: [{
    id: "seed-1", source_provider: providerId, source_document_id: documentRef.source_document_id,
    canonical_identifier: documentRef.canonical_identifier, source_title: "DIFFERENT title",
    source_version: documentRef.source_version, published_at: null, effective_at: null,
    retrieved_at: t(1), country: "RU", language: "ru", content_hash: computeReferenceContentHash(factsV1, "fixture-v1"),
    verification_status: "unverified", test_only: true, created_at: t(1),
  }],
});
await assert.rejects(
  async () => ingestProviderRevision(mismatchMock, { providerId, document: documentRef, facts: factsV1, testOnly: true, retrievedAt: t(2) }),
  /fail closed/,
);
check(true, "content mismatch on a reused state row fails closed");

const promoted = await promoteReferenceRevision(mock, {
  providerId, document: documentRef, facts: factsV1, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(2),
});
check(promoted.documentStatus === "created" && promoted.document.verification_status === "verified", "promote inserts the verified document state row");
check(promoted.snapshotStatus === "created" && promoted.snapshot.source_document_id === promoted.document.id, "promote binds the snapshot to the verified document row");
const promotedAgain = await promoteReferenceRevision(mock, {
  providerId, document: documentRef, facts: factsV1, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(3),
});
check(promotedAgain.documentStatus === "reused" && promotedAgain.snapshotStatus === "reused" && mock.tables.get("medication_reference_snapshots").length === 1, "promote retry is idempotent: verified document and snapshot are reused");
await assert.rejects(
  async () => promoteReferenceRevision(mock, { providerId, document: documentRef, facts: factsV1, conceptId: "concept-1", testOnly: true, verifiedBy: "  " }),
  /fail closed/,
);
check(true, "promotion without an operator fails closed");

const partialMock = createSupabaseMock({
  medication_reference_documents: [{
    id: "doc-partial", source_provider: providerId, source_document_id: documentRef.source_document_id,
    canonical_identifier: documentRef.canonical_identifier, source_title: documentRef.source_title,
    source_version: documentRef.source_version, published_at: null, effective_at: null,
    retrieved_at: t(1), country: "RU", language: "ru", content_hash: computeReferenceContentHash(factsV1, "fixture-v1"),
    verification_status: "verified", test_only: true, verified_at: t(1), verified_by: "runtime-tester", created_at: t(1),
  }],
});
const partialResult = await promoteReferenceRevision(partialMock, {
  providerId, document: documentRef, facts: factsV1, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(2),
});
check(partialResult.documentStatus === "reused" && partialResult.snapshotStatus === "created" && partialResult.document.id === "doc-partial", "partial promote state is safe: retry reuses the verified document and creates the missing snapshot");

const retired = await retireReferenceRevision(mock, promoted.document, { stateRowId: "state-retired-1" });
check(retired.status === "created" && retired.document.verification_status === "retired", "retire appends a retired state row for the exact revision");
const stateAfterRetire = await loadRevisionStateRows(mock, promoted.document);
check(resolveDocumentStatusOfRecord(stateAfterRetire)?.verification_status === "retired", "after retire the exact revision state of record is retired");
const retiredAgain = await retireReferenceRevision(mock, promoted.document);
check(retiredAgain.status === "reused" && retiredAgain.document.id === "state-retired-1", "retire retry is idempotent");
const rejected = await rejectReferenceRevision(mock, staged.document, { stateRowId: "state-rejected-1" });
check(rejected.status === "created" && rejected.document.verification_status === "rejected", "reject appends a rejected state row for the exact revision");
const stateAfterReject = await loadRevisionStateRows(mock, promoted.document);
check(resolveDocumentStatusOfRecord(stateAfterReject)?.verification_status === "rejected", "the newest state row wins: after reject the state of record is rejected");

console.log("\nSnapshot content comparison (canonical JSON semantics)");
const orderedFacts = {
  trade_name: "Synthetic Ingestion Fixture",
  active_ingredient: "synthetic-ingestion-compound",
  special_warnings: ["warn one", "warn two"],
  interactions: { with_food: "none", with_alcohol: "avoid" },
};
const reorderedTopLevel = {
  interactions: { with_food: "none", with_alcohol: "avoid" },
  special_warnings: ["warn one", "warn two"],
  active_ingredient: "synthetic-ingestion-compound",
  trade_name: "Synthetic Ingestion Fixture",
};
const reorderedNested = {
  trade_name: "Synthetic Ingestion Fixture",
  active_ingredient: "synthetic-ingestion-compound",
  special_warnings: ["warn one", "warn two"],
  interactions: { with_alcohol: "avoid", with_food: "none" },
};
const reorderMock = createSupabaseMock();
const baselineSnap = await promoteReferenceRevision(reorderMock, {
  providerId, document: documentRef, facts: orderedFacts, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(1),
});
check(baselineSnap.snapshotStatus === "created", "baseline snapshot created for comparison cases");
const topReorder = await promoteReferenceRevision(reorderMock, {
  providerId, document: documentRef, facts: reorderedTopLevel, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(2),
});
check(topReorder.snapshotStatus === "reused" && topReorder.contentHash === baselineSnap.contentHash, "top-level fact key order does not affect snapshot reuse");
const nestedReorder = await promoteReferenceRevision(reorderMock, {
  providerId, document: documentRef, facts: reorderedNested, conceptId: "concept-1",
  testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(3),
});
check(nestedReorder.snapshotStatus === "reused", "nested object key order does not affect snapshot reuse");

function seededPromoteMock(seedFacts, hash) {
  return createSupabaseMock({
    medication_reference_documents: [{
      id: "doc-seed", source_provider: providerId, source_document_id: documentRef.source_document_id,
      canonical_identifier: documentRef.canonical_identifier, source_title: documentRef.source_title,
      source_version: documentRef.source_version, published_at: null, effective_at: null,
      retrieved_at: t(1), country: "RU", language: "ru", content_hash: hash,
      verification_status: "verified", test_only: true, verified_at: t(1), verified_by: "runtime-tester", created_at: t(1),
    }],
    medication_reference_snapshots: [{
      id: "snap-seed", source_document_id: "doc-seed", medication_concept_id: "concept-1",
      snapshot_version: "fixture-v1", source_facts: seedFacts, content_hash: hash,
      retrieved_at: t(1), test_only: true, created_at: t(1),
    }],
  });
}
const orderedHash = computeReferenceContentHash(orderedFacts, "fixture-v1");
const arrayReorderedFacts = { ...orderedFacts, special_warnings: ["warn two", "warn one"] };
await assert.rejects(
  async () => promoteReferenceRevision(seededPromoteMock(arrayReorderedFacts, orderedHash), {
    providerId, document: documentRef, facts: orderedFacts, conceptId: "concept-1",
    testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(2),
  }),
  /fail closed/,
);
check(true, "array order change on a reused snapshot state is a content mismatch and fails closed");
const nestedChangedFacts = { ...orderedFacts, interactions: { with_food: "DIFFERENT", with_alcohol: "avoid" } };
await assert.rejects(
  async () => promoteReferenceRevision(seededPromoteMock(nestedChangedFacts, orderedHash), {
    providerId, document: documentRef, facts: orderedFacts, conceptId: "concept-1",
    testOnly: true, verifiedBy: "runtime-tester", retrievedAt: t(2),
  }),
  /fail closed/,
);
check(true, "nested fact value change on a reused snapshot state is a content mismatch and fails closed");

console.log("\nVerified-only loader honors revision status-of-record");
function loaderFixture(overrides = {}) {
  const contentHashDoc = "c".repeat(64);
  const verifiedDoc = {
    id: "doc-verified", source_provider: providerId, source_document_id: "ingest-doc-2",
    source_url: null, canonical_identifier: "fixture:ingest-doc-2@fixture-v1",
    source_title: "Synthetic loader fixture document, not medical information",
    source_version: "fixture-v1", published_at: null, effective_at: null, retrieved_at: t(1),
    country: "RU", language: "ru", content_hash: contentHashDoc,
    verification_status: "verified", test_only: false, verified_at: t(1), verified_by: "tester", created_at: t(1),
  };
  const siblingRows = overrides.siblings || [];
  const documents = overrides.boundDocument ? [overrides.boundDocument] : [verifiedDoc];
  const snapshot = {
    id: "snap-1", source_document_id: (overrides.boundDocument || verifiedDoc).id,
    medication_concept_id: "concept-1", snapshot_version: "fixture-v1",
    source_facts: { mechanism_summary: "Synthetic loader fixture; no medical content." },
    content_hash: "b".repeat(64), retrieved_at: t(1), test_only: false,
  };
  const order = {
    id: "order-1", item_type: "medication", name: "Synthetic loader fixture",
    reference_status: "verified", medication_concept_id: "concept-1",
    reference_source_snapshot_id: "snap-1", reference_source_provider: providerId,
  };
  const mock = createSupabaseMock({
    medication_reference_snapshots: [snapshot],
    medication_reference_summaries: [],
    medication_reference_documents: [...documents, ...siblingRows],
    medication_reference_concepts: [],
  });
  return { mock, order };
}

const visible = loaderFixture();
const visibleRefs = await loadVerifiedMedicationReferences(visible.mock, [visible.order]);
check(visibleRefs.get("order-1")?.verified === true, "verified non-test chain with a verified state of record is loaded");

const retiredCase = loaderFixture({ siblings: [{ ...loaderFixture().mock.tables.get("medication_reference_documents")[0], id: "doc-retired", verification_status: "retired", verified_at: null, verified_by: null, created_at: t(2) }] });
const retiredRefs = await loadVerifiedMedicationReferences(retiredCase.mock, [retiredCase.order]);
check(!retiredRefs.has("order-1"), "a newer retired state row of the exact revision fails the snapshot closed");

const rejectedCase = loaderFixture({ siblings: [{ ...loaderFixture().mock.tables.get("medication_reference_documents")[0], id: "doc-rejected", verification_status: "rejected", verified_at: null, verified_by: null, created_at: t(2) }] });
const rejectedRefs = await loadVerifiedMedicationReferences(rejectedCase.mock, [rejectedCase.order]);
check(!rejectedRefs.has("order-1"), "a newer rejected state row of the exact revision fails the snapshot closed");

const otherHashCase = loaderFixture({ siblings: [{ ...loaderFixture().mock.tables.get("medication_reference_documents")[0], id: "doc-other-hash", content_hash: "d".repeat(64), verification_status: "retired", verified_at: null, verified_by: null, created_at: t(3) }] });
const otherHashRefs = await loadVerifiedMedicationReferences(otherHashCase.mock, [otherHashCase.order]);
check(otherHashRefs.get("order-1")?.verified === true, "a retired state row of a different content_hash does not revoke the revision");

const unverifiedBound = loaderFixture({ boundDocument: { ...loaderFixture().mock.tables.get("medication_reference_documents")[0], id: "doc-unverified", verification_status: "unverified", verified_at: null, verified_by: null } });
const unverifiedRefs = await loadVerifiedMedicationReferences(unverifiedBound.mock, [unverifiedBound.order]);
check(!unverifiedRefs.has("order-1"), "an unverified bound document is never loaded");

console.log(`\nMedication reference ingestion tests: ${passed} passed`);
