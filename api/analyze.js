import { runTask, TASK_TYPES } from "../lib/modelRouter.js";
import { getModule, isValidModule, DEFAULT_MODULE } from "../lib/modules.js";
import { readModulePrompt, readCorePrompt } from "../lib/prompts.js";

function buildAntiRepeatBlock(convHistory, module = "support") {
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
  body tension, functioning, resources/support${module === "support" ? ", selected support practices" : "."}
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
    const result = await runTask(TASK_TYPES.PROMPT_REPAIR, {
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
  "orthopedist", "cardiologist", "gastroenterologist",
];

const VALID_REASONS = [
  "severe_distress", "persistent_symptoms", "sleep_disruption",
  "functional_impairment", "somatic_symptoms", "traumatic_uncertainty",
  "grief", "substance_use", "hopelessness", "social_isolation",
  "suicidal_thoughts", "self_harm_risk", "psychosis_red_flags",
  "mania_red_flags", "risk_to_others",
  "chest_pain", "headache", "back_pain", "joint_pain", "muscle_tension",
  "shortness_of_breath", "dizziness", "fatigue", "numbness",
  "red_flag_symptom",
];

function deriveMinimumCareLevel({
  riskLevel, suicidalIntent, suicidalPlan, selfHarmRisk,
  psychosisRedFlags, maniaRedFlags, riskToOthers,
  functionalImpairment, severeDistress, somaticSymptoms,
  traumaticUncertainty, sleepDisruption, substanceUse,
}, module) {
  if (module === "body") {
    // Body module: focus on medical red flags
    if (riskToOthers) return "urgent_help";
    if (suicidalIntent || suicidalPlan) return "urgent_help";
    // Chest pain, severe shortness of breath, worst headache, stroke-like symptoms
    // These are detected via the text patterns below
    if (psychosisRedFlags || maniaRedFlags) return "urgent_help";
    if (somaticSymptoms && (riskLevel === "high" || functionalImpairment)) {
      return "urgent_help";
    }
    // Any concerning physical symptom that limits function
    if (somaticSymptoms || severeDistress || functionalImpairment || selfHarmRisk) {
      return "medical_consultation";
    }
    if (sleepDisruption || substanceUse) {
      return "medical_consultation";
    }
    return "self_care";
  }
  // Support module: mental health triage
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
  if ((level === "professional_contact" || level === "medical_consultation") && timeframe !== "within_days" && timeframe !== "today") {
    violations.push(`${level} must have timeframe 'within_days' or 'today'`);
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
- level: self_support | professional_contact | urgent_help | self_care | medical_consultation
- timeframe: today | within_days | within_weeks | routine
- specialist_types: ${VALID_SPECIALIST_TYPES.join(", ")}
- reasons: ${VALID_REASONS.join(", ")}

Верни JSON:
{ "care_recommendation": { "level": "...", "timeframe": "...", "specialist_types": [], "reasons": [], "interim_support": [], "urgent_triggers": [] } }`;

  try {
    const result = await runTask(TASK_TYPES.PROMPT_REPAIR, {
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

const BODY_FALLBACK_RESPONSE = {
  type: "intake_analysis",
  user_report: "Спасибо, я собрал первичные данные. Начнем мягко: пару дней понаблюдаем за питанием, сном и активностью, а затем соберем простой план без рывков и крайностей.\n\nЭто не диагноз и не медицинское назначение.",
  body_plan: {
    focus: "Первичное наблюдение и мягкий старт",
    days: [
      { day: 1, title: "Просто начните замечать", actions: ["Запишите, что и когда вы едите", "Отметьте время сна и самочувствие утром", "Посильная прогулка 15–20 минут"], note: "Ничего не меняйте — просто наблюдайте" },
      { day: 2, title: "Продолжаем наблюдение", actions: ["Запишите вес и объём талии", "Те же три точки: еда, сон, движение"], note: "Два дня — уже хорошая база" },
      { day: 3, title: "Первый микрошаг", actions: ["Добавьте стакан воды утром", "Замените один перекус на фрукт или овощ"], note: "Маленький шаг — это уже движение" },
      { day: 4, title: "Закрепляем", actions: ["Повторите шаг дня 3", "10 минут лёгкой растяжки или ходьбы"], note: "Не стремитесь к идеалу — стремитесь к регулярности" },
      { day: 5, title: "Добавляем осознанность", actions: ["Обратите внимание на сигналы голода и сытости", "Сделайте один приём пищи без телефона"], note: "Еда — не только топливо, но и контакт с собой" },
      { day: 6, title: "Проверяем прогресс", actions: ["Запишите самочувствие и вес", "Что получилось? Что было сложным?"], note: "Срыв — не провал, а информация" },
      { day: 7, title: "Оцениваем неделю", actions: ["Посмотрите, что изменилось за неделю", "Отметьте, что хотите продолжить"], note: "Любой опыт полезен. На следующей неделе скорректируем план" },
    ],
  },
  care_recommendation: {
    level: "self_care",
    timeframe: "within_weeks",
    specialist_types: [],
    reasons: [],
    interim_support: ["наблюдать за питанием, сном и активностью"],
  },
  module: "body",
};

function calcBMI(heightCm, weightKg) {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return null;
  return Math.round((w / ((h / 100) * (h / 100))) * 10) / 10;
}

async function trySaveIntake(intake, bmi, careLevel, routerMeta) {
  try {
    const { getSupabase } = await import("../lib/supabase.js");
    const supabase = getSupabase();
    const answers = { ...intake };
    delete answers.session_id;
    const payload = {
      module: "body",
      version: "body-intake-v0.1",
      session_id: intake.session_id || null,
      answers,
      bmi: bmi ?? null,
      care_recommendation: careLevel || null,
      provider: routerMeta?.provider || null,
      ai_model: routerMeta?.model_used || null,
      task_type: routerMeta?.task_type || null,
      router_version: routerMeta?.router_version || null,
      request_duration_ms: routerMeta?.request_duration || null,
    };
    await supabase.from("body_intake_forms").insert(payload);
  } catch (err) {
    console.log("Body intake DB save skipped (table may not exist):", err.message);
  }
}

async function handleBodyIntakeAnalysis(req, res, intake) {
  const bmi = calcBMI(intake.height_cm, intake.weight_kg);

  // Backend care level override based on red flags (safety backstop)
  const redFlags = Array.isArray(intake.red_flags_check) ? intake.red_flags_check : [];
  const hasUrgentFlag = redFlags.some(f => ["chest_pain", "fainting"].includes(f));
  const hasMedicalFlag = redFlags.some(f => ["severe_dizziness", "unexplained_weight_loss", "blood_in_stool"].includes(f));
  let redFlagCareLevel = null;
  if (hasUrgentFlag) redFlagCareLevel = "urgent_help";
  else if (hasMedicalFlag) redFlagCareLevel = "medical_consultation";

  // Try to save intake data (non-blocking)
  trySaveIntake(intake, bmi, null);

  const DISCLAIMER = "\n\nЭто не диагноз и не медицинское назначение.";

  try {
    const conversationStyle = readCorePrompt("conversation-style.md") || "";
    const modulePrompt = readModulePrompt("body", "intake-analysis.md") || "Ты — AI-ассистент модуля здоровья. Проанализируй данные анкеты и верни план.";

    const systemPrompt = `
${modulePrompt}

${conversationStyle}

ПРАВИЛА:
- Не ставь диагноз
- Не назначай лекарства, БАДы, ГПП-1, витамины в лечебных дозах
- Не давай жёсткие нормы калорий
- Не стыди, не дави
- При красных флагах — чётко рекомендовать врача
- Отвечай только на русском языке
- Каждый ответ обязан заканчиваться фразой: "${DISCLAIMER.trim()}"
- Верни JSON с полями: user_report (текст для пользователя), body_plan (объект с полями focus и days), care_recommendation (объект)
`;

    const flags = Array.isArray(intake.red_flags_check) ? intake.red_flags_check.join(", ") : "нет";

    const userPrompt = `Пользователь заполнил первичную анкету модуля "Здоровье & Стройность".

Данные анкеты:
- Имя: ${intake.display_name || "не указано"}
- Пол: ${intake.sex || "не указан"}
- Возраст: ${intake.age || "не указан"}
- Цель: ${intake.goal === "custom" ? intake.goal_custom : intake.goal || "не указана"}
- Рост: ${intake.height_cm || "не указан"} см
- Вес: ${intake.weight_kg || "не указан"} кг
- ИМТ: ${bmi ?? "не рассчитан"}
- Объём талии: ${intake.waist_cm || "не указан"} см
- Уровень активности на работе: ${intake.work_activity_level || "не указан"}
- Шагов в день: ${intake.daily_steps_estimate || "не указано"}
- Сон: ${intake.sleep_hours_estimate || "не указан"}
- Питание (главная проблема): ${intake.nutrition_main_problem || "не указана"}
- Ограничения по здоровью: ${intake.health_limitations || "нет"}
- Красные флаги: ${flags}

Проанализируй анкету и верни JSON:
{
  "user_report": "3-5 предложений на русском, бережно, без диагнозов",
  "body_plan": {
    "focus": "главная тема недели",
    "days": [
      { "day": 1, "title": "...", "actions": ["..."], "note": "..." }
    ]
  },
  "care_recommendation": {
    "level": "self_care|medical_consultation|urgent_help",
    "timeframe": "...",
    "specialist_types": [],
    "reasons": [],
    "interim_support": []
  }
}`;

    const MODEL_TRIAGE = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
    const MODEL_FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
    const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

    const result = await runTask(TASK_TYPES.BODY_INTAKE, {
      systemPrompt,
      userPrompt,
      model: MODEL_TRIAGE,
      fallbackModel: MODEL_FALLBACK,
      reasoningEffort: REASONING_EFFORT,
    });

    const parsed = result.parsed;

    if (!parsed || !parsed.user_report) {
      return res.status(200).json({
        ...BODY_FALLBACK_RESPONSE,
        bmi,
        care_recommendation: redFlagCareLevel
          ? { ...BODY_FALLBACK_RESPONSE.care_recommendation, level: redFlagCareLevel }
          : BODY_FALLBACK_RESPONSE.care_recommendation,
        triggered_red_flags: redFlags,
        red_flag_care_level: redFlagCareLevel,
        used_fallback: true,
        intake_answers: intake,
      });
    }

    const careLevel = redFlagCareLevel || parsed.care_recommendation?.level || "self_care";

    // Override care_recommendation if red flags dictate higher level
    let safeCareRecommendation = parsed.care_recommendation || BODY_FALLBACK_RESPONSE.care_recommendation;
    if (redFlagCareLevel) {
      safeCareRecommendation = {
        ...safeCareRecommendation,
        level: redFlagCareLevel,
        ...(hasUrgentFlag ? {
          timeframe: "немедленно",
          specialist_types: ["emergency_service"],
          reasons: redFlags,
          interim_support: ["Позвоните 112 или 103", "Не оставайтесь в одиночестве"],
        } : {
          timeframe: "в ближайшее время",
          specialist_types: ["general_physician"],
          reasons: redFlags,
          interim_support: ["Обратитесь к терапевту для первичной консультации"],
        }),
      };
    }

    // Save intake with care recommendation (non-blocking)
    trySaveIntake(intake, bmi, careLevel, result);

    return res.status(200).json({
      type: "intake_analysis",
      user_report: parsed.user_report,
      body_plan: parsed.body_plan || BODY_FALLBACK_RESPONSE.body_plan,
      care_recommendation: safeCareRecommendation,
      bmi,
      triggered_red_flags: redFlags,
      red_flag_care_level: redFlagCareLevel,
      used_fallback: !!result.fallback_used,
      model_used: result.model_used,
      fallback_used: result.fallback_used,
      provider: result.provider,
      task_type: result.task_type,
      request_duration: result.request_duration,
      module: "body",
      intake_answers: intake,
    });
  } catch (error) {
    console.error("Body intake analysis error:", error.message);
    return res.status(200).json({
      ...BODY_FALLBACK_RESPONSE,
      bmi,
      care_recommendation: redFlagCareLevel
        ? { ...BODY_FALLBACK_RESPONSE.care_recommendation, level: redFlagCareLevel }
        : BODY_FALLBACK_RESPONSE.care_recommendation,
      triggered_red_flags: redFlags,
      red_flag_care_level: redFlagCareLevel,
      used_fallback: true,
      intake_answers: intake,
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, answers, mode, conversationHistory: rawHistory, depth = 0, isContinuation = false, previousPatientReport = "", previousDoctorReport = "", homeTasks = "", resourceFactors = "", supportPlan, voiceObservations, module: reqModule, stage, intake: intakeData } = req.body || {};

  const activeModule = isValidModule(reqModule) ? reqModule : DEFAULT_MODULE;

  // Body intake stage: one-shot analysis from completed intake form
  const bodyIntake = intakeData || answers;
  if (stage === "intake_completed" && activeModule === "body" && bodyIntake) {
    return await handleBodyIntakeAnalysis(req, res, bodyIntake);
  }

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Опишите состояние подробнее" });
  }
  const moduleConfig = getModule(activeModule);
  const MIN_DEPTH = 3;
  const MAX_DEPTH = 8;

  const fallbackQuestions_support = [
    "Было ли в последние месяцы важное событие, потеря, конфликт, болезнь, переезд, военные события, исчезновение или смерть близкого человека, которое могло повлиять на ваше состояние?",
    "Началось ли состояние после конкретного события или постепенно, без понятной причины?",
    "Были ли алкоголь, вещества, новые лекарства, отмена препаратов, гормональные или соматические проблемы, которые совпали с ухудшением?",
    "Как давно вы замечаете это состояние?",
    "Насколько это влияет на сон, работу, учебу или отношения?",
    "Бывали ли мысли, что жить не хочется или причинить себе вред?",
    "Бывали ли ощущения, что вы слышите или замечаете то, чего не замечают другие?",
    "Бывали ли периоды, когда вы почти не спали, но чувствовали необычный прилив энергии?",
  ];

  const fallbackQuestions_body = [
    "Где именно вы чувствуете боль или дискомфорт? Опишите словами.",
    "Когда это началось и как менялось со временем?",
    "Что делает эти ощущения сильнее или слабее?",
    "Были ли у вас похожие симптомы раньше?",
    "Как это влияет на ваш обычный день — работу, сон, движение?",
    "Пробовали ли вы что-то, чтобы облегчить состояние?",
    "Были ли недавно травмы, падения, перегрузки или болезни?",
    "Принимаете ли вы какие-то лекарства или средства от боли?",
  ];

  const fallbackQuestions = activeModule === "body" ? fallbackQuestions_body : fallbackQuestions_support;

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
      module: activeModule,
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

  const antiRepeatBlock = buildAntiRepeatBlock(convHistory, activeModule);

  // Build system prompt based on active module
  const conversationStyle = readCorePrompt("conversation-style.md") || "";

  const systemPrompt = (() => {
    const modulePrompt = readModulePrompt(activeModule, "triage-system.md");
    const basePrompt = modulePrompt || `Ты — AI-ассистент сервиса "Точка Опоры". Твоя задача — помогать пользователю описать своё состояние, задавать уточняющие вопросы и формировать предварительное заключение. Ты НЕ ставишь диагноз. Ты НЕ назначаешь лечение.`;

    // Common rules shared by all modules
    const commonRules = `
ПРАВИЛА (общие для всех модулей):
- Не ставь диагноз
- Не назначай лекарства, дозировки, схемы лечения, БАДы, растительные средства
- Не используй "у вас..." в отношении болезни или расстройства
- Используй язык сигналов: "признаки", "маркеры", "важно уточнить", "стоит обсудить со специалистом"
- Если есть риск самоповреждения — срочная помощь 112/103, не оставаться одному
- Не обещай излечение, не заменяй врача, не давай категоричных советов
- Отчёт для специалиста — профессиональным языком, но без окончательных диагнозов и назначений

${conversationStyle}

Голосовые признаки (войс-обсервации):
Не ставь диагноз по голосовым признакам.
Не усиливай уровень риска только на основании голоса.

MIN_DEPTH = 3. Не завершай диалог до минимальной глубины.
MAX_DEPTH = 8. После максимальной глубины заверши, указав ограничения.

Модель уверенности:
- Высокая: множество сигналов, согласованы между раундами
- Средняя: некоторые сигналы присутствуют, частичные данные
- Низкая: мало сигналов, противоречивые данные

Продолжение сессии (isContinuation=true):
Если это продолжение, AI НЕ начинает новый опрос.
Кратко напоминает прошлый разговор и задает вопросы о динамике.
Не повторяй вопросы, которые уже были заданы.
Фокус — на changes, progress, new signals.
`;

    if (activeModule === "support") {
      return `
Ты — AI-ассистент первичного mental health triage (выявление сигналов).

Ты НЕ ставишь диагноз.
Ты определяешь:
- сигналы (эмоциональные, когнитивные, поведенческие)
- маркеры риска
- уровень срочности
- необходимость передачи специалисту

Добавлен Patient Support Layer.
Всегда ищи:
- ресурсы пациента
- социальную поддержку
- действия, которые могут стабилизировать состояние
- план до следующего контакта

Сферы выявления сигналов:
- Эмоциональная сфера
- Травматический контекст
- Нейрокогнитивная сфера
- Сфера риска
- Функциональные нарушения
- Ресурсы и поддержка

Правила:
- не ставь диагноз
- не назначай лекарства
- если риск самоповреждения — срочная помощь 112/103
- используй "обнаружены сигналы", "важно уточнить"

${commonRules}

--- ПРАВИЛА ФОРМИРОВАНИЯ ОТЧЁТА ДЛЯ КЛИЕНТА (user_report) ---

Структура user_report:
1. Что с вами сейчас происходит — 2-4 предложения. Назвать главное событие и его влияние.
2. Что мы услышали в разговоре — только конкретные проявления из диалога.
3. Что важно не пропустить — риски, телесные симптомы, сон, алкоголь.
4. На что можно опереться — реальные ресурсы из разговора.
5. Что может немного помочь сегодня — максимум 3 конкретных действия.
6. Следующий шаг — один понятный шаг с маршрутизацией.

Обязательное заземление в фактах:
Каждый user_report должен опираться на 2-3 конкретных факта из разговора.

Когда завершаешь диалог, верни JSON с user_report, doctor_report и care_recommendation.

${antiRepeatBlock}
`;
    }

    // Body module and other modules
    return `
${basePrompt}

${commonRules}

--- ПРАВИЛА ФОРМИРОВАНИЯ ОТЧЁТА ДЛЯ КЛИЕНТА (user_report) ---

Структура user_report:
1. Что происходит с вашим телом — 2-4 предложения о главных ощущениях/симптомах.
2. Что мы услышали — конкретные детали из разговора.
3. Что важно не пропустить — красные флаги, требующие врача.
4. На что можно опереться — что помогает или пробовали раньше.
5. Что может немного помочь сегодня — максимум 3 конкретных действия.
6. Следующий шаг — один понятный шаг.

Каждый user_report должен опираться на 2-3 конкретных факта из разговора.
Пиши живым человеческим языком.

--- КОНЕЦ ПРАВИЛ ОТЧЁТА ДЛЯ КЛИЕНТА ---

${antiRepeatBlock}
`;
  })();

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
    const result = await runTask(TASK_TYPES.PATIENT_DIALOG, {
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
        return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: modelUsed, fallback_used: fallbackUsed, module: activeModule });
      }
      return res.status(200).json({ type: "final", user_report: fallbackFinal, doctor_report: "", model_used: modelUsed, fallback_used: fallbackUsed, module: activeModule });
    }

    if (!parsed) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: modelUsed, fallback_used: fallbackUsed, module: activeModule });
      }
      return res.status(200).json({ type: "final", user_report: raw, doctor_report: "", model_used: modelUsed, fallback_used: fallbackUsed, module: activeModule });
    }

    if (parsed.type === "questions" && Array.isArray(parsed.questions)) {
      return res.status(200).json({
        type: "questions",
        questions: parsed.questions.filter(Boolean).slice(0, 7),
        model_used: modelUsed,
        fallback_used: fallbackUsed,
        provider: result.provider,
        task_type: result.task_type,
        request_duration: result.request_duration,
        module: activeModule,
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
    }, activeModule);

    // Validate and enforce care_recommendation
    let careRepairInfo = { repairAttempted: false };
    let careCheck = { pass: true, violations: [] };

    if (careRec) {
      careCheck = checkCareRecommendation(careRec, fullConversation);
      // Backend override: model cannot set below minimum
      const levelOrder = { "self_support": 0, "professional_contact": 1, "self_care": 0, "medical_consultation": 1, "urgent_help": 2 };
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
        timeframe: minimumLevel === "urgent_help" ? "today" : (minimumLevel === "professional_contact" || minimumLevel === "medical_consultation") ? "within_days" : "within_weeks",
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
      if ((careRec.level === "self_support" || careRec.level === "self_care") && !careRec.reasons.length) {
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
      provider: result.provider,
      task_type: result.task_type,
      request_duration: result.request_duration,
      module: activeModule,
      care_recommendation: careRec,
      _debug: debugInfo,
    });
  } catch (error) {
    console.error("Analyze error:", error.message);
    const fallbackLevel = activeModule === "body" ? "self_care" : "self_support";
    const fallbackCareRec = {
      level: fallbackLevel,
      timeframe: "within_weeks",
      specialist_types: [],
      reasons: ["persistent_symptoms"],
      interim_support: ["вернуться к разговору позже по коду доступа"],
      urgent_triggers: [],
    };
    if (depth === 0) {
      return res.status(200).json({ type: "questions", questions: fallbackQuestions, model_used: MODEL_TRIAGE, fallback_used: true, care_recommendation: fallbackCareRec, module: activeModule });
    }
    return res.status(200).json({ type: "final", report: fallbackFinal, model_used: MODEL_TRIAGE, fallback_used: true, care_recommendation: fallbackCareRec, module: activeModule });
  }
}
