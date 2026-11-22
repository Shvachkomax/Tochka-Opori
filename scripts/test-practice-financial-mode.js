import assert from "node:assert/strict";
import { DATABASE_REFS } from "../lib/security/database-architecture.js";
import {
  PRACTICE_FINANCIAL_MODES,
  resolvePracticeFinancialMode,
} from "../lib/my-practice/financial-mode.js";
import {
  isMyPracticeServerEnabled,
  isMyPracticeTestServerEnabled,
} from "../lib/my-practice/workspace-handler.js";

const test = {
  MY_PRACTICE_SERVER_ENABLED: "true",
  MY_PRACTICE_ALLOWED_SUPABASE_REF: DATABASE_REFS.test,
  SUPABASE_URL: `https://${DATABASE_REFS.test}.supabase.co`,
  VERCEL_ENV: "preview",
  DEPLOYMENT_PURPOSE: "test",
};
const live = {
  MY_PRACTICE_SERVER_ENABLED: "true",
  MY_PRACTICE_ALLOWED_SUPABASE_REF: DATABASE_REFS.live,
  SUPABASE_URL: `https://${DATABASE_REFS.live}.supabase.co`,
  VERCEL_ENV: "production",
  DEPLOYMENT_PURPOSE: "live",
};

assert.equal(isMyPracticeServerEnabled(test), true, "approved Preview/Test server opens");
assert.equal(isMyPracticeTestServerEnabled(test), true, "synthetic route remains test-only");
assert.deepEqual(resolvePracticeFinancialMode(test), {
  mode: null, code: "FINANCIAL_MODE_REQUIRED", financialActionsAllowed: false,
});
assert.equal(resolvePracticeFinancialMode({ ...test, MY_PRACTICE_FINANCIAL_MODE: "test_credits" }).mode, PRACTICE_FINANCIAL_MODES.TEST_CREDITS);
assert.equal(resolvePracticeFinancialMode({ ...test, MY_PRACTICE_FINANCIAL_MODE: "payments_disabled" }).mode, PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED);
assert.equal(resolvePracticeFinancialMode({ ...test, MY_PRACTICE_FINANCIAL_MODE: "real_payments" }).code, "REAL_PAYMENTS_NOT_IMPLEMENTED");
assert.equal(resolvePracticeFinancialMode({ ...test, MY_PRACTICE_FINANCIAL_MODE: "unknown" }).code, "UNKNOWN_FINANCIAL_MODE");

assert.equal(isMyPracticeServerEnabled(live), true, "production clinical base requires exact live database");
assert.equal(isMyPracticeTestServerEnabled(live), false, "test-only synthetic workspace never opens in Production");
assert.equal(resolvePracticeFinancialMode(live).mode, PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED, "Production defaults fail-closed to disabled payments");
assert.equal(resolvePracticeFinancialMode({ ...live, MY_PRACTICE_FINANCIAL_MODE: "test_credits" }).code, "TEST_CREDITS_FORBIDDEN_IN_PRODUCTION");
assert.equal(resolvePracticeFinancialMode({ ...live, MY_PRACTICE_FINANCIAL_MODE: "real_payments" }).code, "REAL_PAYMENTS_NOT_IMPLEMENTED");
assert.equal(resolvePracticeFinancialMode({ ...live, MY_PRACTICE_FINANCIAL_MODE: "unknown" }).code, "UNKNOWN_FINANCIAL_MODE");
assert.equal(resolvePracticeFinancialMode({ ...live, SUPABASE_URL: `https://${DATABASE_REFS.test}.supabase.co` }).code, "UNTRUSTED_FINANCIAL_ENVIRONMENT");

console.log("Practice financial modes: PASS (test credits opt-in, disabled Production default, real payments blocked)");
