import { canonicalizeProviderFacts, computeReferenceContentHash } from "./medication-reference-canonical.js";
import {
  validateProviderDocumentRef,
  validateProviderFacts,
} from "./medication-reference-provider.js";

const DOCUMENT_COLUMNS = "id, source_provider, source_document_id, source_url, canonical_identifier, source_title, source_version, published_at, effective_at, retrieved_at, country, language, content_hash, verification_status, test_only, verified_at, verified_by, created_at";
const SNAPSHOT_COLUMNS = "id, source_document_id, medication_concept_id, snapshot_version, source_facts, content_hash, retrieved_at, test_only, created_at";

const DOCUMENT_CONTENT_FIELDS = [
  "source_provider", "source_document_id", "source_url", "canonical_identifier", "source_title",
  "source_version", "published_at", "effective_at", "country", "language", "content_hash",
  "verification_status", "test_only",
];
const SNAPSHOT_CONTENT_FIELDS = [
  "source_document_id", "medication_concept_id", "snapshot_version", "source_facts",
  "content_hash", "test_only",
];

function failClosed(message) {
  throw new Error(`reference ingestion fail closed: ${message}`);
}

function isUniqueViolation(error) {
  return String(error?.code || error?.details || error?.message || "").includes("23505");
}

function normalizeBoolean(value) {
  return value === true;
}

export function documentRevisionKey(row) {
  return {
    source_provider: row.source_provider,
    source_document_id: row.source_document_id,
    source_version: row.source_version,
    content_hash: row.content_hash,
    test_only: normalizeBoolean(row.test_only),
  };
}

export function sameDocumentRevision(a, b) {
  const left = documentRevisionKey(a);
  const right = documentRevisionKey(b);
  return left.source_provider === right.source_provider
    && left.source_document_id === right.source_document_id
    && left.source_version === right.source_version
    && left.content_hash === right.content_hash
    && left.test_only === right.test_only;
}

// Deterministic state-of-record for one exact revision:
// newest created_at wins; exact created_at ties break on id DESC.
export function resolveDocumentStatusOfRecord(rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const aTime = Date.parse(a.created_at || "") || 0;
    const bTime = Date.parse(b.created_at || "") || 0;
    if (aTime !== bTime) return bTime - aTime;
    const aId = String(a.id || "");
    const bId = String(b.id || "");
    if (aId === bId) return 0;
    return aId < bId ? 1 : -1;
  })[0];
}

function assertDocumentContentMatch(existing, expected) {
  for (const field of DOCUMENT_CONTENT_FIELDS) {
    if ((existing[field] ?? null) !== (expected[field] ?? null)) {
      failClosed(`document ${field} mismatch on reused state row ${existing.id}`);
    }
  }
}

function assertSnapshotContentMatch(existing, expected) {
  for (const field of SNAPSHOT_CONTENT_FIELDS) {
    if (field === "source_facts") {
      let existingCanonical;
      let expectedCanonical;
      try {
        existingCanonical = canonicalizeProviderFacts(existing.source_facts ?? {});
        expectedCanonical = canonicalizeProviderFacts(expected.source_facts ?? {});
      } catch (error) {
        failClosed(`snapshot source_facts are not canonicalizable: ${error.message}`);
      }
      if (existingCanonical !== expectedCanonical) {
        failClosed(`snapshot source_facts mismatch on reused row ${existing.id}`);
      }
      continue;
    }
    if ((existing[field] ?? null) !== (expected[field] ?? null)) {
      failClosed(`snapshot ${field} mismatch on reused row ${existing.id}`);
    }
  }
}

function documentStateKey(row) {
  return {
    source_provider: row.source_provider,
    source_document_id: row.source_document_id,
    source_version: row.source_version,
    content_hash: row.content_hash,
    verification_status: row.verification_status,
    test_only: normalizeBoolean(row.test_only),
  };
}

