import { VidalProvider } from "./providers/vidal-provider.js";
import { MinzdravGuidelinesProvider } from "./providers/minzdrav-guidelines-provider.js";
import { ClinicalCasesProvider } from "./providers/clinical-cases-provider.js";
import {
  KNOWLEDGE_OPERATIONS,
  KNOWLEDGE_PRICES_RUB,
} from "./constants.js";
import { hasClinicalKnowledgeAccess, sanitizeClinicalText, redactPii } from "./access.js";
import { getSupabase } from "../../supabase.js";

const queryHistory = [];
const idempotencyStore = new Map();


async function persistQueryLog(record) {
  try {
    const supabase = getSupabase();
    await supabase.from("clinical_knowledge_query_log").insert({
      actor_id: record.actor_id,
      organization_id: record.organization_id,
      operation: record.operation,
      result_count: record.result_count,
      idempotency_key: record.idempotency_key,
      price_rub: record.price,
      billing_enabled: record.billing_enabled,
      charged: false,
      status: record.status,
      metadata: { mock: true },
    });
  } catch (e) {
    // Persistence is best-effort; do not fail the search.
  }
}

function makeQueryRecord({ operation, actor, organizationId, resultCount, idempotencyKey, price, billingEnabled }) {
  return {
    id: `ckq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    actor_id: actor?.id || null,
    organization_id: organizationId || null,
    result_count: resultCount,
    idempotency_key: idempotencyKey || null,
    price_rub: price,
    billing_enabled: billingEnabled,
    charged: false,
    status: "success",
    created_at: new Date().toISOString(),
  };
}

export function getKnowledgePrices() {
  return { ...KNOWLEDGE_PRICES_RUB };
}

export function estimateCharge(operation, billingEnabled = false) {
  const price = KNOWLEDGE_PRICES_RUB[operation] ?? 0;
  return {
    operation,
    price_rub: price,
    billable: price > 0,
    billing_enabled: billingEnabled,
    requires_confirmation: billingEnabled && price > 0,
    real_charge_performed: false,
  };
}

export async function searchDrugs({ query, extended = false, actor, organizationId, memberships = [], billingEnabled = false, idempotencyKey = null }) {
  if (!hasClinicalKnowledgeAccess({ role: actor?.role, requestedOrganizationId: organizationId, memberships })) {
    return { ok: false, error: "Доступ запрещён." };
  }
  const operation = extended ? KNOWLEDGE_OPERATIONS.DRUG_EXTENDED_SEARCH : KNOWLEDGE_OPERATIONS.DRUG_BASIC_SEARCH;
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    return idempotencyStore.get(idempotencyKey);
  }
  const safeQuery = sanitizeClinicalText(query, 200);
  const results = await VidalProvider.searchDrugs({ query: safeQuery, extended });
  const providerStatus = VidalProvider.mode;
  const price = KNOWLEDGE_PRICES_RUB[operation];
  const record = makeQueryRecord({ operation, actor, organizationId, resultCount: results.length, idempotencyKey, price, billingEnabled });
  queryHistory.push(record);
  persistQueryLog(record);
    const response = {
    ok: true,
    provider: VidalProvider.id,
    provider_mode: VidalProvider.mode,
    provider_status: VidalProvider.mode,
    license_status: VidalProvider.license_status,
    is_mock: false,
    operation,
    query: safeQuery,
    results: results.map((item) => ({ ...item, description: redactPii(item.dosing) })),
    no_results_message: results.length === 0 ? "Источник Vidal ожидает подключения лицензии. Реальные данные недоступны." : null,
    charge: estimateCharge(operation, billingEnabled),
    query_id: record.id,
    real_charge_performed: false,
  };
  if (idempotencyKey) idempotencyStore.set(idempotencyKey, response);
  return response;
}

export async function searchGuidelines({ symptoms = [], diagnosis = "", ageGroup = null, comorbidities = [], actor, organizationId, memberships = [], billingEnabled = false, idempotencyKey = null }) {
  if (!hasClinicalKnowledgeAccess({ role: actor?.role, requestedOrganizationId: organizationId, memberships })) {
    return { ok: false, error: "Доступ запрещён." };
  }
  const operation = KNOWLEDGE_OPERATIONS.GUIDELINE_SEARCH;
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) return idempotencyStore.get(idempotencyKey);
  const safeSymptoms = symptoms.map((x) => sanitizeClinicalText(x, 120)).filter(Boolean);
  const safeDiagnosis = sanitizeClinicalText(diagnosis, 200);
  const results = await MinzdravGuidelinesProvider.search({ symptoms: safeSymptoms, diagnosis: safeDiagnosis, ageGroup });
  const price = KNOWLEDGE_PRICES_RUB[operation];
  const record = makeQueryRecord({ operation, actor, organizationId, resultCount: results.length, idempotencyKey, price, billingEnabled });
  queryHistory.push(record);
  persistQueryLog(record);
  const response = {
    ok: true,
    provider: MinzdravGuidelinesProvider.id,
    provider_mode: MinzdravGuidelinesProvider.mode,
    license_status: "public_reference",
    is_mock: false,
    operation,
    results: results.map((item) => ({
      ...item,
      match_summary: "Совпадение по указанным симптомам и диагнозу.",
      differences: "Требуется сверка с клинической картиной пациента.",
      missing_data: "Недостающие данные должны быть уточнены специалистом.",
    })),
    charge: estimateCharge(operation, billingEnabled),
    query_id: record.id,
    real_charge_performed: false,
  };
  if (idempotencyKey) idempotencyStore.set(idempotencyKey, response);
  return response;
}

export async function searchSimilarCases({ symptoms = [], diagnosis = "", ageGroup = null, comorbidities = [], examinations = [], treatment = "", actor, organizationId, memberships = [], billingEnabled = false, idempotencyKey = null, allowSyntheticFallback = true, allowedModules = [] }) {
  if (!hasClinicalKnowledgeAccess({ role: actor?.role, requestedOrganizationId: organizationId, memberships })) {
    return { ok: false, error: "Доступ запрещён." };
  }
  const operation = KNOWLEDGE_OPERATIONS.SIMILAR_CASES_SEARCH;
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) return idempotencyStore.get(idempotencyKey);
  const filters = {
    symptoms: symptoms.map((x) => sanitizeClinicalText(x, 120)).filter(Boolean),
    diagnosis: sanitizeClinicalText(diagnosis, 200),
    ageGroup,
    comorbidities: comorbidities.map((x) => sanitizeClinicalText(x, 120)).filter(Boolean),
  };
  let results = [];
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("clinical_knowledge_cases")
      .select("*")
      .eq("expert_review_status", "approved");
    if (data && data.length) {
      results = data.filter((item) => {
        if (filters.ageGroup && item.age_group !== filters.ageGroup) return false;
        if (filters.symptoms.length) {
          const haystack = `${(item.complaints || []).join(" ")} ${item.anamnesis || ""}`.toLowerCase();
          if (!filters.symptoms.some((symptom) => haystack.includes(String(symptom).toLowerCase()))) return false;
        }
        return true;
      }).map((item) => ({ ...item, source_type: "clinical_case" }));
    }
  } catch (e) {
    results = [];
  }
  if (!results.length && allowSyntheticFallback) {
    results = await ClinicalCasesProvider.search(filters);
  }
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("published_clinical_cases")
      .select("*")
      .eq("expert_review_status", "approved");
    if (data && data.length) {
      const moduleFiltered = data.filter((item) => {
        if (!allowedModules || !allowedModules.length) return true;
        if (!item.modules || !item.modules.length) return true;
        return item.modules.some((m) => allowedModules.includes(m));
      });
      const mapped = moduleFiltered.map((item) => ({ ...item, source_type: "published_case" }));
      results = results.concat(mapped);
    }
  } catch (e) {}
  const price = KNOWLEDGE_PRICES_RUB[operation];
  const record = makeQueryRecord({ operation, actor, organizationId, resultCount: results.length, idempotencyKey, price, billingEnabled });
  queryHistory.push(record);
  persistQueryLog(record);
  const response = {
    ok: true,
    provider: ClinicalCasesProvider.id,
    provider_mode: ClinicalCasesProvider.mode,
    is_mock: true,
    operation,
    results: results.map((item) => ({
      ...item,
      match_summary: "Совпадение по симптомам и возрастной группе.",
      essential_matches: item.complaints,
      important_differences: "Синтетический демонстрационный случай; не является клинической рекомендацией.",
      source_results: item.outcomes,
      source_link: item.source,
      source_date: item.updated_at,
      missing_data: "Подтверждённый диагноз и индивидуальные данные пациента отсутствуют в демонстрационном наборе.",
    })),
    charge: estimateCharge(operation, billingEnabled),
    query_id: record.id,
    real_charge_performed: false,
    no_confirmed_sources_message: results.length === 0 ? "Подтверждённых источников не найдено." : null,
  };
  if (idempotencyKey) idempotencyStore.set(idempotencyKey, response);
  return response;
}

export function listQueryHistory({ actorId = null, organizationId = null } = {}) {
  return queryHistory.filter((item) => {
    if (actorId && item.actor_id !== actorId) return false;
    if (organizationId && item.organization_id !== organizationId) return false;
    return true;
  });
}

export function clearKnowledgeStateForTests() {
  queryHistory.length = 0;
  idempotencyStore.clear();
}
