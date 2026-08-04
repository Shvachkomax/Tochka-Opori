import crypto from "node:crypto";
import { runTask, TASK_TYPES, getActiveProvider } from "../lib/modelRouter.js";
import { getSupabase } from "../lib/supabase.js";
import { getModule, isValidModule, DEFAULT_MODULE } from "../lib/modules.js";
import { readModulePrompt, readCorePrompt } from "../lib/prompts.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { requireClientToken } from "../lib/security/client-token.js";
import { debitCreditsForSession, setSessionVisibleAfterCode } from "../lib/usage/debit.js";
import { ensureWallet, setWalletVisible } from "../lib/usage/wallet.js";
import { getOrCreateContinuationCredential } from "../lib/session/continuation-store.js";
import { generateSessionAccessToken } from "../lib/security/access-token.js";
import {
  REPORT_STATUS,
  getStableReportRequestId,
  getOrCreateSessionForAnalyze,
  checkReportStatus,
  setReportStatus,
  saveFinalReportToSession,
  createReportArtifacts,
  deterministicUserReportFix,
  repairInvalidJson,
  buildReportResponsePayload,
} from "../lib/report/finalize.js";

function generateBodyCode() {
  const p1 = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 4);
  const p2 = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 3);
  return `HEALTH-${p1}-${p2}`;
}

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

// Risk detection helpers: only flag a risk if the user is talking about themselves,
// not about a third-party event (e.g., a suicide in their environment).
const OWN_RISK_WORDS = ["я", "мне", "мной", "мо[йёе]", "мо[яю]", "себе", "собой", "собе", "хочу", "думаю", "планирую", "собираюсь", "покончу", "сделаю", "напишу"];
const THIRD_PARTY_WORDS = ["он", "она", "оно", "его", "её", "ее", "им", "ей", "ему", "друг", "подруга", "знакомый", "знакомая", "родственник", "родственница", "мама", "папа", "мать", "отец", "брат", "сестра", "сын", "дочь", "муж", "жена", "парень", "девушка", "коллега", "начальник", "человек", "кто-то", "кое-кто", "врач", "сосед", "близкий"];

