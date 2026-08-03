import crypto from "crypto";
import { getSupabase } from "../lib/supabase.js";
import { maskText, maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { validateSessionAccess, generateSessionAccessToken } from "../lib/security/access-token.js";
import {
  parseContinuationCredential,
  verifyContinuationSecret,
  getOwnerType,
  getContinuationAttemptKey,
  isLegacyShortCode,
  ContinuationConfigError,
  SUPPORTED_MODULES,
} from "../lib/session/continuation-credential.js";
import {
  getOrCreateContinuationCredential,
  rotateContinuationCredential,
  fingerprint,
} from "../lib/session/continuation-store.js";
import { createReportArtifacts, REPORT_STATUS } from "../lib/report/finalize.js";
import { runTask, TASK_TYPES } from "../lib/modelRouter.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}

// Resolve body owner from session_id + access_token.
// Returns { ownerId, sessionId } or throws with appropriate HTTP status.
async function resolveBodyOwner(sessionId, accessToken) {
  if (!sessionId || !accessToken) {
    return null;
  }
  const valid = await validateSessionAccess(sessionId, accessToken);
  if (!valid) {
    return null;
  }
  const supabase = getSupabase();
  const { data: client, error: clientError } = await supabase
    .from("body_clients")
    .select("anonymous_owner_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (clientError || !client) {
    return null;
  }
  // If anonymous_owner_id is missing (legacy row), generate and persist one
  if (!client.anonymous_owner_id) {
    const { randomUUID } = await import("node:crypto");
    const newOwnerId = randomUUID();
    const { error: updateError } = await supabase
      .from("body_clients")
      .update({ anonymous_owner_id: newOwnerId })
      .eq("session_id", sessionId);
    if (updateError) {
      console.error("[resolveBodyOwner] failed to assign owner:", updateError.code);
      return null;
    }
    return { ownerId: newOwnerId, sessionId };
  }
  return { ownerId: client.anonymous_owner_id, sessionId };
}

// Anonymous Continuation Credential Pass helpers
async function buildCabinetSessions({ module, ownerId, supabase }) {
  const table = module === "body" ? "body_clients" : "sessions";
  const isBody = module === "body";

  const selectCols = isBody
    ? "session_id, display_name, created_at"
    : "session_id, public_code, module, patient_text, created_at, json_data";

  let query = supabase
    .from(table)
    .select(selectCols)
    .eq("anonymous_owner_id", ownerId);

  if (!isBody) {
    query = query.eq("module", module);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("buildCabinetSessions error", error);
    return [];
  }

  return (data || []).map((s, idx) => {
    if (isBody) {
      return {
        sessionId: s.session_id,
        publicCode: s.session_id,
        createdAt: s.created_at,
        summary: s.display_name ? `Анкета здоровья: ${s.display_name}` : "Анкета здоровья",
        status: "first_contact",
        order: idx + 1,
      };
    }
    const json = s.json_data || {};
    const input = (s.patient_text || "").trim();
    const summary = input
      ? `${input.split(/[.!?\n]/)[0].trim().slice(0, 110)}${input.split(/[.!?\n]/)[0].trim().length > 110 ? "…" : ""}`
      : "Обращение без текстового описания.";
    return {
      sessionId: s.session_id,
      publicCode: s.public_code,
      createdAt: s.created_at,
      summary,
      status: json.isContinuation || json.previousPatientReport ? "followup" : "first_contact",
      order: idx + 1,
    };
  });
}

async function buildCabinetData({ module, ownerId, supabase }) {
  const sessions = await buildCabinetSessions({ module, ownerId, supabase });
  const latestSession = sessions[0];
  let latestReport = null;

  if (latestSession?.sessionId) {
    const isBody = module === "body";
    const table = isBody ? "body_intake_forms" : "sessions";
    const selectCols = isBody
      ? "session_id, answers, care_recommendation, bmi, created_at"
      : "session_id, public_code, patient_text, user_report, doctor_report, support_plan, json_data, created_at";
    const { data } = await supabase
      .from(table)
      .select(selectCols)
      .eq("session_id", latestSession.sessionId)
      .maybeSingle();
    if (data) {
      if (isBody) {
        const answers = data.answers || {};
        latestReport = {
          sessionId: data.session_id,
          publicCode: data.session_id,
          userReport: `Анкета здоровья заполнена. ИМТ: ${data.bmi ?? "—"}. Цель: ${answers.goal || "—"}.`,
          doctorReport: "",
          supportPlan: data.care_recommendation || null,
          homeTasks: "",
          resourceFactors: "",
          previousPatientReport: "",
          previousDoctorReport: "",
          dialogDepth: 0,
          conversationHistory: [],
        };
      } else {
        const json = data.json_data || {};
        latestReport = {
          sessionId: data.session_id,
          publicCode: data.public_code,
          userReport: data.user_report || "",
          doctorReport: data.doctor_report || "",
          supportPlan: data.support_plan || null,
          homeTasks: json.homeTasks || "",
          resourceFactors: json.resourceFactors || "",
          previousPatientReport: json.previousPatientReport || "",
          previousDoctorReport: json.previousDoctorReport || "",
          dialogDepth: json.dialogDepth ?? 0,
          conversationHistory: data.conversation_history || [],
        };
      }
    }
  }

  return { sessions, latestReport };
}

async function getUsageBalanceForOwner({ module, ownerId }) {
  const { getWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
  const ownerType = getOwnerType(module);
  const wallet = await getWallet({ ownerType, ownerId, module });
  if (!wallet) return { ok: true, visible: false };
  return await getUsageBalanceForClient({ walletId: wallet.id });
}

function isValidSessionId(id) {
  if (!id || typeof id !== "string") return false;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, prefix: "session:" });
  const limited = await limit(req, res);
  if (limited) return;

  const { action } = req.body || {};

  try {
    switch (action) {
      case "save":
        return await handleSave(req, res);
      case "load":
        return await handleLoad(req, res);
      case "getCabinet":
        return await handleGetCabinet(req, res);
      case "getReport":
        return await handleGetReport(req, res);
      case "updateSupportPlan":
        return await handleUpdateSupportPlan(req, res);
      case "save_conversation_pairs":
        return await handleSaveConversationPairs(req, res);
      case "validateInviteToken":
        return await handleValidateInviteToken(req, res);
      case "listBodyDailyLogs":
        return await handleListBodyDailyLogs(req, res);
      case "generateAccessToken":
        return await handleGenerateAccessToken(req, res);
      case "createFollowUpSession":
        return await handleCreateFollowUpSession(req, res);
      case "exchangeContinuationCredential":
        return await handleExchangeContinuationCredential(req, res);
      case "regenerateContinuationCredential":
        return await handleRegenerateContinuationCredential(req, res);
      case "getReportStatus":
        return await handleGetReportStatus(req, res);
      case "getBodyCabinet":
        return await handleGetBodyCabinet(req, res);
      case "getBodyOnboarding":
        return await handleGetBodyOnboarding(req, res);
      case "saveBodyOnboarding":
        return await handleSaveBodyOnboarding(req, res);
      case "getBodyDiaryDay":
        return await handleGetBodyDiaryDay(req, res);
      case "savePlateHistory":
        return await handleSavePlateHistory(req, res);
      case "getBodyPlateHistory":
        return await handleGetBodyPlateHistory(req, res);
      case "getBodyInsights":
        return await handleGetBodyInsights(req, res);
      case "dismissBodyInsight":
        return await handleDismissBodyInsight(req, res);
      case "getBodyWeeklySummary":
        return await handleGetBodyWeeklySummary(req, res);
      case "generateBodyWeeklySummary":
        return await handleGenerateBodyWeeklySummary(req, res);
      case "getBodyAiChat":
        return await handleGetBodyAiChat(req, res);
      case "sendBodyAiMessage":
        return await handleSendBodyAiMessage(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function handleSave(req, res) {
  try {
    const {
      sessionId, patient_text, conversationHistory,
      user_report, doctor_report, riskLevel, supportPlan,
      dialogDepth, previousPatientReport, previousDoctorReport,
      homeTasks, resourceFactors, questions, answers,
      voiceObservations, _debug, care_recommendation,
      invite_token, module: sessionModule,
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "Missing sessionId" });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ ok: false, error: "Invalid sessionId format" });
    }

    const supabase = getSupabase();

    const privacy = getPrivacySafeMode();
    const maskedPatientText = privacy ? maskText(patient_text || "") : patient_text;
    const maskedUserReport = privacy ? maskSensitiveData(user_report || "") : user_report;
    const maskedDoctorReport = privacy ? maskSensitiveData(doctor_report || "") : doctor_report;
    const maskedConversation = privacy ? maskSensitiveData(conversationHistory || []) : conversationHistory;

    const { generatePublicCode } = await import("../lib/publicCode.js");
    const { validateInviteToken, useInviteToken } = await import("./experts.js");
    const { ensureWallet, setWalletVisible } = await import("../lib/usage/wallet.js");

    const existing = await supabase
      .from("sessions")
      .select("public_code, organization_id, primary_expert_id, access_token_hash, legacy_access, anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existing.error) {
      console.error("handleSave: SELECT error", existing.error);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна. Попробуйте позже." });
    }

    let publicCode = existing?.data?.public_code;
    let organizationId = existing?.data?.organization_id || null;
    let primaryExpertId = existing?.data?.primary_expert_id || null;
    let inviteToken = existing?.data?.invite_token || null;
    const isNewSession = !existing?.data;
    const alreadyHasToken = existing?.data?.access_token_hash != null;

    // Ensure anonymous_owner_id exists (created server-side, never from frontend)
    let anonymousOwnerId = existing?.data?.anonymous_owner_id || null;
    const codeJustCreated = !publicCode;

    if (publicCode && (organizationId || primaryExpertId)) {
      // keep
    } else if (publicCode && !organizationId && !primaryExpertId) {
      const { data: assignment } = await supabase
        .from("patient_assignments")
        .select("organization_id, primary_expert_id")
        .eq("public_code", publicCode)
        .eq("status", "active")
        .maybeSingle();
      if (assignment) {
        organizationId = assignment.organization_id;
        primaryExpertId = assignment.primary_expert_id;
      }
    }

    // Generate anonymous_owner_id for new sessions
    if (!anonymousOwnerId) {
      const { randomUUID } = await import("node:crypto");
      anonymousOwnerId = randomUUID();
    }

    let newWalletId = null;
    if (!publicCode) {
      publicCode = generatePublicCode();

      // Create wallet (hidden) once code is generated.
      // Visibility set only after DB save confirms code persistence.
      const wallet = await ensureWallet({ ownerType: "anonymous_case", ownerId: anonymousOwnerId, module: "support" });
      newWalletId = wallet?.id || null;

      if (invite_token) {
        const invite = await validateInviteToken(invite_token);
        if (invite) {
          organizationId = invite.organization_id;
          primaryExpertId = invite.expert_id;
          inviteToken = invite_token;

          const { data: existingAssignment } = await supabase
            .from("patient_assignments")
            .select("id")
            .eq("public_code", publicCode)
            .maybeSingle();

          if (!existingAssignment) {
            await supabase.from("patient_assignments").insert({
              public_code: publicCode,
              organization_id: organizationId,
              primary_expert_id: primaryExpertId,
              assigned_by_expert_id: primaryExpertId,
              assigned_by_expert_name: "auto",
              source: "invite_link",
              status: "active",
            });

            await supabase.from("patient_access").insert({
              public_code: publicCode,
              organization_id: organizationId,
              expert_id: primaryExpertId,
              access_role: "owner",
              granted_by_expert_id: primaryExpertId,
              granted_by_expert_name: "auto",
            });
          }

          await useInviteToken(invite_token);
        }
      }
    }

    const { data: existingRow } = await supabase
      .from("sessions")
      .select("id, json_data")
      .eq("session_id", sessionId)
      .maybeSingle();

    const existingPairs = existingRow?.json_data?.conversation_pairs || [];

    const payload = {
      session_id: sessionId,
      module: sessionModule || 'support',
      anonymous_owner_id: anonymousOwnerId,
      patient_text: maskedPatientText,
      conversation_history: maskedConversation,
      user_report: maskedUserReport,
      doctor_report: maskedDoctorReport,
      risk_level: riskLevel || null,
      support_plan: supportPlan || null,
      public_code: publicCode,
      organization_id: organizationId,
      primary_expert_id: primaryExpertId,
      invite_token: inviteToken,
      json_data: {
        dialogDepth: dialogDepth ?? 0,
        previousPatientReport: previousPatientReport || "",
        previousDoctorReport: previousDoctorReport || "",
        homeTasks: homeTasks || "",
        resourceFactors: resourceFactors || "",
        questions: questions || null,
        answers: answers || {},
        voiceObservations: voiceObservations || null,
        _debug: _debug || null,
        care_recommendation: care_recommendation || null,
        ...(existingPairs.length > 0 ? { conversation_pairs: existingPairs } : {}),
      },
    };

    let error;
    if (existingRow) {
      ({ error } = await supabase.from("sessions").update(payload).eq("session_id", sessionId));
    } else {
      ({ error } = await supabase.from("sessions").insert(payload));
    }

    if (error) {
      console.error("save-session supabase error", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось сохранить сессию. Попробуйте позже.",
        details: process.env.VERCEL ? undefined : error.message,
      });
    }

    // Only make wallet visible after code persistence is confirmed
    if (newWalletId) {
      const { setWalletVisible } = await import("../lib/usage/wallet.js");
      setWalletVisible({ walletId: newWalletId });
    }

    // Generate access_token for sessions that don't have one yet
    let accessToken = null;
    if (isNewSession || !alreadyHasToken) {
      accessToken = await generateSessionAccessToken(sessionId);
      if (!accessToken) {
        console.error("handleSave: failed to generate/store access token for", sessionId);
        // Don't fail the save — token can be regenerated later.
        // Legacy access still works until migrations are applied.
      }
    }

    // Create owner-level continuation credential on first completed report (cross-device access)
    let continuationCode = null;
    const moduleForCredential = sessionModule || "support";
    if (moduleForCredential === "support" && anonymousOwnerId) {
      try {
        const { credential, secret, isNew } = await getOrCreateContinuationCredential({
          module: moduleForCredential,
          ownerId: anonymousOwnerId,
          supabase,
        });
        if (credential && (isNew || secret)) {
          continuationCode = isNew && secret ? `${credential.lookup_code}-${secret}` : null;
        }
      } catch (credErr) {
        if (credErr instanceof ContinuationConfigError) {
          console.error("handleSave: continuation credential config error", credErr.message);
        } else {
          console.error("handleSave: failed to get/create continuation credential", credErr);
        }
        // Don't fail the save; credential can be regenerated later.
      }
    }

    // Return wallet balance if visible
    let usageBalance = null;
    try {
      const wallet = await ensureWallet({ ownerType: "anonymous_case", ownerId: anonymousOwnerId, module: "support" });
      if (wallet) {
        const { getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
        usageBalance = await getUsageBalanceForClient({ walletId: wallet.id });
      }
    } catch (_) { /* non-blocking */ }

    return res.status(200).json({
      ok: true,
      message: "Сессия сохранена. Вы можете продолжить позже.",
      sessionId,
      publicCode,
      continuation_code: continuationCode,
      organization_id: organizationId,
      primary_expert_id: primaryExpertId,
      access_token: accessToken,
      usage_balance: usageBalance,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка сохранения сессии",
    });
  }
}

