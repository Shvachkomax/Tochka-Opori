import { createMedicationReferenceProvider, normalizeMedicationCandidateText } from "./medication-reference.js";
import {
  providerError,
  validateProviderCandidate,
  validateProviderConcept,
  validateProviderDocumentRef,
  validateProviderFactSection,
  validateProviderFacts,
  validateProviderSourceMeta,
  validateProviderRevisionToken,
} from "./medication-reference-provider.js";

const FIXTURE_RETRIEVED_AT = "2026-01-01T00:00:00.000Z";

export const FIXTURE_REFERENCE_CATALOG = Object.freeze({
  "fixture-record-1": Object.freeze({
    display_name: "Synthetic Fixture Medicine",
    canonical_name: "synthetic fixture medicine",
    active_ingredient: "synthetic-fixture-compound",
    dosage_form: "tablets",
    strength: "50 mg",
    atc_code: "N00XX00",
    concept_kind: "single_ingredient",
    currentVersion: "fixture-v2",
    revisions: Object.freeze({
      "fixture-v1": Object.freeze({
        document: Object.freeze({
          source_document_id: "fixture-doc-1",
          canonical_identifier: "fixture:fixture-doc-1@fixture-v1",
          source_title: "Synthetic fixture document v1, not medical information",
          source_version: "fixture-v1",
          published_at: null,
          effective_at: null,
          country: "RU",
          language: "ru",
        }),
        facts: Object.freeze({
          trade_name: "Synthetic Fixture Medicine",
          active_ingredient: "synthetic-fixture-compound",
          dosage_form: "tablets",
          strength: "50 mg",
          mechanism_summary: "Synthetic fixture revision v1 only; no medical content.",
        }),
      }),
      "fixture-v2": Object.freeze({
        document: Object.freeze({
          source_document_id: "fixture-doc-1",
          canonical_identifier: "fixture:fixture-doc-1@fixture-v2",
          source_title: "Synthetic fixture document v2, not medical information",
          source_version: "fixture-v2",
          published_at: null,
          effective_at: null,
          country: "RU",
          language: "ru",
        }),
        facts: Object.freeze({
          trade_name: "Synthetic Fixture Medicine",
          active_ingredient: "synthetic-fixture-compound",
          dosage_form: "tablets",
          strength: "50 mg",
          mechanism_summary: "Synthetic fixture revision v2 only; no medical content.",
          special_warnings: "Synthetic fixture warning text; not medical information.",
        }),
      }),
    }),
  }),
  "fixture-record-2": Object.freeze({
    display_name: "Synthetic Fixture Compound Two",
    canonical_name: "synthetic fixture compound two",
    active_ingredient: "synthetic-fixture-extract",
    dosage_form: "capsules",
    strength: "100 mg",
    atc_code: null,
    concept_kind: "single_ingredient",
    currentVersion: "fixture-v1",
    revisions: Object.freeze({
      "fixture-v1": Object.freeze({
        document: Object.freeze({
          source_document_id: "fixture-doc-2",
          canonical_identifier: "fixture:fixture-doc-2@fixture-v1",
          source_title: "Synthetic fixture document two, not medical information",
          source_version: "fixture-v1",
          published_at: null,
          effective_at: null,
          country: "RU",
          language: "ru",
        }),
        facts: Object.freeze({
          trade_name: "Synthetic Fixture Compound Two",
          active_ingredient: "synthetic-fixture-extract",
          mechanism_summary: "Synthetic fixture record two; no medical content.",
        }),
      }),
    }),
  }),
  "fixture-record-broken": Object.freeze({
    error: "rate_limit",
  }),
});

export function createFixtureMedicationReferenceProvider(catalog = FIXTURE_REFERENCE_CATALOG) {
  const revisionCache = new Map();
  const fetchCounters = new Map();

  function getRecord(providerRecordId) {
    return catalog[providerRecordId] || null;
  }

  function fetchRevision(providerRecordId) {
    const record = getRecord(providerRecordId);
    if (!record) return null;
    if (record.error) {
      throw providerError(record.error, `fixture provider refuses ${providerRecordId} (${record.error})`);
    }
    const version = record.currentVersion;
    const cacheKey = `${providerRecordId}@${version}`;
    if (!revisionCache.has(cacheKey)) {
      const revisionPayload = record.revisions[version];
      if (!revisionPayload) {
        throw providerError("parse", `fixture catalog has no revision ${version} for ${providerRecordId}`);
      }
      revisionCache.set(cacheKey, {
        revision: validateProviderRevisionToken({ provider_record_id: providerRecordId, source_version: version }),
        document: validateProviderDocumentRef({ ...revisionPayload.document, retrieved_at: FIXTURE_RETRIEVED_AT }),
        facts: validateProviderFacts(revisionPayload.facts),
      });
      fetchCounters.set(providerRecordId, (fetchCounters.get(providerRecordId) || 0) + 1);
    }
    return revisionCache.get(cacheKey);
  }

  function projectSection(providerRecordId, section) {
    const payload = fetchRevision(providerRecordId);
    if (!payload) return null;
    return validateProviderFactSection({
      revision: payload.revision,
      section,
      value: payload.facts[section] ?? null,
    });
  }

  const provider = {
    providerId: "fixture",
    supportsSupplements: false,

    async searchMedication(queryText) {
      const query = normalizeMedicationCandidateText(queryText);
      if (!query) return { available: true, candidates: [] };
      const candidates = Object.entries(catalog)
        .filter(([recordId, record]) => !record.error && (
          normalizeMedicationCandidateText(record.display_name).includes(query)
          || normalizeMedicationCandidateText(record.canonical_name || "").includes(query)
          || normalizeMedicationCandidateText(recordId).includes(query)
        ))
        .map(([recordId, record]) => validateProviderCandidate({
          provider_record_id: recordId,
          display_name: record.display_name,
          active_ingredient: record.active_ingredient,
          dosage_form: record.dosage_form,
          strength: record.strength,
          atc_code: record.atc_code,
          match_method: "fixture_name_search",
        }));
      return { available: true, candidates };
    },

    async getMedicationConcept(providerRecordId) {
      const record = getRecord(providerRecordId);
      if (!record) return null;
      if (record.error) {
        throw providerError(record.error, `fixture provider refuses ${providerRecordId} (${record.error})`);
      }
      return validateProviderConcept({
        provider_record_id: providerRecordId,
        display_name: record.display_name,
        canonical_name: record.canonical_name,
        active_ingredient: record.active_ingredient,
        atc_code: record.atc_code,
        concept_kind: record.concept_kind,
      });
    },

    async getOfficialInformation(providerRecordId) {
      const payload = fetchRevision(providerRecordId);
      if (!payload) return null;
      return { document: payload.document, facts: payload.facts, revision: payload.revision };
    },

    async getAdverseEffects(providerRecordId) {
      return projectSection(providerRecordId, "adverse_effects");
    },

    async getContraindications(providerRecordId) {
      return projectSection(providerRecordId, "contraindications");
    },

    async getInteractions(providerRecordId) {
      return projectSection(providerRecordId, "interactions");
    },

    async getMechanism(providerRecordId) {
      return projectSection(providerRecordId, "mechanism_summary");
    },

    async getSourceMetadata() {
      return validateProviderSourceMeta({
        provider: "fixture",
        retrieved_at: FIXTURE_RETRIEVED_AT,
        attribution_text: "Synthetic fixture source, not medical information",
        license_ref: "fixture-license",
      });
    },

    getRevisionFetchCount(providerRecordId) {
      return fetchCounters.get(providerRecordId) || 0;
    },
  };

  return createMedicationReferenceProvider(provider);
}