function makeWordBoundaryRegex(words) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${words.join("|")})(?![\\p{L}\\p{N}_])`, "iu");
}

const OWN_RISK_PRONOUNS = makeWordBoundaryRegex(OWN_RISK_WORDS);
const THIRD_PARTY_SUBJECTS = makeWordBoundaryRegex(THIRD_PARTY_WORDS);

function isOwnRiskSentence(sentence, riskRegex) {
  if (!riskRegex.test(sentence)) return false;
  // Third-party mention near the risk term should not count as own risk.
  if (THIRD_PARTY_SUBJECTS.test(sentence)) return false;
  // Require a first-person indicator in the same sentence.
  return OWN_RISK_PRONOUNS.test(sentence);
}

function hasOwnRiskPattern(text, pattern) {
  if (!text) return false;
  const sentences = text.split(/[.!?\n]+/).filter(Boolean);
  for (const sentence of sentences) {
    if (isOwnRiskSentence(sentence, pattern)) return true;
  }
  return false;
}

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

function programmaticCareFix({
  careRec,
  minimumLevel,
  hasSuicidalIntent,
  hasSuicidalPlan,
  hasPsychosis,
  hasMania,
  hasRiskToOthers,
  hasSevereDistress,
  hasFunctionalImpairment,
  hasSomaticSymptoms,
  hasTraumaticUncertainty,
  hasSleepDisruption,
  hasSubstanceUse,
  hasSelfHarm,
}) {
  const levelOrder = {
    self_support: 0,
    self_care: 0,
    professional_contact: 1,
    medical_consultation: 1,
    urgent_help: 2,
  };

  if (!careRec || typeof careRec !== "object") {
    careRec = { level: minimumLevel, specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] };
  }

  if (levelOrder[careRec.level] < levelOrder[minimumLevel]) {
    careRec.level = minimumLevel;
  }

  if (careRec.level === "urgent_help") {
    careRec.timeframe = "today";
  } else if (careRec.level === "professional_contact" || careRec.level === "medical_consultation") {
    if (careRec.timeframe !== "today" && careRec.timeframe !== "within_days") {
      careRec.timeframe = "within_days";
    }
  } else if (!careRec.timeframe) {
    careRec.timeframe = "within_weeks";
  }

  if (!Array.isArray(careRec.specialist_types)) careRec.specialist_types = [];
  if (!Array.isArray(careRec.reasons)) careRec.reasons = [];
  if (!Array.isArray(careRec.interim_support)) careRec.interim_support = [];
  if (!Array.isArray(careRec.urgent_triggers)) careRec.urgent_triggers = [];

  // Filter invalid values.
  careRec.specialist_types = careRec.specialist_types.filter(st => VALID_SPECIALIST_TYPES.includes(st));
  careRec.reasons = careRec.reasons.filter(r => VALID_REASONS.includes(r));
  if (careRec.level !== "urgent_help") {
    careRec.urgent_triggers = [];
  }

  // Populate reasons / specialist types based on detected signals.
  if (hasSuicidalIntent || hasSuicidalPlan) {
    careRec.reasons.push("suicidal_thoughts");
    if (!careRec.specialist_types.includes("emergency_service")) careRec.specialist_types.push("emergency_service");
  }
  if (hasPsychosis) {
    careRec.reasons.push("psychosis_red_flags");
    if (!careRec.specialist_types.includes("psychiatrist")) careRec.specialist_types.push("psychiatrist");
  }
  if (hasMania) {
    careRec.reasons.push("mania_red_flags");
    if (!careRec.specialist_types.includes("psychiatrist")) careRec.specialist_types.push("psychiatrist");
  }
  if (hasSevereDistress) careRec.reasons.push("severe_distress");
  if (hasFunctionalImpairment) careRec.reasons.push("functional_impairment");
  if (hasSomaticSymptoms) {
    careRec.reasons.push("somatic_symptoms");
    if (!careRec.specialist_types.includes("general_physician") && !careRec.specialist_types.includes("emergency_service")) {
      careRec.specialist_types.push("general_physician");
    }
  }
  if (hasTraumaticUncertainty) careRec.reasons.push("traumatic_uncertainty");
  if (hasSleepDisruption) careRec.reasons.push("sleep_disruption");
  if (hasSubstanceUse) {
    careRec.reasons.push("substance_use");
    if (!careRec.specialist_types.includes("clinical_psychologist")) careRec.specialist_types.push("clinical_psychologist");
  }
  if (hasSelfHarm) {
    careRec.reasons.push("self_harm_risk");
    careRec.level = "urgent_help";
    careRec.timeframe = "today";
  }
  if (hasRiskToOthers) {
    careRec.reasons.push("risk_to_others");
    careRec.level = "urgent_help";
    careRec.timeframe = "today";
  }

  careRec.specialist_types = [...new Set(careRec.specialist_types)];
  careRec.reasons = [...new Set(careRec.reasons)];

  if ((careRec.level === "self_support" || careRec.level === "self_care") && careRec.reasons.length === 0) {
    careRec.interim_support = ["вернуться к разговору, если состояние изменится"];
  }

  if (careRec.level === "urgent_help" && careRec.urgent_triggers.length === 0) {
    careRec.urgent_triggers = ["see_recommendations"];
  }

  return careRec;
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

async function trySaveIntake(intake, bmi, careLevel, routerMeta, sessionCode, source = "self_signup", specialistId = null, specialistName = null) {
  const targetSessionId = sessionCode || intake.session_id || null;
  try {
    const crypto = await import("node:crypto");
    const { getSupabase } = await import("../lib/supabase.js");
    const supabase = getSupabase();
    const answers = { ...intake };
    delete answers.session_id;
    const payload = {
      module: "body",
      version: "body-intake-v0.1",
      session_id: targetSessionId,
      answers,
      bmi: bmi ?? null,
      care_recommendation: careLevel || null,
      provider: routerMeta?.provider || null,
      ai_model: routerMeta?.model_used || null,
      task_type: routerMeta?.task_type || null,
      router_version: routerMeta?.router_version || null,
      request_duration_ms: routerMeta?.request_duration || null,
      source,
      specialist_id: specialistId,
      specialist_name: specialistName,
    };
    await supabase.from("body_intake_forms").insert(payload);

    const displayName = intake.display_name || null;
    const goal = intake.goal || null;

    const { data: existingClient } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id")
      .eq("session_id", targetSessionId)
      .maybeSingle();

    let anonymousOwnerId = existingClient?.anonymous_owner_id;

    if (anonymousOwnerId) {
      await supabase.from("body_clients").update({
        display_name: displayName,
        source,
        specialist_id: specialistId,
        specialist_name: specialistName,
        goal,
        updated_at: new Date().toISOString(),
      }).eq("session_id", targetSessionId);
    } else {
      anonymousOwnerId = crypto.randomUUID();
      await supabase.from("body_clients").insert({
        session_id: targetSessionId,
        anonymous_owner_id: anonymousOwnerId,
        display_name: displayName,
        source,
        specialist_id: specialistId,
        specialist_name: specialistName,
        goal,
        status: "active",
        updated_at: new Date().toISOString(),
      });
    }

    return { success: true, anonymousOwnerId, sessionId: targetSessionId };
  } catch (err) {
    console.log("Body intake DB save skipped:", err.message);
    return { success: false, anonymousOwnerId: null, sessionId: targetSessionId };
  }
}

async function handleBodyIntakeAnalysis(req, res, intake) {
  const bmi = calcBMI(intake.height_cm, intake.weight_kg);

  // Extract referral info from request body
  const source = req.body.source || "self_signup";
  const specialistId = req.body.specialist_id || null;
  const specialistName = req.body.specialist_name || null;

  // Backend care level override based on red flags (safety backstop)
  const redFlags = Array.isArray(intake.red_flags_check) ? intake.red_flags_check : [];
  const hasUrgentFlag = redFlags.some(f => ["chest_pain", "fainting"].includes(f));
  const hasMedicalFlag = redFlags.some(f => ["severe_dizziness", "unexplained_weight_loss", "blood_in_stool"].includes(f));
  let redFlagCareLevel = null;
  if (hasUrgentFlag) redFlagCareLevel = "urgent_help";
  else if (hasMedicalFlag) redFlagCareLevel = "medical_consultation";

  // Generate continuation code
  const sessionCode = generateBodyCode();

  // Save client record before AI — debit depends on canonical body_clients row
  const saveResult = await trySaveIntake(intake, bmi, null, null, sessionCode, source, specialistId, specialistName);
  if (!saveResult.success) {
    return res.status(500).json({ ok: false, error: "Не удалось сохранить данные. Попробуйте позже." });
  }

  // Create owner-level continuation credential on first completed intake.
  let continuationCode = null;
  let accessToken = null;
  try {
    const { getSupabase } = await import("../lib/supabase.js");
    const supabase = getSupabase();
    const credentialResult = await getOrCreateContinuationCredential({
      module: "body",
      ownerId: saveResult.anonymousOwnerId,
      supabase,
    });
    if (credentialResult.isNew && credentialResult.combinedCode) {
      continuationCode = credentialResult.combinedCode;
    }
    accessToken = await generateSessionAccessToken(sessionCode, {
      module: "body",
      anonymousOwnerId: saveResult.anonymousOwnerId,
      publicCode: continuationCode,
    });
  } catch (credErr) {
    console.error("Body intake continuation credential creation failed:", credErr.message);
  }

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

Проанализируй анкету и верни JSON с планом ровно на 3 дня:
{
  "user_report": "3-5 предложений на русском, бережно, без диагнозов",
  "body_plan": {
    "focus": "главная тема на 3 дня",
    "days": [
      { "day": 1, "title": "Наблюдение", "actions": ["записать вес", "отметить шаги", "записать питание", "отметить сон", "заметка о самочувствии"], "note": "Сегодня ничего не меняем — просто смотрим, как идёт день." },
      { "day": 2, "title": "...", "actions": ["..."], "note": "..." },
      { "day": 3, "title": "...", "actions": ["..."], "note": "..." }
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
        session_id: sessionCode,
        access_token: accessToken,
        continuation_code: continuationCode,
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

    // Save intake with care recommendation — await to confirm code persistence
    const updated = (await trySaveIntake(intake, bmi, careLevel, result, sessionCode, source, specialistId, specialistName)).success;

    try {
      await debitCreditsForSession({
        sessionId: sessionCode,
        module: "body",
        resourceType: "body_intake_analyze",
        requestId: `body-intake-${sessionCode}-${Date.now()}`,
        provider: result.provider,
        model: result.model_used,
      });
    } catch (e) {
      console.error("[credits] body_intake_analyze debit failed:", e.message);
    }

    // Only make wallet visible after code is confirmed saved
    if (updated) {
      setSessionVisibleAfterCode({ sessionId: sessionCode, module: "body" });
      try {
        const wallet = await ensureWallet({ ownerType: "anonymous_profile", ownerId: saveResult.anonymousOwnerId, module: "body" });
        if (wallet) {
          await setWalletVisible({ walletId: wallet.id });
        }
      } catch (walletErr) {
        console.error("[wallet] body intake set visible failed:", walletErr.message);
      }
    }

    return res.status(200).json({
      type: "intake_analysis",
      session_id: sessionCode,
      access_token: accessToken,
      continuation_code: continuationCode,
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
      session_id: sessionCode,
      access_token: accessToken,
      continuation_code: continuationCode,
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

// Body diary daily log handler
async function handleDailyLogAnalysis(req, res) {
  const { session_id, daily_log } = req.body || {};

  if (!session_id || !daily_log) {
    return res.status(400).json({ ok: false, saved: false, error: "Missing session_id or daily_log" });
  }

  // Local date helper (avoids UTC offset issues near midnight)
  function getLocalDateString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const logDate = daily_log.log_date || getLocalDateString();

  try {
    const { getSupabase } = await import("../lib/supabase.js");
    const { fingerprint } = await import("../lib/session/continuation-store.js");
    const supabase = getSupabase();

    const ALLOWED_COLS = [
      "session_id", "module", "log_date",
      "weight_kg", "waist_cm",
      "steps", "activity_comment",
      "workout_done", "workout_type", "workout_minutes", "workout_intensity", "workout_comment",
      "workout_entries",
      "calories", "activity_calories", "activity_calories_source", "calorie_intake_source",
      "meals_count", "breakfast", "lunch", "dinner", "snacks", "nutrition_comment",
      "overeating_level", "sweet_cravings",
      "water_l",
      "sleep_hours", "sleep_quality",
      "energy_level", "mood_level",
      "day_text", "voice_transcript",
      "plate_photos", "plate_analysis",
    ];
    const safeLog = { session_id, module: "body", log_date: logDate };
    for (const key of ALLOWED_COLS) {
      if (daily_log[key] !== undefined) {
        safeLog[key] = daily_log[key];
      }
    }

    // Backward compatibility: compute aggregate fields from workout_entries
    if (Array.isArray(safeLog.workout_entries) && safeLog.workout_entries.length > 0) {
      const entries = safeLog.workout_entries;
      safeLog.workout_done = true;
      safeLog.workout_minutes = entries.reduce((sum, e) => sum + (e.minutes || 0), 0);
      safeLog.activity_calories = entries.reduce((sum, e) => sum + (e.activity_calories || 0), 0);
      safeLog.workout_type = entries[0].type || null;
      safeLog.workout_intensity = entries[0].intensity || null;
      safeLog.workout_comment = entries.map(e => e.comment).filter(Boolean).join("; ") || null;
      if (entries[0].activity_calories_source) {
        safeLog.activity_calories_source = entries[0].activity_calories_source;
      }
    }

    // Upsert: find existing row for this session_id + log_date, update or insert
    const { data: existing, error: findError } = await supabase
      .from("body_daily_logs")
      .select("id")
      .eq("session_id", session_id)
      .eq("log_date", logDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error("[body-diary-save] find error:", findError.code, findError.message);
      return res.status(500).json({ ok: false, saved: false, error: "Не удалось сохранить дневник. Попробуйте ещё раз." });
    }

    let savedLog;
    if (existing) {
      // Update existing row
      const { data: updated, error: updateError } = await supabase
        .from("body_daily_logs")
        .update({ ...safeLog, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("id, session_id, log_date, created_at, updated_at")
        .single();

      if (updateError || !updated) {
        console.error("[body-diary-save] update error:", updateError?.code, updateError?.message);
        return res.status(500).json({ ok: false, saved: false, error: "Не удалось сохранить дневник. Попробуйте ещё раз." });
      }
      savedLog = updated;
    } else {
      // Insert new row
      const { data: inserted, error: insertError } = await supabase
        .from("body_daily_logs")
        .insert(safeLog)
        .select("id, session_id, log_date, created_at, updated_at")
        .single();

      if (insertError || !inserted) {
        console.error("[body-diary-save] insert error:", insertError?.code, insertError?.message);
        return res.status(500).json({ ok: false, saved: false, error: "Не удалось сохранить дневник. Попробуйте ещё раз." });
      }
      savedLog = inserted;
    }

    // Ensure body_clients row exists
    try {
      const { data: existingClient } = await supabase
        .from("body_clients")
        .select("id")
        .eq("session_id", session_id)
        .maybeSingle();

      if (!existingClient) {
        const { randomUUID } = await import("node:crypto");
        await supabase.from("body_clients").upsert({
          session_id,
          anonymous_owner_id: randomUUID(),
          source: "self_signup",
          status: "active",
        }, { onConflict: "session_id" });
      }
    } catch (clientErr) {
      console.log("Body client check skipped:", clientErr.message);
    }

    // Save plate history (structured per-photo observations)
    if (savedLog.id && Array.isArray(daily_log.plate_analysis) && daily_log.plate_analysis.length > 0) {
      try {
        const { fingerprint: fpFn } = await import("../lib/session/continuation-store.js");
        // Resolve owner_id from body_clients
        const { data: ownerClient } = await supabase
          .from("body_clients")
          .select("anonymous_owner_id")
          .eq("session_id", session_id)
          .maybeSingle();
        const ownerId = ownerClient?.anonymous_owner_id;
        if (ownerId) {
          const now = new Date().toISOString();
          for (const result of daily_log.plate_analysis) {
            if (result.error) continue;
            const photoIndex = result.photo_index ?? 0;
            const platePayload = {
              owner_type: "anonymous_profile",
              owner_id: ownerId,
              session_id,
              daily_log_id: savedLog.id,
              log_date: logDate,
              photo_ref: `${savedLog.id}:${photoIndex}`,
              photo_index: photoIndex,
              meal_type: result.meal_type || null,
              detected_foods: result.detected_foods || null,
              plate_components: result.plate_components || null,
              vegetables_assessment: result.plate_components?.vegetables != null ? (result.plate_components.vegetables >= 40 ? "enough" : result.plate_components.vegetables > 0 ? "low" : "missing") : null,
              protein_assessment: result.plate_components?.protein != null ? (result.plate_components.protein >= 20 ? "enough" : result.plate_components.protein > 0 ? "low" : "missing") : null,
              carbohydrate_assessment: result.plate_components?.carbohydrates != null ? (result.plate_components.carbohydrates <= 35 ? "enough" : result.plate_components.carbohydrates > 50 ? "excess" : "ok") : null,
              balance_summary: result.balance_summary || null,
              what_is_missing: result.what_is_missing || null,
              gentle_suggestion: result.gentle_suggestion || null,
              confidence: result.confidence || null,
              updated_at: now,
            };
            // Upsert by owner_id + daily_log_id + photo_index
            const { data: existingPlate } = await supabase
              .from("body_plate_history")
              .select("id")
              .eq("owner_id", ownerId)
              .eq("daily_log_id", savedLog.id)
              .eq("photo_index", photoIndex)
              .maybeSingle();
            if (existingPlate) {
              await supabase.from("body_plate_history").update(platePayload).eq("id", existingPlate.id);
            } else {
              await supabase.from("body_plate_history").insert(platePayload);
            }
          }
        }
      } catch (plateErr) {
        console.error("[body-diary-save] plate history save skipped:", plateErr.message);
      }
    }

    // Only now run AI analysis (after confirmed save)
    try {
      const conversationStyle = readCorePrompt("conversation-style.md") || "";
      const diary = daily_log;

      const systemPrompt = `
