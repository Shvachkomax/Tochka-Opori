const REVIEW_STATUS = new Map();
const PUBLISHED_CASES = [
  { id: "pub-case-1", title: "Zolpidem-induced complex sleep behaviour: a case report", authors: "Not specified in search result", journal: "BMC Psychiatry", year: 2025, doi: "10.1186/s12888-025-06593-x", source_url: "https://bmcpsychiatry.biomedcentral.com/articles/10.1186/s12888-025-06593-x", specialty: "Psychiatry", symptoms: ["insomnia", "complex sleep behaviour"], diagnosis: "Zolpidem-induced complex sleep behaviour", examinations: ["clinical history"], treatment: "Zolpidem review", outcomes: "Episodes correlated with zolpidem use", applicability_limits: "Single case report; not a treatment recommendation", usage_rights: "Open access metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-2", title: "Tirzepatide-induced weight loss and obstructive sleep apnea improvement in an adult with type 2 diabetes", authors: "Funamizu N et al.", journal: "Medicine (Baltimore)", year: 2025, doi: "10.1097/MD.0000000000045445", source_url: "https://pubmed.ncbi.nlm.nih.gov/41137356/", specialty: "Endocrinology", symptoms: ["obesity", "obstructive sleep apnea", "type 2 diabetes"], diagnosis: "Type 2 diabetes with obesity and OSA", examinations: ["polysomnography", "HbA1c"], treatment: "Tirzepatide plus lifestyle", outcomes: "Weight loss and OSA improvement", applicability_limits: "Single patient observation", usage_rights: "PubMed metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-3", title: "Cognitive behavioral therapy-enhanced through videoconferencing for night eating syndrome, binge-eating disorder and comorbid insomnia", authors: "Melisse B, Arora T", journal: "Journal of Eating Disorders", year: 2024, doi: "10.1186/s40337-024-01131-8", source_url: "https://link.springer.com/article/10.1186/s40337-024-01131-8", specialty: "Psychiatry", symptoms: ["night eating", "binge eating", "insomnia"], diagnosis: "Night-eating syndrome and binge-eating disorder", examinations: ["clinical assessment"], treatment: "CBT-E with CBT-I", outcomes: "Abstinence from binge eating post-treatment", applicability_limits: "Single case report", usage_rights: "Open access metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-4", title: "Treatment of idiopathic hypersomnia with modafinil in an individual at clinical high risk for psychosis", authors: "Sato Y et al.", journal: "Psychiatry and Clinical Neurosciences Reports", year: 2025, doi: "10.1002/pcn5.70123", source_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12050949/", specialty: "Psychiatry", symptoms: ["excessive daytime sleepiness"], diagnosis: "Idiopathic hypersomnia with CHR-P", examinations: ["polysomnography", "MSLT"], treatment: "Modafinil", outcomes: "EDS improved", applicability_limits: "Single case report", usage_rights: "PMC metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-5", title: "Phentermine-topiramate extended release for the dual treatment of obesity and sleep-related eating disorder", authors: "Not specified in search result", journal: "Journal of Medical Case Reports", year: 2022, doi: "10.1186/s13256-021-03243-0", source_url: "https://pubmed.ncbi.nlm.nih.gov/35081980/", specialty: "Psychiatry", symptoms: ["obesity", "sleep-related eating disorder"], diagnosis: "Sleep-related eating disorder with obesity", examinations: ["clinical history"], treatment: "Phentermine-topiramate ER", outcomes: "Weight loss and symptom resolution", applicability_limits: "Single case report", usage_rights: "PubMed metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-6", title: "The dual orexin receptor antagonist suvorexant in alcohol use disorder and comorbid insomnia", authors: "Campbell EJ et al.", journal: "Clinical Case Reports", year: 2024, doi: "10.1002/ccr3.8740", source_url: "https://onlinelibrary.wiley.com/doi/full/10.1002/ccr3.8740", specialty: "Psychiatry", symptoms: ["alcohol use disorder", "insomnia"], diagnosis: "Alcohol use disorder with insomnia", examinations: ["clinical assessment"], treatment: "Suvorexant", outcomes: "Improved cravings and sleep", applicability_limits: "Single case report", usage_rights: "Publisher metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-7", title: "Unraveling Leptin's Influence: Sleep Abnormalities in Obesity-Related Neurogenetics", authors: "Colón-Soto J et al.", journal: "Ponce Health Sciences University Scientific Journal", year: 2025, doi: "10.71332/cv0z6q31", source_url: "https://doi.org/10.71332/cv0z6q31", specialty: "Endocrinology", symptoms: ["obesity", "sleep abnormalities"], diagnosis: "Obesity-related neurogenetics", examinations: ["genetic testing"], treatment: "Not specified", outcomes: "Descriptive case", applicability_limits: "Single case report", usage_rights: "Publisher metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-8", title: "Sleep Disorders in a Patient with Obesity and Type 2 Diabetes Mellitus", authors: "Lebedeva DD, P'yanykh OP", journal: "Doctor Ru", year: 2025, doi: "10.31550/1727-2378-2025-24-4-92-104", source_url: "https://doi.org/10.31550/1727-2378-2025-24-4-92-104", specialty: "Endocrinology", symptoms: ["obesity", "type 2 diabetes", "sleep disorders"], diagnosis: "Obesity, type 2 diabetes and sleep disorders", examinations: ["somnography", "CPAP"], treatment: "Comprehensive management", outcomes: "Weight loss and AHI improvement", applicability_limits: "Single case report", usage_rights: "Publisher metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-9", title: "Night eating syndrome and binge-eating disorder with comorbid insomnia", authors: "Melisse B, Arora T", journal: "Journal of Eating Disorders", year: 2024, doi: "10.1186/s40337-024-01131-8", source_url: "https://link.springer.com/article/10.1186/s40337-024-01131-8", specialty: "Psychiatry", symptoms: ["night eating", "insomnia"], diagnosis: "Night eating syndrome", examinations: ["clinical assessment"], treatment: "CBT", outcomes: "Symptom reduction", applicability_limits: "Single case report", usage_rights: "Open access metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
  { id: "pub-case-10", title: "Idiopathic hypersomnia and clinical high risk for psychosis", authors: "Sato Y et al.", journal: "Psychiatry and Clinical Neurosciences Reports", year: 2025, doi: "10.1002/pcn5.70123", source_url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12050949/", specialty: "Psychiatry", symptoms: ["hypersomnia"], diagnosis: "Idiopathic hypersomnia", examinations: ["MSLT"], treatment: "Modafinil", outcomes: "EDS improved", applicability_limits: "Single case report", usage_rights: "PMC metadata only", expert_review_status: "pending_review", last_verified_at: "2026-10-27" },
];

export const PublishedClinicalCasesProvider = {
  id: "published_clinical_cases",
  mode: "metadata_catalog",
  async search(filters = {}) {
    return PUBLISHED_CASES.filter((item) => (REVIEW_STATUS.get(item.id) || item.expert_review_status) === "approved").map((item) => ({
      source_type: "published_case",
      source_name: item.journal,
      title: item.title,
      source_url: item.source_url,
      document_id: item.id,
      version: String(item.year),
      published_at: `${item.year}-01-01`,
      last_verified_at: item.last_verified_at,
      license_status: "metadata_only",
      is_mock: false,
      expert_review_status: item.expert_review_status,
      content: `${item.symptoms.join(", ")}; ${item.diagnosis}; ${item.treatment}; ${item.outcomes}`,
      authors: item.authors,
      doi: item.doi,
      specialty: item.specialty,
      applicability_limits: item.applicability_limits,
    }));
  },
  async listPending() {
    return PUBLISHED_CASES.filter((item) => item.expert_review_status !== "approved");
  },
};

export function setPublishedCaseStatus(id, status) { REVIEW_STATUS.set(id, status); }
export function getPublishedCaseStatus(id, fallback) { return REVIEW_STATUS.get(id) || fallback; }
