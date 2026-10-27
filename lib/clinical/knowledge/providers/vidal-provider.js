const MOCK_DRUGS = [
  {
    id: "mock-vidal-001",
    name: "Сертралин",
    active_substance: "сертралин",
    form: "таблетки, покрытые пленочной оболочкой",
    indications: ["депрессивный эпизод", "обсессивно-компульсивное расстройство", "паническое расстройство"],
    contraindications: ["одновременный прием ингибиторов МАО", "детский возраст до 6 лет для части показаний"],
    dosing: "Начальная доза обычно 50 мг/сут, возможна коррекция по переносимости и клинической картине.",
    interactions_available: false,
    source: "Vidal (mock adapter)",
    updated_at: "2026-01-01",
  },
  {
    id: "mock-vidal-002",
    name: "Атомоксетин",
    active_substance: "атомоксетин",
    form: "капсулы",
    indications: ["синдром дефицита внимания и гиперактивности"],
    contraindications: ["феохромоцитома", "тяжелые сердечно-сосудистые заболевания"],
    dosing: "Дозирование зависит от массы тела и переносимости; титрация по инструкции.",
    interactions_available: false,
    source: "Vidal (mock adapter)",
    updated_at: "2026-01-01",
  },
];

export const VidalProvider = {
  id: "vidal",
  mode: "mock",
  async searchDrugs({ query, extended = false }) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const results = MOCK_DRUGS.filter((drug) =>
      drug.name.toLowerCase().includes(q) || drug.active_substance.toLowerCase().includes(q)
    );
    return results.map((drug) => ({
      ...drug,
      extended: Boolean(extended),
      interactions: extended && drug.interactions_available ? [] : null,
      disclaimer: "Демонстрационные данные mock-адаптера. Не использовать для назначения лечения.",
    }));
  },
};