Ты — доброжелательный ассистент модуля "Здоровье & Стройность". Пользователь заполнил дневник дня.

Твоя задача: написать структурированный итог дня.

ПРАВИЛА:
- Не стыдить, не ругать
- Не требовать компенсировать еду тренировкой
- Не назначать лекарства, БАДы, витамины
- Не давать жесткие нормы калорий
- Не ставить диагноз
- Отвечать только на русском языке
- Если данных мало — честно писать, что вывод предварительный
- Если есть явные признаки: боль в груди, обморок, кровь в стуле, сильное головокружение, резкое ухудшение — написать "Лучше не продолжать программу сейчас и обратиться за медицинской помощью"

Верни JSON строго с полями:
{
  "ai_day_summary": "2-4 предложения общий итог дня",
  "ai_positive_observation": "одно конкретное что получилось сегодня (шаги, регулярность, выбор еды и т.д.)",
  "ai_pattern_observation": "одно наблюдение или повторяющийся паттерн (мало овощей, нерегулярное питание и т.д.), если данных достаточно; иначе null",
  "ai_focus_tomorrow": "один мягкий фокус на завтра",
  "ai_question_for_user": "один открытый вопрос для рефлексии"
}

### ai_positive_observation:
Заметь одно конкретное достижение или положительный момент дня.
Примеры: «Вы вышли на прогулку, хотя не планировали», «Белок был в каждом приёме пищи», «Заполнили дневник — это уже важно для понимания привычек».

