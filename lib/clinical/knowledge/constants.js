export const CLINICAL_KNOWLEDGE_MODULE = "clinical_knowledge";

export const CLINICAL_CASE_STATUSES = Object.freeze([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "archived",
]);

export const APPROVED_CASE_STATUS = "approved";

export const KNOWLEDGE_OPERATIONS = Object.freeze({
  DRUG_BASIC_SEARCH: "drug_basic_search",
  DRUG_EXTENDED_SEARCH: "drug_extended_search",
  GUIDELINE_SEARCH: "guideline_search",
  SIMILAR_CASES_SEARCH: "similar_cases_search",
  ANALYTIC_OVERVIEW: "analytic_overview",
});

export const KNOWLEDGE_PRICES_RUB = Object.freeze({
  [KNOWLEDGE_OPERATIONS.DRUG_BASIC_SEARCH]: 0,
  [KNOWLEDGE_OPERATIONS.DRUG_EXTENDED_SEARCH]: 5,
  [KNOWLEDGE_OPERATIONS.GUIDELINE_SEARCH]: 0,
  [KNOWLEDGE_OPERATIONS.SIMILAR_CASES_SEARCH]: 20,
  [KNOWLEDGE_OPERATIONS.ANALYTIC_OVERVIEW]: 50,
});

export const KNOWLEDGE_ROLES = Object.freeze({
  SPECIALIST: "specialist",
  ORGANIZATION_ADMIN: "organization_admin",
  PLATFORM_ADMIN: "platform_admin",
});

export const CLINICAL_DIRECTIONS = Object.freeze([
  "psychiatry",
  "psychotherapy",
  "neurology",
  "general_medicine",
  "nutrition",
  "pediatrics",
]);

export const AGE_GROUPS = Object.freeze([
  "child",
  "adolescent",
  "adult",
  "older_adult",
]);
