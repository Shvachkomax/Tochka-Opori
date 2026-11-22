// Server-only financial mode resolution for My Practice.
// A browser request never participates in this decision: only deployment
// environment variables and the exact connected Supabase project are accepted.
import { DATABASE_REFS } from "../security/database-architecture.js";
import {
  isLocalMyPracticeRehearsal,
  isMyPracticeTestEnvironment,
  isMyPracticeProductionEnvironment,
} from "./workspace-handler.js";

export const PRACTICE_FINANCIAL_MODES = Object.freeze({
  TEST_CREDITS: "test_credits",
  PAYMENTS_DISABLED: "payments_disabled",
  REAL_PAYMENTS: "real_payments",
});

function exactSupabaseUrl(env, ref) {
  return env.SUPABASE_URL === `https://${ref}.supabase.co`;
}

function testContext(env) {
  return isLocalMyPracticeRehearsal(env)
    || (isMyPracticeTestEnvironment(env)
      && env.MY_PRACTICE_ALLOWED_SUPABASE_REF === DATABASE_REFS.test
      && exactSupabaseUrl(env, DATABASE_REFS.test));
}

function blocked(code) {
  return { mode: null, code, financialActionsAllowed: false };
}

/**
 * Resolve payment behavior without using any client-controlled input.
 *
 * `test_credits` is deliberately opt-in, even locally. In a validated live
 * deployment an omitted setting means `payments_disabled`: catalog, calendar
 * and explicitly unpaid appointment requests still work, but no payment path
 * can settle a booking. `real_payments` is always rejected until A4 supplies a
 * separate provider implementation and release approval.
 */
export function resolvePracticeFinancialMode(env = process.env) {
  const requested = env.MY_PRACTICE_FINANCIAL_MODE;

  if (isMyPracticeProductionEnvironment(env)) {
    if (requested === undefined || requested === "" || requested === PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED) {
      return {
        mode: PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED,
        code: null,
        financialActionsAllowed: false,
      };
    }
    if (requested === PRACTICE_FINANCIAL_MODES.TEST_CREDITS) {
      return blocked("TEST_CREDITS_FORBIDDEN_IN_PRODUCTION");
    }
    if (requested === PRACTICE_FINANCIAL_MODES.REAL_PAYMENTS) {
      return blocked("REAL_PAYMENTS_NOT_IMPLEMENTED");
    }
    return blocked("UNKNOWN_FINANCIAL_MODE");
  }

  if (!testContext(env)) return blocked("UNTRUSTED_FINANCIAL_ENVIRONMENT");
  if (requested === PRACTICE_FINANCIAL_MODES.TEST_CREDITS) {
    return { mode: PRACTICE_FINANCIAL_MODES.TEST_CREDITS, code: null, financialActionsAllowed: true };
  }
  if (requested === PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED) {
    return { mode: PRACTICE_FINANCIAL_MODES.PAYMENTS_DISABLED, code: null, financialActionsAllowed: false };
  }
  if (requested === PRACTICE_FINANCIAL_MODES.REAL_PAYMENTS) {
    return blocked("REAL_PAYMENTS_NOT_IMPLEMENTED");
  }
  return blocked(requested === undefined || requested === "" ? "FINANCIAL_MODE_REQUIRED" : "UNKNOWN_FINANCIAL_MODE");
}

export function isPracticeTestCreditsMode(env = process.env) {
  return resolvePracticeFinancialMode(env).mode === PRACTICE_FINANCIAL_MODES.TEST_CREDITS;
}

export function financialModeErrorMessage(code) {
  const messages = {
    FINANCIAL_MODE_REQUIRED: "Финансовый режим не настроен. Оплата и подтверждение записи безопасно отключены.",
    UNKNOWN_FINANCIAL_MODE: "Финансовый режим не распознан. Оплата и подтверждение записи безопасно отключены.",
    UNTRUSTED_FINANCIAL_ENVIRONMENT: "Финансовые операции недоступны в этом окружении.",
    TEST_CREDITS_FORBIDDEN_IN_PRODUCTION: "Тестовые кредиты запрещены в Production.",
    REAL_PAYMENTS_NOT_IMPLEMENTED: "Реальные платежи ещё не подключены.",
  };
  return messages[code] || "Финансовая операция безопасно отключена.";
}