### ai_pattern_observation:
Если данных за 3+ дня — заметь повторяющийся паттерн.
Примеры: «На последних фото овощей было мало», «Три дня подряд сон меньше 6 часов», «Энергия выше в дни с тренировкой».
Если данных мало — верни null.

### ai_question_for_user:
Открытый вопрос для рефлексии, без подвоха.
Примеры: «Что помогает вам добавлять овощи к обеду?», «Как вы себя чувствуете после прогулки?», «Что мешает лечь спать раньше?»

### Анализ шагов:
- Меньше 5000: мягко предложить прогулку
- 5000+: отметить как хорошую базу

### Анализ тренировки:
- Не было: не ругать, предложить реалистичную активность
- Была: отметить как плюс

### Анализ питания:
- Переедания нет, но энергия/настроение низкие — предположить связь с составом тарелки
- Фото тарелок помогут увидеть точнее

${conversationStyle}
`;

      const plateSummary = Array.isArray(diary.plate_analysis) && diary.plate_analysis.length > 0
        ? diary.plate_analysis.map((p, i) => `Фото ${i + 1}: ${p.balance_summary || "—"}`).join("\n")
        : null;

      const waterNote = diary.water_glasses_done != null
        ? `Вода: выпито ${diary.water_glasses_done} стакана(ов) из ${diary.water_goal_glasses || 5}`
        : null;

      const dayDesc = [
        diary.steps ? `Шаги: ${diary.steps}` : null,
        diary.activity_comment ? `Активность: ${diary.activity_comment}` : null,
        diary.workout_done ? `Тренировка: ${diary.workout_type || "да"} ${diary.workout_minutes ? `(${diary.workout_minutes} мин)` : ""}` : "Тренировки не было",
        diary.calories ? `Калории: ${diary.calories}` : null,
        diary.breakfast ? `Завтрак: ${diary.breakfast}` : null,
        diary.lunch ? `Обед: ${diary.lunch}` : null,
        diary.dinner ? `Ужин: ${diary.dinner}` : null,
        diary.snacks ? `Перекусы: ${diary.snacks}` : null,
        diary.nutrition_comment ? `Комментарий питание: ${diary.nutrition_comment}` : null,
        diary.overeating_level !== null && diary.overeating_level !== undefined ? `Переедание: ${diary.overeating_level}` : null,
        diary.sweet_cravings ? `Тяга к сладкому: ${diary.sweet_cravings}` : null,
        diary.water_l ? `Вода: ${diary.water_l} л` : null,
        waterNote,
        diary.sleep_hours ? `Сон: ${diary.sleep_hours} ч` : null,
        diary.sleep_quality ? `Качество сна: ${diary.sleep_quality}` : null,
        diary.energy_level ? `Энергия: ${diary.energy_level}/10` : null,
        diary.mood_level ? `Настроение: ${diary.mood_level}/10` : null,
        diary.day_text ? `Комментарий: ${diary.day_text}` : null,
        plateSummary ? `Анализ тарелок:\n${plateSummary}` : null,
      ].filter(Boolean).join("\n");

      const userPrompt = `Пользователь записал день в дневник здоровья.

${dayDesc || "Нет заполненных полей."}

