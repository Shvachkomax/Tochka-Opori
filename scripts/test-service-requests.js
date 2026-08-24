// Phase 11: Service Requests — unit tests for authorization and state transitions.
// No database required. Tests pure logic only.

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

// ── Status transition logic (mirrors specialist.js) ───────

const VALID_TRANSITIONS = {
  submitted:     ["accept", "cancel"],
  accepted:      ["needs_clarification", "schedule", "answer", "cancel"],
  needs_clarification: ["schedule", "answer", "cancel"],
  scheduled:     ["complete", "cancel"],
  answered:      ["complete"],
  completed:     [],
  cancelled:     [],
};

function canTransition(currentStatus, action) {
  return VALID_TRANSITIONS[currentStatus]?.includes(action) ?? false;
}

// ── Test 1: Valid transitions ──────────────────────────────
console.log("1. Valid status transitions");

assert(canTransition("submitted", "accept"), "submitted → accept");
assert(canTransition("submitted", "cancel"), "submitted → cancel");

assert(canTransition("accepted", "schedule"), "accepted → schedule");
assert(canTransition("accepted", "answer"), "accepted → answer");
assert(canTransition("accepted", "cancel"), "accepted → cancel");

assert(canTransition("needs_clarification", "schedule"), "needs_clarification → schedule");
assert(canTransition("needs_clarification", "answer"), "needs_clarification → answer");

assert(canTransition("scheduled", "complete"), "scheduled → complete");
assert(canTransition("scheduled", "cancel"), "scheduled → cancel");

assert(canTransition("answered", "complete"), "answered → complete");

// ── Test 2: Invalid transitions ────────────────────────────
console.log("\n2. Invalid status transitions");

assert(!canTransition("completed", "accept"), "completed → accept blocked");
assert(!canTransition("cancelled", "accept"), "cancelled → accept blocked");
assert(!canTransition("submitted", "needs_clarification"), "submitted → needs_clarification blocked");
assert(!canTransition("submitted", "answer"), "submitted → answer blocked");
assert(!canTransition("needs_clarification", "accept"), "needs_clarification → accept blocked");
assert(!canTransition("answered", "cancel"), "answered → cancel blocked");
assert(!canTransition("submitted", "complete"), "submitted → complete blocked");
assert(!canTransition("submitted", "schedule"), "submitted → schedule blocked");
assert(!canTransition("completed", "cancel"), "completed → cancel blocked");
assert(!canTransition("cancelled", "cancel"), "cancelled → cancel blocked");

// ── Test 2b: frontend/backend action wire contract ─────────
console.log("\n2b. Frontend/backend action wire contract");

function buildUpdateRequestBody(updateAction, extra = {}) {
  return { action: "updateServiceRequest", update_action: updateAction, ...extra };
}

const acceptBody = buildUpdateRequestBody("accept");
assert(acceptBody.action === "updateServiceRequest", "dispatcher action is preserved");
assert(acceptBody.update_action === "accept", "backend receives accept as update_action");
const clarificationBody = buildUpdateRequestBody("needs_clarification", { specialist_response: "Уточните дату" });
assert(clarificationBody.update_action === "needs_clarification", "backend receives clarification transition");
assert(clarificationBody.specialist_response === "Уточните дату", "clarification text stays a lightweight request field");

// ── Test 3: Ownership check logic ──────────────────────────
console.log("\n3. Ownership check");

function checkOwnership(requestSpecialistId, expertId) {
  return String(requestSpecialistId) === String(expertId);
}

assert(checkOwnership("abc-123", "abc-123"), "same specialist → allowed");
assert(!checkOwnership("abc-123", "def-456"), "different specialist → denied");
assert(!checkOwnership("alena_zhukova", "abc-123"), "legacy string vs UUID → denied");

// ── Test 4: Module entitlement check ───────────────────────
console.log("\n4. Module entitlement");

function checkModuleEntitlement(requestModule, allowedModules) {
  return allowedModules.includes(requestModule);
}

