const DAY_MS = 24 * 60 * 60 * 1000;

function invitation({ id, topic, text, contextText = text }) {
  return Object.freeze({ id, topic, text, contextText });
}

export const FIRST_SCREEN_INVITATIONS = Object.freeze([
  invitation({
    id: "first_start",
    topic: "start",
    text: "Здесь можно рассказать о том, что вас беспокоит. Начните с того, что сейчас важнее всего.",
  }),
  invitation({
    id: "first_anxiety",
    topic: "anxiety",
    text: "Тревожно или трудно отключиться от мыслей? Можно начать с этого.",
  }),
  invitation({
    id: "first_relationships",
    topic: "work_relationships",
    text: "На работе или в отношениях непростой период? Расскажите, что происходит.",
  }),
  invitation({
    id: "first_body",
    topic: "body_sensations",
    text: "Беспокоят ощущения в теле? Расскажите, что вы замечаете и когда это началось.",
  }),
  invitation({
    id: "first_sleep",
    topic: "sleep",
    text: "Трудно уснуть или восстановить силы? Как это проявляется у вас?",
  }),
  invitation({
    id: "first_day",
    topic: "daily_life",
    text: "Не знаете, с чего начать? Можно просто рассказать, как прошёл день.",
  }),
  invitation({
    id: "first_prepare",
    topic: "preparing_questions",
    text: "Поможем описать ваше состояние и подготовить вопросы специалисту.",
  }),
]);

export const CABINET_INVITATIONS = Object.freeze([
  invitation({
    id: "cabinet_checkin",
    topic: "current_state",
    text: "Как вы сейчас себя чувствуете? Что хочется обсудить?",
  }),
  invitation({
    id: "cabinet_day",
    topic: "day",
    text: "Как прошёл ваш день? Что особенно запомнилось?",
  }),
  invitation({
    id: "cabinet_now",
    topic: "now",
    text: "Есть что-то, о чём хочется поговорить прямо сейчас?",
  }),
  invitation({
    id: "cabinet_continue",
    topic: "continuation",
    text: "Хотите продолжить прошлый разговор или обсудить что-то новое?",
  }),
  invitation({
    id: "cabinet_gap",
    topic: "return_after_gap",
    text: "С прошлого посещения прошло {N}. Как вы сейчас?",
    contextText: "Человек вернулся после перерыва в несколько дней.",
  }),
]);

const ALL_INVITATIONS = Object.freeze([
  ...FIRST_SCREEN_INVITATIONS,
  ...CABINET_INVITATIONS,
]);

const INVITATIONS_BY_ID = new Map(ALL_INVITATIONS.map((item) => [item.id, item]));

function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcCalendarDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatDayCount(days) {
  const value = Math.abs(Math.trunc(Number(days)));
  if (!Number.isFinite(value)) return "";
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "дней"
    : mod10 === 1
      ? "день"
      : mod10 >= 2 && mod10 <= 4
        ? "дня"
        : "дней";
  return `${value} ${noun}`;
}

export function getPreviousVisitGapDays(previousVisitAt, now = new Date()) {
  const previous = parseDate(previousVisitAt);
  const current = parseDate(now);
  if (!previous || !current) return null;
  const gap = Math.floor((utcCalendarDay(current) - utcCalendarDay(previous)) / DAY_MS);
  return gap >= 0 ? gap : null;
}

export function buildCabinetInvitations({
  hasPreviousConversation = false,
  previousVisitAt = null,
  now = new Date(),
} = {}) {
  const gapDays = getPreviousVisitGapDays(previousVisitAt, now);
  const result = [];

  if (hasPreviousConversation && gapDays !== null && gapDays >= 3) {
    const gapInvitation = INVITATIONS_BY_ID.get("cabinet_gap");
    result.push(Object.freeze({
      ...gapInvitation,
      text: `С прошлого посещения прошло ${formatDayCount(gapDays)}. Как вы сейчас?`,
      contextText: `Человек вернулся после перерыва ${formatDayCount(gapDays)}.`,
      gapDays,
    }));
  }

  for (const item of CABINET_INVITATIONS) {
    if (item.id === "cabinet_gap") continue;
    if (item.id === "cabinet_continue" && !hasPreviousConversation) continue;
    result.push(item);
  }

  return Object.freeze(result);
}

export function getSupportInvitationById(id) {
  if (typeof id !== "string" || !id || id.length > 64) return null;
  return INVITATIONS_BY_ID.get(id) || null;
}

export function getFirstScreenInvitationById(id) {
  const item = getSupportInvitationById(id);
  return item && FIRST_SCREEN_INVITATIONS.includes(item) ? item : null;
}

export function getCabinetInvitationById(id) {
  const item = getSupportInvitationById(id);
  return item && CABINET_INVITATIONS.includes(item) ? item : null;
}

export function buildDialogueInvitationContext(id, { gapDays = null } = {}) {
  const item = getSupportInvitationById(id);
  if (!item) return null;

  if (item.id === "cabinet_gap") {
    const days = Number(gapDays);
    if (!Number.isInteger(days) || days < 3) return null;
    return Object.freeze({
      id: item.id,
      topic: item.topic,
      contextText: `Человек вернулся после перерыва ${formatDayCount(days)}.`,
    });
  }

  return Object.freeze({
    id: item.id,
    topic: item.topic,
    contextText: item.contextText,
  });
}

export function buildDialogueInvitationPromptNote(invitation) {
  if (!invitation?.contextText) return "";
  return [
    "Контекст стартового приглашения:",
    `Пользователь начал разговор, выбрав подсказку: «${invitation.contextText}»`,
    "Это не ответ пользователя, не реплика пациента и не клинический симптом.",
    "Учитывай тему в первом ответе, если она уместна, но не утверждай, что пользователь сам это сказал, и не заставляй возвращаться к теме.",
  ].join("\n");
}
