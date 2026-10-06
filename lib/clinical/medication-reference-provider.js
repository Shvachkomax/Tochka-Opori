import { immutableJsonClone, validateSourceFacts } from "./medication-reference-canonical.js";

export const MEDICATION_REFERENCE_PROVIDER_ERROR_CODES = Object.freeze([
  "auth",
  "rate_limit",
  "not_found",
  "parse",
  "contract",
  "unavailable",
]);

export class MedicationReferenceProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "MedicationReferenceProviderError";
    this.code = MEDICATION_REFERENCE_PROVIDER_ERROR_CODES.includes(code) ? code : "unavailable";
    if (options.cause) this.cause = options.cause;
  }
}

export function providerError(code, message, cause) {
  return new MedicationReferenceProviderError(code, message, cause ? { cause } : undefined);
}

function contractError(message) {
  return providerError("contract", message);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw contractError(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw contractError(`${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalIsoTimestamp(value, field) {
  const normalized = optionalString(value, field);
  if (normalized === null) return null;
  if (Number.isNaN(Date.parse(normalized))) throw contractError(`${field} must be an ISO timestamp`);
  return normalized;
}

function freezeCopy(value) {
  return Object.freeze(value);
}

export function validateProviderCandidate(value) {
  if (!value || typeof value !== "object") throw contractError("provider candidate must be an object");
  return freezeCopy({
    provider_record_id: requireNonEmptyString(value.provider_record_id, "provider_record_id"),
    display_name: requireNonEmptyString(value.display_name, "display_name"),
    active_ingredient: optionalString(value.active_ingredient, "active_ingredient"),
    dosage_form: optionalString(value.dosage_form, "dosage_form"),
    strength: optionalString(value.strength, "strength"),
    atc_code: optionalString(value.atc_code, "atc_code"),
    match_method: optionalString(value.match_method, "match_method") || "provider_name_search",
  });
}

export function validateProviderConcept(value) {
  if (!value || typeof value !== "object") throw contractError("provider concept must be an object");
  return freezeCopy({
    provider_record_id: requireNonEmptyString(value.provider_record_id, "provider_record_id"),
    display_name: requireNonEmptyString(value.display_name, "display_name"),
    canonical_name: optionalString(value.canonical_name, "canonical_name"),
    active_ingredient: optionalString(value.active_ingredient, "active_ingredient"),
    atc_code: optionalString(value.atc_code, "atc_code"),
    concept_kind: optionalString(value.concept_kind, "concept_kind"),
  });
}

export function validateProviderDocumentRef(value) {
  if (!value || typeof value !== "object") throw contractError("provider document ref must be an object");
  const sourceUrl = optionalString(value.source_url, "source_url");
  const canonicalIdentifier = optionalString(value.canonical_identifier, "canonical_identifier");
  if (!sourceUrl && !canonicalIdentifier) {
    throw contractError("provider document ref requires source_url or canonical_identifier");
  }
  if (sourceUrl && !sourceUrl.startsWith("https://")) {
    throw contractError("source_url must use https://");
  }
  return freezeCopy({
    source_document_id: requireNonEmptyString(value.source_document_id, "source_document_id"),
    source_url: sourceUrl,
    canonical_identifier: canonicalIdentifier,
    source_title: requireNonEmptyString(value.source_title, "source_title"),
    source_version: requireNonEmptyString(value.source_version, "source_version"),
    published_at: optionalIsoTimestamp(value.published_at, "published_at"),
    effective_at: optionalIsoTimestamp(value.effective_at, "effective_at"),
    country: requireNonEmptyString(value.country, "country"),
    language: requireNonEmptyString(value.language, "language"),
  });
}

export function validateProviderFacts(value) {
  try {
    validateSourceFacts(value);
    return immutableJsonClone(value, "source_facts");
  } catch (error) {
    throw contractError(`provider facts invalid: ${error.message}`);
  }
}

const FACT_SECTIONS = Object.freeze([
  "adverse_effects",
  "contraindications",
  "interactions",
  "mechanism_summary",
]);

export function validateProviderFactSection(value) {
  if (!value || typeof value !== "object") throw contractError("provider fact section must be an object");
  const section = requireNonEmptyString(value.section, "section");
  if (!FACT_SECTIONS.includes(section)) throw contractError(`unsupported fact section: ${section}`);
  const revision = value.revision;
  if (!revision || typeof revision !== "object") throw contractError("provider fact section requires a revision");
  let sectionValue = null;
  if (value.value !== undefined) {
    try {
      sectionValue = immutableJsonClone(value.value, "section.value");
    } catch (error) {
      throw contractError(`provider fact section value invalid: ${error.message}`);
    }
  }
  return freezeCopy({
    revision: freezeCopy({
      provider_record_id: requireNonEmptyString(revision.provider_record_id, "revision.provider_record_id"),
      source_version: requireNonEmptyString(revision.source_version, "revision.source_version"),
    }),
    section,
    value: sectionValue,
  });
}

export function validateProviderSourceMeta(value) {
  if (!value || typeof value !== "object") throw contractError("provider source meta must be an object");
  return freezeCopy({
    provider: requireNonEmptyString(value.provider, "provider"),
    retrieved_at: requireNonEmptyString(value.retrieved_at, "retrieved_at"),
    attribution_text: optionalString(value.attribution_text, "attribution_text"),
    license_ref: optionalString(value.license_ref, "license_ref"),
  });
}

export function validateProviderRevisionToken(value) {
  if (!value || typeof value !== "object") throw contractError("revision token must be an object");
  return freezeCopy({
    provider_record_id: requireNonEmptyString(value.provider_record_id, "revision.provider_record_id"),
    source_version: requireNonEmptyString(value.source_version, "revision.source_version"),
  });
}