Напиши короткий итог дня и один мягкий фокус на завтра.`;

      const MODEL = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
      const FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
      const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

      const result = await runTask(TASK_TYPES.BODY_INTAKE, {
        systemPrompt,
        userPrompt,
        model: MODEL,
        fallbackModel: FALLBACK,
        reasoningEffort: REASONING_EFFORT,
      });

      const parsed = result.parsed;

      if (parsed && parsed.ai_day_summary) {
        const updatePayload = {
          ai_day_summary: parsed.ai_day_summary,
          ai_focus_tomorrow: parsed.ai_focus_tomorrow,
          ai_positive_observation: parsed.ai_positive_observation || null,
          ai_pattern_observation: parsed.ai_pattern_observation || null,
          ai_question_for_user: parsed.ai_question_for_user || null,
          ai_analysis_status: "success",
          ai_analysis_request_id: `body-diary-ai-${session_id}-${Date.now()}`,
          ai_analysis_model: result.model_used,
          daily_log_version: 2,
          updated_at: new Date().toISOString(),
        };
        await supabase
          .from("body_daily_logs")
          .update(updatePayload)
          .eq("id", savedLog.id);

        // Generate insights (after confirmed save + AI success)
        try {
          await generateBodyInsights({ supabase, ownerId: ownerClient?.anonymous_owner_id, session_id, logDate });
        } catch (insightErr) {
          console.error("[body-diary-save] insight generation skipped:", insightErr.message);
        }
      }

      // Debit credits for AI analysis
      try {
        await debitCreditsForSession({
          sessionId: session_id,
          module: "body",
          resourceType: "body_diary_ai_analysis",
          requestId: `body-diary-ai-${session_id}-${Date.now()}`,
          provider: result.provider,
          model: result.model_used,
        });
      } catch (e) {
        console.error("[credits] body_diary_ai_analysis debit failed:", e.message);
      }

      return res.status(200).json({
        ok: true,
        saved: true,
        daily_log_id: savedLog.id,
        log_date: savedLog.log_date,
        session_id,
        ai_day_summary: parsed?.ai_day_summary || "Спасибо, день записан. Продолжайте наблюдение.",
        ai_positive_observation: parsed?.ai_positive_observation || null,
        ai_pattern_observation: parsed?.ai_pattern_observation || null,
        ai_focus_tomorrow: parsed?.ai_focus_tomorrow || "Постарайтесь сегодня лечь спать вовремя.",
        ai_question_for_user: parsed?.ai_question_for_user || null,
        ai_analysis_status: "success",
        model_used: result.model_used,
        fallback_used: !!result.fallback_used,
      });
    } catch (aiError) {
      // Save succeeded but AI failed — still return success with fallback text
      console.error("[body-diary-save] AI analysis failed:", aiError.message);
      return res.status(200).json({
        ok: true,
        saved: true,
        daily_log_id: savedLog.id,
        analysis_ready: false,
        log_date: savedLog.log_date,
        session_id,
        ai_day_summary: "Спасибо, день записан. Продолжайте наблюдение.",
        ai_focus_tomorrow: "Постарайтесь сегодня лечь спать вовремя.",
      });
    }
  } catch (err) {
    console.error("[body-diary-save] fatal error:", err.message);
    return res.status(500).json({ ok: false, saved: false, error: "Не удалось сохранить дневник. Попробуйте ещё раз." });
  }
}

async function handlePlatePhotoAnalysis(req, res) {
  const { session_id, photos } = req.body || {};

  if (!session_id) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  if (!Array.isArray(photos) || photos.length === 0 || photos.length > 6) {
    return res.status(400).json({ error: "Need 1-6 photos" });
  }

  const platePrompt = readModulePrompt("body", "plate-analysis.md") || "";
  const conversationStyle = readCorePrompt("conversation-style.md") || "";
  const systemPrompt = `${platePrompt}\n\n${conversationStyle}`;

  const MODEL = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
  const FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
  const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

  const results = [];
  const successfullyAnalyzed = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const dataUrl = typeof photo === "string" ? photo : photo.dataUrl || photo.data_url || "";
    const photoName = typeof photo === "object" ? (photo.name || `Фото ${i + 1}`) : `Фото ${i + 1}`;

    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      results.push({
        photo_index: i,
        photo_name: photoName,
        error: "Не удалось прочитать изображение. Попробуйте другое фото.",
        confidence: "unclear",
      });
      continue;
    }

    if (/^data:image\/heic/i.test(dataUrl) || /^data:image\/heif/i.test(dataUrl)) {
      results.push({
        photo_index: i,
        photo_name: photoName,
        error: "Формат HEIC пока не поддерживается. Сохраните фотографию в формате JPG, PNG или WebP и загрузите ещё раз.",
        confidence: "unclear",
      });
      continue;
    }

    const sizeCheck = dataUrl.length * 0.75;
    if (sizeCheck > 10 * 1024 * 1024) {
      results.push({
        photo_index: i,
        photo_name: photoName,
        error: "Фото слишком большое. Выберите файл меньшего размера.",
        confidence: "unclear",
      });
      continue;
    }

    try {
      const userPrompt = `Проанализируй эту фотографию еды.

Фото: вставлено как base64 изображение.