async function handleLoad(req, res) {
  try {
    const { publicCode, access_token } = req.body || {};

    if (!publicCode || typeof publicCode !== "string") {
      return res.status(400).json({ error: "Введите код диалога" });
    }

    const normalized = publicCode.trim().toUpperCase();

    const isSupportCode = /^ТОЧКА-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
    const isHealthCode = /^HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(normalized);
    if (!isSupportCode && !isHealthCode) {
      return res.status(400).json({
        ok: false,
        error: "Неверный формат кода. Ожидается ТОЧКА-XXXX-XXXX или HEALTH-XXXX-XXX.",
      });
    }

    const { data, error } = await getSupabase()
      .from("sessions")
      .select("" +
        "session_id, module, public_code, patient_text, conversation_history, " +
        "user_report, doctor_report, support_plan, risk_level, json_data, " +
        "organization_id, primary_expert_id, invite_token, legacy_access, created_at, anonymous_owner_id"
      )
      .eq("public_code", normalized)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        ok: false,
        error: "База данных временно недоступна. Попробуйте позже.",
      });
    }

    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "Код не найден. Проверьте правильность ввода.",
      });
    }

    if (isHealthCode && data.module !== "body") {
      return res.status(404).json({ ok: false, error: "Код не найден." });
    }
    if (isSupportCode && data.module !== "support" && data.module !== "body") {
      return res.status(404).json({ ok: false, error: "Код не найден." });
    }

    // Access token validation
    if (!data.legacy_access) {
      if (!access_token) {
        return res.status(401).json({ ok: false, error: "Требуется код доступа к сессии." });
      }
      const valid = await validateSessionAccess(data.session_id, access_token);
      if (!valid) {
        return res.status(403).json({ ok: false, error: "Неверный код доступа." });
      }
    }

    const jsonData = data.json_data || {};
    const pairs = jsonData.conversation_pairs || [];
    const session = {
      sessionId: data.session_id,
      module: data.module || 'support',
      publicCode: data.public_code,
      patient_input: data.patient_text,
      conversationHistory: data.conversation_history,
      conversationPairs: Array.isArray(pairs) ? pairs : [],
      user_report: data.user_report,
      doctor_report: data.doctor_report,
      supportPlan: data.support_plan,
      riskLevel: data.risk_level,
      dialogDepth: jsonData.dialogDepth ?? 0,
      previousPatientReport: jsonData.previousPatientReport || "",
      previousDoctorReport: jsonData.previousDoctorReport || "",
      homeTasks: jsonData.homeTasks || "",
      resourceFactors: jsonData.resourceFactors || "",
      questions: jsonData.questions || null,
      answers: jsonData.answers || {},
      // Legacy flag so frontend knows if access_token is needed for writes
      legacyAccess: data.legacy_access === true,
    };

    // Return wallet balance if visible
    let usageBalance = null;
    if (data.anonymous_owner_id) {
      try {
        const { ensureWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
        const wallet = await ensureWallet({ ownerType: "anonymous_case", ownerId: data.anonymous_owner_id, module: "support" });
        if (wallet) {
          usageBalance = await getUsageBalanceForClient({ walletId: wallet.id });
        }
      } catch (_) { /* non-blocking */ }
    }

    return res.status(200).json({
      ok: true,
      message: "Сессия загружена.",
      session,
      usage_balance: usageBalance,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка при поиске сессии",
    });
  }
}

function makeSessionSummary(session) {
  // Privacy-safe one-sentence summary from user's own words.
  // Avoids diagnoses and medical conclusions.
  const input = (session.patient_text || "").trim();
  if (!input) return "Обращение без текстового описания.";
  // First sentence: up to first sentence terminator.
  const firstSentence = input.split(/[.!?\n]/)[0].trim();
  const limited = firstSentence.slice(0, 110);
  const suffix = firstSentence.length > 110 ? "…" : "";
  return `${limited}${suffix}`;
}

