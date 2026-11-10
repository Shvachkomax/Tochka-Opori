/**
 * Safeguards for Support question loops. Pure functions enable regression tests.
 * Other modules remain on their existing route.
 */
export function supportMissingModelGuard(module, modelAvailable) {
  if (module !== "support" || modelAvailable) return null;
  return {
    status: 503,
    payload: {
      code: "SUPPORT_AI_UNAVAILABLE",
      error: "ИИ-анализ недоступен в этой тестовой сборке. Разговор не обрабатывается; повторите попытку после подключения модели.",
    },
  };
}

export function supportUnexpectedQuestionsGuard(module, depth, responseType) {
  if (module !== "support" || depth < 3 || responseType !== "questions") return null;
  return {
    status: 502,
    payload: {
      code: "SUPPORT_REPORT_NOT_READY",
      error: "ИИ не смог подготовить итоговый разбор. Повторите попытку позже.",
    },
  };
}
