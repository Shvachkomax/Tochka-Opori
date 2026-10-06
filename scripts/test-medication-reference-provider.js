import assert from "node:assert/strict";
import {
  ALLOWED_SOURCE_FACT_KEYS,
  canonicalizeProviderFacts,
  computeReferenceContentHash,
} from "../lib/clinical/medication-reference-canonical.js";
import {
  MedicationReferenceProviderError,
  MEDICATION_REFERENCE_PROVIDER_ERROR_CODES,
  validateProviderCandidate,
  validateProviderConcept,
  validateProviderDocumentRef,
  validateProviderFactSection,
  validateProviderFacts,
  validateProviderSourceMeta,
} from "../lib/clinical/medication-reference-provider.js";
import { createFixtureMedicationReferenceProvider } from "../lib/clinical/medication-reference-fixture-provider.js";

let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log(`  OK ${label}`);
}

console.log("Provider error taxonomy");
check(Array.isArray(MEDICATION_REFERENCE_PROVIDER_ERROR_CODES) && MEDICATION_REFERENCE_PROVIDER_ERROR_CODES.includes("rate_limit"), "error codes are declared");
const typed = new MedicationReferenceProviderError("auth", "denied");
check(typed instanceof Error && typed.code === "auth" && typed.name === "MedicationReferenceProviderError", "typed provider error carries its code");
check(new MedicationReferenceProviderError("unknown-code", "x").code === "unavailable", "unknown error codes fall back to unavailable");

console.log("\nContract validators");
const candidate = validateProviderCandidate({ provider_record_id: "rec-1", display_name: "Name", match_method: "fixture_name_search" });
check(candidate.provider_record_id === "rec-1" && candidate.match_method === "fixture_name_search", "provider candidate is normalized");
assert.throws(() => validateProviderCandidate({ provider_record_id: "" }), /provider_record_id/);
check(validateProviderConcept({ provider_record_id: "rec-1", display_name: "Name" }).canonical_name === null, "optional concept fields default to null");
check(validateProviderDocumentRef({
  source_document_id: "doc-1", canonical_identifier: "fixture:doc-1", source_title: "T",
  source_version: "fixture-v1", country: "RU", language: "ru",
}).source_url === null, "document ref accepts canonical_identifier without url");
assert.throws(() => validateProviderDocumentRef({
  source_document_id: "doc-1", source_title: "T", source_version: "v", country: "RU", language: "ru",
}), /source_url or canonical_identifier/);
assert.throws(() => validateProviderDocumentRef({
  source_document_id: "doc-1", source_url: "http://insecure.example", source_title: "T",
  source_version: "v", country: "RU", language: "ru",
}), /https/);
check(ALLOWED_SOURCE_FACT_KEYS.length === 14, "source fact allow-list has 14 keys");
check(validateProviderFacts({ mechanism_summary: "text", strength: "50 mg" }).strength === "50 mg", "provider facts validated against the allow-list");
assert.throws(() => validateProviderFacts({ invented_fact: "x" }), /allow-list/);
assert.throws(() => validateProviderFacts({ mechanism_summary: undefined }), /non-JSON|invalid/);
const section = validateProviderFactSection({ revision: { provider_record_id: "rec-1", source_version: "fixture-v1" }, section: "mechanism_summary", value: "text" });
check(section.revision.source_version === "fixture-v1", "fact section keeps its revision token");
assert.throws(() => validateProviderFactSection({ revision: { provider_record_id: "rec-1", source_version: "v" }, section: "made_up", value: 1 }), /unsupported fact section/);
check(validateProviderSourceMeta({ provider: "fixture", retrieved_at: "2026-01-01T00:00:00.000Z" }).provider === "fixture", "source meta validated");

