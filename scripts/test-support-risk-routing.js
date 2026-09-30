import assert from "node:assert/strict";
import { synchronizeUserReportNextStep } from "../lib/report/finalize.js";

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const timer = originalSetInterval(...args);
  timer.unref?.();
  return timer;
};
const { buildUserRiskAssessmentText, deriveMinimumCareLevel, hasOwnRiskPattern, programmaticCareFix } = await import("../api/analyze.js");
globalThis.setInterval = originalSetInterval;

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
);
assert.match(alignedUrgentReport, /нужна срочная помощь сегодня/iu);
assert.match(alignedUrgentReport, /позвоните 112/iu);
assert.match(alignedUrgentReport, /Не оставайтесь сейчас один/iu);

console.log("Support risk routing regression tests passed.");
