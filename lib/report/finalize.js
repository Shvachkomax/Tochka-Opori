// Backend finalization for the final support report.
// Ensures durable save before debit, idempotent retries, and stable request IDs.

import { getSupabase } from "../supabase.js";
import { generatePublicCode } from "../publicCode.js";
import { generateSessionAccessToken } from "../security/access-token.js";
import { getOrCreateContinuationCredential } from "../session/continuation-store.js";
import { ensureWallet, setWalletVisible } from "../usage/wallet.js";
import { runTask, TASK_TYPES } from "../modelRouter.js";

export const REPORT_STATUS = {
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
};

export function getStableReportRequestId(sessionId, depth) {
  return `support-final:${sessionId}:${depth}`;
}

// Deterministic replacements for stylistic prohibited terms in user_report.
// Does NOT weaken clinical safety rules or allow diagnoses.
export function deterministicUserReportFix(userReport) {
  if (!userReport) return userReport;
  let fixed = userReport;

  const replacements = [
    {
      pattern: /(выявлены|обнаружены)\s+сигналы/gi,
      replacement: "стоит обратить внимание",
    },
    {
      pattern: /эмоциональн(ая|ой|ую|ые|ых|ым)\s+сфер/gi,
      replacement: "чувства и переживания",
    },
    {
      pattern: /нейрокогнитивн(ая|ой|ую|ые|ых|ым)\s+сфер/gi,
      replacement: "мышление и внимание",
    },
    {
      pattern: /модифицирующ(ие|их|им)\s+фактор(ов|ы)?/gi,
      replacement: "то, что влияет на состояние",
    },
    {
      pattern: /травматическ(ий|ого|ому|им|ом)\s+контекст/gi,
      replacement: "травматичная ситуация",
    },
    {
      pattern: /психопатологическ/gi,
      replacement: "состояние",
    },
    {
      pattern: /ресурсн(ый|ого|ому|ым|ом|ые|ых|ым)\s+потенциал/gi,
      replacement: "собственные силы и поддержка",
    },
  ];

  for (const { pattern, replacement } of replacements) {
    fixed = fixed.replace(pattern, replacement);
  }

  // Cap repetitive hedging phrases
  fixed = capPhrase(fixed, "важно оценить", 2, "можно уточнить");
  fixed = capPhrase(fixed, "требуется уточнение", 1, "хочется разобрать подробнее");

  return fixed;
}

function capPhrase(text, phrase, max, replacement) {
  const re = new RegExp(phrase, "gi");
  let count = 0;
  return text.replace(re, (match) => {
    count += 1;
    return count <= max ? match : replacement;
  });
}

// Ensure session row exists for the analyze call.
// Creates owner, wallet, public_code if missing.
export async function getOrCreateSessionForAnalyze({
  supabase,
  sessionId,
  module,
  patientText,
  conversationHistory,
  dialogDepth,
  inviteToken,
}) {
  const { data: existing } = await supabase
    .from("sessions")
    .select("session_id, public_code, anonymous_owner_id, module, access_token_hash, legacy_access, json_data")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing) return existing;

  const { randomUUID } = await import("node:crypto");
  const anonymousOwnerId = randomUUID();
  const publicCode = generatePublicCode();

  // Ensure wallet exists
  await ensureWallet({
    ownerType: module === "support" ? "anonymous_case" : "anonymous_profile",
    ownerId: anonymousOwnerId,
    module,
  });

  const jsonData = {
    dialogDepth: dialogDepth ?? 0,
    patient_text: patientText || "",
    conversation_history: conversationHistory || [],
  };

  const { error } = await supabase.from("sessions").insert({
    session_id: sessionId,
    module,
    anonymous_owner_id: anonymousOwnerId,
    public_code: publicCode,
    patient_text: patientText || "",
    conversation_history: conversationHistory || [],
    json_data: jsonData,
    invite_token: inviteToken || null,
    legacy_access: false,
  });

  if (error) {
    console.error("[finalize] failed to create session for analyze", error?.message || error);
    throw new Error("SESSION_CREATE_FAILED");
  }

  return {
    session_id: sessionId,
    public_code: publicCode,
    anonymous_owner_id: anonymousOwnerId,
    module,
    access_token_hash: null,
    legacy_access: false,
    json_data: jsonData,
  };
}

export async function checkReportStatus(supabase, sessionId, requestId) {
  const { data } = await supabase
    .from("sessions")
    .select("report_generation_status, report_request_id, user_report, doctor_report, care_recommendation, public_code, access_token_hash, anonymous_owner_id, json_data")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!data) return { status: "not_found" };
  if (data.report_request_id !== requestId) return { status: "mismatch", data };
  if (data.report_generation_status === REPORT_STATUS.READY) return { status: "ready", data };
  if (data.report_generation_status === REPORT_STATUS.PROCESSING) return { status: "processing", data };
  if (data.report_generation_status === REPORT_STATUS.FAILED) return { status: "failed", data };
  return { status: "not_started", data };
}

export async function setReportStatus(supabase, sessionId, { status, requestId, errorCode, startedAt, completedAt }) {
  const update = { report_generation_status: status };
  if (requestId !== undefined) update.report_request_id = requestId;
  if (errorCode !== undefined) update.report_error_code = errorCode;
  if (startedAt !== undefined) update.report_started_at = startedAt;
  if (completedAt !== undefined) update.report_completed_at = completedAt;

  const { error } = await supabase
    .from("sessions")
    .update(update)
    .eq("session_id", sessionId);

  if (error) {
    console.error("[finalize] setReportStatus failed", error?.message || error);
    return false;
  }
  return true;
}

