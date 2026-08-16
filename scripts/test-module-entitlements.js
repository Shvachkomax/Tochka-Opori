// Phase 11: Specialist module entitlements — unit tests
// Tests validateSpecialistContext and module normalization logic.
// No database required.

import { validateSpecialistContext } from "../api/specialist.js";

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

console.log("\n=== Module Entitlement Tests ===\n");

// ── Test 1: support-only expert can list support ──────────
console.log("1. support-only expert → support allowed");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: ["support"],
  });
  assert(result.ok === true, "support access granted");
}

// ── Test 2: support-only expert cannot list body ──────────
console.log("2. support-only expert → body forbidden");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "body",
    allowedModules: ["support"],
  });
  assert(result.ok === false, "body access denied");
  assert(result.error === "Нет доступа к указанному модулю", "correct error message");
}

// ── Test 3: body-only expert can list body ────────────────
console.log("3. body-only expert → body allowed");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "body",
    allowedModules: ["body"],
  });
  assert(result.ok === true, "body access granted");
}

// ── Test 4: body-only expert cannot list support ──────────
console.log("4. body-only expert → support forbidden");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: ["body"],
  });
  assert(result.ok === false, "support access denied");
}

// ── Test 5: dual expert can access both ───────────────────
console.log("5. dual expert → both allowed");
{
  const r1 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: ["support", "body"],
  });
  assert(r1.ok === true, "support access granted");

  const r2 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "body",
    allowedModules: ["support", "body"],
  });
  assert(r2.ok === true, "body access granted");
}

// ── Test 6: invalid module rejected ───────────────────────
console.log("6. invalid module rejected");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "finance",
    allowedModules: ["support", "body"],
  });
  assert(result.ok === false, "invalid module rejected");
  assert(result.error === "Некорректный модуль", "correct error message");
}

// ── Test 7: empty allowed_modules → deny all ──────────────
console.log("7. empty allowed_modules → deny all");
{
  const r1 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: [],
  });
  assert(r1.ok === false, "empty modules denies support");

  const r2 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "body",
    allowedModules: [],
  });
  assert(r2.ok === false, "empty modules denies body");
}

// ── Test 8: undefined allowed_modules → deny all ──────────
console.log("8. undefined allowed_modules → deny all (fail closed)");
{
  const r1 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: undefined,
  });
  assert(r1.ok === false, "undefined modules denies support");

  const r2 = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "body",
    allowedModules: undefined,
  });
  assert(r2.ok === false, "undefined modules denies body");
}

// ── Test 9: null allowed_modules → deny all ───────────────
console.log("9. null allowed_modules → deny all (fail closed)");
{
  const result = validateSpecialistContext({
    memberships: [],
    organizationId: null,
    module: "support",
    allowedModules: null,
  });
  assert(result.ok === false, "null modules denies support");
}

// ── Test 10: org membership + entitlement both required ────
console.log("10. org membership + entitlement both required");
{
  const memberships = [{ organization_id: "org-1" }];
  const r1 = validateSpecialistContext({
    memberships,
    organizationId: "org-1",
    module: "support",
    allowedModules: ["support"],
  });
  assert(r1.ok === true, "correct org + correct module = allowed");

  const r2 = validateSpecialistContext({
    memberships,
    organizationId: "org-2",
    module: "support",
    allowedModules: ["support"],
  });
  assert(r2.ok === false, "wrong org = denied");

  const r3 = validateSpecialistContext({
    memberships,
    organizationId: "org-1",
    module: "body",
    allowedModules: ["support"],
  });
  assert(r3.ok === false, "correct org but wrong module = denied");
}

// ── Summary ───────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
