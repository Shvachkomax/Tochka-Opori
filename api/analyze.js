import { runTextAnalysis } from "../lib/aiClient.js";

function buildAntiRepeatBlock(convHistory) {
  if (!Array.isArray(convHistory) || convHistory.length === 0) return "";

  const previousQuestions = [];
  const previousAnswers = [];
  const knownTopics = new Set();

  for (const entry of convHistory) {
    if (entry.role === "assistant" && Array.isArray(entry.questions)) {
      for (const q of entry.questions) {
        if (q && q.length > 10) {
          previousQuestions.push(q);
          knownTopics.add(q.slice(0, 40));
        }
      }
    }
    if (entry.role === "user") {
      const text = entry.content || "";
      if (text && text.length > 5) {
        previousAnswers.push(text.slice(0, 80));
      }
      if (entry.answers) {
        for (const val of Object.values(entry.answers)) {
          if (val && val.length > 5) {
            previousAnswers.push(val.slice(0, 80));
          }
        }
      }
    }
  }

  if (previousQuestions.length === 0) return "";

  return `
Уже спрашивали (не повторять):
${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Уже отвечено:
${previousAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n")}

Правило:
- Не задавай вопрос, если ответ уже есть в истории.
- Не повторяй вопрос другими словами.
- Каждый новый раунд уточняет только незакрытые зоны:
  safety/risk, timeline, trigger/context, sleep, substances/medications,
  body tension, functioning, resources/support, selected support practices.
- Если вопрос уже был задан или пациент уже ответил, не возвращайся к нему без явной причины.
`;
}

const PROMPT_VERSION = "3.1-care-routing";

const PROHIBITED_TERMS_USER_REPORT = [
  "эмоциональн(ая|ой|ую|ые|ых|ым) сфер",
  "нейрокогнитивн(ая|ой|ую|ые|ых|ым) сфер",
  "модифицирующие факторы",
  "модифицирующих факторов",
  "травматическ(ий|ого|ому|им|ом) контекст",
  "психопатологическ",
  "ресурсн(ый|ого|ому|ым|ом|ые|ых|ым) потенциал",
  "выявлены сигналы",
  "обнаружены сигналы",
];