Оцени состав тарелки по правилу тарелки. Верни JSON строго по схеме из инструкции.`;

      const result = await runTask(TASK_TYPES.BODY_INTAKE, {
        systemPrompt,
        userPrompt,
        model: MODEL,
        fallbackModel: FALLBACK,
        reasoningEffort: REASONING_EFFORT,
        images: [dataUrl],
      });

      const parsed = result.parsed;

      if (parsed && parsed.plate_components) {
        const entry = {
          photo_index: i,
          photo_name: photoName,
          detected_foods: parsed.detected_foods || [],
          plate_components: parsed.plate_components,
          balance_summary: parsed.balance_summary || "",
          what_is_missing: parsed.what_is_missing || [],
          gentle_suggestion: parsed.gentle_suggestion || "",
          confidence: parsed.confidence || "medium",
        };
        results.push(entry);
        successfullyAnalyzed.push(entry);
      } else {
        results.push({
          photo_index: i,
          photo_name: photoName,
          error: "Не удалось прочитать изображение. Попробуйте другое фото.",
          confidence: "unclear",
        });
      }
    } catch (err) {
      console.error(`Plate photo ${i} analysis error:`, err.message);
      const isRateLimit = /rate.?limit|429|quota/i.test(err.message);
      const isModelUnavailable = /model.*unavailable|overloaded|5\d\d/i.test(err.message);
      let errorMsg = "Сервис анализа временно недоступен. Попробуйте позже.";
      if (isRateLimit) errorMsg = "Сервис анализа временно перегружен. Попробуйте позже.";
      else if (isModelUnavailable) errorMsg = "Сервис анализа временно недоступен. Попробуйте позже.";

      results.push({
        photo_index: i,
        photo_name: photoName,
        error: errorMsg,
        confidence: "unclear",
      });
    }
  }

  if (successfullyAnalyzed.length > 0) {
    try {
      await debitCreditsForSession({
        sessionId: session_id,
        module: "body",
        resourceType: "plate_analysis",
        requestId: `plate-${session_id}-${Date.now()}`,
        imageCount: successfullyAnalyzed.length,
      });
    } catch (e) {
      console.error("[credits] plate_analysis debit failed:", e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    session_id,
    results,
    total_photos: photos.length,
    analyzed: successfullyAnalyzed.length,
  });
}

const VALID_STAGES = ["intake_completed", "daily_log_submitted", "plate_photo_analysis"];
const MAX_TEXT_LENGTH = 15000;
const MAX_CONVERSATION_TURNS = 50;

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, prefix: "analyze:" });
  const limited = await limit(req, res);
  if (limited) return;

  // Require short-lived client token
  const tokenCheck = requireClientToken(["analyze"])(req, res);
  if (!tokenCheck) return;

  const { text, answers, mode, conversationHistory: rawHistory, depth = 0, isContinuation = false, previousPatientReport = "", previousDoctorReport = "", homeTasks = "", resourceFactors = "", supportPlan, voiceObservations, module: reqModule, stage, intake: intakeData, session_id, daily_log } = req.body || {};

  const activeModule = isValidModule(reqModule) ? reqModule : DEFAULT_MODULE;

  // Validate module
  if (reqModule && !isValidModule(reqModule)) {
    return res.status(400).json({ error: "Invalid module" });
  }

  // Validate stage
  if (stage && !VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: "Invalid stage" });
  }

  // Body intake stage: one-shot analysis from completed intake form
  const bodyIntake = intakeData || answers;
  if (stage === "intake_completed" && activeModule === "body" && bodyIntake) {
    return await handleBodyIntakeAnalysis(req, res, bodyIntake);
  }

  // Body diary daily log stage
  if (stage === "daily_log_submitted" && activeModule === "body" && session_id && daily_log) {
    return await handleDailyLogAnalysis(req, res);
  }

  // Body plate photo analysis stage
  if (stage === "plate_photo_analysis" && activeModule === "body" && session_id) {
    return await handlePlatePhotoAnalysis(req, res);
  }

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Опишите состояние подробнее" });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Текст не должен превышать ${MAX_TEXT_LENGTH} символов` });
  }

  if (rawHistory && Array.isArray(rawHistory) && rawHistory.length > MAX_CONVERSATION_TURNS) {
    return res.status(400).json({ error: `История диалога не должна превышать ${MAX_CONVERSATION_TURNS} сообщений` });
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
  const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || process.env.AI_REASONING_EFFORT || "medium";

  const isFinalReport = activeModule === "support" && depth >= 3;
  let finalSession = null;
  let finalReportRequestId = null;
  let finalSupabase = null;

  // Final Report Reliability Pass: durable save and idempotency.
  // Check status before calling the model to avoid double AI calls and double debits.
  let sessionLookupMs = 0;
  if (isFinalReport) {
    finalSupabase = getSupabase();
    finalReportRequestId = getStableReportRequestId(session_id, depth);
    const tSessionLookup = Date.now();
    try {
      finalSession = await getOrCreateSessionForAnalyze({
        supabase: finalSupabase,
        sessionId: session_id,
        module: activeModule,
        patientText: text,
        conversationHistory: convHistory,
        dialogDepth: depth,
        inviteToken: req.body.invite_token || null,
      });
    } catch (err) {
      console.error("[analyze] getOrCreateSessionForAnalyze failed", err.message);
      return res.status(500).json({ error: "Не удалось подготовить сессию для отчёта." });
    }
    sessionLookupMs = Date.now() - tSessionLookup;

    const statusCheck = await checkReportStatus(finalSupabase, session_id, finalReportRequestId);
    if (statusCheck.status === "ready") {
      const artifacts = await createReportArtifacts({
        supabase: finalSupabase,
        sessionId: session_id,
        module: activeModule,
        anonymousOwnerId: finalSession.anonymous_owner_id,
      });
      const cachedPayload = buildReportResponsePayload({
        userReport: statusCheck.data.user_report,
        doctorReport: statusCheck.data.doctor_report,
        careRecommendation: statusCheck.data.care_recommendation,
        modelUsed: MODEL_TRIAGE,
        fallbackUsed: false,
        provider: getActiveProvider(),
        taskType: TASK_TYPES.PATIENT_DIALOG,
        requestDuration: 0,
        publicCode: statusCheck.data.public_code,
        accessToken: artifacts.accessToken,
        continuationCode: artifacts.continuationCode,
        debugInfo: { cached: true, report_request_id: finalReportRequestId },
      });
      return res.status(200).json(cachedPayload);
    }
    if (statusCheck.status === "processing") {
      return res.status(202).json({
        type: "processing",
        message: "Отчёт ещё формируется. Подождите немного.",
        report_request_id: finalReportRequestId,
      });
    }

    await setReportStatus(finalSupabase, session_id, {
      status: REPORT_STATUS.PROCESSING,
      requestId: finalReportRequestId,
      startedAt: new Date().toISOString(),
    });
  }

  try {
    const t0 = Date.now();
    const sessionIdHash = session_id ? session_id.slice(-8) : "none";
    const promptChars = (systemPrompt || "").length + (userPrompt || "").length;
    const historyChars = (historyText || "").length;
    const msgCount = Array.isArray(convHistory) ? convHistory.length : 0;
    console.log(JSON.stringify({
      stage: "analyze_request_start",
      session: sessionIdHash,
      model: MODEL_TRIAGE,
      depth,
      continuation: isContinuation,
      msg_count: msgCount,
      prompt_chars: promptChars,
      history_chars: historyChars,
      reasoning_effort: REASONING_EFFORT,
    }));

    const result = await runTask(TASK_TYPES.PATIENT_DIALOG, {
      systemPrompt,
      userPrompt,
      model: MODEL_TRIAGE,
      fallbackModel: MODEL_FALLBACK,
      reasoningEffort: REASONING_EFFORT,
      finalReport: activeModule === "support" && depth >= 3,
    });

    const t1 = Date.now();
    console.log(JSON.stringify({
      stage: "openai_request_complete",
      session: sessionIdHash,
      elapsed_ms: t1 - t0,
      model_used: result.model_used,
      fallback_used: result.fallback_used,
      request_duration: result.request_duration,
    }));

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

    if (parsed.type === "questions" && Array.isArray(parsed.questions)) {
      try {
        await debitCreditsForSession({
          sessionId: req.body.session_id,
          module: activeModule,
          resourceType: "support_analyze",
          requestId: `analyze-questions-${req.body.session_id || "no-session"}-${Date.now()}`,
          provider: result.provider,
          model: modelUsed,
        });
      } catch (e) {
        console.error("[credits] support_analyze questions debit failed:", e.message);
      }
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

    // =================== FINAL REPORT RELIABILITY PASS ===================
    // Only support module uses this durable finalization flow.
    // Status check and session creation were already done before the model call.
    if (isFinalReport) {
      const supabase = finalSupabase;
      const reportRequestId = finalReportRequestId;
      const session = finalSession;

      let userPart = parsed?.user_report || "";
      let doctorPart = parsed?.doctor_report || "";
      let careRec = parsed?.care_recommendation || null;
      let modelUsedFinal = modelUsed;
      let fallbackUsedFinal = fallbackUsed;
      let repairInfo = { repairAttempted: false };

      // Allow ONE AI repair call only for JSON parse / schema failure.
      if (!parsed) {
        const repairResult = await repairInvalidJson({
          rawResponse: raw,
          systemPrompt,
          userPrompt,
          model: MODEL_TRIAGE,
          fallbackModel: MODEL_FALLBACK,
          reasoningEffort: REASONING_EFFORT,
        });
        repairInfo = {
          repairAttempted: true,
          repairSucceeded: !!repairResult.parsed,
          repairFailed: !repairResult.parsed,
        };
        if (repairResult.parsed) {
          userPart = repairResult.parsed.user_report || "";
          doctorPart = repairResult.parsed.doctor_report || "";
          careRec = repairResult.parsed.care_recommendation || null;
          modelUsedFinal = repairResult.model_used || modelUsed;
          fallbackUsedFinal = repairResult.fallback_used || fallbackUsed;
        } else {
          await setReportStatus(supabase, session_id, {
            status: REPORT_STATUS.FAILED,
            requestId: reportRequestId,
            errorCode: "json_parse_failed",
          });
          return res.status(500).json({
            error: "Не удалось распознать отчёт. Попробуйте ещё раз позже.",
            report_request_id: reportRequestId,
          });
        }
      }

      // Deterministic style fix (no AI call).
      userPart = deterministicUserReportFix(userPart);

      // --- Care recommendation: backend minimum level override ---
      const fullConversation = (historyText || "") + " " + (text || "");
      const hasSuicidalIntent = hasOwnRiskPattern(fullConversation, /суицидальн|план.*покончить|таблетк.*собрал|прощальн.*письм/iu);
      const hasSuicidalPlan = hasOwnRiskPattern(fullConversation, /подробн.*план|знаю.*как.*сделаю|когда.*сделаю/iu);
      const hasPsychosis = hasOwnRiskPattern(fullConversation, /голос|слыш.*голос|вид.*то.*не.*вид|параной|след.*за.*мной|управля.*мысл/iu);
      const hasMania = hasOwnRiskPattern(fullConversation, /не.*спал.*дня|энерги.*слишком|бешен.*план|потратил.*все.*деньг|необычн.*сил/iu);
      const hasRiskToOthers = hasOwnRiskPattern(fullConversation, /причин.*вред.*друг|убь.*кого|опасен.*для.*окруж/iu);
      const hasSevereDistress = /больше.*не.*могу|не.*выдерж|сдавать|край.*тяжел/iu.test(fullConversation);
      const hasFunctionalImpairment = /не.*работ|увол|не.*учёб|леж.*цел.*день|не.*вста|не.*выхож/iu.test(fullConversation);
      const hasSomaticSymptoms = /боль.*в.*груд|сердцебиен|одыш|обморок|головокружен|сдавил.*виск/iu.test(fullConversation);
      const hasTraumaticUncertainty = /пропал.*без.*вест|нет.*информац|судьб.*неизвест|не.*знаю.*жив|потерян.*связь/iu.test(fullConversation);
      const hasSleepDisruption = /не.*спл|просыпа.*паник|бессонн|спл.*3.*час|спл.*4.*час/iu.test(fullConversation);
      const hasSubstanceUse = /пил.*бутылк|алкоголь.*помога|выпива|опохмел|трясутся.*рук.*по.*утр/iu.test(fullConversation);
      const hasSelfHarm = hasOwnRiskPattern(fullConversation, /реж.*себ|самоповреж|причин.*себе.*вред/iu);

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

      careRec = programmaticCareFix({
        careRec,
        minimumLevel,
        hasSuicidalIntent,
        hasSuicidalPlan,
        hasPsychosis,
        hasMania,
        hasRiskToOthers,
        hasSevereDistress,
        hasFunctionalImpairment,
        hasSomaticSymptoms,
        hasTraumaticUncertainty,
        hasSleepDisruption,
        hasSubstanceUse,
        hasSelfHarm,
      });

      // Final fallback for user_report if empty.
      if (!userPart) {
        userPart = "Нам не удалось сформулировать итог разговора достаточно точно. Ваш диалог сохранён, и к нему можно вернуться позже по коду доступа.";
      }

      // Quality check is logged but not blocking — deterministic style fix already applied.
      const qualityCheck = checkReportQuality(userPart, text, historyText);
      if (!qualityCheck.pass) {
        console.log("[analyze] user report quality issues after deterministic fix:", qualityCheck.violations.join("; "));
      }

      const debugInfo = {
        raw_model_response: raw,
        parsed_user_report: userPart,
        parsed_doctor_report: doctorPart,
        care_recommendation: careRec,
        prompt_version: PROMPT_VERSION,
        quality_check: qualityCheck,
        repair: repairInfo,
        minimum_level: minimumLevel,
        report_request_id: reportRequestId,
      };

      const extraJsonData = {
        dialogDepth: depth,
        previousPatientReport: req.body.previousPatientReport || "",
        previousDoctorReport: req.body.previousDoctorReport || "",
        homeTasks: req.body.homeTasks || "",
        resourceFactors: req.body.resourceFactors || "",
        questions: req.body.questions || null,
        answers: req.body.answers || {},
        voiceObservations: req.body.voiceObservations || null,
        _debug: debugInfo,
        care_recommendation: careRec,
      };

      // 1. Durable save first.
      const tStep0 = Date.now();
      const saved = await saveFinalReportToSession({
        supabase,
        sessionId: session_id,
        userReport: userPart,
        doctorReport: doctorPart,
        careRecommendation: careRec,
        reportRequestId,
        status: REPORT_STATUS.READY,
        completedAt: new Date().toISOString(),
        extraJsonData,
      });
      const saveReportMs = Date.now() - tStep0;

      if (!saved) {
        await setReportStatus(supabase, session_id, {
          status: REPORT_STATUS.FAILED,
          requestId: reportRequestId,
          errorCode: "save_failed",
        });
        return res.status(500).json({
          error: "Не удалось сохранить готовый отчёт. Попробуйте ещё раз позже.",
          report_request_id: reportRequestId,
        });
      }

      // 2. Create access token and continuation credential AFTER save.
      const tStep1 = Date.now();
      const artifacts = await createReportArtifacts({
        supabase,
        sessionId: session_id,
        module: activeModule,
        anonymousOwnerId: session.anonymous_owner_id,
      });
      const credentialCreationMs = Date.now() - tStep1;

      // 3. Debit only after durable save.
      const tStep2 = Date.now();
      const debitResult = await debitCreditsForSession({
        sessionId: session_id,
        module: activeModule,
        resourceType: "support_analyze",
        requestId: reportRequestId,
        provider: result.provider,
        model: modelUsedFinal,
        inputTokens: result.input_tokens ?? null,
        outputTokens: result.output_tokens ?? null,
      });
      const usageDebitMs = Date.now() - tStep2;

      if (!debitResult.charged) {
        console.error("[analyze] final report debit failed", debitResult);
      }

      const t2 = Date.now();
      console.log(JSON.stringify({
        stage: "response_sent",
        session: sessionIdHash,
        total_elapsed_ms: t2 - t0,
        save_report_ms: saveReportMs,
        credential_creation_ms: credentialCreationMs,
        usage_debit_ms: usageDebitMs,
        report_request_id: reportRequestId,
        debit_charged: debitResult.charged,
      }));

      const responsePayload = buildReportResponsePayload({
        userReport: userPart,
        doctorReport: doctorPart,
        careRecommendation: careRec,
        modelUsed: modelUsedFinal,
        fallbackUsed: fallbackUsedFinal,
        provider: result.provider,
        taskType: result.task_type,
        requestDuration: result.request_duration,
        publicCode: session.public_code,
        accessToken: artifacts.accessToken,
        continuationCode: artifacts.continuationCode,
        debugInfo,
        timing: {
          session_lookup_ms: sessionLookupMs,
          save_report_ms: saveReportMs,
          credential_creation_ms: credentialCreationMs,
          usage_debit_ms: usageDebitMs,
        },
      });
      return res.status(200).json(responsePayload);
    }

    // Non-durable fallback for non-support or early-depth final reports.
    let userPart = parsed.user_report || "";
    const doctorPart = parsed.doctor_report || "";
    let careRec = parsed.care_recommendation || null;
    userPart = deterministicUserReportFix(userPart);
    const fullConversation = (historyText || "") + " " + (text || "");
    const hasSuicidalIntent = hasOwnRiskPattern(fullConversation, /суицидальн|план.*покончить|таблетк.*собрал|прощальн.*письм/iu);
    const hasSuicidalPlan = hasOwnRiskPattern(fullConversation, /подробн.*план|знаю.*как.*сделаю|когда.*сделаю/iu);
    const hasPsychosis = hasOwnRiskPattern(fullConversation, /голос|слыш.*голос|вид.*то.*не.*вид|параной|след.*за.*мной|управля.*мысл/iu);
    const hasMania = hasOwnRiskPattern(fullConversation, /не.*спал.*дня|энерги.*слишком|бешен.*план|потратил.*все.*деньг|необычн.*сил/iu);
    const hasRiskToOthers = hasOwnRiskPattern(fullConversation, /причин.*вред.*друг|убь.*кого|опасен.*для.*окруж/iu);
    const hasSevereDistress = /больше.*не.*могу|не.*выдерж|сдавать|край.*тяжел/iu.test(fullConversation);
    const hasFunctionalImpairment = /не.*работ|увол|не.*учёб|леж.*цел.*день|не.*вста|не.*выхож/iu.test(fullConversation);
    const hasSomaticSymptoms = /боль.*в.*груд|сердцебиен|одыш|обморок|головокружен|сдавил.*виск/iu.test(fullConversation);
    const hasTraumaticUncertainty = /пропал.*без.*вест|нет.*информац|судьб.*неизвест|не.*знаю.*жив|потерян.*связь/iu.test(fullConversation);
    const hasSleepDisruption = /не.*спл|просыпа.*паник|бессонн|спл.*3.*час|спл.*4.*час/iu.test(fullConversation);
    const hasSubstanceUse = /пил.*бутылк|алкоголь.*помога|выпива|опохмел|трясутся.*рук.*по.*утр/iu.test(fullConversation);
    const hasSelfHarm = hasOwnRiskPattern(fullConversation, /реж.*себ|самоповреж|причин.*себе.*вред/iu);
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
    careRec = programmaticCareFix({
      careRec,
      minimumLevel,
      hasSuicidalIntent,
      hasSuicidalPlan,
      hasPsychosis,
      hasMania,
      hasRiskToOthers,
      hasSevereDistress,
      hasFunctionalImpairment,
      hasSomaticSymptoms,
      hasTraumaticUncertainty,
      hasSleepDisruption,
      hasSubstanceUse,
      hasSelfHarm,
    });
    if (!userPart) {
      userPart = "Нам не удалось сформулировать итог разговора достаточно точно. Ваш диалог сохранён, и к нему можно вернуться позже по коду доступа.";
    }
    const report = userPart.includes("===USER_REPORT===")
      ? userPart
      : `===USER_REPORT===\n\n${userPart}\n\n===DOCTOR_REPORT===\n\n${doctorPart}`;
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

// ============================================================
// Body Insights Generation
// ============================================================

async function generateBodyInsights({ supabase, ownerId, session_id, logDate }) {
  if (!ownerId) return;

  const { fingerprint } = await import("../lib/session/continuation-store.js");

  // Get recent daily logs for this owner
  const { data: ownerSessions } = await supabase
    .from("body_clients")
    .select("session_id")
    .eq("anonymous_owner_id", ownerId);
  const ownerSessionIds = (ownerSessions || []).map(s => s.session_id);
  if (ownerSessionIds.length === 0) return;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: recentLogs } = await supabase
    .from("body_daily_logs")
    .select("log_date, steps, sleep_hours, energy_level, workout_done, plate_photos, overeating_level")
    .in("session_id", ownerSessionIds)
    .gte("log_date", sevenDaysAgo)
    .order("log_date", { ascending: false });

  const logs = recentLogs || [];
  if (logs.length < 2) return; // Need at least 2 days for patterns

  const insights = [];

  // Insight: low steps pattern
  const lowStepDays = logs.filter(l => l.steps != null && l.steps < 5000);
  if (lowStepDays.length >= 3) {
    const fp = `low_steps:7d:${fingerprint(ownerId)}`;
    insights.push({
      insight_type: "activity_pattern",
      insight_date: logDate,
      title: "Мало шагов",
      insight_text: `За последние ${logs.length} дней ${lowStepDays.length} раз шагов было меньше 5000. Прогулки помогают расходу энергии и настроению.`,
      priority: "normal",
      fingerprint: fp,
      source_kind: "daily_logs",
    });
  }

  // Insight: poor sleep pattern
  const poorSleepDays = logs.filter(l => l.sleep_hours != null && l.sleep_hours < 6);
  if (poorSleepDays.length >= 3) {
    const fp = `poor_sleep:7d:${fingerprint(ownerId)}`;
    insights.push({
      insight_type: "sleep_pattern",
      insight_date: logDate,
      title: "Мало сна",
      insight_text: `${poorSleepDays.length} из ${logs.length} дней сон был меньше 6 часов. Это может влиять на энергию и аппетит.`,
      priority: "normal",
      fingerprint: fp,
      source_kind: "daily_logs",
    });
  }

  // Insight: no photos
  const daysWithoutPhotos = logs.filter(l => !l.plate_photos || l.plate_photos.length === 0);
  if (logs.length >= 3 && daysWithoutPhotos.length === logs.length) {
    const fp = `no_photos:7d:${fingerprint(ownerId)}`;
    insights.push({
      insight_type: "nutrition_pattern",
      insight_date: logDate,
      title: "Нет фото питания",
      insight_text: `Фото тарелок помогают точнее оценить состав. Загружайте хотя бы одно фото в день.`,
      priority: "low",
      fingerprint: fp,
      source_kind: "plate_history",
    });
  }

  // Save insights (upsert by fingerprint)
  for (const insight of insights) {
    const payload = {
      owner_type: "anonymous_profile",
      owner_id: ownerId,
      status: "active",
      updated_at: new Date().toISOString(),
      ...insight,
    };

    const { data: existing } = await supabase
      .from("body_insights")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("fingerprint", insight.fingerprint)
      .maybeSingle();

    if (!existing) {
      await supabase.from("body_insights").insert(payload);
    }
  }
}
