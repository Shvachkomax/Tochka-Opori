const CATALOG = [
  { id: "minzdrav-301", title: "Депрессивный эпизод, Рекуррентное депрессивное расстройство", icd: ["F32", "F33"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/301", last_verified_at: "2026-10-27" },
  { id: "minzdrav-455", title: "Тревожно-фобические расстройства", icd: ["F40"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/455", last_verified_at: "2026-10-27" },
  { id: "minzdrav-456", title: "Паническое расстройство", icd: ["F41.0"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/456", last_verified_at: "2026-10-27" },
  { id: "minzdrav-650", title: "Обсессивно-компульсивное расстройство", icd: ["F42"], specialty: "Психиатрия", year: 2025, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/650", last_verified_at: "2026-10-27" },
  { id: "minzdrav-753", title: "Посттравматическое стрессовое расстройство", icd: ["F43.1"], specialty: "Психиатрия", year: 2023, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/753", last_verified_at: "2026-10-27" },
  { id: "minzdrav-675", title: "Биполярное аффективное расстройство", icd: ["F31"], specialty: "Психиатрия", year: 2025, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/675", last_verified_at: "2026-10-27" },
  { id: "minzdrav-451", title: "Шизофрения (взрослые)", icd: ["F20"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/451", last_verified_at: "2026-10-27" },
  { id: "minzdrav-742", title: "Делирий, не обусловленный алкоголем и другими психоактивными веществами, у лиц пожилого и старческого возраста", icd: ["F05"], specialty: "Психиатрия", year: 2026, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/742", last_verified_at: "2026-10-27" },
  { id: "minzdrav-617", title: "Когнитивные расстройства у лиц пожилого и старческого возраста", icd: ["F00", "F01", "F02", "F03", "F06.7"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/617", last_verified_at: "2026-10-27" },
  { id: "minzdrav-397", title: "Специфические расстройства личности", icd: ["F60"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/397", last_verified_at: "2026-10-27" },
  { id: "minzdrav-594", title: "Расстройства аутистического спектра (дети)", icd: ["F84"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/594", last_verified_at: "2026-10-27" },
  { id: "minzdrav-452", title: "Умственная отсталость у взрослых", icd: ["F70"], specialty: "Психиатрия", year: 2024, status: "Действует", url: "https://cr.minzdrav.gov.ru/recomend/452", last_verified_at: "2026-10-27" },
];

export const MinzdravGuidelinesProvider = {
  id: "minzdrav_guidelines",
  mode: "catalog",
  async search({ query = "", symptoms = [], diagnosis = "", icd = "", specialty = "" }) {
    const q = `${query} ${symptoms.join(" ")} ${diagnosis} ${icd} ${specialty}`.toLowerCase();
    return CATALOG.filter((item) => {
      if (!q.trim()) return true;
      const haystack = `${item.title} ${item.icd.join(" ")} ${item.specialty}`.toLowerCase();
      return q.split(/\s+/).some((term) => term && haystack.includes(term));
    }).map((item) => ({
      source_type: "official_guideline",
      source_name: "Минздрав РФ",
      title: item.title,
      source_url: item.url,
      document_id: item.id,
      version: String(item.year),
      published_at: `${item.year}-01-01`,
      last_verified_at: item.last_verified_at,
      license_status: "public_reference",
      is_mock: false,
      expert_review_status: "approved",
      content: `Официальная клиническая рекомендация, статус: ${item.status}.`,
      icd: item.icd,
      specialty: item.specialty,
    }));
  },
};
