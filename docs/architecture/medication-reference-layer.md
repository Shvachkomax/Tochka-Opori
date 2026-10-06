# Medication Reference Layer

## Existing Model Reuse

- `medication_concepts` and `medication_concept_ingredients` remain the normalized C2 catalog. No parallel product/ingredient catalog is introduced.
- C2 `medication_concepts.test_only` marks development catalog fixtures. Test-only concepts are excluded from candidate search and rejected by clinician-order/reference-snapshot gates.
- Immutable clinician-authored C2 `medication_orders` remain separate and retain their existing `patientMedicationAiEnabled = false` gate.
- `patient_medication_orders.name` remains the patient's original, unmodified text. A concept match is a separate, owner-scoped link.
- C1 clinical event/observation provenance remains for longitudinal clinical facts; source documents and reference snapshots are separate immutable reference records.

## Matching

Matching normalizes Unicode compatibility, letter case and whitespace only. It does not remove strength, punctuation, dosage form, or perform fuzzy/transliteration matching. Only non-test, active RU concepts are searched. Exact display/canonical-name matches are `candidate` results, never an automatic match. Multiple exact candidates are `ambiguous`; no result is `unresolved`. A patient can explicitly select one of the returned candidates, producing a `matched` state. This confirms only the name-to-concept link, not any medical facts. `verified` is unavailable to patient APIs and is accepted only when a linked non-test snapshot and document are verified.

Changing patient-entered medicine identity fields clears the current link and returns it to `unresolved`; the original name remains the source text. `patient_medication_reference_matches` records reference-state transitions append-only.

## Reference Provenance

- `medication_reference_documents` stores provider, canonical document identity/URL, title, source version, jurisdiction, language, publication/effective/retrieval timestamps, content hash and verification status.
- `medication_reference_snapshots` stores allow-listed structured source facts for one C2 concept and exact source document. It is immutable and hash/version addressed.
- `medication_reference_summaries` stores a distinct, immutable AI-generated summary linked to one exact snapshot, including model and prompt version. Only a separately reviewed summary tied to a verified non-test source can be marked `reviewed`.
- `patient_medication_orders` links the original patient report to a C2 concept and current reference status. Its append-only reference-match events preserve candidate/decision history.

Every reference table has RLS enabled, no client-role privileges, and least-privilege server access. Source documents, snapshots, summaries and match history are append-only. TEST fixtures default to `test_only = true`; verified AI context rejects test-only documents/snapshots/summaries.

## Provider and AI Boundary

`PATIENT_MEDICATION_REFERENCE_PROVIDER` is provider-neutral and currently unavailable. No network provider, scrape, or fixture source is configured. Internal C2 catalog search is exact-match candidate normalization only; it does not provide verified pharmacological facts.

Health and Support quick-chat context may contain a verified snapshot only when the patient's explicit order link, C2 concept, snapshot, source document, verification status, and non-test status all agree. The context carries document ID/title/version, jurisdiction/language, retrieval date, content hash, and snapshot ID. Otherwise it carries a safe unavailable message and no source facts. Source facts and AI summaries are never merged or overwritten.

Clinician-authored C2 orders remain unavailable to patient AI. Medication AI must not prescribe, stop, replace or change dose/frequency. It may not state pharmacological facts from model memory. A described adverse effect is not evidence that the medication caused a patient's symptom. Supplements use no medicine facts unless a separately approved supplement-capable source is connected.

## Vidal and Other Sources

Official Vidal pages reviewed on 2026-10-05:

- Developer database/API options: <https://www.vidal.ru/services/bd-vidal>
- API overview and test access request: <https://www.vidal.ru/api/>
- User agreement: <https://www.vidal.ru/eula>

Vidal documents a REST API using `X-Token` or HTTP authentication, a per-IP rate limit described inconsistently on its API page (3 vs. 4 requests/second), and says test access is requested directly from Vidal. Its developer page lists a purchasable database/API and says data includes the Russian State Register and officially approved instructions. The user agreement says use of drug-directory information and other sections requires prior agreement with JSC Vidal Rus. No Vidal content is currently downloaded, stored or used for AI. Before integration, obtain written terms covering production API access, source fact storage/snapshots, patient display, attribution, caching/update/retention, AI summaries and transmission of excerpts to an LLM.

The official Russian GRLS portal exposes a search/download UI and developer access workflow, but the public help page reviewed did not document an external read API or reuse/storage license. No scraping is authorized by this review; obtain official technical and reuse terms first.

The official openFDA label API is a possible international adapter, not a Russian primary source. FDA terms generally dedicate its data to CC0, but the label API documentation warns that company-submitted labels are reformatted, not verified by FDA, and may not be current or identical to approved labeling. Third-party material can carry separate rights. It is not enabled as a verified RU source.