async function handleGetCabinet(req, res) {
  try {
    const { sessionId, publicCode, access_token } = req.body || {};

    if (!access_token) {
      return res.status(401).json({ ok: false, error: "Требуется код доступа." });
    }

    const supabase = getSupabase();
    let effectiveSessionId = sessionId;

    if (publicCode) {
      const normalized = publicCode.trim().toUpperCase();
      const { data: resolved, error: resolvedError } = await supabase
        .from("sessions")
        .select("session_id, module")
        .eq("public_code", normalized)
        .maybeSingle();
      if (resolvedError) {
        console.error("handleGetCabinet: resolve publicCode error", resolvedError);
        return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
      }
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Сессия не найдена." });
      }
      if (resolved.module !== "support" && resolved.module !== "body") {
        return res.status(404).json({ ok: false, error: "Сессия не найдена." });
      }
      effectiveSessionId = resolved.session_id;
    }

    if (!effectiveSessionId || typeof effectiveSessionId !== "string" || !isValidSessionId(effectiveSessionId)) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or publicCode" });
    }

    const valid = await validateSessionAccess(effectiveSessionId, access_token);
    if (!valid) {
      return res.status(403).json({ ok: false, error: "Неверный код доступа." });
    }

    const { data: currentSession, error: currentError } = await supabase
      .from("sessions")
      .select("session_id, public_code, anonymous_owner_id, module, created_at, json_data")
      .eq("session_id", effectiveSessionId)
      .maybeSingle();

    if (currentError) {
      console.error("handleGetCabinet: SELECT error", currentError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
    }
    if (!currentSession) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    const ownerId = currentSession.anonymous_owner_id;
    if (!ownerId) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    // All sessions for this owner (cabinet view, chronological desc).
    const { data: sessions, error: sessionsError } = await supabase
      .from("sessions")
      .select("session_id, public_code, module, patient_text, created_at, json_data")
      .eq("anonymous_owner_id", ownerId)
      .eq("module", "support")
      .order("created_at", { ascending: false });

    if (sessionsError) {
      console.error("handleGetCabinet: sessions list error", sessionsError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
    }

    const sessionList = (sessions || []).map((s, idx) => {
      const json = s.json_data || {};
      const isContinuation = !!(json.previousPatientReport || json.isContinuation);
      return {
        sessionId: s.session_id,
        publicCode: s.public_code,
        createdAt: s.created_at,
        summary: makeSessionSummary(s),
        status: isContinuation ? "followup" : "first_contact",
        order: idx + 1,
      };
    });

    // Latest session context needed for follow-up
    const latest = sessions?.[0];
    const latestJson = latest?.json_data || {};
    const latestReport = latest ? {
      user_report: latest.user_report || "",
      doctor_report: latest.doctor_report || "",
      previousPatientReport: latestJson.previousPatientReport || "",
      previousDoctorReport: latestJson.previousDoctorReport || "",
      homeTasks: latestJson.homeTasks || "",
      resourceFactors: latestJson.resourceFactors || "",
      supportPlan: latest.support_plan || null,
      dialogDepth: latestJson.dialogDepth ?? 0,
      conversationHistory: latest.conversation_history || [],
    } : null;

    return res.status(200).json({
      ok: true,
      public_code: currentSession.public_code,
      session_id: currentSession.session_id,
      sessions: sessionList,
      latest_report: latestReport,
    });
  } catch (error) {
    console.error("handleGetCabinet error", error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка кабинета" });
  }
}

async function handleGetReport(req, res) {
  try {
    const { sessionId, publicCode, access_token } = req.body || {};

    if (!access_token) {
      return res.status(401).json({ ok: false, error: "Требуется код доступа." });
    }

    const supabase = getSupabase();
    let effectiveSessionId = sessionId;

    if (publicCode) {
      const normalized = publicCode.trim().toUpperCase();
      const { data: resolved, error: resolvedError } = await supabase
        .from("sessions")
        .select("session_id, module")
        .eq("public_code", normalized)
        .maybeSingle();
      if (resolvedError) {
        console.error("handleGetReport: resolve publicCode error", resolvedError);
        return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
      }
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Сессия не найдена." });
      }
      if (resolved.module !== "support" && resolved.module !== "body") {
        return res.status(404).json({ ok: false, error: "Сессия не найдена." });
      }
      effectiveSessionId = resolved.session_id;
    }

    if (!effectiveSessionId || typeof effectiveSessionId !== "string" || !isValidSessionId(effectiveSessionId)) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or publicCode" });
    }

    let valid = await validateSessionAccess(effectiveSessionId, access_token);
    if (!valid) {
      // Owner-based fallback: token may belong to another session of the same owner (cabinet access).
      const { data: target } = await supabase
        .from("sessions")
        .select("anonymous_owner_id")
        .eq("session_id", effectiveSessionId)
        .maybeSingle();
      if (!target?.anonymous_owner_id) {
        return res.status(404).json({ ok: false, error: "Сессия не найдена." });
      }
      const { data: tokenSession } = await supabase
        .from("sessions")
        .select("session_id, anonymous_owner_id, access_token_hash, legacy_access")
        .eq("access_token_hash", hashToken(access_token))
        .maybeSingle();
      valid = !!tokenSession && tokenSession.anonymous_owner_id === target.anonymous_owner_id;
    }
    if (!valid) {
      return res.status(403).json({ ok: false, error: "Неверный код доступа." });
    }

    const { data, error } = await supabase
      .from("sessions")
      .select(
        "session_id, module, public_code, patient_text, conversation_history, " +
        "user_report, doctor_report, support_plan, risk_level, json_data, " +
        "organization_id, primary_expert_id, created_at"
      )
      .eq("session_id", effectiveSessionId)
      .maybeSingle();

    if (error) {
      console.error("handleGetReport: SELECT error", error);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
    }
    if (!data) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    const jsonData = data.json_data || {};
    const pairs = jsonData.conversation_pairs || [];
    const session = {
      sessionId: data.session_id,
      module: data.module || "support",
      publicCode: data.public_code,
      patient_input: data.patient_text,
      conversationHistory: data.conversation_history,
      conversationPairs: Array.isArray(pairs) ? pairs : [],
      user_report: data.user_report,
      doctor_report: data.doctor_report,
      supportPlan: data.support_plan,
      riskLevel: data.risk_level,
      dialogDepth: jsonData.dialogDepth ?? 0,
      previousPatientReport: jsonData.previousPatientReport || "",
      previousDoctorReport: jsonData.previousDoctorReport || "",
      homeTasks: jsonData.homeTasks || "",
      resourceFactors: jsonData.resourceFactors || "",
      questions: jsonData.questions || null,
      answers: jsonData.answers || {},
      createdAt: data.created_at,
    };

    return res.status(200).json({
      ok: true,
      session,
    });
  } catch (error) {
    console.error("handleGetReport error", error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка загрузки отчёта" });
  }
}

async function handleCreateFollowUpSession(req, res) {
  try {
    const { previousSessionId, access_token } = req.body || {};

    if (!previousSessionId || typeof previousSessionId !== "string") {
      return res.status(400).json({ ok: false, error: "Missing previousSessionId" });
    }
    if (!isValidSessionId(previousSessionId)) {
      return res.status(400).json({ ok: false, error: "Invalid previousSessionId format" });
    }
    if (!access_token) {
      return res.status(401).json({ ok: false, error: "Требуется код доступа." });
    }

    const valid = await validateSessionAccess(previousSessionId, access_token);
    if (!valid) {
      return res.status(403).json({ ok: false, error: "Неверный код доступа." });
    }

    const supabase = getSupabase();
    const { data: parent, error: parentError } = await supabase
      .from("sessions")
      .select("anonymous_owner_id, module, public_code")
      .eq("session_id", previousSessionId)
      .maybeSingle();

    if (parentError) {
      console.error("handleCreateFollowUpSession: SELECT error", parentError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
    }
    if (!parent || !parent.anonymous_owner_id) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    const { generatePublicCode } = await import("../lib/publicCode.js");
    const { randomUUID } = await import("node:crypto");

    const newSessionId = randomUUID();
    const newPublicCode = generatePublicCode();

    const { error: insertError } = await supabase.from("sessions").insert({
      session_id: newSessionId,
      module: parent.module || "support",
      anonymous_owner_id: parent.anonymous_owner_id,
      public_code: newPublicCode,
      patient_text: "",
      conversation_history: [],
      json_data: {
        previousPublicCode: parent.public_code,
        isContinuation: true,
      },
    });

    if (insertError) {
      console.error("handleCreateFollowUpSession: INSERT error", insertError);
      return res.status(500).json({ ok: false, error: "Не удалось создать сессию продолжения." });
    }

    const newAccessToken = await generateSessionAccessToken(newSessionId);
    if (!newAccessToken) {
      console.error("handleCreateFollowUpSession: failed to generate token for", newSessionId);
      return res.status(500).json({ ok: false, error: "Не удалось создать код доступа." });
    }

    return res.status(200).json({
      ok: true,
      sessionId: newSessionId,
      access_token: newAccessToken,
      public_code: newPublicCode,
      previous_session_id: previousSessionId,
    });
  } catch (error) {
    console.error("handleCreateFollowUpSession error", error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка создания сессии продолжения" });
  }
}

async function handleGenerateAccessToken(req, res) {
  try {
    const { sessionId, publicCode } = req.body || {};

    if (!sessionId && !publicCode) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or publicCode" });
    }

    const supabase = getSupabase();
    let query = supabase.from("sessions").select("session_id, legacy_access").maybeSingle();

    if (sessionId) {
      query = query.eq("session_id", sessionId);
    } else {
      query = query.eq("public_code", publicCode);
    }

    const { data, error } = await query;
    if (error) {
      console.error("handleGenerateAccessToken: SELECT error", error);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна. Попробуйте позже." });
    }
    if (!data) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена" });
    }

    const rawToken = await generateSessionAccessToken(data.session_id);
    if (!rawToken) {
      return res.status(500).json({ ok: false, error: "Не удалось сгенерировать токен" });
    }

    return res.status(200).json({ ok: true, access_token: rawToken });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error" });
  }
}