async function selectDocumentByStateKey(supabase, row) {
  const key = documentStateKey(row);
  const { data, error } = await supabase.from("medication_reference_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("source_provider", key.source_provider)
    .eq("source_document_id", key.source_document_id)
    .eq("source_version", key.source_version)
    .eq("content_hash", key.content_hash)
    .eq("verification_status", key.verification_status)
    .eq("test_only", key.test_only)
    .maybeSingle();
  if (error) failClosed(`document state lookup failed (${error.message})`);
  return data || null;
}

async function upsertDocumentStateRow(supabase, row) {
  const existing = await selectDocumentByStateKey(supabase, row);
  if (existing) {
    assertDocumentContentMatch(existing, row);
    return { status: "reused", document: existing };
  }
  const { data, error } = await supabase.from("medication_reference_documents")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await selectDocumentByStateKey(supabase, row);
      if (raced) {
        assertDocumentContentMatch(raced, row);
        return { status: "reused", document: raced };
      }
    }
    failClosed(`document state insert failed (${error.message})`);
  }
  return { status: "created", document: data };
}

async function upsertSnapshotRow(supabase, row) {
  const { data: existing, error: lookupError } = await supabase.from("medication_reference_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("source_document_id", row.source_document_id)
    .eq("medication_concept_id", row.medication_concept_id)
    .eq("content_hash", row.content_hash)
    .maybeSingle();
  if (lookupError) failClosed(`snapshot lookup failed (${lookupError.message})`);
  if (existing) {
    assertSnapshotContentMatch(existing, row);
    return { status: "reused", snapshot: existing };
  }
  const { data, error } = await supabase.from("medication_reference_snapshots")
    .insert(row)
    .select("*")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await supabase.from("medication_reference_snapshots")
        .select(SNAPSHOT_COLUMNS)
        .eq("source_document_id", row.source_document_id)
        .eq("medication_concept_id", row.medication_concept_id)
        .eq("content_hash", row.content_hash)
        .maybeSingle();
      if (raced) {
        assertSnapshotContentMatch(raced, row);
        return { status: "reused", snapshot: raced };
      }
    }
    failClosed(`snapshot insert failed (${error.message})`);
  }
  return { status: "created", snapshot: data };
}

function buildDocumentRow({ providerId, ref, contentHash, status, testOnly, retrievedAt, verifiedBy, documentId }) {
  const row = {
    source_provider: providerId,
    source_document_id: ref.source_document_id,
    source_url: ref.source_url,
    canonical_identifier: ref.canonical_identifier,
    source_title: ref.source_title,
    source_version: ref.source_version,
    published_at: ref.published_at,
    effective_at: ref.effective_at,
    retrieved_at: retrievedAt || new Date().toISOString(),
    country: ref.country,
    language: ref.language,
    content_hash: contentHash,
    verification_status: status,
    test_only: normalizeBoolean(testOnly),
  };
  if (documentId) row.id = documentId;
  if (status === "verified") {
    row.verified_at = retrievedAt || new Date().toISOString();
    row.verified_by = verifiedBy;
  }
  return row;
}

export async function ingestProviderRevision(supabase, { providerId, document, facts, testOnly = true, retrievedAt, documentId } = {}) {
  if (typeof providerId !== "string" || !providerId.trim()) failClosed("providerId is required");
  const ref = validateProviderDocumentRef(document);
  const validatedFacts = validateProviderFacts(facts);
  const contentHash = computeReferenceContentHash(validatedFacts, ref.source_version);
  const row = buildDocumentRow({
    providerId: providerId.trim(),
    ref,
    contentHash,
    status: "unverified",
    testOnly,
    retrievedAt,
    documentId,
  });
  const result = await upsertDocumentStateRow(supabase, row);
  return { status: result.status, document: result.document, contentHash };
}

