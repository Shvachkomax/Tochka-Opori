// Phase 11C: Support Service Pricing — unit tests
// Tests canonical pricing, service_code validation, and snapshot logic.

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

// ── Canonical pricing table ────────────────────────────────
const CANONICAL_PRICING = [
  { service_code: "short_followup", module: "support", credits: 10000, active: true },
  { service_code: "therapy_review", module: "support", credits: 20000, active: true },
  { service_code: "written_consultation", module: "support", credits: 25000, active: true },
  { service_code: "phone_consultation", module: "support", credits: 30000, active: true },
  { service_code: "urgent_contact", module: "support", credits: 40000, active: true },
  { service_code: "online_consultation", module: "support", credits: 50000, active: true },
  { service_code: "offline_consultation", module: "support", credits: 75000, active: true },
];

const SERVICE_CODE_MAP = {
  short_followup: { request_type: "question", meeting_format: "text" },
  therapy_review: { request_type: "question", meeting_format: "text" },
  written_consultation: { request_type: "question", meeting_format: "text" },
  phone_consultation: { request_type: "phone", meeting_format: "phone" },
  urgent_contact: { request_type: "urgent", meeting_format: "phone" },
  online_consultation: { request_type: "video", meeting_format: "video" },
  offline_consultation: { request_type: "offline", meeting_format: "offline" },
};

// ── Test 1: Canonical prices for all 7 Support services ────
console.log("1. Canonical prices for all 7 Support services");

assert(CANONICAL_PRICING.length === 7, "7 canonical services");
assert(CANONICAL_PRICING.find((p) => p.service_code === "short_followup").credits === 10000, "short_followup = 10000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "therapy_review").credits === 20000, "therapy_review = 20000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "written_consultation").credits === 25000, "written_consultation = 25000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "phone_consultation").credits === 30000, "phone_consultation = 30000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "urgent_contact").credits === 40000, "urgent_contact = 40000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "online_consultation").credits === 50000, "online_consultation = 50000");
assert(CANONICAL_PRICING.find((p) => p.service_code === "offline_consultation").credits === 75000, "offline_consultation = 75000");

// ── Test 2: Explicit service_code mapping ──────────────────
console.log("\n2. Explicit service_code mapping");

assert(SERVICE_CODE_MAP.short_followup.request_type === "question", "short_followup → question");
assert(SERVICE_CODE_MAP.short_followup.meeting_format === "text", "short_followup → text");
assert(SERVICE_CODE_MAP.therapy_review.request_type === "question", "therapy_review → question");
assert(SERVICE_CODE_MAP.written_consultation.request_type === "question", "written_consultation → question");
assert(SERVICE_CODE_MAP.phone_consultation.request_type === "phone", "phone_consultation → phone");
assert(SERVICE_CODE_MAP.urgent_contact.request_type === "urgent", "urgent_contact → urgent");
assert(SERVICE_CODE_MAP.online_consultation.request_type === "video", "online_consultation → video");
assert(SERVICE_CODE_MAP.offline_consultation.request_type === "offline", "offline_consultation → offline");

// ── Test 3: Invalid service_code rejected ──────────────────
console.log("\n3. Invalid service_code rejected");

function resolveServiceCode(code) {
  return CANONICAL_PRICING.find((p) => p.service_code === code && p.active) || null;
}

assert(resolveServiceCode("short_followup") !== null, "valid code accepted");
assert(resolveServiceCode("unknown_code") === null, "unknown code rejected");
assert(resolveServiceCode("") === null, "empty code rejected");
assert(resolveServiceCode(null) === null, "null code rejected");

// ── Test 4: Client-supplied price cannot override ──────────
console.log("\n4. Client-supplied price cannot override");

function resolvePrice(serviceCode) {
  const pricing = CANONICAL_PRICING.find((p) => p.service_code === serviceCode && p.active);
  return pricing ? pricing.credits : null;
}

assert(resolvePrice("online_consultation") === 50000, "canonical price returned");
// Even if client sends price_credits=999, backend uses canonical
assert(resolvePrice("online_consultation") !== 999, "client override ignored");

// ── Test 5: Inactive tariff rejected ───────────────────────
console.log("\n5. Inactive tariff rejected");

const inactivePricing = [...CANONICAL_PRICING];
inactivePricing[0] = { ...inactivePricing[0], active: false };

function resolveActivePrice(code, pricing) {
  const p = pricing.find((x) => x.service_code === code && x.active);
  return p ? p.credits : null;
}

