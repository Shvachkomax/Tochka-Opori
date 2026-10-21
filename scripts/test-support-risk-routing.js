import assert from "node:assert/strict";
import { deterministicUserReportFix, synchronizeUserReportNextStep } from "../lib/report/finalize.js";

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const {
  buildCrisisResponse,
  buildUserRiskAssessmentText,
  deriveMinimumCareLevel,
  detectSupportCrisisSignals,
  detectSupportSomaticSignals,
  getSupportCrisisAction,
  hasOwnRiskPattern,
  programmaticCareFix,
  SUPPORT_CRISIS_QUESTIONS,
} = await import("../api/analyze.js");
globalThis.setInterval = originalSetInterval;
const { isAnMedSupportFeatureEnabled } = await import("../lib/security/module-availability.js");

assert.equal(isAnMedSupportFeatureEnabled("support", { brand: "anmed", supportOnly: "false" }), true);
assert.equal(isAnMedSupportFeatureEnabled("body", { brand: "anmed", supportOnly: "false" }), false, "crisis routing does not run in Health/Body");
assert.equal(isAnMedSupportFeatureEnabled("support", { brand: "pneumointegration", supportOnly: "false" }), false, "AnMed-specific routing remains inactive in Pneumointegration");

const selfHarmPattern = /реж.*себ|самоповреж|причин.*себе.*вред/iu;
const suicidalIntentPattern = /суицидальн|план.*покончить|таблетк.*собрал|прощальн.*письм/iu;
const suicidalPlanPattern = /подробн.*план|знаю.*как.*сделаю|когда.*сделаю/iu;

const safeScenario = "Это вымышленный сценарий. Я не думаю о самоповреждении. Мыслей причинить себе вред нет. Контроль над собой сохраняю, состояние умеренное.";
assert.equal(hasOwnRiskPattern(safeScenario, selfHarmPattern), false, "explicit self-harm denials must not be classified as positive risk");
assert.equal(hasOwnRiskPattern(safeScenario, selfHarmPattern, { negationAware: false }), true, "non-Support callers retain the existing detector behavior");
assert.equal(hasOwnRiskPattern(safeScenario, suicidalIntentPattern), false);
assert.equal(hasOwnRiskPattern(safeScenario, suicidalPlanPattern), false);
assert.equal(hasOwnRiskPattern("Синтетический пациент отрицает мысли причинить себе вред и сохраняет контроль.", selfHarmPattern), false);

const userOnlyRiskText = buildUserRiskAssessmentText({
  text: "Это безопасный синтетический случай.",
  answers: { 0: "Нет, мыслей причинить себе вред не было." },
  conversationHistory: [
    { role: "assistant", questions: ["Были ли мысли причинить себе вред?"] },
    { role: "user", content: "Контроль над собой сохраняю." },
  ],
});
assert.doesNotMatch(userOnlyRiskText, /Были ли мысли причинить себе вред/);
assert.equal(hasOwnRiskPattern(userOnlyRiskText, selfHarmPattern), false, "assistant questions must not count as patient risk evidence");
const positiveAnswerRiskText = buildUserRiskAssessmentText({
  text: "Обычный синтетический ввод.",
  answers: { 0: "Да, я планирую причинить себе вред сегодня." },
  conversationHistory: [{ role: "assistant", questions: ["Есть ли риск?"] }],
});
assert.equal(hasOwnRiskPattern(positiveAnswerRiskText, selfHarmPattern), true, "current user answers must remain part of risk evidence");

const safeMinimum = deriveMinimumCareLevel({
  riskLevel: null,
  suicidalIntent: false,
  suicidalPlan: false,
  selfHarmRisk: hasOwnRiskPattern(safeScenario, selfHarmPattern),
  psychosisRedFlags: false,
  maniaRedFlags: false,
  riskToOthers: false,
  functionalImpairment: false,
  severeDistress: false,
  somaticSymptoms: false,
  traumaticUncertainty: false,
  sleepDisruption: true,
  substanceUse: false,
}, "support");
assert.equal(safeMinimum, "professional_contact", "moderate sleep disruption remains non-emergency routing");