// Promote writes the verified document row and the snapshot row as two
// independent inserts: this is NOT a single DB transaction. The partial
// state "verified document exists, snapshot absent" is safe because the
// loader stays fail-closed without a snapshot, and retrying this function
// reuses the exact verified document row and creates the missing snapshot.
export async function promoteReferenceRevision(supabase, {
  providerId, document, facts, conceptId, testOnly = true, verifiedBy,
  retrievedAt, documentId, snapshotId, snapshotVersion,
} = {}) {
  if (typeof providerId !== "string" || !providerId.trim()) failClosed("providerId is required");
  if (typeof verifiedBy !== "string" || !verifiedBy.trim()) failClosed("verifiedBy is required for promotion");
  if (typeof conceptId !== "string" || !conceptId.trim()) failClosed("conceptId is required for promotion");
  const ref = validateProviderDocumentRef(document);
  const validatedFacts = validateProviderFacts(facts);
  const contentHash = computeReferenceContentHash(validatedFacts, ref.source_version);
  const docRow = buildDocumentRow({
    providerId: providerId.trim(),
    ref,
    contentHash,
    status: "verified",
    testOnly,
    retrievedAt,
    verifiedBy: verifiedBy.trim(),
    documentId,
  });
  const docResult = await upsertDocumentStateRow(supabase, docRow);
  const snapRow = {
    source_document_id: docResult.document.id,
    medication_concept_id: conceptId.trim(),
    snapshot_version: snapshotVersion || ref.source_version,
    source_facts: validatedFacts,
    content_hash: contentHash,
    retrieved_at: retrievedAt || new Date().toISOString(),
    test_only: normalizeBoolean(testOnly),
  };
  if (snapshotId) snapRow.id = snapshotId;
  const snapResult = await upsertSnapshotRow(supabase, snapRow);
  return {
    document: docResult.document,
    snapshot: snapResult.snapshot,
    documentStatus: docResult.status,
    snapshotStatus: snapResult.status,
    contentHash,
  };
}

async function insertStateRow(supabase, sourceRow, status, stateRowId) {
  if (!sourceRow || !sourceRow.source_document_id) failClosed("a document row of the revision is required");
  if (!["retired", "rejected"].includes(status)) failClosed(`unsupported state row status: ${status}`);
  const row = {
    source_provider: sourceRow.source_provider,
    source_document_id: sourceRow.source_document_id,
    source_url: sourceRow.source_url ?? null,
    canonical_identifier: sourceRow.canonical_identifier ?? null,
    source_title: sourceRow.source_title,
    source_version: sourceRow.source_version,
    published_at: sourceRow.published_at ?? null,
    effective_at: sourceRow.effective_at ?? null,
    retrieved_at: sourceRow.retrieved_at || new Date().toISOString(),
    country: sourceRow.country,
    language: sourceRow.language,
    content_hash: sourceRow.content_hash,
    verification_status: status,
    test_only: normalizeBoolean(sourceRow.test_only),
  };
  if (stateRowId) row.id = stateRowId;
  return upsertDocumentStateRow(supabase, row);
}

export async function retireReferenceRevision(supabase, sourceRow, options = {}) {
  const result = await insertStateRow(supabase, sourceRow, "retired", options.stateRowId);
  return result;
}

export async function rejectReferenceRevision(supabase, sourceRow, options = {}) {
  const result = await insertStateRow(supabase, sourceRow, "rejected", options.stateRowId);
  return result;
}

export async function loadRevisionStateRows(supabase, revisionLike) {
  const key = documentRevisionKey(revisionLike);
  const { data, error } = await supabase.from("medication_reference_documents")
    .select(DOCUMENT_COLUMNS)
    .eq("source_provider", key.source_provider)
    .eq("source_document_id", key.source_document_id)
    .eq("source_version", key.source_version);
  if (error) throw error;
  return (data || []).filter((row) => row.content_hash === key.content_hash && normalizeBoolean(row.test_only) === key.test_only);
}