console.log("\nCanonical facts and content hash (golden)");
const factsBase = {
  trade_name: "Name",
  active_ingredient: "compound",
  strength: "50 mg",
  interactions: { with_food: "none", with_alcohol: "avoid" },
  special_warnings: ["warn one", "warn two"],
};
const factsKeyOrder = {
  special_warnings: ["warn one", "warn two"],
  interactions: { with_alcohol: "avoid", with_food: "none" },
  strength: "50 mg",
  active_ingredient: "compound",
  trade_name: "Name",
};
const hashBase = computeReferenceContentHash(factsBase, "fixture-v1");
check(hashBase === computeReferenceContentHash(factsKeyOrder, "fixture-v1"), "object key permutation does not change the hash");
const factsNestedOrder = {
  ...factsBase,
  interactions: { with_food: "none", with_alcohol: "avoid" },
};
check(hashBase === computeReferenceContentHash(factsNestedOrder, "fixture-v1"), "nested object key permutation does not change the hash");
const factsArrayOrder = { ...factsBase, special_warnings: ["warn two", "warn one"] };
check(hashBase !== computeReferenceContentHash(factsArrayOrder, "fixture-v1"), "array element permutation changes the hash");
check(hashBase !== computeReferenceContentHash(factsBase, "fixture-v2"), "source_version change changes the hash");
check(hashBase !== computeReferenceContentHash({ ...factsBase, strength: "100 mg" }, "fixture-v1"), "single fact change changes the hash");
check(/^[0-9a-f]{64}$/.test(hashBase), "content hash is lowercase sha256 hex");
assert.throws(() => computeReferenceContentHash(factsBase, ""), /source_version/);
assert.throws(() => canonicalizeProviderFacts({ mechanism_summary: new Date() }), /non-JSON/);
assert.throws(() => canonicalizeProviderFacts({ strength: Number.NaN }), /non-JSON/);
assert.throws(() => canonicalizeProviderFacts({ strength: () => 1 }), /non-JSON|invalid/);
assert.throws(() => canonicalizeProviderFacts({ strength: undefined }), /non-JSON|invalid/);
check(canonicalizeProviderFacts(factsBase) === canonicalizeProviderFacts(factsKeyOrder), "canonical representation is stable under key reordering");

console.log("\nFixture provider");
const provider = createFixtureMedicationReferenceProvider();
check(typeof provider.searchMedication === "function" && typeof provider.getOfficialInformation === "function", "fixture provider implements the seam");
check(provider.providerId === "fixture" && provider.supportsSupplements === false, "fixture provider does not claim supplement coverage");
const search = await provider.searchMedication("Synthetic Fixture Medicine");
check(search.available === true && search.candidates.length >= 1 && search.candidates[0].provider_record_id === "fixture-record-1", "fixture search returns provider-native candidates");
const missing = await provider.getOfficialInformation("fixture-record-unknown");
check(missing === null, "unknown records return null, not fabricated facts");
await assert.rejects(async () => provider.getOfficialInformation("fixture-record-broken"), (error) => error instanceof MedicationReferenceProviderError && error.code === "rate_limit");
await assert.rejects(async () => provider.getMechanism("fixture-record-broken"), (error) => error.code === "rate_limit");

const official = await provider.getOfficialInformation("fixture-record-1");
check(official.revision.provider_record_id === "fixture-record-1" && official.revision.source_version === "fixture-v2", "official information returns one explicit deterministic revision");
check(official.document.source_version === "fixture-v2" && official.document.source_document_id === "fixture-doc-1", "document ref carries the upstream revision token");
check(official.facts.mechanism_summary.includes("v2"), "facts belong to that single revision");
const mechanism = await provider.getMechanism("fixture-record-1");
const adverse = await provider.getAdverseEffects("fixture-record-1");
check(JSON.stringify(mechanism.revision) === JSON.stringify(official.revision) && JSON.stringify(adverse.revision) === JSON.stringify(official.revision), "fact sections carry the identical revision token");
check(mechanism.value === official.facts.mechanism_summary && (adverse.value ?? null) === (official.facts.adverse_effects ?? null), "fact sections are projections of the same fetched payload");
check(provider.getRevisionFetchCount("fixture-record-1") === 1, "revision-aware cache fetches each revision only once");
const meta = await provider.getSourceMetadata("fixture-record-1");
check(meta.provider === "fixture" && meta.attribution_text.includes("Synthetic fixture"), "source metadata is attributed to the fixture");
const concept = await provider.getMedicationConcept("fixture-record-1");
check(concept.display_name === "Synthetic Fixture Medicine", "provider concept matches the fixture record");

console.log(`\nMedication reference provider tests: ${passed} passed`);