function checkReportQuality(userReport, originalText, historyText) {
  const violations = [];
  if (!userReport) return { pass: false, violations: ["user_report is empty"] };

  for (const pattern of PROHIBITED_TERMS_USER_REPORT) {
    const re = new RegExp(pattern, "iu");
    if (re.test(userReport)) {
      violations.push(`prohibited term: ${pattern}`);
    }
  }

  // Check "важно оценить" > 2
  const vazhnoOcenit = (userReport.match(/важно оценить/gi) || []).length;
  if (vazhnoOcenit > 2) violations.push(`"важно оценить" used ${vazhnoOcenit} times`);

  // Check "требуется уточнение" > 1
  const trebuetsya = (userReport.match(/требуется уточнение/gi) || []).length;
  if (trebuetsya > 1) violations.push(`"требуется уточнение" used ${trebuetsya} times`);

  // Check if it mentions any specific fact from original text
  // Extract key nouns/entities from original text (simple heuristic)
  const originalWords = (originalText || "").split(/\s+/).filter(w => w.length > 4);
  const factMentions = originalWords.filter(w => {
    const clean = w.replace(/[.,!?;:()"']/g, "").toLowerCase();
    if (clean.length < 4) return false;
    // Skip common words
    const skip = ["который", "которая", "которые", "потому", "чтобы", "себя", "сейчас", "сегодня", "может", "очень", "просто", "тогда", "всегда", "никогда", "потом"];
    if (skip.includes(clean)) return false;
    return userReport.toLowerCase().includes(clean);
  }).length;
  if (factMentions < 2) violations.push(`too few concrete facts (${factMentions} mentions of user's words)`);

  // Check for generic list style
  const genericPhrases = [
    "стресс", "конфликт", "болезнь", "веществ", "кофеин", "никотин",
    "бады", "умеренн", "здоров",
  ];
  const genericCount = genericPhrases.filter(p =>
    new RegExp(p, "iu").test(userReport)
  ).length;
  if (genericCount >= 4) violations.push(`generic checklist style (${genericCount} universal factors)`);

  // Check главное событие is mentioned
  if (originalText) {
    const mainTopicWords = originalText
      .split(/\s+/)
      .filter(w => w.length > 5)
      .slice(0, 20);
    const mentioned = mainTopicWords.filter(w => {
      const clean = w.replace(/[.,!?;:()"']/g, "").toLowerCase();
      if (clean.length < 4) return false;
      return userReport.toLowerCase().includes(clean);
    }).length;
    if (mentioned < 1) violations.push("главное событие из обращения не упомянуто");
  }

  return { pass: violations.length === 0, violations };
}

async function repairUserReport(rawResponse, userReport, doctorReport, violations, originalText, convHistory) {
  const repairPrompt = `Ты — редактор отчётов для психологического сервиса "Точка опоры".

Исходный диалог:
${convHistory || ""}

Исходное описание пользователя:
${originalText || ""}

Предыдущий user_report (нуждается в исправлении):
${userReport}

Нарушенные правила:
${violations.join("\n")}

Задача: перепиши ТОЛЬКО user_report. doctor_report не меняй.
Строго соблюдай:
1. 6 разделов: что происходит, что услышали, что не пропустить, на что опереться, что может помочь, следующий шаг.
2. Живой человеческий язык, без канцелярита.
3. Конкретные факты из диалога (минимум 2-3).
4. Запрещено: "эмоциональная сфера", "нейрокогнитивная сфера", "модифицирующие факторы", "травматический контекст", "выявлены сигналы", "важно оценить", "требуется уточнение".
5. Обращение к человеку ("вы", "вам", "ваш").

Верни JSON:
{ "user_report": "исправленный текст" }`;

  try {
    const result = await runTextAnalysis({
      systemPrompt: "Ты — редактор отчётов для психологического сервиса. Исправляй user_report согласно инструкции.",
      userPrompt: repairPrompt,
      model: process.env.AI_MODEL_TRIAGE || "gpt-4.1-mini",
      fallbackModel: process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini",
      reasoningEffort: "low",
    });
    const repaired = result.parsed?.user_report;
    if (repaired && repaired.length > 50) {
      const recheck = checkReportQuality(repaired, originalText, convHistory);
      if (recheck.pass) return { repaired, repairAttempted: true, repairSucceeded: true, repairFailed: false };
    }
    return { repaired: null, repairAttempted: true, repairSucceeded: false, repairFailed: true };
  } catch {
    return { repaired: null, repairAttempted: true, repairSucceeded: false, repairFailed: true };
  }
}

const VALID_SPECIALIST_TYPES = [
  "psychologist", "clinical_psychologist", "psychotherapist",
  "psychiatrist", "general_physician", "neurologist",
  "emergency_service", "crisis_service",
];

const VALID_REASONS = [
  "severe_distress", "persistent_symptoms", "sleep_disruption",
  "functional_impairment", "somatic_symptoms", "traumatic_uncertainty",
  "grief", "substance_use", "hopelessness", "social_isolation",
  "suicidal_thoughts", "self_harm_risk", "psychosis_red_flags",
  "mania_red_flags", "risk_to_others",
];

function deriveMinimumCareLevel({
  riskLevel, suicidalIntent, suicidalPlan, selfHarmRisk,
  psychosisRedFlags, maniaRedFlags, riskToOthers,
  functionalImpairment, severeDistress, somaticSymptoms,
  traumaticUncertainty, sleepDisruption, substanceUse,
}) {
  if (suicidalIntent || suicidalPlan || psychosisRedFlags || maniaRedFlags || riskToOthers || riskLevel === "high") {
    return "urgent_help";
  }
  if (selfHarmRisk || severeDistress || functionalImpairment || somaticSymptoms || traumaticUncertainty || sleepDisruption || substanceUse) {
    return "professional_contact";
  }
  return "self_support";
}

function checkCareRecommendation(cr, conversationText) {
  const violations = [];
  if (!cr || !cr.level) {
    violations.push("care_recommendation missing or has no level");
    return { pass: false, violations };
  }

  const level = cr.level;
  const timeframe = cr.timeframe;

  // If risk is high, level cannot be self_support — handled by backend override
  // Check timeframe consistency
  if (level === "urgent_help" && timeframe !== "today") {
    violations.push("urgent_help must have timeframe 'today'");
  }
  if (level === "professional_contact" && timeframe !== "within_days" && timeframe !== "today") {
    violations.push("professional_contact must have timeframe 'within_days' or 'today'");
  }

  // specialist_types must be valid
  if (Array.isArray(cr.specialist_types)) {
    for (const st of cr.specialist_types) {
      if (!VALID_SPECIALIST_TYPES.includes(st)) {
        violations.push(`invalid specialist_type: ${st}`);
      }
    }
  }

  // reasons must be valid
  if (Array.isArray(cr.reasons)) {
    for (const r of cr.reasons) {
      if (!VALID_REASONS.includes(r)) {
        violations.push(`invalid reason: ${r}`);
      }
    }
  }

  // urgent_triggers only for urgent_help
  if (cr.urgent_triggers?.length && level !== "urgent_help") {
    violations.push("urgent_triggers only allowed for urgent_help level");
  }

  // If somatic symptoms present, must include general_physician or emergency_service
  if (cr.reasons?.includes("somatic_symptoms")) {
    if (!cr.specialist_types?.some(st => st === "general_physician" || st === "emergency_service")) {
      violations.push("somatic_symptoms require general_physician or emergency_service in specialist_types");
    }
  }

  // Traumatic uncertainty + sleep disruption → professional_contact minimum
  if (cr.reasons?.includes("traumatic_uncertainty") && cr.reasons?.includes("sleep_disruption")) {
    if (level === "self_support") {
      violations.push("traumatic_uncertainty + sleep_disruption require at least professional_contact");
    }
  }

  return { pass: violations.length === 0, violations };
}

async function repairCareRecommendation(originalText, historyText, cr, violations) {
  const repairPrompt = `Ты — редактор маршрутизации помощи для психологического сервиса "Точка опоры".

Исходный диалог:
${historyText || ""}

Исходное описание пользователя:
${originalText || ""}

Текущая care_recommendation (нуждается в исправлении):
${JSON.stringify(cr, null, 2)}

Нарушенные правила:
${violations.join("\n")}

Задача: исправь ТОЛЬКО care_recommendation.

Правила:
- level: self_support | professional_contact | urgent_help
- timeframe: today | within_days | within_weeks | routine
- specialist_types: ${VALID_SPECIALIST_TYPES.join(", ")}
- reasons: ${VALID_REASONS.join(", ")}

Верни JSON:
{ "care_recommendation": { "level": "...", "timeframe": "...", "specialist_types": [], "reasons": [], "interim_support": [], "urgent_triggers": [] } }`;

  try {
    const result = await runTextAnalysis({
      systemPrompt: "Ты — редактор маршрутизации помощи. Исправляй care_recommendation согласно инструкции.",
      userPrompt: repairPrompt,
      model: process.env.AI_MODEL_TRIAGE || "gpt-4.1-mini",
      fallbackModel: process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini",
      reasoningEffort: "low",
    });
    const repaired = result.parsed?.care_recommendation;
    if (repaired && repaired.level) {
      const recheck = checkCareRecommendation(repaired, historyText);
      if (recheck.pass) return { repaired, repairAttempted: true, repairSucceeded: true };
    }
    return { repaired: null, repairAttempted: true, repairSucceeded: false };
  } catch {
    return { repaired: null, repairAttempted: true, repairSucceeded: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, answers, mode, conversationHistory: rawHistory, depth = 0, isContinuation = false, previousPatientReport = "", previousDoctorReport = "", homeTasks = "", resourceFactors = "", supportPlan, voiceObservations } = req.body || {};

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Опишите состояние подробнее" });
  }

  const MIN_DEPTH = 3;
  const MAX_DEPTH = 8;

  const fallbackQuestions = [
    "Было ли в последние месяцы важное событие, потеря, конфликт, болезнь, переезд, военные события, исчезновение или смерть близкого человека, которое могло повлиять на ваше состояние?",
    "Началось ли состояние после конкретного события или постепенно, без понятной причины?",
    "Были ли алкоголь, вещества, новые лекарства, отмена препаратов, гормональные или соматические проблемы, которые совпали с ухудшением?",
    "Как давно вы замечаете это состояние?",
    "Насколько это влияет на сон, работу, учебу или отношения?",
    "Бывали ли мысли, что жить не хочется или причинить себе вред?",
    "Бывали ли ощущения, что вы слышите или замечаете то, чего не замечают другие?",
    "Бывали ли периоды, когда вы почти не спали, но чувствовали необычный прилив энергии?",
  ];

  const fallbackFinal = `===USER_REPORT===

Спасибо, что поделились.

Ваш разговор сохранён. Нам не удалось полностью обработать его сейчас, но вы сможете вернуться к нему позже по коду доступа.

Если вам нужно поговорить со специалистом — обратитесь к психологу или психотерапевту очно или онлайн.

Если состояние ухудшается или появляются мысли причинить себе вред — звоните 112 или 103. Не оставайтесь одни.

===DOCTOR_REPORT===

AI-assisted summary не сформирован из-за технической ошибки. Диалог сохранён для ручного разбора.`;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      type: "questions",
      questions: fallbackQuestions,
      model_used: "none",
      fallback_used: true,
    });
  }

  const convHistory = Array.isArray(rawHistory) ? rawHistory : [];

  let historyText = "";
  if (convHistory.length > 0) {
    historyText = convHistory
      .map((entry) => {
        if (entry.role === "user") {
          return `Пользователь: ${entry.content || JSON.stringify(entry.answers)}`;
        }
        if (entry.role === "assistant") {
          return `AI: заданы вопросы — ${(entry.questions || []).join("; ")}`;
        }
        return "";
      })
      .join("\n\n");
  }

  const currentAnswersText =
    answers && typeof answers === "object"
      ? Object.entries(answers)
          .map(([key, val]) => `Вопрос ${parseInt(key) + 1}: ${val || "нет ответа"}`)
          .join("\n")
      : "";

  const antiRepeatBlock = buildAntiRepeatBlock(convHistory);

  const systemPrompt = `Ты — AI-ассистент первичного mental health triage (выявление сигналов). Твоя задача — выявление сигналов, а не постановка диагноза.

Ты НЕ ставишь диагноз.
Ты определяешь:
- сигналы (эмоциональные, когнитивные, поведенческие)
- маркеры риска
- уровень сроности
- необходимость передачи специалисту

Добавлен Patient Support Layer.
Система должна не только выявлять сигналы, но и помогать пациенту пережить ближайшие часы/дни безопасным способом.
Всегда ищи:
- ресурсы пациента
- социальную поддержку
- действия, которые могут немного стабилизировать состояние
- возможность обратиться к близкому
- план до следующего контакта

Нельзя:
- обещать излечение
- заменять врача
- давать категоричные советы
- назначать лекарства
- давать опасные рекомендации

Можно:
- предложить дневник состояния
- дневник сна
- наблюдение за триггерами
- ограничить алкоголь/стимуляторы
- обратиться к близкому человеку
- снизить нагрузку
- сделать короткую прогулку или план физической активности
- подготовить список жалоб для специалиста
- назначить следующий анонимный разговор

При достаточной глубине диалога необходимо выяснять:
1. Что человек уже делает для улучшения состояния.
2. Какие немедикаментозные способы поддержки использует.
3. Какие лекарства принимает.
4. Были ли изменения препаратов.
5. Использует ли алкоголь, никотин, стимуляторы, БАДы, средства для сна.

Система не назначает лечение и не рекомендует препараты.
Система не должна рекомендовать: препараты, дозировки, схемы лечения, БАДы, растительные седативные средства.
Система может только фиксировать факт их использования и предлагать обсудить вопросы лечения со специалистом.

Система может обсуждать только:
- режим сна
- физическую активность
- снижение алкоголя
- снижение стимуляторов
- дневник состояния
- дневник сна
- социальную поддержку
- обращение к близким
- снижение перегрузки
- наблюдение за триггерами
- подготовку к консультации специалиста

Используй русские формулировки:
- признаки тревоги
- признаки, связанные с травмой
- маркеры, напоминающие СДВГ
- маниакальные красные флаги
- психотические красные флаги
- маркеры исполнительной дисфункции
- сигналы эмоциональной нестабильности
- модифицирующие факторы
- временная динамика
- ресурсы и поддержка

Запрещено (даже во внутренних рассуждениях):
- "у вас ПТСР"
- "у вас биполярное расстройство"
- "у вас шизофрения"
- "это подтверждает СДВГ"
- "диагноз"
- "пациент страдает"

Сферы выявления сигналов (внутреннее отслеживание):
- Эмоциональная сфера (Affective / emotional)
- Травматический контекст (Trauma)
- Нейрокогнитивная сфера (Neurocognitive)
- Сфера мышления и восприятия (Thought / perception)
- Сфера нестабильности настроения (Mood instability)
- Сфера риска (Risk)
- Модифицирующие факторы (Contextual modifiers)
- Временная динамика (Temporal analysis)
- Функциональные нарушения (Functional impairment)
- Ресурсы и поддержка (Resource & Support)

Правила:
- не ставь диагноз
- не назначай лекарства
- не используй "у вас психоз/шизофрения/БАР"
- используй "обнаружены сигналы", "важно уточнить", "рекомендуется обсудить со специалистом"
- если риск самоповреждения — срочная помощь 112/103
- не усиливай тревогу
- отвечай только на русском языке, без смешивания с английским
- если пользователь явно обозначил психологический триггер (расставание, утрата, конфликт) — не спрашивай про наследственные психические заболевания, фокусируйся на причинах и контексте триггера
- всегда проверяй соматические факторы: перенесённый ковид, интоксикации, хирургические операции, отмена/смена препаратов
- если обозначена главная проблема — выясни её психологические причины и обстоятельства
- выясни события ближайшего прошлого: болезни, интоксикации, травмы, перегрузки
- отчет для специалиста пиши на профессиональном медицинском русском языке
- не превращать это в терапию, не обещать улучшение, не заменять врача
- если есть суицидальные мысли, план или потеря контроля — основная рекомендация: срочная помощь и не оставаться одному

Речевой стиль "Точки опоры": живой язык без канцелярита.

1. Всегда соблюдай речевой стиль: живой язык без канцелярита. Пациенту отвечай просто, тепло, короткими фразами. Не используй тяжёлые служебные обороты, пассивные конструкции и медицинский жаргон там, где можно сказать человечески.

2. Уточняющие вопросы должны звучать как живой разговор, а не анкета.
   Плохо: "Укажите длительность состояния."
   Лучше: "Как давно это началось?"
   Плохо: "Опишите провоцирующий фактор."
   Лучше: "Было ли событие, после которого вам стало хуже?"

3. Вкладка "Для вас" должна быть написана живым человеческим языком.
   Запрещено: "на основании предоставленной информации", "имеются признаки", "наблюдается", "данное состояние", "осуществить обращение", "проведение анализа", "симптоматика", "выявлены признаки" без мягкой переформулировки.
   Предпочтительно: "по вашим словам видно", "похоже, сейчас...", "вам стало...", "лучше поговорить со специалистом", "с этим не стоит оставаться одному", "давайте разберём по шагам".

4. Тексты практик Support Toolkit должны быть простыми, спокойными и не обещать результата.
   Не писать: "эта практика поможет", "это снизит тревогу", "это восстановит сон".
   Писать: "можно попробовать", "если вам подходит", "остановитесь, если становится хуже", "это не лечение и не замена специалиста".

5. В кризисном окне и high risk ответе говорить ясно и прямо, но без паники.
   Пример: "Если есть риск причинить вред себе или другому человеку — звоните 112 или 103 и не оставайтесь одни."
   Не писать: "Осуществите обращение за экстренной медицинской помощью."

6. Перед тем как ответить пациенту, перепиши фразы, которые звучат как справка или медицинский протокол, на живой язык.

Полный речевой справочник: prompts/language-style.md.

--- ПРАВИЛА ФОРМИРОВАНИЯ ОТЧЁТА ДЛЯ КЛИЕНТА (user_report) ---

Отчёт для клиента — это не медицинская справка и не перечень доменов.
Это короткое, узнаваемое продолжение состоявшегося разговора.
Человек должен увидеть в тексте свою ситуацию и понять, что его услышали.
Не повторяй внутреннюю классификацию системы в user_report.
Не перечисляй все возможные причины и факторы — выбирай только то, что связано с данным разговором.

Запрещено использовать в user_report (допустимо только в doctor_report):
- эмоциональная сфера / нейрокогнитивная сфера
- модифицирующие факторы / травматический контекст
- домены / маркеры / гипотезы
- психопатологическая симптоматика
- "требуется уточнение" / "важно оценить" / "выявлены сигналы"
- ресурсный потенциал
- "триггеры" как универсальное слово без конкретики

Структура user_report при финальном ответе:

1. Что с вами сейчас происходит — 2-4 предложения. Назвать главное событие и его влияние.

2. Что мы услышали в разговоре — только конкретные проявления из диалога. Никаких универсальных списков.

3. Что важно не пропустить — коротко: непосредственные риски, телесные симптомы (требующие врача), сон, алкоголь или препараты — только если обсуждалось. Не писать список всех возможных факторов одновременно.

4. На что можно опереться — реальные ресурсы из разговора. Если ресурс не выявлен: "В разговоре пока не удалось найти человека или место, на которое вы можете опереться". Не писать "важно оценить социальную поддержку".

5. Что может немного помочь сегодня — максимум 3 конкретных выполнимых действия. Без общих фраз: "снизить нагрузку", "стабилизировать сон", "избегать стресса". Конкретно: "выбрать одного человека и написать ему", "сделать паузу в проверке новостей", "поесть или выпить воды", "записать симптомы", "договориться о медосмотре".

6. Следующий шаг — один понятный шаг. Например: "В следующем разговоре стоит подробнее обсудить сон, телесные симптомы и то, кто может быть рядом в ближайшие дни."

Обязательное заземление в фактах:
Перед формированием user_report выдели внутренне:
1) главное событие; 2) главную трудность сейчас; 3) наиболее значимые проявления; 4) имеющиеся ресурсы; 5) ближайший реалистичный шаг.
Не выводи этот служебный анализ отдельно, но обязательно используй его в тексте.
Каждый user_report должен опираться минимум на 2-3 конкретных факта из разговора.

Неопределённая утрата (ambiguous loss):
Различай: подтверждённая смерть vs расставание vs человек пропал без вести vs потеряна связь, судьба неизвестна.
Если судьба близкого неизвестна:
- не пиши так, как будто смерть подтверждена;
- не называй состояние завершённым горем;
- используй: "мучительная неопределённость", "неопределённая утрата" — с пояснением;
- признавай, что человеку трудно одновременно надеяться и готовиться к плохим новостям;
- не предлагай "принять утрату", если факт утраты не подтверждён.

Связь переживаний и тела:
Если в разговоре есть соматические жалобы:
- назови их конкретно (только если клиент сообщал);
- объясни, что длительное напряжение может усиливать телесные ощущения;
- не утверждай, что симптомы вызваны только тревогой;
- укажи, что медицинские причины должны быть исключены;
- при опасных симптомах — ясная рекомендация обратиться за неотложной помощью.
Не используй "нейрокогнитивная сфера" для телесных жалоб.

Запрет на отчёт-анкету:
user_report не должен выглядеть как перечень вопросов, которые врач ещё не задал.
Вместо "важно оценить социальную поддержку" → "Вы рассказали, что можете обратиться к сестре" или "Пока неясно, есть ли рядом человек, которому вы можете позвонить".
Вместо "требуется уточнение по препаратам" → "Мы пока не обсудили лекарства и средства, которые вы принимаете. Это стоит уточнить в следующем разговоре".

Стиль user_report (Нора Галь):
- конкретный глагол вместо отглагольного существительного;
- короткие предложения;
- меньше пассивных конструкций;
- не использовать канцелярские связки;
- обращаться к человеку, а не описывать его как объект анализа;
- один абзац — одна мысль.

--- КОНЕЦ ПРАВИЛ ОТЧЁТА ДЛЯ КЛИЕНТА ---

Голосовые признаки (voice_observations):
Если переданы voice_observations, используй их только как дополнительный
неспецифический источник информации.

Не ставь диагноз по голосовым признакам.

Разделяй:
1. наблюдаемую особенность речи;
2. возможные альтернативные объяснения;
3. вопрос, который специалисту следует уточнить.

Не усиливай уровень риска только на основании голоса.

Голосовые признаки могут повысить приоритет уточняющего вопроса,
но не могут самостоятельно служить основанием для вывода о депрессии,
мании, психозе, интоксикации, суицидальном риске или неискренности.

MIN_DEPTH = ${MIN_DEPTH}. Не завершай диалог до минимальной глубины ${MIN_DEPTH}, если нет низкой сложности, низкого риска и ясного объяснения.
MAX_DEPTH = ${MAX_DEPTH}. После максимальной глубины ${MAX_DEPTH} заверши, указав ограничения.

Модель уверенности:
- Высокая: множество сигналов в сфере, согласованы между раундами
- Средняя: некоторые сигналы присутствуют, частичные данные
- Низкая: мало сигналов, противоречивые данные — рекомендуется дальнейшая оценка

Продолжение сессии (isContinuation=true):
Если это продолжение предыдущей сессии, AI НЕ начинает новый опрос.
AI кратко напоминает прошлый разговор и задает вопросы о динамике состояния:
- что изменилось с прошлого раза?
- что помогло?
- что ухудшилось?
- удалось ли выполнить рекомендации?
- какие появились новые жалобы или сигналы?
Не повторяй вопросы, которые уже были заданы в предыдущей сессии.
Не запрашивай заново то, что уже выяснено.
Фокус — на changes, progress, new signals.

Если в support_plan есть selected_practices, спросить:
- Удалось ли попробовать выбранную практику?
- Что изменилось после неё?
- Стало легче, тяжелее или без изменений?
- Что оказалось неудобным или не подошло?
- Заполняли ли дневник состояния?

Если выбран дневник:
- спросить, удалось ли вести дневник 1–3 дня;
- какие симптомы усиливались;
- что немного помогало.`;

  let userPrompt = "";

  if (isContinuation && depth === 0) {
    userPrompt = `Это продолжение предыдущей сессии.

Исходное описание пользователя (из прошлой сессии):
${text}

Новое сообщение пользователя (в этой сессии):
${
  currentAnswersText
    ? `Ответы на вопросы из этой сессии:\n${currentAnswersText}`
    : "(пользователь ещё не ответил на вопросы этого раунда)"
}

Отчёт для пациента из прошлой сессии:
${previousPatientReport}

Отчёт для специалиста из прошлой сессии:
${previousDoctorReport}

Рекомендации до следующей встречи:
${homeTasks}

Ресурсные факторы:
${resourceFactors}

${
  supportPlan?.selected_practices?.length
    ? `Выбранные практики из прошлой сессии:\n${supportPlan.selected_practices.map((p) => `- ${p.title}`).join("\n")}\n\n`
    : ""
}${supportPlan?.diary_requested ? "Был предложен дневник состояния на 3 дня.\n\n" : ""}Твоя задача: это follow-up сессия.
НЕ начинай новый опрос с нуля.
Кратко напомни прошлый разговор и спроси о динамике:
- что изменилось?
- что помогло?
- что ухудшилось?
- удалось ли выполнить рекомендации?
- есть ли новые жалобы или сигналы?${
  supportPlan?.selected_practices?.length
    ? "\n- удалось ли попробовать выбранные практики?\n- что изменилось после практик?"
    : ""
}${supportPlan?.diary_requested ? "\n- удалось ли вести дневник?\n- какие симптомы усилились?\n- что немного помогало?" : ""}

Задай 3-5 вопросов про динамику.

Верни JSON:
{ "type": "questions", "questions": ["вопрос 1", "вопрос 2", "вопрос 3", "вопрос 4"] }`;
  } else if (!convHistory.length && depth === 0 && !isContinuation) {
    userPrompt = `Это первый раунд диалога.

Исходное описание пользователя:
${text}

Определи, какие сферы выявления сигналов активны.
Задай 4-6 уточняющих вопросов для уточнения сигналов.
Первые 2-3 вопроса — про контекст и возможный триггер (травматический контекст, модифицирующие факторы).
Если основные риски уже частично проверены, добавь 1-3 вопроса из Resource & Support Domain:
- Кто сейчас может вас поддержать?
- Есть ли человек, которому можно написать или позвонить сегодня?
- Что помогает вам хотя бы немного почувствовать себя спокойнее?
- Что раньше помогало переживать трудные периоды?
- Есть ли возможность в ближайшие 24 часа снизить нагрузку?
Вопросы должны быть адаптивными к тексту пользователя, а не шаблонными.

Верни JSON:
{ "type": "questions", "questions": ["вопрос 1", "вопрос 2", "вопрос 3", "вопрос 4"] }`;
  } else {
    const enough = depth >= MIN_DEPTH;
    const maxed = depth >= MAX_DEPTH;

    let decisionRule = "";
    if (maxed) {
      decisionRule = "Ты достиг максимальной глубины. ОБЯЗАН завершить диалог и вернуть финальный отчет, указав ограничения.";
    } else if (enough) {
      decisionRule = `Ты достиг минимальной глубины. Оцени, достаточно ли данных для предварительного заключения.
Если есть конкурирующие гипотезы или не хватает критической информации — продолжай уточнение.
Если данных достаточно — заверши и верни отчет.`;
    } else {
      decisionRule = `Ты еще не достиг минимальной глубины. Продолжай уточнение. Верни только вопросы.`;
    }

    const voiceBlock = Array.isArray(voiceObservations) && voiceObservations.length > 0
      ? `\nГолосовые признаки (экспериментальный анализ):\n${voiceObservations.map((vo) => {
          const a = vo.analysis || {};
          return `- Сообщение ${vo.messageId || vo.round || ""}: ${a.summary || "анализ недоступен"}`;
        }).join("\n")}\n`
      : (typeof voiceObservations === "object" && voiceObservations?.summary
          ? `\nГолосовые признаки (экспериментальный анализ):\n${voiceObservations.summary}\n`
          : "");

    userPrompt = `Текущий раунд: ${depth + 1}.
${decisionRule}

История диалога:
${historyText}

${
  currentAnswersText
    ? `Ответы на предыдущие вопросы:\n${currentAnswersText}\n`
    : ""
}${voiceBlock}Исходное описание пользователя: ${text}

${
  isContinuation && previousPatientReport
    ? `Отчёт для пациента из прошлой сессии:\n${previousPatientReport}\n\n`
    : ""
}${
  isContinuation && previousDoctorReport
    ? `Отчёт для специалиста из прошлой сессии:\n${previousDoctorReport}\n\n`
    : ""
}

Оцени по сферам выявления:
- какие сферы активны
- какие сигналы подтверждены
- какие сферы требуют уточнения
- какой уровень уверенности по каждой сфере

Если это follow-up и в этом раунде нужно продолжить, а не завершить — верни вопросы даже если данных уже достаточно.
Фокус на динамике изменений, регрессах, новых сигналах.

Если основные риски уже частично проверены, добавь 1-3 вопроса из Resource & Support Domain:
- Кто сейчас может вас поддержать?
- Есть ли человек, которому можно написать или позвонить сегодня?
- Что помогает вам хотя бы немного почувствовать себя спокойнее?
- Что раньше помогало переживать трудные периоды?
- Есть ли возможность в ближайшие 24 часа снизить нагрузку?

${antiRepeatBlock}

Если нужно больше информации — верни JSON:
{ "type": "questions", "questions": ["вопрос 1", "вопрос 2", ...] }

Если данных достаточно для предварительного заключения — верни JSON. Строго соблюдай структуру user_report из правил выше (6 разделов: что происходит, что услышали, что не пропустить, на что опереться, что может помочь, следующий шаг). Никаких "эмоциональная сфера", "модифицирующие факторы" и т.д. в user_report. Используй конкретные факты диалога. Пиши живым человеческим языком.

Обязательно включи поле care_recommendation с маршрутизацией помощи:
- level: self_support | professional_contact | urgent_help
- timeframe: today | within_days | within_weeks | routine
- specialist_types: один или несколько из psychologist, clinical_psychologist, psychotherapist, psychiatrist, general_physician, neurologist, emergency_service, crisis_service
- reasons: один или несколько из severe_distress, persistent_symptoms, sleep_disruption, functional_impairment, somatic_symptoms, traumatic_uncertainty, grief, substance_use, hopelessness, social_isolation, suicidal_thoughts, self_harm_risk, psychosis_red_flags, mania_red_flags, risk_to_others
- interim_support: максимум 3 временных шага до контакта со специалистом (строками)
- urgent_triggers: только для urgent_help, список конкретных триггеров

Логика выбора:
- SELF_SUPPORT: нет риска, лёгкое/умеренное состояние, функционирование сохранено, симптомы кратковременные, есть поддержка, нет злоупотребления
- PROFESSIONAL_CONTACT: состояние заметно мешает сну/работе/питанию, симптомы сохраняются неделями, усиливаются, сильная тревога, неопределённая утрата, травматический контекст, пугающие телесные симптомы, безысходность, изоляция, алкоголь/лекарства для совладания, требуется мед.оценка соматических жалоб
- URGENT_HELP: суицидальное намерение/план/попытка, психоз, мания с опасным поведением, угроза другим, невозможность оставаться в безопасности, опасные телесные симптомы

В разделе 6 user_report "Следующий шаг" обязательно используй маршрутизацию из care_recommendation level:
- self_support: "Сейчас можно начать с нескольких простых шагов и поддержки близких. Если состояние не начнёт уменьшаться в ближайшие дни или станет сильнее, стоит обратиться к специалисту."
- professional_contact: "Я бы рекомендовал в ближайшие дни связаться со специалистом." + конкретный тип специалиста, объяснение почему, и если есть телесные симптомы — отдельно рекомендация врача
- urgent_help: "Здесь нужна срочная помощь сегодня. Пожалуйста, позвоните 112, обратитесь в ближайшее приёмное отделение или попросите близкого помочь вам добраться до помощи. Не оставайтесь сейчас один."

Добавь в doctor_report раздел "Маршрутизация:" с care level, сроком, типом специалиста, причинами и interim_support.

{ "type": "final", "user_report": "1. Что с вами сейчас происходит\n\n[2-4 предложения о главном событии и его влиянии]\n\n2. Что мы услышали в разговоре\n\n[конкретные проявления из диалога, 2-3 факта]\n\n3. Что важно не пропустить\n\n[коротко: риски, телесные симптомы, сон, алкоголь — только из диалога]\n\n4. На что можно опереться\n\n[реальные ресурсы из разговора или \"пока не удалось найти\"]\n\n5. Что может немного помочь сегодня\n\n[максимум 3 конкретных действия, связанных с ситуацией]\n\n6. Следующий шаг\n\n[один понятный шаг с маршрутизацией]", "doctor_report": "Выявленные сигналы: [сферы]\nМаркеры риска: [риски]\nМодифицирующие факторы: [контекст]\nВременная динамика: [динамика]\nФункциональные нарушения: [нарушения]\nУверенность: [уровень]\nСрочность: [срочность]\nРекомендации: [рекомендация]\nДинамика с прошлой сессии: [изменения]\nРесурсы и поддержка пациента:\n- социальная поддержка:\n- защитные факторы:\n- готовность обращаться за помощью:\n- план до следующего контакта:\n- возможные барьеры:\nТекущие препараты и способы самопомощи:\n- лекарства:\n- безрецептурные средства:\n- алкоголь:\n- кофеин:\n- никотин:\n- БАДы:\n- немедикаментозные стратегии:\nМаршрутизация:\n- уровень: [self_support | professional_contact | urgent_help]\n- срок: [today | within_days | within_weeks | routine]\n- специалист: [тип]\n- причины: [причины]\n- временная опора до консультации: [interim_support]", "care_recommendation": { "level": "professional_contact|self_support|urgent_help", "timeframe": "within_days|today|within_weeks|routine", "specialist_types": ["clinical_psychologist", "psychotherapist"], "reasons": ["severe_distress", "sleep_disruption"], "interim_support": ["шаг 1", "шаг 2", "шаг 3"], "urgent_triggers": [] } }

ВАЖНО: Не завершай слишком рано. Если есть конкурирующие гипотезы или не хватает информации — продолжай уточнение.`;

    if (isContinuation && depth === 0) {
      userPrompt += `\n\nВАЖНО: Это follow-up сессия. Не завершай на первом раунде, если данные неполные.`;
    }
  }

  const MODEL_TRIAGE = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
  const MODEL_FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
  const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

  try {
    const result = await runTextAnalysis({
      systemPrompt,
      userPrompt,
      model: MODEL_TRIAGE,
      fallbackModel: MODEL_FALLBACK,
      reasoningEffort: REASONING_EFFORT,
    });

    const raw = result.raw;
    const parsed = result.parsed;
    const modelUsed = result.model_used;
    const fallbackUsed = result.fallback_used;

    if (!raw) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: modelUsed, fallback_used: fallbackUsed });
      }
      return res.status(200).json({ type: "final", user_report: fallbackFinal, doctor_report: "", model_used: modelUsed, fallback_used: fallbackUsed });
    }

    if (!parsed) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: modelUsed, fallback_used: fallbackUsed });
      }
      return res.status(200).json({ type: "final", user_report: raw, doctor_report: "", model_used: modelUsed, fallback_used: fallbackUsed });
    }

    if (parsed.type === "questions" && Array.isArray(parsed.questions)) {
      return res.status(200).json({
        type: "questions",
        questions: parsed.questions.filter(Boolean).slice(0, 7),
        model_used: modelUsed,
        fallback_used: fallbackUsed,
      });
    }

    let userPart = parsed.user_report || "";
    const doctorPart = parsed.doctor_report || "";
    let careRec = parsed.care_recommendation || null;

    // Quality check and repair for user_report
    let qualityCheck = { pass: true, violations: [] };
    let repairInfo = { repairAttempted: false };

    if (userPart) {
      qualityCheck = checkReportQuality(userPart, text, historyText);
      if (!qualityCheck.pass) {
        console.log("User report quality check failed:", qualityCheck.violations.join("; "));
        const repairResult = await repairUserReport(
          raw, userPart, doctorPart, qualityCheck.violations, text, historyText
        );
        repairInfo = repairResult;
        if (repairResult.repaired) {
          userPart = repairResult.repaired;
        }
      }
    }

    // --- Care recommendation: backend minimum level override ---
    // Detect signals from conversation
    const fullConversation = (historyText || "") + " " + (text || "");
    const hasSuicidalIntent = /суицидальн|план.*покончить|таблетк.*собрал|прощальн.*письм/i.test(fullConversation);
    const hasSuicidalPlan = /подробн.*план|знаю.*как.*сделаю|когда.*сделаю/i.test(fullConversation);
    const hasPsychosis = /голос|слыш.*голос|вид.*то.*не.*вид|параной|след.*за.*мной|управля.*мысл/i.test(fullConversation);
    const hasMania = /не.*спал.*дня|энерги.*слишком|бешен.*план|потратил.*все.*деньг|необычн.*сил/i.test(fullConversation);
    const hasRiskToOthers = /причин.*вред.*друг|убь.*кого|опасен.*для.*окруж/i.test(fullConversation);
    const hasSevereDistress = /больше.*не.*могу|не.*выдерж|сдавать|край.*тяжел/i.test(fullConversation);
    const hasFunctionalImpairment = /не.*работ|увол|не.*учёб|леж.*цел.*день|не.*вста|не.*выхож/i.test(fullConversation);
    const hasSomaticSymptoms = /боль.*в.*груд|сердцебиен|одыш|обморок|головокружен|сдавил.*виск/i.test(fullConversation);
    const hasTraumaticUncertainty = /пропал.*без.*вест|нет.*информац|судьб.*неизвест|не.*знаю.*жив|потерян.*связь/i.test(fullConversation);
    const hasSleepDisruption = /не.*спл|просыпа.*паник|бессонн|спл.*3.*час|спл.*4.*час/i.test(fullConversation);
    const hasSubstanceUse = /пил.*бутылк|алкоголь.*помога|выпива|опохмел|трясутся.*рук.*по.*утр/i.test(fullConversation);
    const hasSelfHarm = /реж.*себ|самоповреж|причин.*себе.*вред/i.test(fullConversation);

    const minimumLevel = deriveMinimumCareLevel({
      riskLevel: null,
      suicidalIntent: hasSuicidalIntent,
      suicidalPlan: hasSuicidalPlan,
      selfHarmRisk: hasSelfHarm,
      psychosisRedFlags: hasPsychosis,
      maniaRedFlags: hasMania,
      riskToOthers: hasRiskToOthers,
      functionalImpairment: hasFunctionalImpairment,
      severeDistress: hasSevereDistress,
      somaticSymptoms: hasSomaticSymptoms,
      traumaticUncertainty: hasTraumaticUncertainty,
      sleepDisruption: hasSleepDisruption,
      substanceUse: hasSubstanceUse,
    });

    // Validate and enforce care_recommendation
    let careRepairInfo = { repairAttempted: false };
    let careCheck = { pass: true, violations: [] };

    if (careRec) {
      careCheck = checkCareRecommendation(careRec, fullConversation);
      // Backend override: model cannot set below minimum
      const levelOrder = { "self_support": 0, "professional_contact": 1, "urgent_help": 2 };
      if (levelOrder[careRec.level] < levelOrder[minimumLevel]) {
        careRec.level = minimumLevel;
        careCheck.violations.push(`overridden to ${minimumLevel} (model set lower)`);
        careCheck.pass = careCheck.violations.length === 0;
      }
      // Ensure timeframe consistency
      if (careRec.level === "urgent_help" && careRec.timeframe !== "today") {
        careRec.timeframe = "today";
      }
      if (careRec.level === "professional_contact" && careRec.timeframe !== "within_days" && careRec.timeframe !== "today") {
        careRec.timeframe = "within_days";
      }
      if (!careCheck.pass) {
        console.log("Care recommendation check failed:", careCheck.violations.join("; "));
        const repairResult = await repairCareRecommendation(text, historyText, careRec, careCheck.violations);
        careRepairInfo = repairResult;
        if (repairResult.repaired) {
          careRec = repairResult.repaired;
          const recheck = checkCareRecommendation(careRec, fullConversation);
          if (!recheck.pass) {
            careCheck = recheck;
          }
        }
      }
    }

    // If no careRec from model or repair failed, derive from minimum level
    if (!careRec) {
      careRec = {
        level: minimumLevel,
        timeframe: minimumLevel === "urgent_help" ? "today" : minimumLevel === "professional_contact" ? "within_days" : "within_weeks",
        specialist_types: [],
        reasons: [],
        interim_support: [],
        urgent_triggers: minimumLevel === "urgent_help" ? ["see_recommendations"] : [],
      };
      // Populate based on detected signals
      if (hasSuicidalIntent || hasSuicidalPlan) { careRec.reasons.push("suicidal_thoughts"); careRec.specialist_types.push("emergency_service"); }
      if (hasPsychosis) { careRec.reasons.push("psychosis_red_flags"); careRec.specialist_types.push("psychiatrist"); }
      if (hasMania) { careRec.reasons.push("mania_red_flags"); careRec.specialist_types.push("psychiatrist"); }
      if (hasSevereDistress) careRec.reasons.push("severe_distress");
      if (hasFunctionalImpairment) careRec.reasons.push("functional_impairment");
      if (hasSomaticSymptoms) { careRec.reasons.push("somatic_symptoms"); if (!careRec.specialist_types.includes("general_physician")) careRec.specialist_types.push("general_physician"); }
      if (hasTraumaticUncertainty) careRec.reasons.push("traumatic_uncertainty");
      if (hasSleepDisruption) careRec.reasons.push("sleep_disruption");
      if (hasSubstanceUse) { careRec.reasons.push("substance_use"); if (!careRec.specialist_types.includes("clinical_psychologist")) careRec.specialist_types.push("clinical_psychologist"); }
      if (hasSelfHarm) { careRec.reasons.push("self_harm_risk"); careRec.level = "urgent_help"; careRec.timeframe = "today"; }
      if (hasRiskToOthers) { careRec.reasons.push("risk_to_others"); careRec.level = "urgent_help"; careRec.timeframe = "today"; }
      // Deduplicate
      careRec.specialist_types = [...new Set(careRec.specialist_types)];
      careRec.reasons = [...new Set(careRec.reasons)];
      if (careRec.level === "self_support" && !careRec.reasons.length) {
        careRec.reasons = [];
        careRec.interim_support = ["вернуться к разговору, если состояние изменится"];
      }
    }

    // Final fallback for user_report if quality check still fails
    if (!userPart) {
      userPart = "Нам не удалось сформулировать итог разговора достаточно точно. Ваш диалог сохранён, и к нему можно вернуться позже по коду доступа.";
    }

    const report = userPart.includes("===USER_REPORT===")
      ? userPart
      : `===USER_REPORT===\n\n${userPart}\n\n===DOCTOR_REPORT===\n\n${doctorPart}`;

    const debugInfo = {
      raw_model_response: raw,
      parsed_user_report: userPart,
      parsed_doctor_report: doctorPart,
      care_recommendation: careRec,
      prompt_version: PROMPT_VERSION,
      quality_check: {
        pass: qualityCheck.pass,
        violations: qualityCheck.violations,
      },
      repair: repairInfo,
      care_repair: careRepairInfo,
      minimum_level: minimumLevel,
    };

    return res.status(200).json({
      type: "final",
      report,
      model_used: modelUsed,
      fallback_used: fallbackUsed,
      care_recommendation: careRec,
      _debug: debugInfo,
    });
  } catch (error) {
    console.error("Analyze error:", error.message);
    const fallbackCareRec = {
      level: "self_support",
      timeframe: "within_weeks",
      specialist_types: [],
      reasons: ["persistent_symptoms"],
      interim_support: ["вернуться к разговору позже по коду доступа"],
      urgent_triggers: [],
    };
    if (depth === 0) {
      return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: MODEL_TRIAGE, fallback_used: true, care_recommendation: fallbackCareRec });
    }
    return res.status(200).json({ type: "final", report: fallbackFinal, model_used: MODEL_TRIAGE, fallback_used: true, care_recommendation: fallbackCareRec });
  }
}