assert(checkModuleEntitlement("body", ["body"]), "body specialist → body request allowed");
assert(checkModuleEntitlement("body", ["support", "body"]), "dual specialist → body request allowed");
assert(!checkModuleEntitlement("support", ["body"]), "body specialist → support request denied");
assert(!checkModuleEntitlement("body", ["support"]), "support specialist → body request denied");

// ── Test 5: specialist_id type handling ────────────────────
console.log("\n5. specialist_id type handling");

function normalizeSpecialistId(id) {
  return String(id);
}

assert(normalizeSpecialistId("e0bcdd82-95f6-4d36-ba20-a2eb35107690") === "e0bcdd82-95f6-4d36-ba20-a2eb35107690", "UUID string preserved");
assert(normalizeSpecialistId("alena_zhukova") === "alena_zhukova", "legacy string preserved");
assert(normalizeSpecialistId(null) === "null", "null → 'null' string");

// ── Test 6: Filter logic ──────────────────────────────────
console.log("\n6. Filter logic");

const requests = [
  { status: "submitted" },
  { status: "accepted" },
  { status: "completed" },
  { status: "cancelled" },
];

function filterRequests(requests, filter) {
  if (filter === "all") return requests;
  return requests.filter((r) => r.status === filter);
}

assert(filterRequests(requests, "all").length === 4, "filter=all → 4 results");
assert(filterRequests(requests, "submitted").length === 1, "filter=submitted → 1 result");
assert(filterRequests(requests, "completed").length === 1, "filter=completed → 1 result");
assert(filterRequests(requests, "nonexistent").length === 0, "filter=nonexistent → 0 results");

// ── Test 7: Security — module entitlement from request.module ──
console.log("\n7. Security: module entitlement from request.module");

function checkModuleEntitlementFromRequest(requestModule, allowedModules) {
  return allowedModules.includes(requestModule);
}

// Expert owns request by specialist_id, but request.module NOT in allowed_modules
assert(!checkModuleEntitlementFromRequest("support", ["body"]), "support-only expert → body request → denied");
assert(!checkModuleEntitlementFromRequest("body", ["support"]), "body-only expert → support request → denied");

// Frontend module parameter should NOT bypass entitlement
assert(checkModuleEntitlementFromRequest("body", ["body", "support"]), "dual expert → body request → allowed");
assert(!checkModuleEntitlementFromRequest("support", ["body"]), "body-only expert → frontend says support → still denied");

// ── Test 8: Security — listServiceRequests filters by allowed_modules ──
console.log("\n8. Security: listServiceRequests filters by allowed_modules");

function filterByAllowedModules(requests, allowedModules) {
  return requests.filter((r) => allowedModules.includes(r.module));
}

const mixedRequests = [
  { module: "support" },
  { module: "body" },
  { module: "support" },
];

assert(filterByAllowedModules(mixedRequests, ["support"]).length === 2, "support-only → 2 support requests");
assert(filterByAllowedModules(mixedRequests, ["body"]).length === 1, "body-only → 1 body request");
assert(filterByAllowedModules(mixedRequests, ["support", "body"]).length === 3, "dual → all 3 requests");
assert(filterByAllowedModules(mixedRequests, []).length === 0, "empty allowed → 0 requests");

// ── Test 9: Security — no active assignment blocks creation ──
console.log("\n9. Security: no active assignment blocks creation");

function resolveSpecialistFromAssignment(assignment) {
  if (!assignment?.primary_expert_id) return null;
  return String(assignment.primary_expert_id);
}

assert(resolveSpecialistFromAssignment({ primary_expert_id: "abc-123" }) === "abc-123", "valid assignment → UUID");
assert(resolveSpecialistFromAssignment({ primary_expert_id: null }) === null, "null primary_expert_id → null");
assert(resolveSpecialistFromAssignment(null) === null, "no assignment → null");
assert(resolveSpecialistFromAssignment({}) === null, "empty assignment → null");

// ── Summary ───────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