async function handleUpdateSupportPlan(req, res) {
  try {
    const { public_code, session_id, support_plan, access_token } = req.body || {};

    if (!public_code && !session_id) {
      return res.status(400).json({ ok: false, error: "Missing public_code or session_id" });
    }

    const effectiveSessionId = session_id || public_code;

    // Check access if non-legacy
    const supabase = getSupabase();
    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .select("session_id, legacy_access")
      .eq(session_id ? "session_id" : "public_code", effectiveSessionId)
      .maybeSingle();

    if (sessionError) {
      console.error("handleUpdateSupportPlan: SELECT error", sessionError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна. Попробуйте позже." });
    }

    if (sessionData && !sessionData.legacy_access) {
      if (!access_token) {
        return res.status(401).json({ ok: false, error: "Требуется код доступа." });
      }
      const valid = await validateSessionAccess(sessionData.session_id, access_token);
      if (!valid) {
        return res.status(403).json({ ok: false, error: "Неверный код доступа." });
      }
    }

    let query = supabase.from("sessions").update({ support_plan, updated_at: new Date().toISOString() });

    if (public_code) {
      query = query.eq("public_code", public_code);
    } else {
      query = query.eq("session_id", session_id);
    }

    const { error: updateError } = await query;

    if (updateError) {
      console.error("updateSupportPlan error:", updateError);
      return res.status(500).json({ ok: false, error: "Failed to update support plan" });
    }

    return res.status(200).json({ ok: true, message: "План поддержки обновлён" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error updating support plan" });
  }
}

async function handleSaveConversationPairs(req, res) {
  try {
    const { sessionId, pairs, access_token } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "Missing sessionId" });
    }
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ ok: false, error: "Invalid sessionId format" });
    }

    if (!Array.isArray(pairs)) {
      return res.status(400).json({ ok: false, error: "pairs must be an array" });
    }

    const supabase = getSupabase();

    // Check access
    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .select("legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (sessionError) {
      console.error("handleSaveConversationPairs: SELECT error", sessionError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна. Попробуйте позже." });
    }

    if (sessionData && !sessionData.legacy_access) {
      if (!access_token) {
        return res.status(401).json({ ok: false, error: "Требуется код доступа." });
      }
      const valid = await validateSessionAccess(sessionId, access_token);
      if (!valid) {
        return res.status(403).json({ ok: false, error: "Неверный код доступа." });
      }
    }

    const { data: existingRow } = await supabase
      .from("sessions")
      .select("id, json_data")
      .eq("session_id", sessionId)
      .maybeSingle();

    const existingJson = existingRow?.json_data || {};
    const existingPairs = Array.isArray(existingJson.conversation_pairs) ? existingJson.conversation_pairs : [];
    const merged = mergePairs(existingPairs, pairs);

    const payload = {
      json_data: { ...existingJson, conversation_pairs: merged },
      updated_at: new Date().toISOString(),
    };

    let error;
    if (existingRow) {
      ({ error } = await supabase.from("sessions").update(payload).eq("session_id", sessionId));
    } else {
      payload.session_id = sessionId;
      ({ error } = await supabase.from("sessions").insert(payload));
    }

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error saving conversation pairs" });
  }
}

function mergePairs(existing, incoming) {
  const seen = new Set();
  const merged = [];
  for (const p of existing) {
    if (p.round !== undefined && !seen.has(p.round)) {
      seen.add(p.round);
      merged.push(p);
    }
  }
  for (const p of incoming) {
    if (p.round !== undefined && !seen.has(p.round)) {
      seen.add(p.round);
      merged.push(p);
    }
  }
  merged.sort((a, b) => (a.round || 0) - (b.round || 0));
  return merged;
}

async function handleListBodyDailyLogs(req, res) {
  try {
    const { session_id, access_token } = req.body || {};

    if (!session_id) {
      return res.status(400).json({ ok: false, error: "Missing session_id" });
    }

    const supabase = getSupabase();

    // Check access if non-legacy
    const { data: sessionData, error: sessionError } = await supabase
      .from("sessions")
      .select("legacy_access")
      .eq("session_id", session_id)
      .maybeSingle();

    if (sessionError) {
      console.error("handleListBodyDailyLogs: SELECT error", sessionError);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна. Попробуйте позже." });
    }

    if (sessionData && !sessionData.legacy_access) {
      if (!access_token) {
        return res.status(401).json({ ok: false, error: "Требуется код доступа." });
      }
      const valid = await validateSessionAccess(session_id, access_token);
      if (!valid) {
        return res.status(403).json({ ok: false, error: "Неверный код доступа." });
      }
    }

    const { data, error } = await supabase
      .from("body_daily_logs")
      .select("*")
      .eq("session_id", session_id)
      .order("log_date", { ascending: false })
      .limit(30);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.status(200).json({ ok: true, logs: data || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error listing diary logs" });
  }
}

async function handleValidateInviteToken(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, error: "Укажите token" });
    }

    const { validateInviteToken } = await import("./experts.js");
    const invite = await validateInviteToken(token);

    if (!invite) {
      return res.status(200).json({
        ok: false,
        valid: false,
        error: "Ссылка недействительна или устарела",
      });
    }

    return res.status(200).json({
      ok: true,
      valid: true,
      invite: {
        id: invite.id,
        organization_id: invite.organization_id,
        expert_id: invite.expert_id,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка проверки токена" });
  }
}

const EXCHANGE_RATE_LIMIT_ERROR = "Не удалось открыть запись. Проверьте код продолжения.";
const LEGACY_CODE_ERROR = "Этот код был создан в старой тестовой версии. Создайте новый код или обратитесь к специалисту.";

async function handleExchangeContinuationCredential(req, res) {
  try {
    const { module: reqModule, continuation_code } = req.body || {};

    if (!SUPPORTED_MODULES.includes(reqModule)) {
      return res.status(400).json({ ok: false, error: "Invalid module" });
    }

    const parsed = parseContinuationCredential(continuation_code);
    if (!parsed) {
      // Legacy short codes (ТОЧКА-XXXX-XXXX or HEALTH-XXXX-XXX) are never valid alone.
      if (isLegacyShortCode(continuation_code)) {
        return res.status(403).json({ ok: false, error: LEGACY_CODE_ERROR });
      }
      return res.status(401).json({ ok: false, error: EXCHANGE_RATE_LIMIT_ERROR });
    }

    if (parsed.module !== reqModule) {
      return res.status(401).json({ ok: false, error: EXCHANGE_RATE_LIMIT_ERROR });
    }

    const supabase = getSupabase();

    // Anti-abuse: high threshold per IP, independent of credential lock.
    const abuseLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, prefix: "continuation_abuse:" });
    const abuseLimited = await abuseLimit(req, res);
    if (abuseLimited) return;

    // Unified failure limiter keyed by IP + HMAC(lookup_code). It works identically
    // whether the lookup_code exists in continuation_credentials or not, preventing
    // enumeration of existing credentials.
    const clientIp = getClientIp(req);
    let attemptKey;
    try {
      attemptKey = getContinuationAttemptKey(clientIp, parsed.lookupCode);
    } catch (pepperError) {
      if (pepperError instanceof ContinuationConfigError) {
        console.error("handleExchangeContinuationCredential: config error", pepperError.message);
        return res.status(500).json({ ok: false, error: "Server configuration error" });
      }
      throw pepperError;
    }

    const now = new Date().toISOString();
    const commonError = { status: 401, data: { ok: false, error: EXCHANGE_RATE_LIMIT_ERROR } };

    // Check existing lock first (before touching the credential row).
    const { data: existingAttempts } = await supabase
      .from("continuation_failed_attempts")
      .select("failed_attempt_count, locked_until")
      .eq("attempt_key", attemptKey)
      .maybeSingle();

    if (existingAttempts?.locked_until && existingAttempts.locked_until > now) {
      return res.status(429).json({ ok: false, error: EXCHANGE_RATE_LIMIT_ERROR });
    }

    const { data: credential } = await supabase
      .from("continuation_credentials")
      .select("id, module, owner_type, owner_id, lookup_code, secret_hash, secret_version, revoked_at, created_at")
      .eq("lookup_code", parsed.lookupCode)
      .maybeSingle();

    const credentialFound = !!credential;
    const isRevoked = credential && credential.revoked_at;
    const secretValid = credential
      && credential.module === reqModule
      && !credential.revoked_at
      && verifyContinuationSecret(parsed.secret, credential.secret_hash);

    if (!secretValid) {
      // Specific error for revoked credentials
      if (credentialFound && isRevoked) {
        return res.status(401).json({ ok: false, error: "Этот код был заменён новым. Используйте актуальный код продолжения." });
      }

      console.log("[exchange]", JSON.stringify({
        action: "exchange",
        lookup_fingerprint: fingerprint(parsed.lookupCode),
        credential_id_fingerprint: credential ? fingerprint(credential.id) : "none",
        credential_found: credentialFound,
        secret_valid: false,
        response_status: 401,
      }));

      // Atomically increment failures for this IP + lookup pair. The same RPC is used
      // regardless of whether the credential exists, so the responses are identical.
      const { data: incremented, error: incrementError } = await supabase.rpc(
        "increment_continuation_failed_attempts",
        { p_attempt_key: attemptKey }
      );

      if (incrementError) {
        console.error("handleExchangeContinuationCredential: increment failed", incrementError);
        return res.status(500).json({ ok: false, error: "Не удалось проверить данные. Попробуйте ещё раз." });
      }

      if (incremented?.[0]?.locked_until && incremented[0].locked_until > now) {
        return res.status(429).json({ ok: false, error: EXCHANGE_RATE_LIMIT_ERROR });
      }

      return res.status(commonError.status).json(commonError.data);
    }

    // Success: clear failures for this IP + lookup pair, issue new access token.
    await supabase.rpc("clear_continuation_failed_attempts", { p_attempt_key: attemptKey });

    const targetTable = reqModule === "body" ? "body_clients" : "sessions";
    let targetQuery = supabase
      .from(targetTable)
      .select("session_id")
      .eq("anonymous_owner_id", credential.owner_id);

    if (reqModule !== "body") {
      targetQuery = targetQuery.eq("module", reqModule);
    }

    const { data: targetSession, error: targetError } = await targetQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (targetError) {
      console.error("[handleExchangeContinuationCredential] target query error:", targetError.code, "table:", targetTable);
      return res.status(500).json({ ok: false, error: "Не удалось открыть профиль. Попробуйте позже." });
    }
    if (!targetSession?.session_id) {
      console.log("[handleExchangeContinuationCredential] target_session_found:", false, "owner_found:", true);
      return res.status(404).json({ ok: false, error: "Не удалось найти запись для этого кода. Обратитесь к специалисту." });
    }

    const cabinet = await buildCabinetData({ module: reqModule, ownerId: credential.owner_id, supabase });
    const usageBalance = await getUsageBalanceForOwner({ module: reqModule, ownerId: credential.owner_id });

    const newAccessToken = await generateSessionAccessToken(targetSession.session_id, {
      module: reqModule,
      anonymousOwnerId: credential.owner_id,
      publicCode: cabinet.sessions?.[0]?.publicCode || null,
    });
    if (!newAccessToken) {
      return res.status(500).json({ ok: false, error: "Не удалось создать код доступа. Попробуйте позже." });
    }

    console.log("[exchange]", JSON.stringify({
      action: "exchange",
      lookup_fingerprint: fingerprint(parsed.lookupCode),
      credential_id_fingerprint: fingerprint(credential.id),
      owner_fingerprint: fingerprint(credential.owner_id),
      target_session_fingerprint: fingerprint(targetSession.session_id),
      secret_version: credential.secret_version,
      credential_found: true,
      secret_valid: true,
      response_status: 200,
    }));

    return res.status(200).json({
      ok: true,
      session_id: targetSession.session_id,
      access_token: newAccessToken,
      module: reqModule,
      public_code: cabinet.sessions?.[0]?.publicCode || null,
      cabinet,
      usage_balance: usageBalance,
    });
  } catch (error) {
    if (error instanceof ContinuationConfigError) {
      console.error("handleExchangeContinuationCredential: config error", error.message);
      return res.status(500).json({ ok: false, error: "Server configuration error" });
    }
    console.error("handleExchangeContinuationCredential error", error);
    return res.status(500).json({ ok: false, error: "Не удалось проверить данные. Попробуйте ещё раз." });
  }
}