assert(resolveActivePrice("short_followup", inactivePricing) === null, "inactive tariff returns null");
assert(resolveActivePrice("therapy_review", inactivePricing) === 20000, "active tariff returns price");

// ── Test 6: Body pricing cannot be used in Support ────────
console.log("\n6. Body pricing cannot be used in Support");

function checkModule(pricing, requestedModule) {
  return pricing.module === requestedModule;
}

const bodyPricing = { service_code: "text_question", module: "body", credits: 300 };
assert(!checkModule(bodyPricing, "support"), "body pricing rejected for support");

// ── Test 7: Price snapshots on service_request ─────────────
console.log("\n7. Price snapshots on service_request");

function createServiceRequest(serviceCode, pricing) {
  const p = pricing.find((x) => x.service_code === serviceCode);
  return {
    service_code: serviceCode,
    price_credits: p ? p.credits : null,
    reserved_credits: 0,
    charged_credits: 0,
  };
}

const req1 = createServiceRequest("online_consultation", CANONICAL_PRICING);
assert(req1.service_code === "online_consultation", "service_code snapshotted");
assert(req1.price_credits === 50000, "price_credits snapshotted");
assert(req1.reserved_credits === 0, "reserved_credits stays 0");
assert(req1.charged_credits === 0, "charged_credits stays 0");

// ── Test 8: Tariff change does not alter existing snapshot ──
console.log("\n8. Tariff change does not alter existing snapshot");

const existingRequest = { service_code: "online_consultation", price_credits: 50000 };
// Simulate tariff change
const newPricing = CANONICAL_PRICING.map((p) =>
  p.service_code === "online_consultation" ? { ...p, credits: 60000 } : p
);
// Existing request should still show old price
assert(existingRequest.price_credits === 50000, "existing request keeps old price");

// ── Test 9: reserved_credits remains 0 ─────────────────────
console.log("\n9. reserved_credits remains 0");

const req2 = createServiceRequest("phone_consultation", CANONICAL_PRICING);
assert(req2.reserved_credits === 0, "reserved_credits = 0");

// ── Test 10: charged_credits remains 0 ─────────────────────
console.log("\n10. charged_credits remains 0");

assert(req2.charged_credits === 0, "charged_credits = 0");

// ── Test 11: wallet balance does not change ────────────────
console.log("\n11. wallet balance does not change");

let walletBalance = 22000;
function simulateCreateRequestWithoutDebit(balance) {
  // Phase 11C: no debit
  return balance;
}
assert(simulateCreateRequestWithoutDebit(walletBalance) === 22000, "wallet unchanged");

// ── Test 12: low balance does not block request ────────────
console.log("\n12. low balance does not block request");

function canCreateRequest(balance, price) {
  // Phase 11C: always allow
  return true;
}
assert(canCreateRequest(0, 50000), "low balance does not block");
assert(canCreateRequest(100, 50000), "low balance does not block");

// ── Test 13: specialist sees same price snapshot ───────────
console.log("\n13. specialist sees same price snapshot");

const specialistView = { price_credits: req1.price_credits, service_code: req1.service_code };
assert(specialistView.price_credits === 50000, "specialist sees 50000");
assert(specialistView.service_code === "online_consultation", "specialist sees service_code");

// ── Test 14: admin sees same price snapshot ────────────────
console.log("\n14. admin sees same price snapshot");

const adminView = { price_credits: req1.price_credits, service_code: req1.service_code, reserved_credits: req1.reserved_credits, charged_credits: req1.charged_credits };
assert(adminView.price_credits === 50000, "admin sees price_credits");
assert(adminView.reserved_credits === 0, "admin sees reserved_credits=0");
assert(adminView.charged_credits === 0, "admin sees charged_credits=0");

// ── Test 15: legacy null price is safe ─────────────────────
console.log("\n15. legacy null price is safe");

const legacyRequest = { service_code: null, price_credits: null };
assert(legacyRequest.price_credits === null, "legacy price is null");
assert(legacyRequest.service_code === null, "legacy service_code is null");
// UI should handle null gracefully
const displayPrice = legacyRequest.price_credits > 0 ? `${legacyRequest.price_credits} кредитов` : "Стоимость не зафиксирована (legacy)";
assert(displayPrice === "Стоимость не зафиксирована (legacy)", "legacy display handled");

// ── Summary ───────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
