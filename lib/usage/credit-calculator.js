const CREDIT_RULES = {
  version: 1,
  textInputTokenMultiplier: 1,
  textOutputTokenMultiplier: 1,
  transcriptionPerSecond: 20,
  voiceAnalysisFixed: 1500,
  supportAnalyzeFixed: 500,
  plateAnalysisFixed: 2000,
  diarySaveFixed: 0,
  intakeSaveFixed: 0,
};

export function getCreditRulesVersion() {
  return CREDIT_RULES.version;
}

export function calculateUsageCost({
  resourceType,
  inputTokens,
  outputTokens,
  audioSeconds,
  imageCount,
}) {
  const r = CREDIT_RULES;
  switch (resourceType) {
    case "body_intake_analyze":
    case "body_diary_analyze":
      return calculateTextCost(inputTokens, outputTokens, r);

    case "support_analyze":
      return r.supportAnalyzeFixed;

    case "transcription":
      if (audioSeconds != null && audioSeconds > 0) {
        return Math.ceil(audioSeconds * r.transcriptionPerSecond);
      }
      return 500;

    case "voice_analysis":
      return r.voiceAnalysisFixed;

    case "plate_analysis":
      return r.plateAnalysisFixed;

    case "diary_save":
      return r.diarySaveFixed;

    case "intake_save":
      return r.intakeSaveFixed;

    default:
      return 100;
  }
}

function calculateTextCost(inputTokens, outputTokens, rules) {
  const safeInput = typeof inputTokens === "number" && inputTokens > 0 ? inputTokens : 0;
  const safeOutput = typeof outputTokens === "number" && outputTokens > 0 ? outputTokens : 0;

  if (safeInput > 0 || safeOutput > 0) {
    return (
      safeInput * rules.textInputTokenMultiplier +
      safeOutput * rules.textOutputTokenMultiplier
    );
  }
  return 0;
}

export const RESOURCE_NAMES = {
  support_analyze: "Анализ обращения",
  transcription: "Расшифровка голосового сообщения",
  voice_analysis: "Голосовой анализ",
  plate_analysis: "Анализ фотографии",
  body_intake_analyze: "Анализ анкеты здоровья",
  body_diary_analyze: "Формирование плана",
  diary_save: "Сохранение дневника",
  intake_save: "Сохранение анкеты",
};