const safeCare = programmaticCareFix({
  careRec: { level: "self_support", timeframe: "within_weeks", specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] },
  minimumLevel: safeMinimum,
  hasSuicidalIntent: false,
  hasSuicidalPlan: false,
  hasPsychosis: false,
  hasMania: false,
  hasRiskToOthers: false,
  hasSevereDistress: false,
  hasFunctionalImpairment: false,
  hasSomaticSymptoms: false,
  hasTraumaticUncertainty: false,
  hasSleepDisruption: true,
  hasSubstanceUse: false,
  hasSelfHarm: false,
});
assert.equal(safeCare.level, "professional_contact");

const inconsistentSafeReport = [
  "1. Что с вами сейчас происходит",
  "Синтетическое умеренное состояние, функционирование сохранено.",
  "6. Следующий шаг",
  "Здесь нужна срочная помощь сегодня. Пожалуйста, позвоните 112 и не оставайтесь сейчас один.",
].join("\n\n");
const alignedSafeReport = synchronizeUserReportNextStep(inconsistentSafeReport, safeCare);
assert.match(alignedSafeReport, /Рекомендую в ближайшие дни связаться со специалистом/);
assert.doesNotMatch(alignedSafeReport, /нужна срочная помощь сегодня|позвоните 112|не оставайтесь сейчас один/iu);
assert.match(alignedSafeReport, /Синтетическое умеренное состояние/);

const highRiskScenario = "Я думаю о суицидальных мыслях. Я знаю, когда и как сделаю это, у меня есть подробный план.";
const highRiskIntent = hasOwnRiskPattern(highRiskScenario, suicidalIntentPattern);
const highRiskPlan = hasOwnRiskPattern(highRiskScenario, suicidalPlanPattern);
assert.equal(highRiskIntent, true);
assert.equal(highRiskPlan, true);
const denialWithSeparateActivePlan = "Мыслей о самоповреждении нет но у меня есть подробный план и я знаю, когда и как это сделаю.";
assert.equal(hasOwnRiskPattern(denialWithSeparateActivePlan, suicidalPlanPattern), true, "a denial must not mask a positive risk in another clause");
const urgentMinimum = deriveMinimumCareLevel({
  riskLevel: null,
  suicidalIntent: highRiskIntent,
  suicidalPlan: highRiskPlan,
  selfHarmRisk: false,
  psychosisRedFlags: false,
  maniaRedFlags: false,
  riskToOthers: false,
  functionalImpairment: false,
  severeDistress: false,
  somaticSymptoms: false,
  traumaticUncertainty: false,
  sleepDisruption: false,
  substanceUse: false,
}, "support");
const urgentCare = programmaticCareFix({
  careRec: { level: "professional_contact", timeframe: "within_days", specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] },
  minimumLevel: urgentMinimum,
  hasSuicidalIntent: highRiskIntent,
  hasSuicidalPlan: highRiskPlan,
  hasPsychosis: false,
  hasMania: false,
  hasRiskToOthers: false,
  hasSevereDistress: false,
  hasFunctionalImpairment: false,
  hasSomaticSymptoms: false,
  hasTraumaticUncertainty: false,
  hasSleepDisruption: false,
  hasSubstanceUse: false,
  hasSelfHarm: false,
});
assert.equal(urgentCare.level, "urgent_help");
assert.equal(urgentCare.timeframe, "today");

const alignedUrgentReport = synchronizeUserReportNextStep(
  "1. Что происходит\n\nСинтетический случай.\n\n6. Следующий шаг\n\nОбсудите это со специалистом в ближайшие дни.",
  urgentCare,
  { anMed: true },
);
assert.match(alignedUrgentReport, /нужна срочная помощь сейчас/iu);
assert.match(alignedUrgentReport, /позвоните 112 или 103/iu);
assert.match(alignedUrgentReport, /Не оставайтесь сейчас один/iu);
const otherSupportUrgentReport = synchronizeUserReportNextStep(
  "1. Что происходит\n\nСинтетический случай.\n\n6. Следующий шаг\n\nОбсудите это.",
  urgentCare,
);
assert.match(otherSupportUrgentReport, /нужна срочная помощь сегодня/iu, "non-AnMed Support keeps its existing urgent copy");
assert.doesNotMatch(otherSupportUrgentReport, /112 или 103 сейчас/iu);

