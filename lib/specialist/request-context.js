const CLINICAL_CONTEXT_LABELS = [
  "Сфера выявления сигналов",
  "Маркеры риска",
  "Модифицирующие факторы",
  "Временная динамика",
  "Функциональные нарушения",
  "Рекомендации",
  "Срочность",
  "Текущие препараты и способы самопомощи",
  "Мысли о смерти/самоповреждении",
  "Безопасность сейчас",
  "Намерение или план",
  "Одиночество/кто рядом",
  "Доступная поддержка",
];

function safeText(value, maxLength = 3000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function patientSafeSummary(value) {
  return safeText(value, 2400)
    .split(/\r?\n/)
    .filter((line) => !/(?:диагноз|балл\s+(?:суицидального\s+)?риска|числов\w*\s+прогноз\w*\s+риска|risk\s+score)/iu.test(line))
    .join("\n")
    .trim();
}

export function extractAttentionSignals(doctorReport = "") {
  return String(doctorReport)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => CLINICAL_CONTEXT_LABELS.some((label) => line.toLocaleLowerCase("ru-RU").startsWith(label.toLocaleLowerCase("ru-RU"))))
    .filter((line) => !/(?:диагноз|автоматическ\w+ диагноз|прогноз риска|балл риска|risk score|риск\s*[:=]\s*\d+)/iu.test(line))
    .slice(0, 16)
    .join("\n");
}

export function buildSpecialistRequestContext({ session, crisisBlock } = {}) {
  if (!session) return null;
  const summary = patientSafeSummary(session.user_report || session.patient_text);
  const attentionSignals = extractAttentionSignals(session.doctor_report || "");
  const crisisContext = crisisBlock
    ? safeText(crisisBlock.doctorReport || crisisBlock.initial_message, 2400)
    : "";
  return {
    session_date: session.created_at || null,
    preliminary_summary: summary || "Предварительный отчёт ещё не сформирован.",
    signals_for_attention: attentionSignals || null,
    crisis_context: crisisContext || null,
    report_available: Boolean(session.user_report),
  };
}
