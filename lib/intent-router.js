// Shared Intent Router — deterministic-first, AI-second
// Module-agnostic engine with module-specific configuration.
//
// Priority order:
// 1. Safety intent (module-specific red flags)
// 2. Cabinet navigation intent (module-specific sections)
// 3. Human handoff intent (shared semantics)
// 4. Medication / high-risk intent (shared prohibition)
// 5. Low-confidence / out-of-scope fallback (shared)
// 6. Ordinary AI response (caller handles)

/**
 * @typedef {Object} IntentConfig
 * @property {string} module - "support" | "body"
 * @property {Array} safetyIntents - [{ patterns, answer, severity }]
 * @property {Array} navigationIntents - [{ patterns, answer, section, cta }]
 * @property {Array} medicationPatterns - RegExp[]
 * @property {Function} getCapabilitiesContext - async (supabase, ownerId) => object
 * @property {Object} fallbackMessages - { aiFailure, networkError, lowConfidence }
 * @property {Function} buildPromptContext - async (supabase, ownerId) => object
 */

/**
 * Detect deterministic intent from user message.
 * Returns intent result or null (proceed to AI).
 *
 * @param {string} text - User message
 * @param {IntentConfig} config - Module-specific config
 * @returns {object|null} - Intent result with answer, intent_type, cta, etc.
 */
export function detectIntent(text, config) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase().trim();

  // Priority 1: Safety intents
  if (config.safetyIntents) {
    for (const intent of config.safetyIntents) {
      for (const pat of intent.patterns) {
        if (pat.test(lower)) {
          return {
            answer: intent.answer,
            safety_note: intent.severity === "critical" ? intent.answer : null,
            confidence: "high",
            suggest_followup: false,
            intent_type: "safety",
            severity: intent.severity || "warning",
            cta: intent.cta || null,
          };
        }
      }
    }
  }

  // Priority 2: Navigation intents
  if (config.navigationIntents) {
    for (const intent of config.navigationIntents) {
      for (const pat of intent.patterns) {
        if (pat.test(lower)) {
          return {
            answer: intent.answer,
            safety_note: null,
            confidence: "high",
            suggest_followup: false,
            intent_type: "navigation",
            section: intent.section,
            cta: intent.cta || null,
          };
        }
      }
    }
  }

  // Priority 3: Human handoff (shared across modules)
  const handoffPatterns = [
    /хочу.*врач/i, /нужен.*специалист/i, /нужен.*врач/i,
    /поговорить.*врач/i, /поговорить.*специалист/i,
    /консультац/i, /слишком.*сложн/i, /нужен.*человек/i,
    /хочу.*человек/i, /живой.*человек/i,
    /не.*бот/i, /не.*ai/i,
  ];
  for (const pat of handoffPatterns) {
    if (pat.test(lower)) {
      return {
        answer: config.fallbackMessages?.handoff || "Я могу помочь отправить запрос специалисту. Хотите, чтобы я открыл форму связи?",
        safety_note: null,
        confidence: "high",
        suggest_followup: false,
        intent_type: "handoff",
        cta: "service_request",
      };
    }
  }

  // Priority 4: Medication intent (shared prohibition)
  if (config.medicationPatterns) {
    for (const pat of config.medicationPatterns) {
      if (pat.test(lower)) {
        return {
          answer: config.fallbackMessages?.medication || "Подбор и изменение лекарств — это задача для врача. Я не могу назначать препараты или дозировки.",
          safety_note: null,
          confidence: "high",
          suggest_followup: false,
          intent_type: "medication",
          cta: "service_request",
        };
      }
    }
  }

  return null; // No deterministic intent — proceed to AI
}

/**
 * Build AI failure fallback response.
 *
 * @param {string} errorType - "ai_error" | "network_error" | "timeout"
 * @param {IntentConfig} config - Module-specific config
 * @returns {object} - Fallback response
 */
export function buildFallbackResponse(errorType, config) {
  const messages = config.fallbackMessages || {};
  let answer;

  switch (errorType) {
    case "network_error":
      answer = messages.networkError || "Не удалось связаться с сервисом. Попробуйте ещё раз или продолжите разговор в подробном режиме.";
      break;
    case "timeout":
      answer = messages.timeout || "Ответ занимает больше времени, чем обычно. Попробуйте ещё раз.";
      break;
    default:
      answer = messages.aiFailure || "Сейчас не получилось сформировать ответ. Вы можете попробовать ещё раз или продолжить разговор в подробном режиме.";
  }

  return {
    answer,
    safety_note: null,
    confidence: "low",
    suggest_followup: true,
    intent_type: "error",
    error_type: errorType,
  };
}

/**
 * Build low-confidence / out-of-scope response.
 *
 * @param {IntentConfig} config - Module-specific config
 * @returns {object}
 */
export function buildLowConfidenceResponse(config) {
  return {
    answer: config.fallbackMessages?.lowConfidence || "Я не хочу угадывать. Могу помочь разобрать это подробнее или отправить запрос специалисту.",
    safety_note: null,
    confidence: "low",
    suggest_followup: true,
    intent_type: "low_confidence",
    cta: "service_request",
  };
}
