export const MEDICATION_REFERENCE_STATUSES = Object.freeze([
  "unresolved",
  "candidate",
  "matched",
  "verified",
  "ambiguous",
]);

export const MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE = "У меня сейчас нет подключённого проверенного источника по этому препарату, поэтому я не буду утверждать конкретные медицинские сведения как подтверждённые.";
export const SUPPLEMENT_REFERENCE_UNAVAILABLE_MESSAGE = "Проверенный источник по этой добавке сейчас не подключён, поэтому я не буду утверждать её лечебную эффективность или свойства.";

const PROVIDER_METHODS = [
  "searchMedication",
  "getMedicationConcept",
  "getOfficialInformation",
  "getAdverseEffects",
  "getContraindications",
  "getInteractions",
  "getMechanism",
  "getSourceMetadata",
];

export function createMedicationReferenceProvider(provider) {
  if (!provider || typeof provider.providerId !== "string" || !provider.providerId.trim()) {
    throw new Error("Medication reference provider requires a providerId.");
  }
  for (const method of PROVIDER_METHODS) {
    if (typeof provider[method] !== "function") throw new Error(`Medication reference provider is missing ${method}.`);
  }
  return Object.freeze({ supportsSupplements: false, ...provider });
}

const unavailable = async () => null;

export const PATIENT_MEDICATION_REFERENCE_PROVIDER = createMedicationReferenceProvider({
  providerId: "unavailable",
  searchMedication: async () => ({ available: false, candidates: [] }),
  getMedicationConcept: unavailable,
  getOfficialInformation: unavailable,
  getAdverseEffects: unavailable,
  getContraindications: unavailable,
  getInteractions: unavailable,
  getMechanism: unavailable,
  getSourceMetadata: unavailable,
});

export function normalizeMedicationCandidateText(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("ru-RU").trim().replace(/\s+/g, " ")
    : "";
}

// Exact normalized-name matches are candidates only; they never verify a source.
export function findExactMedicationConceptCandidates(patientText, concepts = []) {
  const query = normalizeMedicationCandidateText(patientText);
  if (!query) return { reference_status: "unresolved", candidates: [], confidence: null };

  const candidates = (concepts || []).filter((concept) => {
    if (concept.status !== "active" || concept.jurisdiction !== "RU" || concept.test_only === true) return false;
    return [concept.display_name, concept.canonical_name]
      .some((name) => normalizeMedicationCandidateText(name) === query);
  }).map((concept) => ({
    medication_concept_id: concept.id,
    concept_code: concept.concept_code,
    display_name: concept.display_name,
    canonical_name: concept.canonical_name,
    concept_kind: concept.concept_kind,
    source_system: concept.source_system,
    confidence: 1,
    confidence_method: "exact_normalized_name",
  }));

  if (!candidates.length) return { reference_status: "unresolved", candidates, confidence: null };
  if (candidates.length > 1) return { reference_status: "ambiguous", candidates, confidence: null };
  return { reference_status: "candidate", candidates, confidence: 1 };
}

export function canExplicitlySelectMedicationConcept(patientText, candidateConceptIds, selectedConcept) {
  if (!selectedConcept?.id || !(candidateConceptIds || []).includes(selectedConcept.id)) return false;
  return findExactMedicationConceptCandidates(patientText, [selectedConcept]).reference_status === "candidate";
}

export function buildVerifiedMedicationReference({ order, snapshot, document, summary = null } = {}) {
  const unavailableResult = {
    status: order?.reference_status || "unresolved",
    verified: false,
    source_facts: null,
    summary: null,
    fallback: order?.item_type === "supplement"
      ? SUPPLEMENT_REFERENCE_UNAVAILABLE_MESSAGE
      : MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE,
  };
  if (!order || order.reference_status !== "verified" || !snapshot || !document) return unavailableResult;
  if (order.reference_source_snapshot_id !== snapshot.id
    || order.medication_concept_id !== snapshot.medication_concept_id
    || snapshot.source_document_id !== document.id
    || order.reference_source_provider !== document.source_provider
    || document.verification_status !== "verified"
    || document.test_only !== false
    || snapshot.test_only !== false) return unavailableResult;

  const reviewedSummary = summary
    && summary.reference_snapshot_id === snapshot.id
    && summary.review_status === "reviewed"
    && summary.test_only === false
    ? {
      summary_text: summary.summary_text,
      summary_language: summary.summary_language,
      model_provider: summary.model_provider,
      model_name: summary.model_name,
      model_version: summary.model_version || null,
      prompt_version: summary.prompt_version,
      reference_snapshot_id: snapshot.id,
    }
    : null;

  return {
    status: "verified",
    verified: true,
    source_facts: snapshot.source_facts,
    summary: reviewedSummary,
    fallback: null,
    source: {
      provider: document.source_provider,
      verification_status: document.verification_status,
      test_only: document.test_only,
      source_document_id: document.source_document_id,
      source_url: document.source_url || null,
      canonical_identifier: document.canonical_identifier || null,
      source_title: document.source_title,
      source_version: document.source_version,
      published_at: document.published_at || null,
      effective_at: document.effective_at || null,
      retrieved_at: document.retrieved_at,
      country: document.country,
      language: document.language,
      content_hash: document.content_hash,
      reference_snapshot_id: snapshot.id,
      snapshot_version: snapshot.snapshot_version,
    },
  };
}

