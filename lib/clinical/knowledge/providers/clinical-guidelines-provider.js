const MOCK_GUIDELINES = [
  {
    id: "mock-guideline-001",
    title: "Клинические рекомендации по депрессивному эпизоду",
    organization: "Минздрав РФ",
    edition: "2024",
    актуальность: "2024-12-01",
    source_url: "https://example.invalid/minzdrav/depression-2024",
    summary: "Структурированный подход к диагностике и ведению депрессивного эпизода.",
    applicable_age_groups: ["adolescent", "adult", "older_adult"],
    keywords: ["депрессия", "снижение настроения", "тревога"],
  },
];

export const ClinicalGuidelinesProvider = {
  id: "clinical_guidelines",
  mode: "mock",
  async search({ symptoms = [], diagnosis = "", ageGroup = null }) {
    const terms = [diagnosis, ...symptoms].map((x) => String(x).toLowerCase()).filter(Boolean);
    return MOCK_GUIDELINES.filter((item) => {
      const haystack = `${item.title} ${item.summary} ${item.keywords.join(" ")}`.toLowerCase();
      const termMatch = terms.length === 0 || terms.some((term) => haystack.includes(term));
      const ageMatch = !ageGroup || item.applicable_age_groups.includes(ageGroup);
      return termMatch && ageMatch;
    }).map((item) => ({ ...item, source_type: "official_guideline" }));
  },
};