async function handleRegenerateContinuationCredential(req, res) {
  try {
    const { session_id, access_token, module: reqModule } = req.body || {};

    if (!session_id || !access_token) {
      return res.status(401).json({ ok: false, error: "Требуется код доступа." });
    }

    const valid = await validateSessionAccess(session_id, access_token);
    if (!valid) {
      return res.status(403).json({ ok: false, error: "Неверный код доступа." });
    }

    const module = reqModule || "support";
    if (!SUPPORTED_MODULES.includes(module)) {
      return res.status(400).json({ ok: false, error: "Invalid module" });
    }

    const supabase = getSupabase();
    const table = module === "body" ? "body_clients" : "sessions";
    const { data: session, error: sessionError } = await supabase
      .from(table)
      .select("anonymous_owner_id")
      .eq("session_id", session_id)
      .maybeSingle();

    if (sessionError) {
      console.error("[handleRegenerateContinuationCredential] session lookup failed:", sessionError.code, "module:", module);
      return res.status(500).json({ ok: false, error: "Не удалось проверить сессию. Попробуйте позже." });
    }
    if (!session?.anonymous_owner_id) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    const rotationResult = await rotateContinuationCredential({
      module,
      ownerId: session.anonymous_owner_id,
      supabase,
    });

    console.log("[rotate]", JSON.stringify({
      action: "rotate",
      credential_id_fingerprint: rotationResult.credentialIdFingerprint,
      owner_fingerprint: fingerprint(session.anonymous_owner_id),
      old_lookup_fingerprint: rotationResult.oldLookupFingerprint,
      new_lookup_fingerprint: rotationResult.newLookupFingerprint,
      old_secret_version: (rotationResult.secretVersion || 1) - 1,
      new_secret_version: rotationResult.secretVersion,
      old_lookup_still_exists: false,
    }));

    return res.status(200).json({
      ok: true,
      continuation_code: rotationResult.combinedCode,
      message: "Старый код продолжения больше не действует.",
    });
  } catch (error) {
    if (error instanceof ContinuationConfigError) {
      console.error("handleRegenerateContinuationCredential: config error", error.message);
      return res.status(500).json({ ok: false, error: "Server configuration error" });
    }
    console.error("handleRegenerateContinuationCredential error:", error.message);
    return res.status(500).json({ ok: false, error: "Не удалось создать новый код продолжения." });
  }
}

async function handleGetReportStatus(req, res) {
  try {
    const { sessionId, reportRequestId } = req.body || {};
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ ok: false, error: "Missing sessionId" });
    }

    const supabase = getSupabase();
    const { data: session, error } = await supabase
      .from("sessions")
      .select("session_id, module, anonymous_owner_id, public_code, report_generation_status, report_request_id, user_report, doctor_report, care_recommendation, access_token_hash, json_data")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      console.error("handleGetReportStatus: SELECT error", error);
      return res.status(500).json({ ok: false, error: "База данных временно недоступна." });
    }
    if (!session) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена." });
    }

    const status = session.report_generation_status;
    const response = {
      ok: true,
      session_id: session.session_id,
      status: status || "not_started",
      report_request_id: session.report_request_id || null,
    };

    if (status === REPORT_STATUS.READY) {
      const artifacts = await createReportArtifacts({
        supabase,
        sessionId,
        module: session.module || "support",
        anonymousOwnerId: session.anonymous_owner_id,
      });
      const userPart = session.user_report || "";
      const doctorPart = session.doctor_report || "";
      const report = userPart.includes("===USER_REPORT===")
        ? userPart
        : `===USER_REPORT===\n\n${userPart}\n\n===DOCTOR_REPORT===\n\n${doctorPart}`;
      response.type = "final";
      response.report = report;
      response.care_recommendation = session.care_recommendation || null;
      response.public_code = session.public_code;
      response.access_token = artifacts.accessToken;
      response.continuation_code = artifacts.continuationCode;
    } else if (status === REPORT_STATUS.PROCESSING) {
      response.message = "Отчёт ещё формируется. Подождите немного.";
    } else if (status === REPORT_STATUS.FAILED) {
      response.message = "Не удалось сформировать отчёт. Попробуйте ещё раз.";
      response.error_code = session.report_error_code || null;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("handleGetReportStatus error", error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка проверки статуса" });
  }
}

async function handleGetBodyCabinet(req, res) {
  try {
    const { sessionId, accessToken, clientToday } = req.body || {};
    if (!sessionId || !accessToken) {
      return res.status(400).json({ ok: false, error: "Missing sessionId or accessToken" });
    }

    // Validate clientToday format (YYYY-MM-DD)
    const today = (clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday))
      ? clientToday
      : new Date().toISOString().slice(0, 10);

    const supabase = getSupabase();

    // 1. Look up body_clients — only real columns
    const { data: client, error: clientError } = await supabase
      .from("body_clients")
      .select("session_id, anonymous_owner_id, display_name, goal, created_at")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (clientError) {
      console.error("[handleGetBodyCabinet] body_clients query error:", clientError.code, clientError.message);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить кабинет" });
    }
    if (!client) {
      return res.status(404).json({ ok: false, error: "Сессия не найдена" });
    }

    // 2. Validate access token against sessions table
    const valid = await validateSessionAccess(sessionId, accessToken);
    if (!valid) {
      return res.status(403).json({ ok: false, error: "Сессия истекла. Войдите снова по коду продолжения." });
    }

    const ownerId = client.anonymous_owner_id;

    // 3. Get all session_ids for this owner
    const { data: ownerSessions, error: ownerSessionsError } = await supabase
      .from("body_clients")
      .select("session_id")
      .eq("anonymous_owner_id", ownerId);

    if (ownerSessionsError) {
      console.error("[handleGetBodyCabinet] owner sessions query error:", ownerSessionsError.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить кабинет" });
    }

    const ownerSessionIds = (ownerSessions || []).map(s => s.session_id);

    let profile = {};
    if (ownerSessionIds.length > 0) {
      const { data: latestIntake } = await supabase
        .from("body_intake_forms")
        .select("answers, bmi, care_recommendation, created_at")
        .in("session_id", ownerSessionIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const answers = latestIntake?.answers || {};
      profile = {
        age: answers.age || null,
        gender: answers.sex || null,
        height_cm: answers.height_cm || null,
        weight_kg: answers.weight_kg || null,
        target_weight_kg: answers.target_weight_kg || null,
        activity_level: answers.work_activity_level || null,
        sleep_hours: answers.sleep_hours_estimate || null,
        stress_level: answers.stress_level || null,
      };
    }

    // 4. Wallet
    const { data: wallet } = await supabase
      .from("usage_wallets")
      .select("balance, total_used")
      .eq("owner_id", ownerId)
      .eq("module", "body")
      .maybeSingle();

    // 5. Owner-level diary history (all sessions, last 90 days, deduplicated by date)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let allLogs = [];
    if (ownerSessionIds.length > 0) {
      const { data: ownerLogs, error: ownerLogsError } = await supabase
        .from("body_daily_logs")
        .select("session_id, log_date, weight_kg, waist_cm, steps, workout_done, workout_minutes, calories, meals_count, water_l, sleep_hours, sleep_quality, energy_level, mood_level, plate_photos, created_at, updated_at")
        .in("session_id", ownerSessionIds)
        .gte("log_date", ninetyDaysAgo)
        .order("log_date", { ascending: false });

      if (ownerLogsError) {
        console.error("[handleGetBodyCabinet] owner logs query error:", ownerLogsError.code, ownerLogsError.message);
        return res.status(500).json({ ok: false, error: "Не удалось загрузить историю дневника" });
      }

      allLogs = ownerLogs || [];
    }

    // Deduplicate by date: keep the latest entry per date (by updated_at or created_at)
    const byDate = new Map();
    for (const log of allLogs) {
      const existing = byDate.get(log.log_date);
      if (!existing) {
        byDate.set(log.log_date, log);
      } else {
        const logTime = log.updated_at || log.created_at || "";
        const existingTime = existing.updated_at || existing.created_at || "";
        if (logTime > existingTime) {
          byDate.set(log.log_date, log);
        }
      }
    }

    const dedupedHistory = Array.from(byDate.values())
      .sort((a, b) => b.log_date.localeCompare(a.log_date));

    // Today's log — search across all owner sessions
    const todayLog = dedupedHistory.find(l => l.log_date === today) || null;

    // Diagnostic log (privacy-safe)
    console.log("[body_cabinet_history]", JSON.stringify({
      action: "body_cabinet_history",
      owner_fingerprint: fingerprint(ownerId),
      session_count: ownerSessionIds.length,
      raw_log_count: allLogs.length,
      unique_day_count: dedupedHistory.length,
      response_status: 200,
    }));

    // 6. Credential existence (for code rotation UI)
    const { data: credential } = await supabase
      .from("continuation_credentials")
      .select("lookup_code")
      .eq("owner_id", ownerId)
      .eq("owner_type", "anonymous_profile")
      .eq("module", "body")
      .eq("revoked_at", null)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      profile,
      wallet: wallet ? { balance: wallet.balance, total_used: wallet.total_used } : null,
      today_log: todayLog || null,
      history: dedupedHistory.map((l) => ({
        date: l.log_date,
        weight_kg: l.weight_kg,
        waist_cm: l.waist_cm,
        steps: l.steps,
        workout_done: l.workout_done,
        workout_minutes: l.workout_minutes,
        calories: l.calories,
        meals_count: l.meals_count,
        water_l: l.water_l,
        sleep_hours: l.sleep_hours,
        sleep_quality: l.sleep_quality,
        energy_level: l.energy_level,
        mood_level: l.mood_level,
        has_photos: Array.isArray(l.plate_photos) && l.plate_photos.length > 0,
      })),
      has_credential: !!credential,
      created_at: client.created_at,
    });
  } catch (error) {
    console.error("handleGetBodyCabinet error", error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка загрузки кабинета" });
  }
}