export async function saveFinalReportToSession({
  supabase,
  sessionId,
  userReport,
  doctorReport,
  careRecommendation,
  reportRequestId,
  status,
  errorCode,
  completedAt,
  extraJsonData,
}) {
  // Internal test hook: only active in NODE_ENV=test and with explicit flag.
  if (process.env.NODE_ENV === "test" && process.env._TEST_FORCE_REPORT_SAVE_FAILURE === sessionId) {
    return false;
  }

  const update = {
    user_report: userReport,
    doctor_report: doctorReport,
    care_recommendation: careRecommendation,
    report_generation_status: status,
    report_completed_at: status === REPORT_STATUS.READY ? completedAt : null,
    report_error_code: status === REPORT_STATUS.FAILED ? errorCode : null,
  };
  if (extraJsonData) {
    // Merge existing json_data with extra fields without overwriting.
    const { data: existing } = await supabase
      .from("sessions")
      .select("json_data")
      .eq("session_id", sessionId)
      .maybeSingle();
    update.json_data = {
      ...(existing?.json_data || {}),
      ...extraJsonData,
    };
  }

  const { error } = await supabase
    .from("sessions")
    .update(update)
    .eq("session_id", sessionId);

  if (error) {
    console.error("[finalize] saveFinalReportToSession failed", error?.message || error);
    return false;
  }
  return true;
}

export async function createReportArtifacts({ supabase, sessionId, module, anonymousOwnerId }) {
  let accessToken = null;
  let continuationCode = null;
  let publicCode = null;

  try {
    const { data: session } = await supabase
      .from("sessions")
      .select("public_code, access_token_hash")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (session) publicCode = session.public_code;

    if (!session?.access_token_hash) {
      accessToken = await generateSessionAccessToken(sessionId);
    }

    const { credential, secret, isNew } = await getOrCreateContinuationCredential({
      module,
      ownerId: anonymousOwnerId,
      supabase,
    });
    if (credential && (isNew || secret)) {
      continuationCode = isNew && secret ? `${credential.lookup_code}-${secret}` : null;
    }

    // Make wallet visible so user can see usage balance and continuation code
    const { ensureWallet, setWalletVisible } = await import("../usage/wallet.js");
    const wallet = await ensureWallet({
      ownerType: module === "support" ? "anonymous_case" : "anonymous_profile",
      ownerId: anonymousOwnerId,
      module,
    });
    if (wallet) {
      await setWalletVisible({ walletId: wallet.id });
    }
  } catch (err) {
    console.error("[finalize] createReportArtifacts failed", err?.message || err);
    // Non-fatal: report is already saved; do not fail the response.
  }

  return { publicCode, accessToken, continuationCode };
}

// One allowed AI repair call for JSON parse / schema failure.
export async function repairInvalidJson({
  rawResponse,
  systemPrompt,
  userPrompt,
  model,
  fallbackModel,
  reasoningEffort,
}) {
  const repairPrompt = `Исходный ответ модели содержит не JSON или неполный JSON. Исправь его в валидный JSON.

Исходный ответ:
${rawResponse || ""}

Требования:
- Верни ТОЛЬКО JSON без пояснений.
- JSON должен содержать поля: user_report (строка), doctor_report (строка), care_recommendation (объект).
- user_report должен быть текстом для пользователя, без диагнозов и медицинских назначений.
- doctor_report — для специалиста.
- care_recommendation: { level: "self_support" | "professional_contact" | "urgent_help", timeframe: "today" | "within_days" | "within_weeks" | "routine", specialist_types: [], reasons: [], interim_support: [], urgent_triggers: [] }`;

  try {
    const result = await runTask(TASK_TYPES.PROMPT_REPAIR, {
      systemPrompt: "Ты — редактор JSON. Исправляй невалидный JSON в требуемую схему.",
      userPrompt: repairPrompt,
      model,
      fallbackModel,
      reasoningEffort,
    });
    return {
      parsed: result.parsed,
      raw: result.raw,
      model_used: result.model_used,
      repairAttempted: true,
    };
  } catch (err) {
    console.error("[finalize] repairInvalidJson failed", err?.message || err);
    return { parsed: null, raw: null, model_used: null, repairAttempted: true, repairFailed: true };
  }
}

export function buildReportResponsePayload({
  userReport,
  doctorReport,
  careRecommendation,
  modelUsed,
  fallbackUsed,
  provider,
  taskType,
  requestDuration,
  publicCode,
  accessToken,
  continuationCode,
  debugInfo,
}) {
  const report = userReport.includes("===USER_REPORT===")
    ? userReport
    : `===USER_REPORT===\n\n${userReport}\n\n===DOCTOR_REPORT===\n\n${doctorReport}`;

  return {
    type: "final",
    report,
    model_used: modelUsed,
    fallback_used: fallbackUsed,
    provider,
    task_type: taskType,
    request_duration: requestDuration,
    care_recommendation: careRecommendation,
    public_code: publicCode,
    access_token: accessToken,
    continuation_code: continuationCode,
    _debug: debugInfo,
  };
}
