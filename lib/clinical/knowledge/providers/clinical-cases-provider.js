import { CLINICAL_CASE_STATUSES, APPROVED_CASE_STATUS } from "../constants.js";

export const SYNTHETIC_CLINICAL_CASES = [
  {
    id: "synthetic-case-001",
    direction: "psychiatry",
    age_group: "adult",
    complaints: ["снижение настроения", "нарушение сна", "снижение энергии"],
    anamnesis: "Демонстрационный синтетический случай. Длительность симптомов несколько недель.",
    comorbidities: ["тревожные проявления"],
    examinations: ["клиническая беседа", "оценка риска"],
    confirmed_diagnosis: null,
    treatment: "Наблюдение и консультация специалиста.",
    outcomes: "Частичное улучшение после структурированного сопровождения.",
    adverse_reactions: [],
    observation_duration: "8 недель",
    source: "Синтетический демонстрационный случай",
    usage_rights: "Только для тестирования и демонстрации.",
    expert_review_status: APPROVED_CASE_STATUS,
    updated_at: "2026-01-01",
  },
  {
    id: "synthetic-case-002",
    direction: "nutrition",
    age_group: "adult",
    complaints: ["набор веса", "усталость после еды"],
    anamnesis: "Демонстрационный синтетический случай без персональных данных.",
    comorbidities: ["инсулинорезистентность (подозрение)"],
    examinations: ["антропометрия", "дневник питания"],
    confirmed_diagnosis: null,
    treatment: "Коррекция рациона и физической активности.",
    outcomes: "Стабилизация веса.",
    adverse_reactions: [],
    observation_duration: "12 недель",
    source: "Синтетический демонстрационный случай",
    usage_rights: "Только для тестирования и демонстрации.",
    expert_review_status: APPROVED_CASE_STATUS,
    updated_at: "2026-01-01",
  },
];

export function listApprovedCases() {
  return SYNTHETIC_CLINICAL_CASES.filter((item) => item.expert_review_status === APPROVED_CASE_STATUS);
}

export function findCases(filters = {}) {
  return listApprovedCases().filter((item) => {
    if (filters.direction && item.direction !== filters.direction) return false;
    if (filters.ageGroup && item.age_group !== filters.ageGroup) return false;
    if (filters.symptoms?.length) {
      const haystack = `${item.complaints.join(" ")} ${item.anamnesis}`.toLowerCase();
      if (!filters.symptoms.some((symptom) => haystack.includes(String(symptom).toLowerCase()))) return false;
    }
    if (filters.comorbidities?.length) {
      const haystack = item.comorbidities.join(" ").toLowerCase();
      if (!filters.comorbidities.some((item2) => haystack.includes(String(item2).toLowerCase()))) return false;
    }
    return true;
  });
}

export const ClinicalCasesProvider = {
  id: "clinical_cases",
  mode: "local_repository",
  async search(filters = {}) {
    return findCases(filters).map((item) => ({ ...item, source_type: "clinical_case" }));
  },
};