// ============================================================
// Body Onboarding
// ============================================================

async function handleGetBodyOnboarding(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("body_onboarding")
      .select("*")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    if (error) {
      console.error("[getBodyOnboarding] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить настройки." });
    }

    return res.status(200).json({
      ok: true,
      onboarding: data || {
        intro_completed: false,
        activity_tracker_used: null,
        activity_tracker_name: null,
        tracked_metrics: [],
        calorie_tracking_mode: null,
        data_entry_preference: null,
        priority_metrics: [],
        support_style: null,
      },
    });
  } catch (error) {
    console.error("handleGetBodyOnboarding error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки настроек." });
  }
}

async function handleSaveBodyOnboarding(req, res) {
  try {
    const { session_id, access_token, onboarding } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!onboarding || typeof onboarding !== "object") {
      return res.status(400).json({ ok: false, error: "Missing onboarding data." });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    const ALLOWED_FIELDS = [
      "intro_completed", "intro_completed_at",
      "activity_tracker_used", "activity_tracker_name", "activity_tracker_other",
      "tracked_metrics",
      "calorie_tracking_mode", "calorie_tracking_app", "calorie_tracking_other",
      "data_entry_preference", "priority_metrics", "support_style",
    ];

    const payload = { owner_type: "anonymous_profile", owner_id: owner.ownerId, updated_at: now };
    for (const key of ALLOWED_FIELDS) {
      if (onboarding[key] !== undefined) {
        payload[key] = onboarding[key];
      }
    }
    if (payload.intro_completed && !payload.intro_completed_at) {
      payload.intro_completed_at = now;
    }

    // Upsert
    const { data: existing } = await supabase
      .from("body_onboarding")
      .select("id")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    let result;
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("body_onboarding")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError) {
        console.error("[saveBodyOnboarding] update error:", updateError.code);
        return res.status(500).json({ ok: false, error: "Не удалось сохранить настройки." });
      }
      result = updated;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("body_onboarding")
        .insert(payload)
        .select("*")
        .single();
      if (insertError) {
        console.error("[saveBodyOnboarding] insert error:", insertError.code);
        return res.status(500).json({ ok: false, error: "Не удалось сохранить настройки." });
      }
      result = inserted;
    }

    return res.status(200).json({ ok: true, onboarding: result });
  } catch (error) {
    console.error("handleSaveBodyOnboarding error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения настроек." });
  }
}

// ============================================================
// Body Diary Day View
// ============================================================

async function handleGetBodyDiaryDay(req, res) {
  try {
    const { session_id, access_token, log_date } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!log_date || !/^\d{4}-\d{2}-\d{2}$/.test(log_date)) {
      return res.status(400).json({ ok: false, error: "Invalid log_date format." });
    }

    const supabase = getSupabase();

    // Find all body sessions for this owner
    const { data: ownerSessions } = await supabase
      .from("body_clients")
      .select("session_id")
      .eq("anonymous_owner_id", owner.ownerId);

    const ownerSessionIds = (ownerSessions || []).map(s => s.session_id);

    if (ownerSessionIds.length === 0) {
      return res.status(404).json({ ok: false, error: "Дневник не найден." });
    }

    // Find the diary day across all owner sessions
    const { data: dayLog, error: dayError } = await supabase
      .from("body_daily_logs")
      .select("*")
      .in("session_id", ownerSessionIds)
      .eq("log_date", log_date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dayError) {
      console.error("[getBodyDiaryDay] query error:", dayError.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить дневник." });
    }
    if (!dayLog) {
      return res.status(404).json({ ok: false, error: "Запись за эту дату не найдена." });
    }

    // Get plate history for this day
    const { data: plateHistory } = await supabase
      .from("body_plate_history")
      .select("id, meal_type, photo_index, detected_foods, plate_components, vegetables_assessment, protein_assessment, carbohydrate_assessment, balance_summary, what_is_missing, gentle_suggestion, confidence, created_at")
      .eq("owner_id", owner.ownerId)
      .eq("log_date", log_date)
      .order("created_at", { ascending: true });

    return res.status(200).json({
      ok: true,
      day: {
        id: dayLog.id,
        session_id: dayLog.session_id,
        log_date: dayLog.log_date,
        weight_kg: dayLog.weight_kg,
        waist_cm: dayLog.waist_cm,
        steps: dayLog.steps,
        activity_comment: dayLog.activity_comment,
        workout_done: dayLog.workout_done,
        workout_type: dayLog.workout_type,
        workout_minutes: dayLog.workout_minutes,
        workout_intensity: dayLog.workout_intensity,
        workout_comment: dayLog.workout_comment,
        calories: dayLog.calories,
        meals_count: dayLog.meals_count,
        breakfast: dayLog.breakfast,
        lunch: dayLog.lunch,
        dinner: dayLog.dinner,
        snacks: dayLog.snacks,
        nutrition_comment: dayLog.nutrition_comment,
        overeating_level: dayLog.overeating_level,
        sweet_cravings: dayLog.sweet_cravings,
        water_l: dayLog.water_l,
        sleep_hours: dayLog.sleep_hours,
        sleep_quality: dayLog.sleep_quality,
        energy_level: dayLog.energy_level,
        mood_level: dayLog.mood_level,
        day_text: dayLog.day_text,
        voice_transcript: dayLog.voice_transcript,
        plate_photos: dayLog.plate_photos,
        plate_analysis: dayLog.plate_analysis,
        ai_day_summary: dayLog.ai_day_summary,
        ai_focus_tomorrow: dayLog.ai_focus_tomorrow,
        ai_positive_observation: dayLog.ai_positive_observation,
        ai_pattern_observation: dayLog.ai_pattern_observation,
        ai_question_for_user: dayLog.ai_question_for_user,
        daily_log_version: dayLog.daily_log_version,
        created_at: dayLog.created_at,
        updated_at: dayLog.updated_at,
      },
      plate_history: plateHistory || [],
    });
  } catch (error) {
    console.error("handleGetBodyDiaryDay error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки дневника." });
  }
}

// ============================================================
// Body Plate History
// ============================================================

async function handleSavePlateHistory(req, res) {
  try {
    const { session_id, access_token, daily_log_id, log_date, plate_results } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!daily_log_id || !log_date || !Array.isArray(plate_results)) {
      return res.status(400).json({ ok: false, error: "Missing daily_log_id, log_date, or plate_results." });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();
    let savedCount = 0;

    for (const result of plate_results) {
      if (result.error) continue; // Skip failed analyses

      const photoIndex = result.photo_index ?? 0;
      const fingerprint = `${daily_log_id}:${photoIndex}`;

      const payload = {
        owner_type: "anonymous_profile",
        owner_id: owner.ownerId,
        session_id,
        daily_log_id,
        log_date,
        photo_ref: fingerprint,
        photo_index: photoIndex,
        meal_type: result.meal_type || null,
        detected_foods: result.detected_foods || null,
        plate_components: result.plate_components || null,
        vegetables_assessment: result.plate_components?.vegetables != null ? (result.plate_components.vegetables >= 40 ? "enough" : result.plate_components.vegetables > 0 ? "low" : "missing") : null,
        protein_assessment: result.plate_components?.protein != null ? (result.plate_components.protein >= 20 ? "enough" : result.plate_components.protein > 0 ? "low" : "missing") : null,
        carbohydrate_assessment: result.plate_components?.carbohydrates != null ? (result.plate_components.carbohydrates <= 35 ? "enough" : result.plate_components.carbohydrates > 50 ? "excess" : "ok") : null,
        balance_summary: result.balance_summary || null,
        what_is_missing: result.what_is_missing || null,
        gentle_suggestion: result.gentle_suggestion || null,
        confidence: result.confidence || null,
        model_used: result.model_used || null,
        prompt_version: result.prompt_version || null,
        updated_at: now,
      };

      // Upsert by owner_id + daily_log_id + photo_index
      const { data: existing } = await supabase
        .from("body_plate_history")
        .select("id")
        .eq("owner_id", owner.ownerId)
        .eq("daily_log_id", daily_log_id)
        .eq("photo_index", photoIndex)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from("body_plate_history")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) {
          console.error("[savePlateHistory] update error:", updateError.code, "photo:", photoIndex);
        } else {
          savedCount++;
        }
      } else {
        const { error: insertError } = await supabase
          .from("body_plate_history")
          .insert(payload);
        if (insertError) {
          console.error("[savePlateHistory] insert error:", insertError.code, "photo:", photoIndex);
        } else {
          savedCount++;
        }
      }
    }

    return res.status(200).json({ ok: true, saved: savedCount });
  } catch (error) {
    console.error("handleSavePlateHistory error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения истории тарелок." });
  }
}

