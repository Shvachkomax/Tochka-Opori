import assert from "node:assert/strict";
import {
  buildMedicationReferenceAIContext,
  buildVerifiedMedicationReference,
  canExplicitlySelectMedicationConcept,
  createMedicationReferenceProvider,
  findExactMedicationConceptCandidates,
  MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE,
  PATIENT_MEDICATION_REFERENCE_PROVIDER,
  SUPPLEMENT_REFERENCE_UNAVAILABLE_MESSAGE,
} from "../lib/clinical/medication-reference.js";

let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log(`  OK ${label}`);
}

const patientText = "  Синтетик-Тест 50 мг  ";
const concepts = [
  { id: "c1", concept_code: "synthetic-c1", source_system: "internal", jurisdiction: "RU", canonical_name: "синтетик-тест 50 мг", display_name: "Синтетик-Тест 50 мг", concept_kind: "single_ingredient", status: "active", test_only: false },
  { id: "c2", concept_code: "synthetic-c2", source_system: "internal", jurisdiction: "RU", canonical_name: "синтетик-тест 50 мг", display_name: "Синтетик-Тест 50 мг", concept_kind: "single_ingredient", status: "active", test_only: false },
  { id: "retired", concept_code: "synthetic-retired", source_system: "internal", jurisdiction: "RU", canonical_name: "Синтетик-Тест 50 мг", display_name: "Синтетик-Тест 50 мг", concept_kind: "single_ingredient", status: "retired", test_only: false },
  { id: "foreign", concept_code: "synthetic-us", source_system: "test", jurisdiction: "US", canonical_name: "Синтетик-Тест 50 мг", display_name: "Синтетик-Тест 50 мг", concept_kind: "single_ingredient", status: "active", test_only: false },
  { id: "test-only", concept_code: "synthetic-test-only", source_system: "fixture", jurisdiction: "RU", canonical_name: "Синтетик-Тест 50 мг", display_name: "Синтетик-Тест 50 мг", concept_kind: "single_ingredient", status: "active", test_only: true },
];

console.log("Medication reference matching and source trust gates");
check(patientText === "  Синтетик-Тест 50 мг  ", "original patient-entered text remains unchanged");
check(findExactMedicationConceptCandidates("unknown typed text", concepts).reference_status === "unresolved", "unmatched text remains unresolved");
const exact = findExactMedicationConceptCandidates("СИНТЕТИК-ТЕСТ  50 мг", concepts.slice(0, 1));
check(exact.reference_status === "candidate" && exact.candidates[0].confidence_method === "exact_normalized_name", "exact normalized match is only a candidate");
check(findExactMedicationConceptCandidates("Синтетик-Тест 50 мг", concepts).reference_status === "ambiguous", "multiple exact concepts are ambiguous, not guessed");
check(findExactMedicationConceptCandidates("Синтетик-Тест 51 мг", concepts).reference_status === "unresolved", "near/fuzzy spelling is not matched");
check(!findExactMedicationConceptCandidates("Синтетик-Тест 50 мг", concepts).candidates.some((c) => c.medication_concept_id === "retired"), "retired concepts are excluded");
check(!findExactMedicationConceptCandidates("Синтетик-Тест 50 мг", concepts).candidates.some((c) => c.medication_concept_id === "foreign"), "non-RU concepts are excluded from RU matching");
check(!findExactMedicationConceptCandidates("Синтетик-Тест 50 мг", concepts).candidates.some((c) => c.medication_concept_id === "test-only"), "test-only concepts are excluded from patient matching");
check(canExplicitlySelectMedicationConcept("Синтетик-Тест 50 мг", ["c1"], concepts[0]), "explicit patient selection accepts only the exact listed candidate");
check(!canExplicitlySelectMedicationConcept("Синтетик-Тест 50 мг", ["c1"], concepts[1]), "patient cannot select a concept outside the candidate set");

const testSource = {
  id: "doc-test-only",
  source_provider: "fixture",
  source_document_id: "synthetic-test-document",
  source_title: "Synthetic fixture; not a medical source",
  source_version: "test-v1",
  verification_status: "verified",
  test_only: true,
};
const testSnapshot = {
  id: "snapshot-test-only",
  source_document_id: testSource.id,
  medication_concept_id: "c1",
  snapshot_version: "test-v1",
  source_facts: { mechanism_summary: "Synthetic placeholder only." },
  test_only: true,
};
const testOrder = { id: "order-1", name: patientText, item_type: "medication", reference_status: "verified", medication_concept_id: "c1", reference_source_snapshot_id: testSnapshot.id };
const rejectedReference = buildVerifiedMedicationReference({ order: testOrder, snapshot: testSnapshot, document: testSource });
check(!rejectedReference.verified && rejectedReference.source_facts === null, "test-only source facts are denied from verified reference context");
check(rejectedReference.fallback === MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE, "unverified medication uses safe fallback text");

const unmatchedAiContext = buildMedicationReferenceAIContext({ name: patientText, reference_status: "candidate", item_type: "medication" }, null);
check(unmatchedAiContext.patient_reported_text === patientText, "AI context retains the original patient report");
check(unmatchedAiContext.verified_reference === null && unmatchedAiContext.normalized_concept === null, "candidate alone is not represented as a drug fact");
check(unmatchedAiContext.reference_unavailable_message === MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE, "AI context carries safe no-source response");
const supplementContext = buildMedicationReferenceAIContext({ name: "synthetic supplement", item_type: "supplement" }, null);
check(supplementContext.reference_unavailable_message === SUPPLEMENT_REFERENCE_UNAVAILABLE_MESSAGE, "supplement gets distinct no-efficacy fallback");

const providerMethods = ["searchMedication", "getMedicationConcept", "getOfficialInformation", "getAdverseEffects", "getContraindications", "getInteractions", "getMechanism", "getSourceMetadata"];
check(providerMethods.every((method) => typeof PATIENT_MEDICATION_REFERENCE_PROVIDER[method] === "function"), "provider boundary exposes replaceable reference operations");
check((await PATIENT_MEDICATION_REFERENCE_PROVIDER.searchMedication(patientText)).available === false, "default provider is explicitly unavailable and does not fetch data");
check(PATIENT_MEDICATION_REFERENCE_PROVIDER.supportsSupplements === false, "default provider does not claim supplement coverage");
assert.throws(() => createMedicationReferenceProvider({ providerId: "incomplete" }), /missing searchMedication/);
passed++;
console.log("  OK incomplete provider adapters are rejected");

console.log(`Medication reference tests: ${passed} passed; fixtures contain synthetic placeholders only.`);
