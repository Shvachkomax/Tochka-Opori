import crypto from "node:crypto";

export const ALLOWED_SOURCE_FACT_KEYS = Object.freeze([
  "trade_name",
  "active_ingredient",
  "dosage_form",
  "strength",
  "atc_code",
  "pharmacological_group",
  "indications",
  "contraindications",
  "adverse_effects",
  "interactions",
  "mechanism_summary",
  "special_warnings",
  "pregnancy_lactation",
  "overdose_information",
]);

export function hasOnlyAllowedSourceFactKeys(facts) {
  return !!facts && typeof facts === "object" && !Array.isArray(facts)
    && Object.keys(facts).every((key) => ALLOWED_SOURCE_FACT_KEYS.includes(key));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalizeValue(value, path) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return JSON.stringify(value);
  if (type === "number") {
    if (!Number.isFinite(value)) throw new Error(`Unsupported non-JSON number at ${path}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalizeValue(item, `${path}[${index}]`)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => {
      const child = value[key];
      if (child === undefined) throw new Error(`Unsupported non-JSON value at ${path}.${key}`);
      return `${JSON.stringify(key)}:${canonicalizeValue(child, `${path}.${key}`)}`;
    });
    return `{${parts.join(",")}}`;
  }
  throw new Error(`Unsupported non-JSON value at ${path}`);
}

export function validateSourceFacts(facts) {
  if (!isPlainObject(facts)) throw new Error("Source facts must be a plain JSON object");
  if (!hasOnlyAllowedSourceFactKeys(facts)) throw new Error("Source facts contain keys outside the allow-list");
  canonicalizeValue(facts, "source_facts");
  return facts;
}

export function canonicalizeProviderFacts(facts) {
  validateSourceFacts(facts);
  return canonicalizeValue(facts, "source_facts");
}

const CONTENT_HASH_FRAMING = "medref-source-facts-v1";

export function computeReferenceContentHash(facts, sourceVersion) {
  if (typeof sourceVersion !== "string" || !sourceVersion.trim()) {
    throw new Error("source_version is required for the reference content hash");
  }
  const canonical = canonicalizeProviderFacts(facts);
  return crypto
    .createHash("sha256")
    .update(`${CONTENT_HASH_FRAMING}\n${sourceVersion}\n${canonical}`, "utf8")
    .digest("hex");
}