async function handleGetBodyPlateHistory(req, res) {
  try {
    const { session_id, access_token, period_days } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const days = period_days === 30 ? 30 : 7;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const supabase = getSupabase();

    const { data: history, error: historyError } = await supabase
      .from("body_plate_history")
      .select("id, log_date, photo_index, meal_type, detected_foods, plate_components, vegetables_assessment, protein_assessment, carbohydrate_assessment, balance_summary, what_is_missing, gentle_suggestion, confidence, created_at")
      .eq("owner_id", owner.ownerId)
      .gte("log_date", sinceDate)
      .order("log_date", { ascending: false })
      .order("photo_index", { ascending: true });

    if (historyError) {
      console.error("[getBodyPlateHistory] query error:", historyError.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить историю." });
    }

    const entries = history || [];

    // Compute aggregates
    const uniqueDays = new Set(entries.map(e => e.log_date));
    const totalPhotos = entries.length;
    const daysWithPhotos = uniqueDays.size;

    let proteinEnough = 0, proteinLow = 0, proteinMissing = 0;
    let vegEnough = 0, vegLow = 0, vegMissing = 0;
    let carbEnough = 0, carbExcess = 0;
    const missingCounts = {};
    let confidenceSum = 0, confidenceCount = 0;

    for (const e of entries) {
      if (e.protein_assessment === "enough") proteinEnough++;
      else if (e.protein_assessment === "low") proteinLow++;
      else if (e.protein_assessment === "missing") proteinMissing++;

      if (e.vegetables_assessment === "enough") vegEnough++;
      else if (e.vegetables_assessment === "low") vegLow++;
      else if (e.vegetables_assessment === "missing") vegMissing++;

      if (e.carbohydrate_assessment === "enough") carbEnough++;
      else if (e.carbohydrate_assessment === "excess") carbExcess++;

      if (Array.isArray(e.what_is_missing)) {
        for (const item of e.what_is_missing) {
          missingCounts[item] = (missingCounts[item] || 0) + 1;
        }
      }

      if (e.confidence != null) {
        confidenceSum += Number(e.confidence);
        confidenceCount++;
      }
    }

    const frequentMissing = Object.entries(missingCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([item, count]) => ({ item, count }));

    return res.status(200).json({
      ok: true,
      period_days: days,
      aggregates: {
        total_photos: totalPhotos,
        days_with_photos: daysWithPhotos,
        protein_enough: proteinEnough,
        protein_low: proteinLow,
        protein_missing: proteinMissing,
        vegetables_enough: vegEnough,
        vegetables_low: vegLow,
        vegetables_missing: vegMissing,
        carbohydrates_enough: carbEnough,
        carbohydrates_excess: carbExcess,
        frequent_missing: frequentMissing,
        average_confidence: confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : null,
      },
      entries: entries.slice(0, 20), // Last 20 for display
    });
  } catch (error) {
    console.error("handleGetBodyPlateHistory error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки истории тарелок." });
  }
}

// ============================================================
// Body Insights
// ============================================================

async function handleGetBodyInsights(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data: insights, error } = await supabase
      .from("body_insights")
      .select("id, insight_type, insight_date, title, insight_text, priority, status, created_at")
      .eq("owner_id", owner.ownerId)
      .eq("status", "active")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      console.error("[getBodyInsights] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить наблюдения." });
    }

    return res.status(200).json({ ok: true, insights: insights || [] });
  } catch (error) {
    console.error("handleGetBodyInsights error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки наблюдений." });
  }
}

async function handleDismissBodyInsight(req, res) {
  try {
    const { session_id, access_token, insight_id } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!insight_id) {
      return res.status(400).json({ ok: false, error: "Missing insight_id." });
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from("body_insights")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("id", insight_id)
      .eq("owner_id", owner.ownerId);

    if (error) {
      console.error("[dismissBodyInsight] update error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось скрыть наблюдение." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("handleDismissBodyInsight error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка скрытия наблюдения." });
  }
}

// ============================================================
// Body Weekly Summary
// ============================================================

function getLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function handleGetBodyWeeklySummary(req, res) {
  try {
    const { session_id, access_token, period_start, period_end } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!period_start || !period_end) {
      return res.status(400).json({ ok: false, error: "Missing period_start or period_end." });
    }

    const supabase = getSupabase();
    const { data: summary, error } = await supabase
      .from("body_weekly_summaries")
      .select("*")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .eq("summary_type", "weekly")
      .eq("period_start", period_start)
      .maybeSingle();

    if (error) {
      console.error("[getBodyWeeklySummary] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить итог." });
    }

    return res.status(200).json({
      ok: true,
      summary: summary || null,
      cached: !!summary,
    });
  } catch (error) {
    console.error("handleGetBodyWeeklySummary error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки итога недели." });
  }
}

async function handleGenerateBodyWeeklySummary(req, res) {
  try {
    const { session_id, access_token, period_start, period_end, force } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!period_start || !period_end) {
      return res.status(400).json({ ok: false, error: "Missing period_start or period_end." });
    }

    const supabase = getSupabase();

    // Check cache
    if (!force) {
      const { data: cached } = await supabase
        .from("body_weekly_summaries")
        .select("*")
        .eq("owner_type", "anonymous_profile")
        .eq("owner_id", owner.ownerId)
        .eq("summary_type", "weekly")
        .eq("period_start", period_start)
        .maybeSingle();

      if (cached) {
        return res.status(200).json({ ok: true, summary: cached, cached: true, credits_charged: 0 });
      }
    }

    // Gather data for the period
    const { data: ownerSessions } = await supabase
      .from("body_clients")
      .select("session_id")
      .eq("anonymous_owner_id", owner.ownerId);
    const ownerSessionIds = (ownerSessions || []).map(s => s.session_id);

    let dailyLogs = [];
    if (ownerSessionIds.length > 0) {
      const { data: logs } = await supabase
        .from("body_daily_logs")
        .select("log_date, weight_kg, waist_cm, steps, workout_done, workout_type, workout_minutes, meals_count, overeating_level, sweet_cravings, water_l, sleep_hours, sleep_quality, energy_level, mood_level, ai_positive_observation, ai_pattern_observation, ai_focus_tomorrow")
        .in("session_id", ownerSessionIds)
        .gte("log_date", period_start)
        .lte("log_date", period_end)
        .order("log_date", { ascending: true });
      dailyLogs = logs || [];
    }

    if (dailyLogs.length === 0) {
      return res.status(200).json({ ok: true, summary: null, cached: false, reason: "no_logs" });
    }

    // Plate aggregates
    const { data: plateEntries } = await supabase
      .from("body_plate_history")
      .select("log_date, protein_assessment, vegetables_assessment, carbohydrate_assessment, what_is_missing")
      .eq("owner_id", owner.ownerId)
      .gte("log_date", period_start)
      .lte("log_date", period_end);

    const plates = plateEntries || [];
    const plateAggregates = {
      total_photos: plates.length,
      days_with_photos: new Set(plates.map(p => p.log_date)).size,
      protein_present_count: plates.filter(p => p.protein_assessment === "enough").length,
      vegetables_present_count: plates.filter(p => p.vegetables_assessment === "enough").length,
      complex_carbs_present_count: plates.filter(p => p.carbohydrate_assessment === "enough").length,
      frequent_missing: (() => {
        const counts = {};
        for (const p of plates) {
          if (Array.isArray(p.what_is_missing)) {
            for (const item of p.what_is_missing) {
              counts[item] = (counts[item] || 0) + 1;
            }
          }
        }
        return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([item]) => item);
      })(),
    };

    // Active insights
    const { data: insights } = await supabase
      .from("body_insights")
      .select("title, insight_text, priority")
      .eq("owner_id", owner.ownerId)
      .eq("status", "active")
      .order("priority", { ascending: true })
      .limit(3);

    // Onboarding preferences
    const { data: onboarding } = await supabase
      .from("body_onboarding")
      .select("activity_tracker_used, support_style, priority_metrics")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    const context = {
      period: { start: period_start, end: period_end, days_count: 7, logs_count: dailyLogs.length },
      daily_logs: dailyLogs,
      plate_aggregates: plateAggregates,
      active_insights: (insights || []).map(i => ({ title: i.title, text: i.insight_text, priority: i.priority })),
      onboarding_preferences: {
        tracker_enabled: onboarding?.activity_tracker_used || false,
        support_style: onboarding?.support_style || "gentle",
        priority_metrics: onboarding?.priority_metrics || [],
      },
    };

    // Read prompt
    const { readModulePrompt } = await import("../lib/prompts.js");
    const weeklyPrompt = readModulePrompt("body", "weekly-summary.md") || "";
    const { readCorePrompt } = await import("../lib/prompts.js");
    const conversationStyle = readCorePrompt("conversation-style.md") || "";

    const systemPrompt = `${weeklyPrompt}\n\n${conversationStyle}`;
    const userPrompt = `Сформируй недельный итог на основе данных:\n\n${JSON.stringify(context, null, 2)}`;

    const MODEL = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
    const FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
    const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

    const result = await runTask(TASK_TYPES.BODY_INTAKE, {
      systemPrompt,
      userPrompt,
      model: MODEL,
      fallbackModel: FALLBACK,
      reasoningEffort: REASONING_EFFORT,
    });

    const parsed = result.parsed;
    if (!parsed || !parsed.period_summary) {
      return res.status(500).json({ ok: false, error: "Не удалось сформировать итог недели. Попробуйте позже." });
    }

    // Save to DB
    const requestId = `weekly-${owner.ownerId}-${period_start}-${Date.now()}`;
    const { error: insertError } = await supabase
      .from("body_weekly_summaries")
      .insert({
        owner_type: "anonymous_profile",
        owner_id: owner.ownerId,
        summary_type: "weekly",
        period_start,
        period_end,
        source_days: dailyLogs.length,
        source_plate_count: plates.length,
        summary_json: parsed,
        user_summary: parsed.period_summary,
        focus_next_period: parsed.next_week_focus,
        model_used: result.model_used,
        request_id: requestId,
        generation_status: "ready",
      });

    if (insertError) {
      console.error("[generateBodyWeeklySummary] insert error:", insertError.code);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить итог. Попробуйте позже." });
    }

    return res.status(200).json({
      ok: true,
      summary: { summary_json: parsed, user_summary: parsed.period_summary, period_start, period_end },
      cached: false,
      credits_charged: 2,
    });
  } catch (error) {
    console.error("handleGenerateBodyWeeklySummary error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка формирования итога недели." });
  }
}

// ============================================================
// Body AI Chat
// ============================================================

async function handleGetBodyAiChat(req, res) {
  try {
    const { session_id, access_token, limit } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const msgLimit = Math.min(limit || 20, 50);

    const { data: messages, error } = await supabase
      .from("body_ai_chat")
      .select("id, role, message_text, ai_response, created_at, model_used, request_id")
      .eq("owner_id", owner.ownerId)
      .order("created_at", { ascending: false })
      .limit(msgLimit);

    if (error) {
      console.error("[getBodyAiChat] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить историю чата." });
    }

    // Return in chronological order
    const sorted = (messages || []).reverse();
    return res.status(200).json({ ok: true, messages: sorted });
  } catch (error) {
    console.error("handleGetBodyAiChat error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки чата." });
  }
}