const directDeathThoughts = detectSupportCrisisSignals("У меня участились мысли о смерти, я почти не ем и стал чаще пить алкоголь.");
assert.equal(directDeathThoughts.detected, true, "direct death thoughts must enter the AnMed crisis route");
assert.equal(getSupportCrisisAction(directDeathThoughts, false), "ask_safety_questions");
assert.equal(SUPPORT_CRISIS_QUESTIONS.length, 4, "the crisis route asks only a short safety set");
assert.match(SUPPORT_CRISIS_QUESTIONS[0], /сейчас в безопасности/iu);
assert.match(SUPPORT_CRISIS_QUESTIONS[1], /намерение или конкретный план/iu);
assert.match(SUPPORT_CRISIS_QUESTIONS[2], /один\/одна/iu);
assert.match(SUPPORT_CRISIS_QUESTIONS[3], /позвонить или написать/iu);

const passiveDeathWish = detectSupportCrisisSignals("Всем было бы легче без меня.");
assert.equal(passiveDeathWish.detected, true, "passive death-wish wording must enter the crisis route");
assert.equal(detectSupportCrisisSignals("Я хочу покончить с собой.").detected, true, "direct intent wording must enter the crisis route");
assert.equal(detectSupportCrisisSignals("Я не хочу покончить с собой.").detected, false, "explicitly denied intent is not positive evidence");
assert.equal(detectSupportCrisisSignals("Нет, мыслей о смерти у меня не было.").detected, false, "an explicit denial alone should not be treated as active risk");
assert.equal(detectSupportCrisisSignals("Мой брат умер, мне тяжело переживать утрату.").detected, false, "third-party death must not be classified as the patient's own suicidal thought");
assert.equal(detectSupportCrisisSignals("Мой брат умер, и я тоже думаю о смерти.").detected, true, "third-party context must not suppress the patient's separate signal");

const planAnswer = buildCrisisResponse({
  initialText: "Мне кажется, всем было бы легче без меня.",
  markers: passiveDeathWish.markers,
  answers: { safety: "Я сейчас не в безопасности", plan: "Да, у меня есть конкретный план", alone: "Я один", support: "Могу позвонить подруге" },
});
assert.equal(planAnswer.emergencyRecommended, true, "reported plan or immediate danger must recommend emergency support");
assert.equal(planAnswer.careRecommendation.level, "urgent_help");
assert.match(planAnswer.userReport, /112 или 103 сейчас/);
assert.match(planAnswer.userReport, /позвоните 112 или 103 сейчас/);
assert.match(planAnswer.userReport, /подруг/);
assert.match(planAnswer.doctorReport, /конкретный план/);
assert.doesNotMatch(planAnswer.userReport, /(?:только\s+)?в ближайшие дни/iu);
assert.equal(getSupportCrisisAction(passiveDeathWish, true), "finalize", "crisis answers finalize without resuming ordinary rounds");

const planWithSafetyDenial = buildCrisisResponse({
  initialText: "Я не хочу жить.",
  markers: ["мысли о смерти"],
  answers: { safety: "Я сейчас в безопасности", plan: "Да, у меня есть конкретный план", alone: "Не один", support: "Рядом близкий" },
});
assert.equal(planWithSafetyDenial.emergencyRecommended, true, "a plan requires the emergency route even when the person reports current safety");

const deniedImmediateDanger = buildCrisisResponse({
  initialText: "У меня были мысли о смерти.",
  markers: directDeathThoughts.markers,
  answers: { safety: "Я сейчас в безопасности", plan: "Нет намерения и плана", alone: "Я не один", support: "Могу позвонить близкому" },
});
assert.equal(deniedImmediateDanger.emergencyRecommended, false, "clear safety and plan denials should be reflected accurately");
assert.equal(deniedImmediateDanger.careRecommendation.timeframe, "today");
assert.match(deniedImmediateDanger.userReport, /свяжитесь сегодня с близким человеком и специалистом/);

