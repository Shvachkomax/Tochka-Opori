// Intent config for Support module
// All patterns, messages, and section definitions are Support-specific.

const SUPPORT_NAVIGATION_INTENTS = [
  {
    patterns: [/где.*практик/i, /мои.*практик/i, /где.*упражнен/i, /найти.*практик/i],
    answer: "Раздел «Мои практики» находится в кабинете ниже графика состояния. Прокрутите страницу вниз — там будут карточки с упражнениями и техниками.",
    section: "practices",
  },
  {
    patterns: [/где.*истор/i, /истор.*разговор/i, /прошл.*разговор/i, /стар.*разговор/i],
    answer: "История разговоров находится в кабинете ниже блока «Последний разговор». Там сохранены все ваши обращения.",
    section: "history",
  },
  {
    patterns: [/где.*отч[её]т/i, /мой.*отч[её]т/i, /посмотр.*отч[её]т/i, /открыть.*отч[её]т/i],
    answer: "Отчёт можно открыть из карточки последнего разговора — нажмите «Открыть отчёт». Или из истории — нажмите «Открыть» рядом с нужным разговором.",
    section: "report",
  },
  {
    patterns: [/где.*график/i, /график.*состоян/i, /динамик/i, /где.*чек.?ин/i, /где.*отметк/i],
    answer: "График состояния и дневник чек-инов находятся в верхней части кабинета, в блоке «Как вы себя чувствуете сегодня?».",
    section: "checkins",
  },
  {
    patterns: [/как.*имя/i, /измен.*имя/i, /псевдоним/i, /обращен/i, /как.*зовут/i],
    answer: "Имя можно изменить в разделе «Профиль» внизу кабинета. Нажмите на стрелку, введите имя и сохраните.",
    section: "profile",
  },
  {
    patterns: [/где.*код/i, /код.*продолжен/i, /код.*доступ/i, /продолжен.*код/i],
    answer: "Код продолжения можно создать или посмотреть в разделе «Доступ» внизу кабинета.",
    section: "access",
  },
  {
    patterns: [/как.*связаться/i, /связаться.*специалист/i, /написать.*специалист/i, /отправить.*запрос/i],
    answer: "Чтобы связаться со специалистом, нажмите кнопку «Связаться со специалистом» в разделе «Специалист» в кабинете.",
    section: "specialist",
    cta: "service_request",
  },
];

const SUPPORT_SAFETY_INTENTS = [
  {
    patterns: [/суицид/i, /убить.*себя/i, /не хочу.*жить/i, /повеситься/i, /порезать/i, /самоповрежд/i],
    answer: "Если вы сейчас в опасности — позвоните 112. Вы не одни. Попросите находящегося рядом человека помочь вам добраться до помощи.",
    severity: "critical",
    cta: "crisis",
  },
  {
    patterns: [/очень.*плохо/i, /не.*справля/i, /крах/i, /конец/i, /безнадёжн/i],
    answer: "Звучит так, как будто сейчас очень тяжело. Если есть риск причинить себе вред — позвоните 112. Если хотите поговорить подробнее, я здесь.",
    severity: "warning",
  },
];

const SUPPORT_MEDICATION_PATTERNS = [
  /какие.*таблетк/i, /какие.*препарат/i, /какие.*лекарств/i,
  /сильн.*снотворн/i, /начать.*принимать/i, /дозировк/i,
  /антидепрессант/i, /успокоительн/i, /транквилизатор/i,
  /рецепт/i, /назначить.*лекарств/i, /отменить.*лекарств/i,
];

const SUPPORT_FALLBACK_MESSAGES = {
  aiFailure: "Сейчас не получилось сформировать ответ. Вы можете попробовать ещё раз или продолжить разговор в подробном режиме.",
  networkError: "Не удалось связаться с сервисом. Попробуйте ещё раз или продолжите разговор в подробном режиме.",
  timeout: "Ответ занимает больше времени, чем обычно. Попробуйте ещё раз.",
  lowConfidence: "Я не хочу угадывать. Могу помочь разобрать это подробнее или отправить запрос специалисту.",
  handoff: "Я могу помочь отправить запрос специалисту. Хотите, чтобы я открыл форму связи?",
  medication: "Подбор и изменение лекарств — это задача для врача. Я не могу назначать препараты или дозировки. Если вам нужна помощь с лекарствами, лучше обсудить это со специалистом.",
};

async function getSupportCapabilitiesContext(supabase, ownerId) {
  const context = {};

  // Practice count
  const { count: practiceCount } = await supabase
    .from("support_owner_practices")
    .select("*", { count: "exact", head: true })
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .eq("status", "active");
  context.practice_count = practiceCount || 0;

  // Has report
  const { data: latestSession } = await supabase
    .from("sessions")
    .select("user_report")
    .eq("anonymous_owner_id", ownerId)
    .eq("module", "support")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  context.has_report = !!latestSession?.user_report;

  // Has specialist
  context.has_specialist = false; // resolved separately if needed

  // Available sections
  context.available_sections = [
    "report", "history", "checkins", "practices",
    "specialist_request", "profile", "access",
  ];

  context.service_request_available = true;

  return context;
}

async function getSupportPromptContext(supabase, ownerId) {
  const context = {};

  // Display name
  const { data: profile } = await supabase
    .from("support_owner_profiles")
    .select("display_name")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .maybeSingle();
  context.display_name = profile?.display_name || null;

  // Latest session
  const { data: latestSession } = await supabase
    .from("sessions")
    .select("user_report, support_plan, care_recommendation, created_at")
    .eq("anonymous_owner_id", ownerId)
    .eq("module", "support")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSession) {
    context.latest_report_summary = (latestSession.user_report || "").slice(0, 800);
    context.care_recommendation = latestSession.care_recommendation || null;
    context.support_plan = latestSession.support_plan || null;
  }

  // Recent check-ins
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: checkins } = await supabase
    .from("support_daily_checkins")
    .select("checkin_date, wellbeing_score, anxiety_score")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .gte("checkin_date", since)
    .order("checkin_date", { ascending: true });
  context.recent_checkins = checkins || [];

  // Active practices
  const { data: practices } = await supabase
    .from("support_owner_practices")
    .select("practice_key, title, user_status, helpfulness")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .limit(10);
  context.active_practices = practices || [];

  // Recent chat
  const { data: recentChat } = await supabase
    .from("support_ai_chat")
    .select("role, message_text")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(5);
  context.recent_chat = (recentChat || []).reverse();

  return context;
}

export const supportConfig = {
  module: "support",
  safetyIntents: SUPPORT_SAFETY_INTENTS,
  navigationIntents: SUPPORT_NAVIGATION_INTENTS,
  medicationPatterns: SUPPORT_MEDICATION_PATTERNS,
  fallbackMessages: SUPPORT_FALLBACK_MESSAGES,
  getCapabilitiesContext: getSupportCapabilitiesContext,
  buildPromptContext: getSupportPromptContext,
};