export function buildMedicationReferenceAIContext(order, reference, concept = null) {
  const verified = reference?.verified === true
    && reference.source?.verification_status === "verified"
    && reference.source?.test_only === false;
  return {
    patient_reported_text: order?.name || null,
    reference_status: reference?.status || order?.reference_status || "unresolved",
    normalized_concept: order?.medication_concept_id && concept ? {
      medication_concept_id: concept.id,
      display_name: concept.display_name,
      canonical_name: concept.canonical_name,
      source_system: concept.source_system,
      explicitly_matched: ["matched", "verified"].includes(order.reference_status),
      verified,
    } : null,
    verified_reference: verified ? {
      source_facts: reference.source_facts,
      summary: reference.summary,
      source: reference.source,
    } : null,
    reference_unavailable_message: verified
      ? null
      : order?.item_type === "supplement" ? SUPPLEMENT_REFERENCE_UNAVAILABLE_MESSAGE : MEDICATION_REFERENCE_UNAVAILABLE_MESSAGE,
  };
}

export async function loadVerifiedMedicationReferences(supabase, orders = []) {
  const eligible = (orders || []).filter((order) => order.reference_status === "verified"
    && order.medication_concept_id && order.reference_source_snapshot_id);
  if (!eligible.length) return new Map();

  const snapshotIds = [...new Set(eligible.map((order) => order.reference_source_snapshot_id))];
  const [{ data: snapshots, error: snapshotsError }, { data: summaries, error: summariesError }] = await Promise.all([
    supabase.from("medication_reference_snapshots")
      .select("id, source_document_id, medication_concept_id, snapshot_version, source_facts, content_hash, retrieved_at, test_only")
      .in("id", snapshotIds).eq("test_only", false),
    supabase.from("medication_reference_summaries")
      .select("id, reference_snapshot_id, summary_language, summary_text, model_provider, model_name, model_version, prompt_version, review_status, test_only, reviewed_at")
      .in("reference_snapshot_id", snapshotIds).eq("review_status", "reviewed").eq("test_only", false)
      .order("created_at", { ascending: false }),
  ]);
  if (snapshotsError) throw snapshotsError;
  if (summariesError) throw summariesError;

  const documentIds = [...new Set((snapshots || []).map((snapshot) => snapshot.source_document_id))];
  const { data: documents, error: documentsError } = documentIds.length
    ? await supabase.from("medication_reference_documents")
      .select("id, source_provider, source_document_id, source_url, canonical_identifier, source_title, source_version, published_at, effective_at, retrieved_at, country, language, content_hash, verification_status, test_only")
      .in("id", documentIds).eq("verification_status", "verified").eq("test_only", false)
    : { data: [], error: null };
  if (documentsError) throw documentsError;

  const snapshotMap = new Map((snapshots || []).map((snapshot) => [snapshot.id, snapshot]));
  const documentMap = new Map((documents || []).map((document) => [document.id, document]));
  const summaryMap = new Map();
  for (const summary of summaries || []) {
    if (!summaryMap.has(summary.reference_snapshot_id)) summaryMap.set(summary.reference_snapshot_id, summary);
  }

  const results = new Map();
  for (const order of eligible) {
    const snapshot = snapshotMap.get(order.reference_source_snapshot_id);
    const document = snapshot && documentMap.get(snapshot.source_document_id);
    if (!snapshot || !document || snapshot.medication_concept_id !== order.medication_concept_id) continue;
    const reference = buildVerifiedMedicationReference({
      order,
      snapshot,
      document,
      summary: summaryMap.get(snapshot.id) || null,
    });
    if (reference.verified) results.set(order.id, reference);
  }
  return results;
}

export async function loadMedicationReferenceForOrder(supabase, order) {
  const references = await loadVerifiedMedicationReferences(supabase, order ? [order] : []);
  return references.get(order?.id) || null;
}

export async function loadMedicationReferenceViews(supabase, orders = []) {
  const conceptIds = [...new Set((orders || []).map((order) => order.medication_concept_id).filter(Boolean))];
  const [{ data: concepts, error: conceptError }, verifiedReferences] = await Promise.all([
    conceptIds.length
      ? supabase.from("medication_concepts").select("id, display_name, canonical_name, concept_kind, source_system, jurisdiction, test_only").in("id", conceptIds).eq("test_only", false)
      : Promise.resolve({ data: [], error: null }),
    loadVerifiedMedicationReferences(supabase, orders),
  ]);
  if (conceptError) throw conceptError;
  const conceptById = new Map((concepts || []).map((concept) => [concept.id, concept]));
  return new Map((orders || []).map((order) => [order.id, {
    status: order.reference_status || "unresolved",
    concept: conceptById.get(order.medication_concept_id) || null,
    candidates: ["candidate", "ambiguous"].includes(order.reference_status) ? order.reference_candidate_concepts || [] : [],
    verified_reference: verifiedReferences.get(order.id) || null,
  }]));
}
