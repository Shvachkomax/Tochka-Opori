export const PATIENT_TOUR_INVITE_DELAY_MS = 1600;
export const PATIENT_TOUR_INVITE_PULSE_MS = 10000;

const commonSteps = {
  overview: {
    id: "overview",
    title: "Знакомство с кабинетом",
    description: "Здесь собраны ваши разговоры, дневник состояния, сведения о здоровье и обращения к специалистам.",
    target: '[data-tour-target="patient-overview"]',
  },
  specialist: {
    id: "specialist",
    title: "Мой специалист",
    description: "Здесь отображаются специалисты, с которыми вы связаны. Можно посмотреть доступные услуги и перейти к записи. Если специалиста пока нет, здесь же показано, как пригласить его или запросить подбор.",
    target: '[data-tour-target="patient-specialist"]',
  },
  booking: {
    id: "booking",
    title: "Запись на приём",
    description: "Откройте услуги специалиста, выберите дату и свободное время. Запись и оплата выполняются только после вашего подтверждения. Если услуг или свободного времени нет, этот шаг можно пропустить.",
    target: '[data-tour-target="patient-booking"]',
  },
  complete: {
    id: "complete",
    title: "Знакомство завершено",
    description: "Вы познакомились с кабинетом. Теперь вы можете пользоваться его возможностями самостоятельно. При необходимости обучение можно запустить снова.",
    target: '[data-tour-target="patient-overview"]',
  },
};

export const PATIENT_TOUR_STEPS = Object.freeze({
  support: Object.freeze([
    commonSteps.overview,
    {
      id: "diary",
      title: "Дневник состояния",
      description: "Здесь можно записывать своё самочувствие и наблюдать изменения состояния. Для знакомства не нужно добавлять медицинские сведения.",
      target: '[data-tour-target="patient-diary"]',
    },
    {
      id: "ai",
      title: "Общение с Точкой Опоры",
      description: "Здесь можно начать текстовый разговор, продиктовать сообщение и посмотреть предыдущие беседы. Голосовое общение запускается только по вашей команде.",
      target: '[data-tour-target="patient-ai"]',
    },
    commonSteps.specialist,
    commonSteps.booking,
    {
      id: "health",
      title: "Сведения о здоровье",
      description: "Здесь можно просматривать сведения, доступные в вашем кабинете. Обучение ничего не меняет в препаратах, назначениях или дозировках.",
      target: '[data-tour-target="patient-health"]',
    },
    commonSteps.complete,
  ]),
  health: Object.freeze([
    commonSteps.overview,
    {
      id: "diary",
      title: "Дневник здоровья",
      description: "Здесь можно отмечать питание, активность, сон и другие показатели. Для знакомства заполнять дневник не обязательно.",
      target: '[data-tour-target="patient-diary"]',
    },
    {
      id: "ai",
      title: "Общение с AI-компаньоном",
      description: "Здесь можно начать текстовый разговор, продиктовать сообщение и посмотреть историю. Платная голосовая сессия никогда не запускается автоматически.",
      target: '[data-tour-target="patient-ai"]',
    },
    commonSteps.specialist,
    commonSteps.booking,
    {
      id: "health",
      title: "Сведения о здоровье",
      description: "Здесь вы можете просматривать и изменять собственные сведения о здоровье. Препараты, назначения и дозировки меняются только после вашего явного действия.",
      target: '[data-tour-target="patient-health"]',
    },
    commonSteps.complete,
  ]),
});

export function normalizePatientTourProfile(profile) {
  return profile === "health" || profile === "body" ? "health" : "support";
}

// Opaque browser-local scope: progress is separated by patient without putting
// a session or patient identifier into a storage key, URL, log or interface.
export function hashPatientTourScope(value) {
  const input = String(value || "local");
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

export function patientTourStorageKey(profile, scope) {
  return `patient-cabinet-tour-v1:${normalizePatientTourProfile(profile)}:${hashPatientTourScope(scope)}`;
}

export function patientTourInviteKey(profile, scope) {
  return `patient-cabinet-tour-invite-v1:${normalizePatientTourProfile(profile)}:${hashPatientTourScope(scope)}`;
}

export function parsePatientTourProgress(value, total = 7) {
  if (value === "complete") return { completed: true, step: 0 };
  const step = Number(value);
  return { completed: false, step: Number.isInteger(step) && step >= 0 && step < total ? step : 0 };
}

export function shouldInviteToPatientTour({ dismissed = false, completed = false } = {}) {
  return !dismissed && !completed;
}

export function patientTourStepStatus(stepId, {
  targetFound = true,
  unavailable = false,
  specialists = null,
  services = null,
} = {}) {
  if (!targetFound) {
    return "Этот раздел пока не отображается. Можно перейти дальше — экскурсия не изменит данные кабинета.";
  }
  if ((stepId === "specialist" || stepId === "booking") && unavailable) {
    return "Серверный раздел записи временно недоступен. Это не означает, что прикреплённый специалист отсутствует.";
  }
  if (stepId === "specialist") {
    if (specialists === 0) {
      return "Прикреплённых специалистов пока нет. Экскурсия не создаёт связь автоматически.";
    }
    if (Number.isInteger(specialists) && specialists > 0) {
      return `Прикреплено специалистов: ${specialists}. Можно открыть их услуги или перейти дальше.`;
    }
  }
  if (stepId === "booking") {
    if (specialists === 0) {
      return "Для записи сначала нужен прикреплённый специалист. Этот шаг можно пропустить.";
    }
    if (Number.isInteger(specialists) && specialists > 0 && services === 0) {
      return "Специалист прикреплён, но активных серверных услуг пока нет. Это не означает отсутствие врача; шаг можно пропустить.";
    }
    if (Number.isInteger(services) && services > 0) {
      return `Доступно серверных услуг: ${services}. Запись и оплата начнутся только после ваших действий.`;
    }
  }
  if (stepId === "overview" || stepId === "complete") {
    return "Кнопки и разделы кабинета остаются доступными во время экскурсии.";
  }
  return "Можно открыть выделенный раздел или перейти дальше без заполнения данных.";
}
