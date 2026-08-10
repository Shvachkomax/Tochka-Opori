// Module isolation tests for shared intent router
// Proves that the shared layer can be invoked with module="body"
// without exposing Support-specific sections or messages.

import { detectIntent, buildFallbackResponse } from "../lib/intent-router.js";
import { supportConfig } from "../lib/intent-configs/support.js";
import { bodyConfig } from "../lib/intent-configs/body.js";

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

console.log("=== MODULE ISOLATION TESTS ===\n");

// --- Support module tests ---
console.log("--- Support module ---");

const supportNav = detectIntent("Где мои практики?", supportConfig);
assert(supportNav?.intent_type === "navigation", "Support: navigation intent detected");
assert(supportNav?.section === "practices", "Support: correct section");
assert(supportNav?.answer?.includes("Мои практики"), "Support: answer mentions practices");

const supportHandoff = detectIntent("Хочу поговорить с врачом", supportConfig);
assert(supportHandoff?.intent_type === "handoff", "Support: handoff detected");
assert(supportHandoff?.cta === "service_request", "Support: CTA is service_request");
assert(!supportHandoff?.answer?.includes("дневник"), "Support: handoff doesn't mention diary");

const supportMed = detectIntent("Какие таблетки начать принимать?", supportConfig);
assert(supportMed?.intent_type === "medication", "Support: medication detected");
assert(!supportMed?.answer?.includes("тарелк"), "Support: medication doesn't mention plate");

const supportSafety = detectIntent("Хочу убить себя", supportConfig);
assert(supportSafety?.intent_type === "safety", "Support: safety intent detected");
assert(supportSafety?.severity === "critical", "Support: critical severity");

const supportFallback = buildFallbackResponse("ai_error", supportConfig);
assert(supportFallback?.intent_type === "error", "Support: fallback response");
assert(supportFallback?.answer?.includes("попробовать ещё раз"), "Support: fallback message");

console.log("");

// --- Body module tests ---
console.log("--- Body module ---");

const bodyNav = detectIntent("Где дневник питания?", bodyConfig);
assert(bodyNav?.intent_type === "navigation", "Body: navigation intent detected");
assert(bodyNav?.section === "diary", "Body: correct section");
assert(bodyNav?.answer?.includes("дневник"), "Body: answer mentions diary");
assert(!bodyNav?.answer?.includes("практик"), "Body: answer doesn't mention practices");

const bodyNav2 = detectIntent("Где графики веса?", bodyConfig);
assert(bodyNav2?.intent_type === "navigation", "Body: charts navigation");
assert(bodyNav2?.section === "charts", "Body: charts section");
assert(!bodyNav2?.answer?.includes("кабинет ниже"), "Body: doesn't use Support wording");

const bodyHandoff = detectIntent("Хочу консультацию", bodyConfig);
assert(bodyHandoff?.intent_type === "handoff", "Body: handoff detected");
assert(bodyHandoff?.answer?.includes("специалисту"), "Body: handoff mentions specialist");

const bodyMed = detectIntent("Какие добавки принимать?", bodyConfig);
assert(bodyMed?.intent_type === "medication", "Body: medication detected");
assert(bodyMed?.answer?.includes("врача"), "Body: medication mentions doctor");
assert(!bodyMed?.answer?.includes("практик"), "Body: medication doesn't mention practices");

const bodySafety = detectIntent("Сильная боль в груди", bodyConfig);
assert(bodySafety?.intent_type === "safety", "Body: safety intent detected");

const bodyFallback = buildFallbackResponse("network_error", bodyConfig);
assert(bodyFallback?.intent_type === "error", "Body: fallback response");
assert(!bodyFallback?.answer?.includes("практик"), "Body: fallback doesn't mention practices");

console.log("");

// --- Cross-module isolation tests ---
console.log("--- Cross-module isolation ---");

// Support config should NOT respond to Body-specific queries
const crossSupport = detectIntent("Где дневник питания?", supportConfig);
assert(crossSupport === null, "Cross: Support doesn't answer Body diary question");

// Body config should NOT respond to Support-specific queries
const crossBody = detectIntent("Где мои практики?", bodyConfig);
assert(crossBody === null, "Cross: Body doesn't answer Support practices question");

// Both should respond to generic handoff
const handoffBothSupport = detectIntent("Нужен специалист", supportConfig);
const handoffBothBody = detectIntent("Нужен специалист", bodyConfig);
assert(handoffBothSupport?.intent_type === "handoff", "Cross: Support handoff works");
assert(handoffBothBody?.intent_type === "handoff", "Cross: Body handoff works");

// Fallback messages should be module-specific
const fbSupport = buildFallbackResponse("ai_error", supportConfig);
const fbBody = buildFallbackResponse("ai_error", bodyConfig);
assert(fbSupport?.answer !== fbBody?.answer, "Cross: fallback messages differ by module");
assert(!fbSupport?.answer?.includes("дневник"), "Cross: Support fallback has no Body terms");
assert(!fbBody?.answer?.includes("практик"), "Cross: Body fallback has no Support terms");

console.log("");

// --- Service FAQ tests ---
console.log("--- Service FAQ ---");

const faqCredits = detectIntent("За что списываются кредиты?", supportConfig);
assert(faqCredits?.intent_type === "service_faq", "FAQ: credits usage detected");
assert(faqCredits?.topic === "credits_usage", "FAQ: correct topic");
assert(faqCredits?.answer?.includes("Кредиты"), "FAQ: answer mentions credits");
assert(!faqCredits?.answer?.includes("авторизац"), "FAQ: no auth mention");

const faqBalance = detectIntent("Сколько у меня кредитов?", supportConfig, { wallet_balance: 19000 });
assert(faqBalance?.intent_type === "service_faq", "FAQ: balance detected");
assert(faqBalance?.answer?.includes("19"), "FAQ: shows actual balance (19xxx)");

const faqFree = detectIntent("Что бесплатно?", supportConfig);
assert(faqFree?.intent_type === "service_faq", "FAQ: free actions detected");
assert(faqFree?.topic === "credits_free_actions", "FAQ: correct topic");
assert(faqFree?.answer?.includes("кабинет"), "FAQ: mentions cabinet as free");

const faqChat = detectIntent("Что такое Поговорим?", supportConfig);
assert(faqChat?.intent_type === "service_faq", "FAQ: quick chat detected");
assert(faqChat?.topic === "quick_chat", "FAQ: correct topic");

const faqDiff = detectIntent("Чем Поговорим отличается от подробного разговора?", supportConfig);
assert(faqDiff?.intent_type === "service_faq", "FAQ: difference question detected");

const faqPrivacy = detectIntent("Это анонимно?", supportConfig);
assert(faqPrivacy?.intent_type === "service_faq", "FAQ: privacy detected");
assert(faqPrivacy?.topic === "privacy", "FAQ: privacy topic");

// Navigation vs FAQ distinction
const navPractice = detectIntent("Где практики?", supportConfig);
assert(navPractice?.intent_type === "navigation", "Distinction: 'где практики' = navigation");
const faqPractice = detectIntent("Что такое практики?", supportConfig);
assert(faqPractice?.intent_type === "service_faq", "Distinction: 'что такое практики' = FAQ");

console.log("");
console.log(`=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