const unclearPlan = buildCrisisResponse({
  initialText: "У меня были мысли о смерти.",
  markers: directDeathThoughts.markers,
  answers: { safety: "Я сейчас в безопасности", plan: "Не могу ответить", alone: "Один", support: "Пока не знаю" },
});
assert.equal(unclearPlan.emergencyRecommended, true, "unanswered plan questions leave safety unconfirmed");
assert.match(unclearPlan.userReport, /112 или 103/);

const interruptedCrisis = buildCrisisResponse({ initialText: "У меня участились мысли о смерти.", markers: directDeathThoughts.markers });
assert.equal(interruptedCrisis.emergencyRecommended, true, "safety remains unconfirmed if the patient interrupts before answering");
assert.match(interruptedCrisis.userReport, /Не ждите ответа сервиса/);
assert.match(interruptedCrisis.userReport, /Короткий план безопасности/iu);

const alcoholCrisis = buildCrisisResponse({
  initialText: "Думаю о смерти и выпиваю, чтобы стало легче.",
  markers: directDeathThoughts.markers,
  answers: { safety: "В безопасности", plan: "Нет плана и намерения", alone: "Не один", support: "Есть близкий" },
});
assert.ok(alcoholCrisis.careRecommendation.reasons.includes("substance_use"));
assert.match(alcoholCrisis.userReport, /не употреблять алкоголь/iu);
assert.doesNotMatch(alcoholCrisis.userReport, /алкоголь поможет|выпейте|используйте алкоголь для/iu);

const somaticScenario = "Последние недели плохо сплю и тревожусь, аппетит почти пропал, похудела на 5 кг за месяц, часто бывает сердцебиение.";
const somaticSignals = detectSupportSomaticSignals(somaticScenario);
assert.equal(somaticSignals.palpitations, true);
assert.equal(somaticSignals.weightChange, true);
assert.equal(somaticSignals.appetiteChange, true);
const somaticMinimum = deriveMinimumCareLevel({
  riskLevel: null, suicidalIntent: false, suicidalPlan: false, selfHarmRisk: false,
  psychosisRedFlags: false, maniaRedFlags: false, riskToOthers: false,
  functionalImpairment: false, severeDistress: false, somaticSymptoms: somaticSignals.hasSomaticSymptoms,
  traumaticUncertainty: false, sleepDisruption: true, substanceUse: false,
}, "support");
const somaticCare = programmaticCareFix({
  careRec: { level: "self_support", timeframe: "within_weeks", specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] },
  minimumLevel: somaticMinimum,
  hasSuicidalIntent: false, hasSuicidalPlan: false, hasPsychosis: false, hasMania: false,
  hasRiskToOthers: false, hasSevereDistress: false, hasFunctionalImpairment: false,
  hasSomaticSymptoms: somaticSignals.hasSomaticSymptoms, hasTraumaticUncertainty: false,
  hasSleepDisruption: true, hasSubstanceUse: false, hasSelfHarm: false,
});
assert.ok(somaticCare.specialist_types.includes("general_physician"));
const somaticReport = synchronizeUserReportNextStep("1. Что происходит\n\nОписанные изменения заметны.\n\n6. Следующий шаг\n\nОбсудите это.", somaticCare, { anMed: true });
assert.match(somaticReport, /могут иметь разные причины/iu);
assert.match(somaticReport, /обсудить их с врачом/iu);
assert.doesNotMatch(somaticReport, /диагноз|это точно тревога/iu);
const correctedGrammar = deterministicUserReportFix("Из-за тревоги еды стало почти не быть.", { anMed: true });
assert.match(correctedGrammar, /почти не удавалось есть/iu);
assert.doesNotMatch(correctedGrammar, /еды стало почти не быть/iu);

console.log("Support risk routing regression tests passed.");