async function handleSendBodyAiMessage(req, res) {
  const startTime = Date.now();
  try {
    const { session_id, access_token, message_text } = req.body || {};
    console.log("[chat] step=1 received:", { has_session: !!session_id, has_token: !!access_token, msg_len: message_text?.length || 0 });

    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      console.log("[chat] step=2 resolveBodyOwner FAILED");
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }
    console.log("[chat] step=2 owner resolved");

    if (!message_text || typeof message_text !== "string") {
      return res.status(400).json({ ok: false, error: "Missing message_text." });
    }

    const trimmed = message_text.trim();
    if (trimmed.length > 3000) {
      return res.status(400).json({ ok: false, error: "Слишком длинный вопрос. Сократите, пожалуйста." });
    }

    const supabase = getSupabase();

    // Save user message
    const userMsgId = crypto.randomUUID();
    const { error: userInsertErr } = await supabase.from("body_ai_chat").insert({
      id: userMsgId,
      owner_type: "anonymous_profile",
      owner_id: owner.ownerId,
      session_id,
      role: "user",
      message_text: trimmed,
      created_at: new Date().toISOString(),
    });
    if (userInsertErr) {
      console.error("[chat] step=3 user message insert FAILED:", userInsertErr.code, userInsertErr.message);
    } else {
      console.log("[chat] step=3 user message saved");
    }

    // Build context snapshot
    let context;
    try {
      context = await buildAiChatContext({ supabase, ownerId: owner.ownerId });
      console.log("[chat] step=4 context built:", {
        logs: context.recent_daily_logs?.length || 0,
        insights: context.active_insights?.length || 0,
        weekly: !!context.weekly_summary,
        chat: context.recent_chat_messages?.length || 0,
      });
    } catch (ctxErr) {
      console.error("[chat] step=4 context build FAILED:", ctxErr.message);
      context = {};
    }

    // Read prompt
    let chatPrompt = "";
    let conversationStyle = "";
    try {
      const { readModulePrompt, readCorePrompt } = await import("../lib/prompts.js");
      chatPrompt = readModulePrompt("body", "ai-chat.md") || "";
      conversationStyle = readCorePrompt("conversation-style.md") || "";
      console.log("[chat] step=5 prompts loaded:", { chat_prompt_len: chatPrompt.length, style_len: conversationStyle.length });
    } catch (promptErr) {
      console.error("[chat] step=5 prompt load FAILED:", promptErr.message);
    }

    const systemPrompt = `${chatPrompt}\n\n${conversationStyle}\n\nКонтекст пользователя:\n${JSON.stringify(context, null, 2)}`;
    const userPrompt = trimmed;

    const MODEL = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
    const FALLBACK = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
    const REASONING_EFFORT = process.env.AI_REASONING_EFFORT || "medium";

    let result;
    try {
      console.log("[chat] step=6 calling AI:", { model: MODEL, fallback: FALLBACK });
      result = await runTask(TASK_TYPES.BODY_INTAKE, {
        systemPrompt,
        userPrompt,
        model: MODEL,
        fallbackModel: FALLBACK,
        reasoningEffort: REASONING_EFFORT,
      });
      console.log("[chat] step=6 AI returned:", {
        has_parsed: !!result.parsed,
        has_answer: !!result.parsed?.answer,
        raw_len: result.raw?.length || 0,
        model_used: result.model_used,
        duration_ms: Date.now() - startTime,
      });
    } catch (aiErr) {
      console.error("[chat] step=6 AI call FAILED:", aiErr.message, "duration:", Date.now() - startTime, "ms");
      return res.status(200).json({
        ok: true,
        message: { role: "assistant", answer: "Не удалось ответить сейчас. Попробуйте позже.", confidence: "low" },
        credits_charged: 0,
      });
    }

    const parsed = result.parsed;
    const raw = result.raw || "";
    const requestId = `chat-${owner.ownerId}-${Date.now()}`;

    // Build response: prefer parsed JSON, fallback to raw text
    let aiAnswer;
    let aiSmallStep = null;
    let aiQuestion = null;
    let aiSafety = null;
    let aiConfidence = "medium";

    if (parsed && parsed.answer) {
      aiAnswer = parsed.answer;
      aiSmallStep = parsed.small_next_step || null;
      aiQuestion = parsed.question_for_specialist || null;
      aiSafety = parsed.safety_note || null;
      aiConfidence = parsed.confidence || "medium";
      console.log("[chat] step=7 using parsed JSON answer");
    } else if (raw) {
      aiAnswer = raw.slice(0, 2000);
      aiConfidence = "low";
      console.log("[chat] step=7 using raw text fallback, len:", raw.length);
    } else {
      aiAnswer = "Не удалось получить ответ. Попробуйте переформулировать вопрос.";
      aiConfidence = "low";
      console.log("[chat] step=7 no answer available");
    }

    // Save assistant response
    const assistantMsgId = crypto.randomUUID();
    const { error: assistantInsertErr } = await supabase.from("body_ai_chat").insert({
      id: assistantMsgId,
      owner_type: "anonymous_profile",
      owner_id: owner.ownerId,
      session_id,
      role: "assistant",
      message_text: aiAnswer,
      ai_response: { answer: aiAnswer, small_next_step: aiSmallStep, question_for_specialist: aiQuestion, safety_note: aiSafety, confidence: aiConfidence },
      context_snapshot: {
        logs_count: context.recent_daily_logs?.length || 0,
        insights_count: context.active_insights?.length || 0,
        has_weekly: !!context.weekly_summary,
      },
      request_id: requestId,
      model_used: result.model_used,
      created_at: new Date().toISOString(),
    });
    if (assistantInsertErr) {
      console.error("[chat] step=8 assistant insert FAILED:", assistantInsertErr.code);
    } else {
      console.log("[chat] step=8 assistant saved, total_duration:", Date.now() - startTime, "ms");
    }

    return res.status(200).json({
      ok: true,
      message: {
        id: assistantMsgId,
        role: "assistant",
        answer: aiAnswer,
        small_next_step: aiSmallStep,
        question_for_specialist: aiQuestion,
        safety_note: aiSafety,
        confidence: aiConfidence,
        created_at: new Date().toISOString(),
      },
      credits_charged: 1,
    });
  } catch (error) {
    console.error("handleSendBodyAiMessage error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отправки сообщения." });
  }
}

async function buildAiChatContext({ supabase, ownerId }) {
  const context = {};

  // Profile
  try {
    const { data: latestIntake } = await supabase
      .from("body_intake_forms")
      .select("answers, bmi, care_recommendation")
      .in("session_id", (await supabase.from("body_clients").select("session_id").eq("anonymous_owner_id", ownerId)).data?.map(s => s.session_id) || ["__none__"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestIntake) {
      context.profile = {
        goal: latestIntake.answers?.goal || null,
        bmi: latestIntake.bmi || null,
        care_recommendation: latestIntake.care_recommendation || null,
      };
    }
  } catch {}

  // Onboarding preferences
  try {
    const { data: onboarding } = await supabase
      .from("body_onboarding")
      .select("activity_tracker_used, support_style, priority_metrics")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (onboarding) {
      context.onboarding_preferences = {
        tracker_enabled: onboarding.activity_tracker_used || false,
        support_style: onboarding.support_style || "gentle",
        priority_metrics: onboarding.priority_metrics || [],
      };
    }
  } catch {}

  // Recent daily logs (max 7)
  try {
    const ownerSessionIds = (await supabase.from("body_clients").select("session_id").eq("anonymous_owner_id", ownerId)).data?.map(s => s.session_id) || [];
    if (ownerSessionIds.length > 0) {
      const { data: logs } = await supabase
        .from("body_daily_logs")
        .select("log_date, weight_kg, steps, workout_done, workout_minutes, meals_count, sleep_hours, sleep_quality, energy_level, mood_level, ai_positive_observation, ai_pattern_observation")
        .in("session_id", ownerSessionIds)
        .order("log_date", { ascending: false })
        .limit(7);
      context.recent_daily_logs = logs || [];
    }
  } catch {}

  // Plate aggregates (30 days)
  try {
    const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: plates } = await supabase
      .from("body_plate_history")
      .select("protein_assessment, vegetables_assessment, carbohydrate_assessment, what_is_missing")
      .eq("owner_id", ownerId)
      .gte("log_date", sinceDate);
    const p = plates || [];
    const missingCounts = {};
    for (const entry of p) {
      if (Array.isArray(entry.what_is_missing)) {
        for (const item of entry.what_is_missing) {
          missingCounts[item] = (missingCounts[item] || 0) + 1;
        }
      }
    }
    context.plate_aggregates_30d = {
      total_photos: p.length,
      protein_present: p.filter(e => e.protein_assessment === "enough").length,
      vegetables_present: p.filter(e => e.vegetables_assessment === "enough").length,
      frequent_missing: Object.entries(missingCounts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([item]) => item),
    };
  } catch {}

  // Active insights (max 3)
  try {
    const { data: insights } = await supabase
      .from("body_insights")
      .select("title, insight_text, priority")
      .eq("owner_id", ownerId)
      .eq("status", "active")
      .order("priority", { ascending: true })
      .limit(3);
    context.active_insights = (insights || []).map(i => ({ title: i.title, text: i.insight_text }));
  } catch {}

  // Weekly summary (latest cached)
  try {
    const { data: weekly } = await supabase
      .from("body_weekly_summaries")
      .select("period_start, period_end, user_summary, summary_json")
      .eq("owner_id", ownerId)
      .eq("summary_type", "weekly")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (weekly) {
      context.weekly_summary = {
        period: `${weekly.period_start} — ${weekly.period_end}`,
        summary: weekly.user_summary,
        positive_changes: weekly.summary_json?.positive_changes || [],
        patterns: weekly.summary_json?.patterns || [],
      };
    }
  } catch {}

  // Recent chat messages (max 5)
  try {
    const { data: recentChat } = await supabase
      .from("body_ai_chat")
      .select("role, message_text")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(5);
    context.recent_chat_messages = (recentChat || []).reverse();
  } catch {}

  return context;
}
