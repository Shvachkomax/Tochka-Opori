// Intent config for Body/Health module
// Stub — will be fully implemented in next phase.
// All patterns and messages are Body-specific.

const BODY_NAVIGATION_INTENTS = [
  {
    patterns: [/где.*дневник/i, /мой.*дневник/i, /дневник.*пит/i],
    answer: "Дневник питания и активности находится в основном кабинете. Нажмите «Заполнить дневник» для новой записи.",
    section: "diary",
  },
  {
    patterns: [/где.*график/i, /график.*вес/i, /динамик.*вес/i, /график.*активност/i],
    answer: "Графики веса, активности и сна находятся в верхней части кабинета в разделе «Динамика».",
    section: "charts",
  },
  {
    patterns: [/где.*фото/i, /фото.*еды/i, /анализ.*тарелк/i, /тарелк/i],
    answer: "Анализ тарелки доступен при заполнении дневника — добавьте фото приёмов пищи.",
    section: "plate",
  },
  {
    patterns: [/где.*недель.*отчёт/i, /недель.*сводк/i, /weekly/i],
    answer: "Недельные сводки находятся в разделе «Недельный отчёт» в кабинете.",
    section: "weekly",
  },
  {
    patterns: [/как.*имя/i, /измен.*имя/i, /псевдоним/i],
    answer: "Имя можно изменить в настройках профиля в кабинете.",
    section: "profile",
  },
];

const BODY_SAFETY_INTENTS = [
  {
    patterns: [/боль.*груд/i, /обморок/i, /кров.*стул/i, /сильн.*головокруж/i, /резк.*ухудшен/i],
    answer: "Это может требовать медицинской помощи. Обратитесь к врачу или в приёмное отделение. Если состояние острое — позвоните 112.",
    severity: "critical",
  },
];

const BODY_MEDICATION_PATTERNS = [
  /какие.*таблетк/i, /какие.*препарат/i, /дозировк/i,
  /бад/i, /добавк/i, /витамин/i,
  /начать.*принимать/i, /отменить.*препарат/i,
];

const BODY_FALLBACK_MESSAGES = {
  aiFailure: "Не удалось получить ответ. Попробуйте ещё раз или задайте вопрос специалисту.",
  networkError: "Не удалось связаться с сервисом. Попробуйте позже.",
  timeout: "Ответ занимает больше времени. Попробуйте ещё раз.",
  lowConfidence: "Я не уверен в ответе. Лучше обсудить это со специалистом.",
  handoff: "Хотите отправить вопрос специалисту? Я могу помочь сформулировать запрос.",
  medication: "Подбор добавок и лекарств — задача для врача. Я не могу назначать препараты.",
};

async function getBodyCapabilitiesContext(supabase, ownerId) {
  return {
    available_sections: ["diary", "charts", "plate", "weekly", "insights", "profile"],
    has_diary: true,
    has_charts: true,
    has_plate: true,
    service_request_available: true,
  };
}

async function getBodyPromptContext(supabase, ownerId) {
  return {};
}

export const bodyConfig = {
  module: "body",
  safetyIntents: BODY_SAFETY_INTENTS,
  navigationIntents: BODY_NAVIGATION_INTENTS,
  medicationPatterns: BODY_MEDICATION_PATTERNS,
  fallbackMessages: BODY_FALLBACK_MESSAGES,
  getCapabilitiesContext: getBodyCapabilitiesContext,
  buildPromptContext: getBodyPromptContext,
};
