// Phase 11: Module resolution helper tests
// Pure unit tests — no database, no browser.

import { normalizeAllowedModules, resolveModule, isModuleAllowed, getModuleLabel } from "../src/pages/specialist/moduleResolution.js";

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

console.log("\n=== Module Resolution Tests ===\n");

// ── normalizeAllowedModules ────────────────────────────────
console.log("1. normalizeAllowedModules");

assert(
  JSON.stringify(normalizeAllowedModules(["support"])) === '["support"]',
  '["support"] → ["support"]'
);
assert(
  JSON.stringify(normalizeAllowedModules(["body"])) === '["body"]',
  '["body"] → ["body"]'
);
assert(
  JSON.stringify(normalizeAllowedModules(["support", "body"])) === '["support","body"]',
  '["support","body"] → ["support","body"]'
);
assert(
  JSON.stringify(normalizeAllowedModules(["body", "support"])) === '["body","support"]',
  '["body","support"] preserves order'
);
assert(
  JSON.stringify(normalizeAllowedModules(["support", "support"])) === '["support"]',
  'deduplicates: ["support","support"] → ["support"]'
);
assert(
  JSON.stringify(normalizeAllowedModules([])) === '[]',
  '[] → []'
);
assert(
  JSON.stringify(normalizeAllowedModules(undefined)) === '[]',
  'undefined → []'
);
assert(
  JSON.stringify(normalizeAllowedModules(null)) === '[]',
  'null → []'
);
assert(
  JSON.stringify(normalizeAllowedModules("support")) === '[]',
  'string → []'
);
assert(
  JSON.stringify(normalizeAllowedModules(["finance"])) === '[]',
  'invalid module → []'
);
assert(
  JSON.stringify(normalizeAllowedModules(["support", "finance"])) === '["support"]',
  '["support","finance"] → ["support"]'
);

// ── resolveModule ──────────────────────────────────────────
console.log("\n2. resolveModule");

assert(
  resolveModule("support", ["support"]) === "support",
  'stored=support, allowed=[support] → support'
);
assert(
  resolveModule("body", ["support"]) === "support",
  'stored=body, allowed=[support] → support (stale corrected)'
);
assert(
  resolveModule("support", ["body"]) === "body",
  'stored=support, allowed=[body] → body (stale corrected)'
);
assert(
  resolveModule("body", ["body"]) === "body",
  'stored=body, allowed=[body] → body'
);
assert(
  resolveModule("support", ["support", "body"]) === "support",
  'stored=support, allowed=[support,body] → support'
);
assert(
  resolveModule("body", ["support", "body"]) === "body",
  'stored=body, allowed=[support,body] → body'
);
assert(
  resolveModule("finance", ["support"]) === "support",
  'stored=invalid, allowed=[support] → support (fallback)'
);
assert(
  resolveModule("support", []) === "support",
  'empty allowed → support (final fallback)'
);

// ── isModuleAllowed ────────────────────────────────────────
console.log("\n3. isModuleAllowed");

assert(isModuleAllowed("support", ["support"]) === true, 'support in [support] → true');
assert(isModuleAllowed("body", ["support"]) === false, 'body in [support] → false');
assert(isModuleAllowed("support", ["body"]) === false, 'support in [body] → false');
assert(isModuleAllowed("body", ["body"]) === true, 'body in [body] → true');
assert(isModuleAllowed("support", ["support", "body"]) === true, 'support in [support,body] → true');
assert(isModuleAllowed("body", ["support", "body"]) === true, 'body in [support,body] → true');
assert(isModuleAllowed("support", []) === false, 'support in [] → false');

// ── getModuleLabel ─────────────────────────────────────────
console.log("\n4. getModuleLabel");

assert(getModuleLabel("support") === "Точка Опоры", 'support → Точка Опоры');
assert(getModuleLabel("body") === "Здоровье & Стройность", 'body → Здоровье & Стройность');

// ── Summary ───────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
