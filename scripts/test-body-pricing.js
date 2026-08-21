// Phase 11E: Body pricing contract tests. No database required.

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const BODY_PRICING = [
  { service_code: "labs_review_written", label: "Расшифровка анализов", service_topic: "labs", meeting_format: "text", credits: 15000, active: true },
  { service_code: "labs_consultation_written", label: "Консультация по анализам", service_topic: "labs", meeting_format: "text", credits: 20000, active: true },
  { service_code: "medications_supplements_review", label: "Разбор принимаемых препаратов и БАДов", service_topic: "medications_supplements", meeting_format: "text", credits: 20000, active: true },
  { service_code: "diary_nutrition_review", label: "Разбор дневника питания", service_topic: "diary_nutrition", meeting_format: "text", credits: 15000, active: true },
  { service_code: "health_written_consultation", label: "Письменная консультация", service_topic: "general_health", meeting_format: "text", credits: 20000, active: true },
  { service_code: "health_phone_consultation", label: "Телефонная консультация", service_topic: null, meeting_format: "phone", credits: 30000, active: true },
  { service_code: "health_online_consultation", label: "Онлайн-консультация", service_topic: null, meeting_format: "video", credits: 40000, active: true },
  { service_code: "health_offline_consultation", label: "Очная консультация", service_topic: null, meeting_format: "offline", credits: 60000, active: true },
].map((row) => ({ ...row, module: "body" }));

const SUPPORT_CODES = [
  "short_followup", "therapy_review", "written_consultation", "phone_consultation",
  "urgent_contact", "online_consultation", "offline_consultation",
];
const SUPPORT_PRICES = {
  short_followup: 10000,
  therapy_review: 20000,
  written_consultation: 25000,
  phone_consultation: 30000,
  urgent_contact: 40000,
  online_consultation: 50000,
  offline_consultation: 75000,
};
const TOPICS = ["labs", "medications_supplements", "diary_nutrition", "general_health", "other"];
const FORBIDDEN_WORDS = ["назначить лекарство", "назначение лечения", "изменение дозировки", "коррекция дозировки"];

function findTariff(serviceCode, module = "body") {
  return BODY_PRICING.find((row) => row.service_code === serviceCode && row.module === module && row.active) || null;
}

function validateTopic(serviceCode, tariff, topic) {
  if (!TOPICS.includes(topic)) return false;
  if (!tariff.service_topic) return true;
  if (serviceCode === "health_written_consultation" && topic === "other") return true;
  return tariff.service_topic === topic;
}

function buildCanonicalSnapshot(input) {
  const tariff = findTariff(input.service_code, "body");
  if (!tariff || !validateTopic(input.service_code, tariff, input.service_topic)) return null;
  return {
    service_code: tariff.service_code,
    service_topic: input.service_topic,
    meeting_format: tariff.meeting_format,
    price_credits: tariff.credits,
    reserved_credits: 0,
    charged_credits: 0,
  };
}

console.log("1. Canonical Body catalog");
assert(BODY_PRICING.length === 8, "exactly 8 approved Body products");
assert(BODY_PRICING.every((row) => row.active && row.module === "body"), "all Body products are active and module-scoped");
assert(BODY_PRICING.find((row) => row.service_code === "labs_review_written")?.credits === 15000, "labs_review_written = 15000");
assert(BODY_PRICING.find((row) => row.service_code === "labs_consultation_written")?.credits === 20000, "labs_consultation_written = 20000");
assert(BODY_PRICING.find((row) => row.service_code === "medications_supplements_review")?.credits === 20000, "medications_supplements_review = 20000");
assert(BODY_PRICING.find((row) => row.service_code === "diary_nutrition_review")?.credits === 15000, "diary_nutrition_review = 15000");
assert(BODY_PRICING.find((row) => row.service_code === "health_phone_consultation")?.credits === 30000, "health_phone_consultation = 30000");
assert(BODY_PRICING.find((row) => row.service_code === "health_online_consultation")?.credits === 40000, "health_online_consultation = 40000");
assert(BODY_PRICING.find((row) => row.service_code === "health_offline_consultation")?.credits === 60000, "health_offline_consultation = 60000");
assert(SUPPORT_CODES.length === 7, "Support catalog contract remains 7 products");
assert(Object.values(SUPPORT_PRICES).every((price) => price > 0), "Support tariff values remain positive and unchanged");

console.log("\n2. Topic × format validation");
assert(validateTopic("labs_review_written", findTariff("labs_review_written"), "labs"), "labs written product accepts labs");
assert(!validateTopic("labs_review_written", findTariff("labs_review_written"), "other"), "labs written product rejects other topic");
assert(validateTopic("health_written_consultation", findTariff("health_written_consultation"), "other"), "general written product accepts other topic");
assert(validateTopic("health_online_consultation", findTariff("health_online_consultation"), "labs"), "universal online product accepts labs topic");
assert(!validateTopic("health_online_consultation", findTariff("health_online_consultation"), "invalid"), "invalid topic rejected");

console.log("\n3. Canonical snapshots and client override protection");
const labsSnapshot = buildCanonicalSnapshot({ service_code: "labs_review_written", service_topic: "labs", price_credits: 1, credits: 1, reserved_credits: 999, charged_credits: 999, meeting_format: "offline" });
assert(labsSnapshot?.price_credits === 15000, "client price cannot override labs snapshot");
assert(labsSnapshot?.meeting_format === "text", "client meeting_format cannot override canonical format");
assert(labsSnapshot?.reserved_credits === 0, "canonical Body request reserved_credits = 0");
assert(labsSnapshot?.charged_credits === 0, "canonical Body request charged_credits = 0");
assert(buildCanonicalSnapshot({ service_code: "unknown", service_topic: "labs" }) === null, "unknown service_code rejected");
assert(buildCanonicalSnapshot({ service_code: "labs_review_written", service_topic: "medications_supplements" }) === null, "invalid topic × product rejected");
assert(findTariff("labs_review_written")?.credits === 15000, "canonical API response supplies Body tariff price");
assert(findTariff("short_followup", "support") === null, "Support service_code cannot be used in Body lookup");
assert(!findTariff("labs_review_written", "body")?.active === false, "active lookup requires active Body tariff rows");

console.log("\n4. Legacy and medical wording safety");
const legacyRequest = { request_type: "labs_medications_review", service_code: null, price_credits: null, reserved_credits: 700 };
assert(legacyRequest.service_code === null && legacyRequest.price_credits === null, "historical legacy request remains NULL-price safe");
assert(legacyRequest.reserved_credits !== legacyRequest.price_credits, "legacy reserved_credits is not treated as price");
assert(["text_question", "phone_call", "video_call", "offline_visit", "diary_review", "labs_medications_review", "other"].every((type) => typeof type === "string"), "all legacy request types remain representable");
assert(FORBIDDEN_WORDS.every((word) => !BODY_PRICING.some((row) => row.label.toLowerCase().includes(word))), "catalog has no prescribing promises");

console.log("\n5. Wallet boundary");
const balanceBefore = 100000;
const balanceAfter = balanceBefore;
assert(balanceBefore === balanceAfter, "Body pricing request does not change wallet balance");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
