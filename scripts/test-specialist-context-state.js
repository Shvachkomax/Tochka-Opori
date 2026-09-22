// Specialist context state-isolation tests.
// Pure tests for delayed responses after identity/module/context changes.

import { buildSpecialistContextKey, isCurrentSpecialistContext } from "../src/pages/specialist/specialistContext.js";

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

function currentContext(expertId, module, organizationId = null) {
  return buildSpecialistContextKey({ expertId, module, organizationId });
}

console.log("\n=== Specialist Context State Tests ===\n");

const supportKey = currentContext("support-expert", "support");
const healthKey = currentContext("health-expert", "body");

assert(supportKey !== healthKey, "different specialist/module contexts have different keys");
assert(
  isCurrentSpecialistContext({
    requestGeneration: 1,
    currentGeneration: 1,
    requestContextKey: supportKey,
    currentContextKey: supportKey,
  }),
  "current Support response is accepted"
);
assert(
  !isCurrentSpecialistContext({
    requestGeneration: 1,
    currentGeneration: 2,
    requestContextKey: supportKey,
    currentContextKey: healthKey,
  }),
  "delayed Support response cannot overwrite Health context"
);
assert(
  !isCurrentSpecialistContext({
    requestGeneration: 2,
    currentGeneration: 2,
    requestContextKey: supportKey,
    currentContextKey: healthKey,
  }),
  "matching generation with a different context key is rejected"
);
assert(
  isCurrentSpecialistContext({
    requestGeneration: 2,
    currentGeneration: 2,
    requestContextKey: healthKey,
    currentContextKey: healthKey,
  }),
  "current Health response is accepted"
);

const supportOrgKey = currentContext("support-expert", "support", "org-a");
const supportPrivateKey = currentContext("support-expert", "support", null);
assert(supportOrgKey !== supportPrivateKey, "organization/private-practice contexts have different keys");
assert(
  !isCurrentSpecialistContext({
    requestGeneration: 3,
    currentGeneration: 4,
    requestContextKey: supportOrgKey,
    currentContextKey: supportPrivateKey,
  }),
  "delayed organization response is rejected after context switch"
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
