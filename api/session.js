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

// Resolve support owner from session_id + access_token.
// Returns { ownerId, sessionId, publicCode } or null.
async function resolveSupportOwner(sessionId, accessToken) {
  if (!sessionId || !accessToken) return null;
  const valid = await validateSessionAccess(sessionId, accessToken);
  if (!valid) return null;
  const supabase = getSupabase();
  const { data: session, error } = await supabase
    .from("sessions")
    .select("session_id, public_code, anonymous_owner_id, module")
    .eq("session_id", sessionId)
    .eq("module", "support")
    .maybeSingle();
  if (error || !session || !session.anonymous_owner_id) return null;
  return { ownerId: session.anonymous_owner_id, sessionId: session.session_id, publicCode: session.public_code };
}

// Resolve specialist relation for a support owner.
// Returns { expertId, expertName, expertRole, expertSpecialty, organizationId, organizationName } or null.
async function resolveSupportSpecialistRelation(ownerId) {
  const supabase = getSupabase();

  // Find public_code for this owner's sessions
  const { data: ownerSessions } = await supabase
    .from("sessions")
    .select("public_code, primary_expert_id, organization_id")
    .eq("anonymous_owner_id", ownerId)
    .eq("module", "support")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!ownerSessions || ownerSessions.length === 0) return null;

  const latest = ownerSessions[0];
  let expertId = latest.primary_expert_id;
  let orgId = latest.organization_id;

  // If session doesn't have expert, check patient_assignments
  if (!expertId && latest.public_code) {
    const { data: assignment } = await supabase
      .from("patient_assignments")
      .select("primary_expert_id, organization_id")
      .eq("public_code", latest.public_code)
      .eq("module", "support")
      .eq("status", "active")
      .maybeSingle();
    if (assignment) {
      expertId = assignment.primary_expert_id;
      orgId = orgId || assignment.organization_id;
    }
  }

  if (!expertId) return null;

  // Get expert details
  const { data: expert } = await supabase
    .from("experts")
    .select("id, name, role, specialty")
    .eq("id", expertId)
    .maybeSingle();

  if (!expert) return null;

  let orgName = null;
  if (orgId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle();
    orgName = org?.name || null;
  }

  return {
    expertId: expert.id,
    expertName: expert.name,
    expertRole: expert.role,
    expertSpecialty: expert.specialty,
    organizationId: orgId,
    organizationName: orgName,
  };
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
      case "updateBodyDisplayName":
        return await handleUpdateBodyDisplayName(req, res);
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
      case "getBodyHealthContext":
        return await handleGetBodyHealthContext(req, res);
      case "saveBodyHealthContext":
        return await handleSaveBodyHealthContext(req, res);
      case "createBodyServiceRequest":
        return await handleCreateBodyServiceRequest(req, res);
      case "getBodyServiceRequests":
        return await handleGetBodyServiceRequests(req, res);
      case "getBodyServiceRequest":
        return await handleGetBodyServiceRequest(req, res);
      case "cancelBodyServiceRequest":
        return await handleCancelBodyServiceRequest(req, res);
      case "createSupportServiceRequest":
        return await handleCreateSupportServiceRequest(req, res);
      case "listSupportServiceRequests":
        return await handleListSupportServiceRequests(req, res);
      case "getSupportServiceRequest":
        return await handleGetSupportServiceRequest(req, res);
      case "cancelSupportServiceRequest":
        return await handleCancelSupportServiceRequest(req, res);
      case "getSupportCheckins":
        return await handleGetSupportCheckins(req, res);
      case "saveSupportCheckin":
        return await handleSaveSupportCheckin(req, res);
      case "getSupportPractices":
        return await handleGetSupportPractices(req, res);
      case "saveSupportPractice":
        return await handleSaveSupportPractice(req, res);
      case "updateSupportPracticeStatus":
        return await handleUpdateSupportPracticeStatus(req, res);
      case "getSupportProfile":
        return await handleGetSupportProfile(req, res);
      case "saveSupportProfile":
        return await handleSaveSupportProfile(req, res);
      case "getSupportChat":
        return await handleGetSupportChat(req, res);
      case "sendSupportMessage":
        return await handleSendSupportMessage(req, res);
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
        .eq("module", "support")
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
            .eq("module", "support")
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
              module: "support",
            });

            await supabase.from("patient_access").insert({
              public_code: publicCode,
              organization_id: organizationId,
              expert_id: primaryExpertId,
              access_role: "owner",
              granted_by_expert_id: primaryExpertId,
              granted_by_expert_name: "auto",
              module: "support",
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

    // Latest session context needed for follow-up (client-safe: no doctor_report)
    const latest = sessions?.[0];
    const latestJson = latest?.json_data || {};
    const latestReport = latest ? {
      user_report: latest.user_report || "",
      previousPatientReport: latestJson.previousPatientReport || "",
      homeTasks: latestJson.homeTasks || "",
      resourceFactors: latestJson.resourceFactors || "",
      supportPlan: latest.support_plan || null,
      careRecommendation: latest.care_recommendation || null,
      dialogDepth: latestJson.dialogDepth ?? 0,
      conversationHistory: latest.conversation_history || [],
      createdAt: latest.created_at,
    } : null;

    // Wallet balance (critical — but degrade gracefully)
    let balance = null;
    try {
      const { getWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
      const wallet = await getWallet({ ownerType: "anonymous_case", ownerId, module: "support" });
      if (wallet) {
        balance = await getUsageBalanceForClient({ walletId: wallet.id });
      }
    } catch (walletError) {
      console.error("[getCabinet] wallet error (non-blocking):", walletError.message);
    }

    // Specialist relation (optional)
    let specialist = null;
    try {
      specialist = await resolveSupportSpecialistRelation(ownerId);
    } catch (specError) {
      console.error("[getCabinet] specialist error (non-blocking):", specError.message);
    }

    // Service requests (optional)
    let serviceRequests = [];
    try {
      const { data: sr } = await supabase
        .from("service_requests")
        .select("id, request_type, meeting_format, title, message, status, specialist_name, scheduled_at, created_at")
        .eq("module", "support")
        .eq("owner_type", "anonymous_case")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(20);
      serviceRequests = sr || [];
    } catch (srError) {
      console.error("[getCabinet] service_requests error (non-blocking):", srError.message);
    }

    // Owner display_name (optional)
    let ownerDisplayName = null;
    try {
      const { data: ownerProfile } = await supabase
        .from("support_owner_profiles")
        .select("display_name")
        .eq("owner_type", "anonymous_case")
        .eq("owner_id", ownerId)
        .maybeSingle();
      ownerDisplayName = ownerProfile?.display_name || null;
    } catch (profileError) {
      console.error("[getCabinet] profile error (non-blocking):", profileError.message);
    }

    return res.status(200).json({
      ok: true,
      public_code: currentSession.public_code,
      session_id: currentSession.session_id,
      sessions: sessionList,
      latest_report: latestReport,
      wallet: balance,
      specialist: specialist ? {
        expertId: specialist.expertId,
        expertName: specialist.expertName,
        expertRole: specialist.expertRole,
        expertSpecialty: specialist.expertSpecialty,
        organizationName: specialist.organizationName,
      } : null,
      service_requests: serviceRequests,
      unread_message_count: 0,
      display_name: ownerDisplayName,
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
    // Client-safe response: no doctor_report, no expert fields
    const session = {
      sessionId: data.session_id,
      module: data.module || "support",
      publicCode: data.public_code,
      patient_input: data.patient_text,
      conversationHistory: data.conversation_history,
      conversationPairs: Array.isArray(pairs) ? pairs : [],
      user_report: data.user_report,
      supportPlan: data.support_plan,
      careRecommendation: data.care_recommendation || null,
      riskLevel: data.risk_level,
      dialogDepth: jsonData.dialogDepth ?? 0,
      previousPatientReport: jsonData.previousPatientReport || "",
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

    console.log("[exchange] start module=" + reqModule + " lookup_prefix=" + parsed.lookupCode.slice(0, 8));

    // Step 1: Find target session
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
      console.error("[exchange] target query error:", targetError.code, targetError.message);
      return res.status(500).json({ ok: false, error: "Не удалось открыть профиль. Попробуйте позже." });
    }
    if (!targetSession?.session_id) {
      console.log("[exchange] no target session for owner");
      return res.status(404).json({ ok: false, error: "Не удалось найти запись для этого кода. Обратитесь к специалисту." });
    }

    console.log("[exchange] target session found");

    // Step 2: Build cabinet
    let cabinet;
    try {
      cabinet = await buildCabinetData({ module: reqModule, ownerId: credential.owner_id, supabase });
      console.log("[exchange] cabinet built sessions=" + (cabinet.sessions?.length || 0));
    } catch (cabinetError) {
      console.error("[exchange] cabinet build error:", cabinetError.message);
      throw cabinetError;
    }

    // Step 3: Get balance
    let usageBalance;
    try {
      usageBalance = await getUsageBalanceForOwner({ module: reqModule, ownerId: credential.owner_id });
      console.log("[exchange] balance ok=" + usageBalance.ok);
    } catch (balanceError) {
      console.error("[exchange] balance error:", balanceError.message);
      throw balanceError;
    }

    // Step 4: Generate access token
    const newAccessToken = await generateSessionAccessToken(targetSession.session_id, {
      module: reqModule,
      anonymousOwnerId: credential.owner_id,
      publicCode: cabinet.sessions?.[0]?.publicCode || null,
    });
    if (!newAccessToken) {
      console.error("[exchange] token generation returned null, retrying with direct insert");
      // Fallback: ensure sessions row exists directly
      const crypto = await import("crypto");
      const fallbackToken = crypto.randomBytes(32).toString("hex");
      const fallbackHash = crypto.createHash("sha256").update(fallbackToken).digest("hex");
      const { error: fallbackErr } = await supabase.from("sessions").upsert({
        session_id: targetSession.session_id,
        module: reqModule,
        anonymous_owner_id: credential.owner_id,
        public_code: cabinet.sessions?.[0]?.publicCode || null,
        patient_text: "",
        conversation_history: [],
        json_data: {},
        access_token_hash: fallbackHash,
        access_token_generated_at: new Date().toISOString(),
        legacy_access: false,
      }, { onConflict: "session_id" });
      if (fallbackErr) {
        console.error("[exchange] fallback insert failed:", fallbackErr.message);
        return res.status(500).json({ ok: false, error: "Не удалось создать код доступа. Попробуйте позже." });
      }
      // Verify the row was created
      const { data: verifyRow } = await supabase
        .from("sessions")
        .select("session_id")
        .eq("session_id", targetSession.session_id)
        .maybeSingle();
      if (!verifyRow) {
        console.error("[exchange] verification failed after fallback insert");
        return res.status(500).json({ ok: false, error: "Не удалось создать код доступа. Попробуйте позже." });
      }
      console.log("[exchange] fallback token created successfully");
      return res.status(200).json({
        ok: true,
        session_id: targetSession.session_id,
        access_token: fallbackToken,
        module: reqModule,
        public_code: cabinet.sessions?.[0]?.publicCode || null,
        cabinet,
        usage_balance: usageBalance,
      });
    }

    // Verify sessions row exists after token generation
    const { data: verifySession } = await supabase
      .from("sessions")
      .select("session_id, access_token_hash")
      .eq("session_id", targetSession.session_id)
      .maybeSingle();
    if (!verifySession || !verifySession.access_token_hash) {
      console.error("[exchange] sessions row verification failed after token generation");
      return res.status(500).json({ ok: false, error: "Не удалось подтвердить сессию. Попробуйте позже." });
    }

    console.log("[exchange] success");

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
      display_name: client.display_name || null,
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
        calorie_intake_source: l.calorie_intake_source,
        activity_calories: l.activity_calories,
        activity_calories_source: l.activity_calories_source,
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

async function handleUpdateBodyDisplayName(req, res) {
  try {
    const { session_id, access_token, display_name } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }
    const name = typeof display_name === "string" ? display_name.trim() : "";
    if (name.length > 100) {
      return res.status(400).json({ ok: false, error: "Имя слишком длинное." });
    }
    const supabase = getSupabase();
    const { error } = await supabase
      .from("body_clients")
      .update({ display_name: name || null })
      .eq("anonymous_owner_id", owner.ownerId);
    if (error) {
      console.error("[updateBodyDisplayName] error:", error.message);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить имя." });
    }
    return res.status(200).json({ ok: true, display_name: name || null });
  } catch (error) {
    console.error("handleUpdateBodyDisplayName error", error);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения имени." });
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

    // Calculate weight change from previous day
    let weightChange = null;
    if (dayLog.weight_kg != null) {
      const { data: prevLog } = await supabase
        .from("body_daily_logs")
        .select("weight_kg")
        .in("session_id", ownerSessionIds)
        .lt("log_date", log_date)
        .not("weight_kg", "is", null)
        .order("log_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prevLog?.weight_kg != null) {
        weightChange = Math.round((dayLog.weight_kg - prevLog.weight_kg) * 10) / 10;
      }
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
        workout_entries: dayLog.workout_entries || null,
        calories: dayLog.calories,
        activity_calories: dayLog.activity_calories,
        activity_calories_source: dayLog.activity_calories_source,
        calorie_intake_source: dayLog.calorie_intake_source,
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
        weight_change: weightChange,
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

    // Detect stale: compare source_snapshot with current logs
    let isStale = false;
    if (summary?.source_snapshot) {
      const ownerSessionIds = (await supabase
        .from("body_clients").select("session_id").eq("anonymous_owner_id", owner.ownerId)
      ).data?.map(s => s.session_id) || [];

      if (ownerSessionIds.length > 0) {
        const { count: currentLogsCount } = await supabase
          .from("body_daily_logs")
          .select("*", { count: "exact", head: true })
          .in("session_id", ownerSessionIds)
          .gte("log_date", period_start)
          .lte("log_date", period_end);

        if ((currentLogsCount || 0) > (summary.source_snapshot.logs_count || 0)) {
          isStale = true;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      summary: summary || null,
      cached: !!summary,
      stale: isStale,
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
    const sourceSnapshot = {
      logs_count: dailyLogs.length,
      latest_log_updated_at: dailyLogs.length > 0 ? dailyLogs[dailyLogs.length - 1].log_date : null,
      generated_at: new Date().toISOString(),
    };
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
        source_snapshot: sourceSnapshot,
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

    // === DETERMINISTIC INTENT ROUTING (before AI) ===
    const config = getModuleConfig("body");
    const intentContext = {};
    try {
      const { getWallet, getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
      const wallet = await getWallet({ ownerType: "anonymous_profile", ownerId: owner.ownerId, module: "body" });
      if (wallet) {
        const balance = await getUsageBalanceForClient({ walletId: wallet.id });
        intentContext.wallet_balance = balance?.balance ?? null;
      }
      // Body-specific context
      const { count: plateCount } = await supabase
        .from("body_plate_photos")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", owner.ownerId);
      intentContext.plate_count = plateCount || 0;
    } catch (ctxError) {
      // Non-blocking — continue without context
    }

    const intentResult = detectIntent(trimmed, config, intentContext);
    if (intentResult) {
      // Save deterministic response
      await supabase.from("body_ai_chat").insert({
        owner_type: "anonymous_profile",
        owner_id: owner.ownerId,
        session_id,
        role: "assistant",
        message_text: intentResult.answer,
        ai_response: intentResult,
        model_used: "deterministic",
        created_at: new Date().toISOString(),
      });
      return res.status(200).json({
        ok: true,
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          answer: intentResult.answer,
          small_next_step: null,
          question_for_specialist: null,
          safety_note: intentResult.safety_note || null,
          confidence: intentResult.confidence || "high",
          created_at: new Date().toISOString(),
        },
      });
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

// ============================================================
// Body Health Context
// ============================================================

async function handleGetBodyHealthContext(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("body_health_contexts")
      .select("*")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .eq("module", "body")
      .maybeSingle();

    if (error) {
      console.error("[getBodyHealthContext] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить контекст здоровья." });
    }

    return res.status(200).json({
      ok: true,
      context: data || {
        health_conditions: [],
        medications: [],
        supplements: [],
        lab_notes: {},
        documents_note: null,
        doctor_observation: null,
        safety_flags: [],
        consent_acknowledged: false,
      },
    });
  } catch (error) {
    console.error("handleGetBodyHealthContext error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки контекста здоровья." });
  }
}

async function handleSaveBodyHealthContext(req, res) {
  try {
    const { session_id, access_token, health_context } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!health_context || typeof health_context !== "object") {
      return res.status(400).json({ ok: false, error: "Missing health_context." });
    }

    // Validate sizes
    if (Array.isArray(health_context.health_conditions) && health_context.health_conditions.length > 30) {
      return res.status(400).json({ ok: false, error: "Слишком много состояний (максимум 30)." });
    }
    if (Array.isArray(health_context.medications) && health_context.medications.length > 30) {
      return res.status(400).json({ ok: false, error: "Слишком много препаратов (максимум 30)." });
    }
    if (Array.isArray(health_context.supplements) && health_context.supplements.length > 30) {
      return res.status(400).json({ ok: false, error: "Слишком много БАДов (максимум 30)." });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    const ALLOWED = [
      "health_conditions", "medications", "supplements",
      "lab_notes", "documents_note", "doctor_observation",
      "safety_flags", "consent_acknowledged",
    ];

    const payload = { owner_type: "anonymous_profile", owner_id: owner.ownerId, module: "body", updated_at: now };
    for (const key of ALLOWED) {
      if (health_context[key] !== undefined) {
        payload[key] = health_context[key];
      }
    }

    const { data: existing } = await supabase
      .from("body_health_contexts")
      .select("id")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .eq("module", "body")
      .maybeSingle();

    let result;
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from("body_health_contexts")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateError) {
        console.error("[saveBodyHealthContext] update error:", updateError.code);
        return res.status(500).json({ ok: false, error: "Не удалось сохранить контекст здоровья." });
      }
      result = updated;
    } else {
      payload.created_at = now;
      const { data: inserted, error: insertError } = await supabase
        .from("body_health_contexts")
        .insert(payload)
        .select("*")
        .single();
      if (insertError) {
        console.error("[saveBodyHealthContext] insert error:", insertError.code);
        return res.status(500).json({ ok: false, error: "Не удалось сохранить контекст здоровья." });
      }
      result = inserted;
    }

    return res.status(200).json({ ok: true, context: result });
  } catch (error) {
    console.error("handleSaveBodyHealthContext error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения контекста здоровья." });
  }
}

// ============================================================
// Service Requests
// ============================================================

const REQUEST_TYPE_CONFIG = {
  text_question: { label: "Онлайн-вопрос", meeting_format: "text", sla_hours: 24, reserved_credits: 300 },
  phone_call: { label: "Телефонный звонок", meeting_format: "phone", sla_hours: 24, reserved_credits: 700 },
  video_call: { label: "Видеоконсультация", meeting_format: "video", sla_hours: 48, reserved_credits: 1500 },
  offline_visit: { label: "Очная консультация", meeting_format: "offline", sla_hours: 48, reserved_credits: 0, pricing_note: "Стоимость и время уточнит специалист" },
  diary_review: { label: "Разбор дневника", meeting_format: "text", sla_hours: 24, reserved_credits: 500 },
  labs_medications_review: { label: "Разбор анализов и препаратов", meeting_format: "text", sla_hours: 24, reserved_credits: 700 },
  other: { label: "Другой запрос", meeting_format: "text", sla_hours: 24, reserved_credits: 300 },
};

async function handleCreateBodyServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_type, message, context_options, client_contact } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!message || typeof message !== "string" || message.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите сообщение." });
    }
    if (message.length > 3000) {
      return res.status(400).json({ ok: false, error: "Слишком длинное сообщение (максимум 3000 символов)." });
    }

    const config = REQUEST_TYPE_CONFIG[request_type];
    if (!config) {
      return res.status(400).json({ ok: false, error: "Неверный тип запроса." });
    }

    const supabase = getSupabase();

    // Resolve specialist from patient_assignments (canonical expert.id)
    let specialistId = null;
    let specialistName = null;

    const { data: assignment } = await supabase
      .from("patient_assignments")
      .select("primary_expert_id")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .eq("module", "body")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!assignment?.primary_expert_id) {
      return res.status(400).json({ ok: false, error: "Нет активного назначения специалиста. Обратитесь к администратору." });
    }

    specialistId = String(assignment.primary_expert_id);
    const { data: expert } = await supabase
      .from("experts")
      .select("id, name")
      .eq("id", assignment.primary_expert_id)
      .maybeSingle();
    specialistName = expert?.name || "Специалист";

    // Build safe context snapshot
    const contextSnapshot = {
      include_recent_diary: !!context_options?.include_recent_diary,
      include_plate_history: !!context_options?.include_plate_history,
      include_weekly_summary: !!context_options?.include_weekly_summary,
      include_health_context: !!context_options?.include_health_context,
    };

    // Enrich with counts
    const ownerSessionIds = (await supabase
      .from("body_clients").select("session_id").eq("anonymous_owner_id", owner.ownerId)
    ).data?.map(s => s.session_id) || [];

    if (contextSnapshot.include_recent_diary && ownerSessionIds.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { count } = await supabase
        .from("body_daily_logs").select("*", { count: "exact", head: true })
        .in("session_id", ownerSessionIds).gte("log_date", sevenDaysAgo);
      contextSnapshot.diary_days_count = count || 0;
    }

    if (contextSnapshot.include_health_context) {
      const { data: hc } = await supabase
        .from("body_health_contexts")
        .select("health_conditions, medications, supplements, lab_notes")
        .eq("owner_id", owner.ownerId).eq("module", "body").maybeSingle();
      if (hc) {
        contextSnapshot.health_context_summary = {
          conditions_count: (hc.health_conditions || []).length,
          medications_count: (hc.medications || []).length,
          supplements_count: (hc.supplements || []).length,
          has_recent_labs: !!hc.lab_notes?.has_recent_labs,
        };
      }
    }

    const now = new Date().toISOString();
    const dueAt = config.sla_hours
      ? new Date(Date.now() + config.sla_hours * 60 * 60 * 1000).toISOString()
      : null;

    const { data: inserted, error: insertError } = await supabase
      .from("service_requests")
      .insert({
        module: "body",
        owner_type: "anonymous_profile",
        owner_id: owner.ownerId,
        session_id,
        specialist_id: specialistId,
        specialist_name: specialistName,
        request_type,
        meeting_format: config.meeting_format,
        title: config.label,
        message: message.trim(),
        status: "submitted",
        priority: "normal",
        sla_hours: config.sla_hours,
        due_at: dueAt,
        reserved_credits: config.reserved_credits,
        pricing_note: config.pricing_note || null,
        context_snapshot: contextSnapshot,
        client_contact: client_contact || {},
        created_at: now,
        updated_at: now,
      })
      .select("id, request_type, status, reserved_credits, due_at, created_at")
      .single();

    if (insertError) {
      console.error("[createBodyServiceRequest] insert error:", insertError.code);
      return res.status(500).json({ ok: false, error: "Не удалось отправить запрос." });
    }

    return res.status(200).json({ ok: true, request: inserted });
  } catch (error) {
    console.error("handleCreateBodyServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отправки запроса." });
  }
}

async function handleGetBodyServiceRequests(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data: requests, error } = await supabase
      .from("service_requests")
      .select("id, request_type, meeting_format, title, message, status, priority, sla_hours, due_at, reserved_credits, pricing_note, specialist_name, specialist_response, client_contact, scheduled_at, scheduled_comment, created_at, answered_at, completed_at, cancelled_at")
      .eq("owner_type", "anonymous_profile")
      .eq("owner_id", owner.ownerId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[getBodyServiceRequests] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить запросы." });
    }

    return res.status(200).json({ ok: true, requests: requests || [] });
  } catch (error) {
    console.error("handleGetBodyServiceRequests error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки запросов." });
  }
}

async function handleGetBodyServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_id } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id." });
    }

    const supabase = getSupabase();
    const { data: request, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", request_id)
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    if (error) {
      console.error("[getBodyServiceRequest] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить запрос." });
    }
    if (!request) {
      return res.status(404).json({ ok: false, error: "Запрос не найден." });
    }

    return res.status(200).json({ ok: true, request });
  } catch (error) {
    console.error("handleGetBodyServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки запроса." });
  }
}

async function handleCancelBodyServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_id } = req.body || {};
    const owner = await resolveBodyOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id." });
    }

    const supabase = getSupabase();
    const { data: request, error: findError } = await supabase
      .from("service_requests")
      .select("id, status")
      .eq("id", request_id)
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    if (findError || !request) {
      return res.status(404).json({ ok: false, error: "Запрос не найден." });
    }

    const cancellable = ["submitted", "accepted", "needs_clarification", "scheduled"];
    if (!cancellable.includes(request.status)) {
      return res.status(400).json({ ok: false, error: "Невозможно отменить запрос в текущем статусе." });
    }

    const { error: updateError } = await supabase
      .from("service_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", request_id);

    if (updateError) {
      console.error("[cancelBodyServiceRequest] update error:", updateError.code);
      return res.status(500).json({ ok: false, error: "Не удалось отменить запрос." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("handleCancelBodyServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отмены запроса." });
  }
}

// ============================================================
// Support Service Requests
// ============================================================

const SUPPORT_REQUEST_TYPE_CONFIG = {
  question: { label: "Онлайн-вопрос", meeting_format: "text", sla_hours: 24 },
  phone: { label: "Телефонный звонок", meeting_format: "phone", sla_hours: 24 },
  video: { label: "Видеоконсультация", meeting_format: "video", sla_hours: 48 },
  offline: { label: "Очная встреча", meeting_format: "offline", sla_hours: 48 },
};

const SUPPORT_REASON_LABELS = {
  discuss_report: "Обсуждение отчёта",
  follow_up: "Продолжение наблюдения",
  new_concern: "Новая проблема",
  other: "Другое",
};

async function handleCreateSupportServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_type, reason, message, preferred_date, time_from, time_to, comment } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!message || typeof message !== "string" || message.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите сообщение." });
    }
    if (message.length > 3000) {
      return res.status(400).json({ ok: false, error: "Слишком длинное сообщение (максимум 3000 символов)." });
    }

    const config = SUPPORT_REQUEST_TYPE_CONFIG[request_type];
    if (!config) {
      return res.status(400).json({ ok: false, error: "Неверный тип запроса." });
    }

    const supabase = getSupabase();

    // Resolve specialist from relation
    const specialist = await resolveSupportSpecialistRelation(owner.ownerId);

    const reasonLabel = SUPPORT_REASON_LABELS[reason] || reason || "";
    const title = `${config.label}${reasonLabel ? " — " + reasonLabel : ""}`;

    const now = new Date().toISOString();
    const dueAt = config.sla_hours
      ? new Date(Date.now() + config.sla_hours * 60 * 60 * 1000).toISOString()
      : null;

    const { data: inserted, error: insertError } = await supabase
      .from("service_requests")
      .insert({
        module: "support",
        owner_type: "anonymous_case",
        owner_id: owner.ownerId,
        session_id: owner.sessionId,
        specialist_id: specialist?.expertId || null,
        specialist_name: specialist?.expertName || null,
        request_type,
        meeting_format: config.meeting_format,
        title,
        message: message.trim(),
        status: "submitted",
        priority: "normal",
        sla_hours: config.sla_hours,
        due_at: dueAt,
        reserved_credits: 0,
        context_snapshot: {
          reason: reason || null,
          preferred_date: preferred_date || null,
          time_from: time_from || null,
          time_to: time_to || null,
          comment: comment || null,
          session_summary: owner.publicCode,
        },
        created_at: now,
        updated_at: now,
      })
      .select("id, request_type, meeting_format, title, status, specialist_name, due_at, created_at")
      .single();

    if (insertError) {
      console.error("[createSupportServiceRequest] insert error:", insertError.code);
      return res.status(500).json({ ok: false, error: "Не удалось отправить запрос." });
    }

    return res.status(200).json({ ok: true, request: inserted });
  } catch (error) {
    console.error("handleCreateSupportServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отправки запроса." });
  }
}

async function handleListSupportServiceRequests(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data: requests, error } = await supabase
      .from("service_requests")
      .select("id, request_type, meeting_format, title, message, status, priority, sla_hours, due_at, specialist_name, specialist_response, scheduled_at, scheduled_comment, created_at, answered_at, completed_at, cancelled_at")
      .eq("module", "support")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[listSupportServiceRequests] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить запросы." });
    }

    return res.status(200).json({ ok: true, requests: requests || [] });
  } catch (error) {
    console.error("handleListSupportServiceRequests error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки запросов." });
  }
}

async function handleGetSupportServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_id } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id." });
    }

    const supabase = getSupabase();
    const { data: request, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", request_id)
      .eq("module", "support")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    if (error) {
      console.error("[getSupportServiceRequest] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить запрос." });
    }
    if (!request) {
      return res.status(404).json({ ok: false, error: "Запрос не найден." });
    }

    return res.status(200).json({ ok: true, request });
  } catch (error) {
    console.error("handleGetSupportServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки запроса." });
  }
}

async function handleCancelSupportServiceRequest(req, res) {
  try {
    const { session_id, access_token, request_id } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id." });
    }

    const supabase = getSupabase();
    const { data: request, error: findError } = await supabase
      .from("service_requests")
      .select("id, status, owner_id")
      .eq("id", request_id)
      .eq("module", "support")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    if (findError || !request) {
      return res.status(404).json({ ok: false, error: "Запрос не найден." });
    }

    const cancellable = ["submitted", "accepted", "needs_clarification", "scheduled"];
    if (!cancellable.includes(request.status)) {
      return res.status(400).json({ ok: false, error: "Невозможно отменить запрос в текущем статусе." });
    }

    const { error: updateError } = await supabase
      .from("service_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", request_id)
      .eq("owner_id", owner.ownerId);

    if (updateError) {
      console.error("[cancelSupportServiceRequest] update error:", updateError.code);
      return res.status(500).json({ ok: false, error: "Не удалось отменить запрос." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("handleCancelSupportServiceRequest error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отмены запроса." });
  }
}

// ============================================================
// Support Daily Check-ins
// ============================================================

async function handleGetSupportCheckins(req, res) {
  try {
    const { session_id, access_token, days } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const lookbackDays = Math.min(Math.max(parseInt(days) || 90, 1), 365);
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const supabase = getSupabase();
    const { data: checkins, error } = await supabase
      .from("support_daily_checkins")
      .select("id, checkin_date, wellbeing_score, anxiety_score, comment, created_at")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .gte("checkin_date", since)
      .order("checkin_date", { ascending: true });

    if (error) {
      console.error("[getSupportCheckins] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить данные." });
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayCheckin = (checkins || []).find(c => c.checkin_date === today) || null;

    return res.status(200).json({
      ok: true,
      today: todayCheckin,
      history: checkins || [],
    });
  } catch (error) {
    console.error("handleGetSupportCheckins error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки данных." });
  }
}

async function handleSaveSupportCheckin(req, res) {
  try {
    const { session_id, access_token, wellbeing_score, anxiety_score, comment } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (wellbeing_score === undefined || wellbeing_score === null || !Number.isInteger(wellbeing_score) || wellbeing_score < -5 || wellbeing_score > 5) {
      return res.status(400).json({ ok: false, error: "Оценка состояния должна быть от -5 до +5." });
    }
    if (anxiety_score !== undefined && anxiety_score !== null && (!Number.isInteger(anxiety_score) || anxiety_score < 0 || anxiety_score > 10)) {
      return res.status(400).json({ ok: false, error: "Оценка напряжения должна быть от 0 до 10." });
    }
    if (comment && typeof comment === "string" && comment.length > 1000) {
      return res.status(400).json({ ok: false, error: "Комментарий слишком длинный (максимум 1000 символов)." });
    }

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const supabase = getSupabase();

    const row = {
      owner_type: "anonymous_case",
      owner_id: owner.ownerId,
      checkin_date: today,
      wellbeing_score,
      anxiety_score: anxiety_score ?? null,
      comment: comment?.trim() || null,
      source: "client_cabinet",
      updated_at: now,
    };

    const { data: saved, error } = await supabase
      .from("support_daily_checkins")
      .upsert(row, { onConflict: "owner_type,owner_id,checkin_date" })
      .select("id, checkin_date, wellbeing_score, anxiety_score, comment")
      .single();

    if (error) {
      console.error("[saveSupportCheckin] upsert error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить." });
    }

    return res.status(200).json({ ok: true, checkin: saved });
  } catch (error) {
    console.error("handleSaveSupportCheckin error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения." });
  }
}

// ============================================================
// Support Owner Practices
// ============================================================

// Known practice definitions (mirror of PRACTICES constant in App.jsx)
const PRACTICE_DEFS = {
  breathing: {
    title: "Дыхание 4–6 минут при тревоге",
    description: "Медленное дыхание с более длинным выдохом, чтобы немного снизить телесное напряжение.",
    instructions: [{ step: 1, text: "Сядьте удобно или лягте." }, { step: 2, text: "Медленно вдохните на 4 счёта." }, { step: 3, text: "Выдохните на 6–8 счётов." }, { step: 4, text: "Повторяйте 5–10 минут." }],
    duration_minutes: 5,
    when_to_use: "При тревоге, панике, напряжении перед сном.",
    safety_note: null,
    category: "breathing",
  },
  grounding: {
    title: "Заземление 5–4–3–2–1",
    description: "Техника заземления через органы чувств для возвращения в настоящий момент.",
    instructions: [{ step: 1, text: "Назовите 5 вещей, которые видите." }, { step: 2, text: "4 вещи, которые можете потрогать." }, { step: 3, text: "3 звука, которые слышите." }, { step: 4, text: "2 запаха." }, { step: 5, text: "1 вкус." }],
    duration_minutes: 5,
    when_to_use: "При диссоциации, навязчивых мыслях, панике.",
    safety_note: null,
    category: "grounding",
  },
  jaw_relaxation: {
    title: "Мягкое расслабление лица и челюсти",
    description: "Снятие напряжения с лица, челюсти и шеи.",
    instructions: [{ step: 1, text: "Мягко приоткройте рот." }, { step: 2, text: "Массируйте челюсть круговыми движениями." }, { step: 3, text: "Потяните шею в стороны." }, { step: 4, text: "Покатайте плечами." }],
    duration_minutes: 5,
    when_to_use: "При сжатии челюсти, головной боли напряжения.",
    safety_note: null,
    category: "grounding",
  },
  sleep_prep: {
    title: "Практика перед сном",
    description: "Мягкая подготовка ко сну при тревоге или бессоннице.",
    instructions: [{ step: 1, text: "За 1 час до сна уберите экраны." }, { step: 2, text: "Сделайте дыхание 4–6." }, { step: 3, text: "Запишите 3 вещи за день." }, { step: 4, text: "Лягте в тёмной прохладной комнате." }],
    duration_minutes: 15,
    when_to_use: "При бессоннице, тревоге перед сном.",
    safety_note: null,
    category: "sleep",
  },
  neck_shoulders_stretch: {
    title: "Мягкая растяжка шеи и плеч",
    description: "Снятие мышечного напряжения в верхней части тела.",
    instructions: [{ step: 1, text: "Наклоните голову вправо, задержите 15 сек." }, { step: 2, text: "Повторите влево." }, { step: 3, text: "Круговые движения плечами." }, { step: 4, text: "Сцепите руки за спиной и потяните." }],
    duration_minutes: 5,
    when_to_use: "При мышечном напряжении, сидячей работе.",
    safety_note: null,
    category: "activity",
  },
  diary: {
    title: "Дневник состояния на 3 дня",
    description: "Краткие ежедневные записи для отслеживания изменений.",
    instructions: [{ step: 1, text: "Утром: как спали, общее состояние." }, { step: 2, text: "Вечером: что помогло, что было трудно." }, { step: 3, text: "Замечайте паттерны без оценки." }],
    duration_minutes: 5,
    when_to_use: "Для понимания динамики, подготовки к консультации.",
    safety_note: null,
    category: "journaling",
  },
  "24h_plan": {
    title: "План 24 часа без ухудшения",
    description: "Пошаговый план на ближайшие сутки.",
    instructions: [{ step: 1, text: "Определите один главный приоритет на день." }, { step: 2, text: "Запланируйте один приятный маленький шаг." }, { step: 3, text: "Определите время для отдыха." }, { step: 4, text: "Отметьте вечером что получилось." }],
    duration_minutes: null,
    when_to_use: "При чувстве перегруженности, неясности с чего начать.",
    safety_note: null,
    category: "routine",
  },
  short_walk: {
    title: "Короткая прогулка",
    description: "Прогулка на свежем воздухе для смены обстановки и лёгкой физической активности.",
    instructions: [{ step: 1, text: "Выйдите на 15–30 минут." }, { step: 2, text: "Идите без цели, просто замечайте окружение." }, { step: 3, text: "Если קשה — хотя бы до ближайшей скамейки." }],
    duration_minutes: 20,
    when_to_use: "При тревоге, низкой мотивации, потребности в смене обстановки.",
    safety_note: null,
    category: "activity",
  },
};

// ============================================================
// Practice Matching & Sync
// ============================================================

// Canonical alias mapping for deterministic practice detection
const PRACTICE_ALIASES = {
  breathing: [/дыхание\s*4[\-\s–]*6/i, /медленн\w+\s*дыхан/i, /удлин[её]нн\w+\s*выдох/i, /глубок\w+\s*дыхан/i, /дыхательн\w+\s*упражнен/i],
  grounding: [/заземлен/i, /5[\-\s]*4[\-\s]*3[\-\s]*2[\-\s]*1/i, /5\s*4\s*3\s*2\s*1/i, /органы\s*чувств/i],
  jaw_relaxation: [/расслаблен\w+\s*(лиц|челюст)/i, /лиц[ао]\s*челюст/i, /напряжен\w+\s*(лиц|челюст)/i],
  sleep_prep: [/подготовк\w+\s*ко\s*сну/i, /ритуал\w*\s*перед\s*сном/i, /спокойн\w+\s*вечер/i, /режим\w*\s*сна/i],
  neck_shoulders_stretch: [/растяжк\w+\s*(ше|плеч)/i, /ше[яию]\s*и\s*плеч/i, /мышечн\w+\s*напряжен/i],
  diary: [/дневник/i, /запис\w+\s*состоян/i, /отслеживан/i],
  "24h_plan": [/план\w*\s*24/i, /24\s*час/i, /пошагов/i],
  short_walk: [/прогулк/i, /пройтись/i, /свеж\w+\s*воздух/i, /выйти\s*на/i],
};

// Match text to practice keys
function matchPractices(text) {
  if (!text || typeof text !== "string") return [];
  const matches = [];
  for (const [key, patterns] of Object.entries(PRACTICE_ALIASES)) {
    for (const pat of patterns) {
      if (pat.test(text)) {
        matches.push(key);
        break;
      }
    }
  }
  return matches;
}

// Sync practices from report to owner-level storage
async function syncPracticesFromReport({ supabase, ownerId, sessionId, userReport, careRecommendation, supportPlan }) {
  try {
    // Collect recommendation text from multiple sources
    const texts = [];
    if (userReport) texts.push(userReport);
    if (careRecommendation?.interim_support) texts.push(careRecommendation.interim_support.join(" "));
    if (supportPlan?.selected_practices) {
      for (const p of supportPlan.selected_practices) {
        if (p.id) {
          // Direct practice ID from user selection
          await upsertPractice(supabase, ownerId, sessionId, p.id);
        }
      }
    }

    // Deterministic match from report text
    const combinedText = texts.join(" ");
    const matchedKeys = matchPractices(combinedText);

    for (const key of matchedKeys) {
      await upsertPractice(supabase, ownerId, sessionId, key);
    }
  } catch (syncError) {
    console.error("[syncPracticesFromReport] non-blocking error:", syncError.message);
    // Don't throw — report save must not fail because of practice sync
  }
}

// Upsert a single practice
async function supsertPractice(supabase, ownerId, sessionId, practiceKey) {
  const def = PRACTICE_DEFS[practiceKey];
  if (!def) return;

  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("support_owner_practices")
    .select("id, recommendation_count, source_session_ids")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .eq("practice_key", practiceKey)
    .maybeSingle();

  if (existing) {
    // Update existing — preserve user status
    const sourceIds = existing.source_session_ids || [];
    const newSourceIds = sessionId && !sourceIds.includes(sessionId)
      ? [...sourceIds, sessionId]
      : sourceIds;

    await supabase
      .from("support_owner_practices")
      .update({
        last_recommended_at: now,
        recommendation_count: (existing.recommendation_count || 1) + 1,
        source_session_ids: newSourceIds,
        instructions: def.instructions || null,
        duration_minutes: def.duration_minutes || null,
        when_to_use: def.when_to_use || null,
        safety_note: def.safety_note || null,
        category: def.category || null,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    // Insert new
    await supabase
      .from("support_owner_practices")
      .insert({
        owner_type: "anonymous_case",
        owner_id: ownerId,
        practice_key: practiceKey,
        title: def.title,
        description: def.description,
        instructions: def.instructions || null,
        duration_minutes: def.duration_minutes || null,
        when_to_use: def.when_to_use || null,
        safety_note: def.safety_note || null,
        category: def.category || null,
        first_recommended_at: now,
        last_recommended_at: now,
        recommendation_count: 1,
        source_session_ids: sessionId ? [sessionId] : [],
        status: "active",
        helpfulness: "unknown",
        user_status: "not_tried",
      });
  }
}

async function handleGetSupportPractices(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    let { data: practices, error } = await supabase
      .from("support_owner_practices")
      .select("id, practice_key, title, description, instructions, duration_minutes, when_to_use, safety_note, category, first_recommended_at, last_recommended_at, recommendation_count, status, helpfulness, user_status, source_session_ids")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .order("last_recommended_at", { ascending: false });

    if (error) {
      console.error("[getSupportPractices] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить практики." });
    }

    // Lazy backfill: if no practices exist, scan existing reports
    if (!practices || practices.length === 0) {
      try {
        const { data: sessions } = await supabase
          .from("sessions")
          .select("session_id, user_report, support_plan")
          .eq("anonymous_owner_id", owner.ownerId)
          .eq("module", "support")
          .order("created_at", { ascending: false })
          .limit(10);

        if (sessions && sessions.length > 0) {
          for (const sess of sessions) {
            if (sess.user_report) {
              await syncPracticesFromReport({
                supabase,
                ownerId: owner.ownerId,
                sessionId: sess.session_id,
                userReport: sess.user_report,
                supportPlan: sess.support_plan || null,
              });
            }
          }

          // Re-query after backfill
          const { data: refreshed } = await supabase
            .from("support_owner_practices")
            .select("id, practice_key, title, description, instructions, duration_minutes, when_to_use, safety_note, category, first_recommended_at, last_recommended_at, recommendation_count, status, helpfulness, user_status, source_session_ids")
            .eq("owner_type", "anonymous_case")
            .eq("owner_id", owner.ownerId)
            .order("last_recommended_at", { ascending: false });
          practices = refreshed || [];
        }
      } catch (backfillError) {
        console.error("[getSupportPractices] lazy backfill non-blocking error:", backfillError.message);
        // Continue with empty practices — don't fail the request
      }
    }

    return res.status(200).json({ ok: true, practices: practices || [] });
  } catch (error) {
    console.error("handleGetSupportPractices error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки практик." });
  }
}

async function handleSaveSupportPractice(req, res) {
  try {
    const { session_id, access_token, practice_key, status: newStatus, helpfulness: newHelpfulness, user_status: newUserStatus } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!practice_key || typeof practice_key !== "string") {
      return res.status(400).json({ ok: false, error: "Укажите практику." });
    }

    const def = PRACTICE_DEFS[practice_key];
    if (!def) {
      return res.status(400).json({ ok: false, error: "Неизвестная практика." });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    // Try to find existing practice
    const { data: existing } = await supabase
      .from("support_owner_practices")
      .select("id, recommendation_count, source_session_ids")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .eq("practice_key", practice_key)
      .maybeSingle();

    if (existing) {
      // Update existing
      const updateFields = { last_recommended_at: now, updated_at: now };
      if (newStatus) updateFields.status = newStatus;
      if (newHelpfulness) updateFields.helpfulness = newHelpfulness;
      if (newUserStatus) updateFields.user_status = newUserStatus;

      const { error: updateError } = await supabase
        .from("support_owner_practices")
        .update(updateFields)
        .eq("id", existing.id);

      if (updateError) {
        console.error("[saveSupportPractice] update error:", updateError.code);
        return res.status(500).json({ ok: false, error: "Не удалось обновить практику." });
      }

      return res.status(200).json({ ok: true, practice: { ...existing, ...updateFields } });
    }

    // Insert new
    const { data: inserted, error: insertError } = await supabase
      .from("support_owner_practices")
      .insert({
        owner_type: "anonymous_case",
        owner_id: owner.ownerId,
        practice_key,
        title: def.title,
        description: def.description,
        instructions: def.instructions || null,
        duration_minutes: def.duration_minutes || null,
        when_to_use: def.when_to_use || null,
        safety_note: def.safety_note || null,
        category: def.category || null,
        first_recommended_at: now,
        last_recommended_at: now,
        recommendation_count: 1,
        source_session_ids: [owner.sessionId],
        status: newStatus || "active",
        helpfulness: newHelpfulness || "unknown",
        user_status: newUserStatus || "not_tried",
      })
      .select("id, practice_key, title, description, instructions, duration_minutes, when_to_use, safety_note, category, first_recommended_at, last_recommended_at, recommendation_count, status, helpfulness, user_status")
      .single();

    if (insertError) {
      console.error("[saveSupportPractice] insert error:", insertError.code);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить практику." });
    }

    return res.status(200).json({ ok: true, practice: inserted });
  } catch (error) {
    console.error("handleSaveSupportPractice error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения практики." });
  }
}

async function handleUpdateSupportPracticeStatus(req, res) {
  try {
    const { session_id, access_token, practice_key, user_status: newUserStatus, helpfulness: newHelpfulness } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    if (!practice_key) {
      return res.status(400).json({ ok: false, error: "Укажите практику." });
    }

    const supabase = getSupabase();
    const updateFields = { updated_at: new Date().toISOString() };
    if (newUserStatus) updateFields.user_status = newUserStatus;
    if (newHelpfulness) updateFields.helpfulness = newHelpfulness;

    const { data: updated, error } = await supabase
      .from("support_owner_practices")
      .update(updateFields)
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .eq("practice_key", practice_key)
      .select("id, practice_key, user_status, helpfulness")
      .single();

    if (error) {
      console.error("[updateSupportPracticeStatus] error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось обновить статус." });
    }

    return res.status(200).json({ ok: true, practice: updated });
  } catch (error) {
    console.error("handleUpdateSupportPracticeStatus error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка обновления." });
  }
}

// ============================================================
// Support Owner Profile (display_name)
// ============================================================

async function handleGetSupportProfile(req, res) {
  try {
    const { session_id, access_token } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const { data: profile } = await supabase
      .from("support_owner_profiles")
      .select("display_name, created_at")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .maybeSingle();

    return res.status(200).json({ ok: true, display_name: profile?.display_name || null });
  } catch (error) {
    console.error("handleGetSupportProfile error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки профиля." });
  }
}

async function handleSaveSupportProfile(req, res) {
  try {
    const { session_id, access_token, display_name } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const cleanName = typeof display_name === "string" ? display_name.trim().slice(0, 50) : "";

    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("support_owner_profiles")
      .upsert({
        owner_type: "anonymous_case",
        owner_id: owner.ownerId,
        display_name: cleanName || null,
        updated_at: now,
      }, { onConflict: "owner_type,owner_id" });

    if (error) {
      console.error("[saveSupportProfile] upsert error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить имя." });
    }

    return res.status(200).json({ ok: true, display_name: cleanName || null });
  } catch (error) {
    console.error("handleSaveSupportProfile error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка сохранения." });
  }
}

// ============================================================
// Support Quick Chat
// ============================================================

async function handleGetSupportChat(req, res) {
  try {
    const { session_id, access_token, limit: msgLimit } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const supabase = getSupabase();
    const lim = Math.min(Math.max(parseInt(msgLimit) || 20, 1), 50);

    const { data: messages, error } = await supabase
      .from("support_ai_chat")
      .select("id, role, message_text, ai_response, created_at")
      .eq("owner_type", "anonymous_case")
      .eq("owner_id", owner.ownerId)
      .order("created_at", { ascending: false })
      .limit(lim);

    if (error) {
      console.error("[getSupportChat] query error:", error.code);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить чат." });
    }

    return res.status(200).json({ ok: true, messages: (messages || []).reverse() });
  } catch (error) {
    console.error("handleGetSupportChat error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка загрузки чата." });
  }
}

// ============================================================
// Shared Intent Router
// ============================================================

import { detectIntent, buildFallbackResponse } from "../lib/intent-router.js";
import { supportConfig } from "../lib/intent-configs/support.js";
import { bodyConfig } from "../lib/intent-configs/body.js";

const MODULE_CONFIGS = {
  support: supportConfig,
  body: bodyConfig,
};

function getModuleConfig(module) {
  return MODULE_CONFIGS[module] || supportConfig; // fallback to support
}

async function handleSendSupportMessage(req, res) {
  try {
    const { session_id, access_token, message } = req.body || {};
    const owner = await resolveSupportOwner(session_id, access_token);
    if (!owner) {
      return res.status(401).json({ ok: false, error: "Требуется авторизация." });
    }

    const trimmed = typeof message === "string" ? message.trim() : "";
    if (!trimmed || trimmed.length < 2) {
      return res.status(400).json({ ok: false, error: "Сообщение слишком короткое." });
    }
    if (trimmed.length > 3000) {
      return res.status(400).json({ ok: false, error: "Сообщение слишком длинное (максимум 3000)." });
    }

    const supabase = getSupabase();
    const now = new Date().toISOString();

    // Save user message
    await supabase.from("support_ai_chat").insert({
      owner_type: "anonymous_case",
      owner_id: owner.ownerId,
      role: "user",
      message_text: trimmed,
      source_session_id: owner.sessionId,
      created_at: now,
    });

    // === DETERMINISTIC INTENT ROUTING (before AI) ===
    const config = getModuleConfig("support");

    // Build context for dynamic FAQ answers
    const intentContext = {};
    try {
      const { getWallet } = await import("../lib/usage/wallet.js");
      const wallet = await getWallet({ ownerType: "anonymous_case", ownerId: owner.ownerId, module: "support" });
      if (wallet) {
        const { getUsageBalanceForClient } = await import("../lib/usage/wallet.js");
        const balance = await getUsageBalanceForClient({ walletId: wallet.id });
        intentContext.wallet_balance = balance?.balance ?? null;
      }
      const { count: practiceCount } = await supabase
        .from("support_owner_practices")
        .select("*", { count: "exact", head: true })
        .eq("owner_type", "anonymous_case")
        .eq("owner_id", owner.ownerId)
        .eq("status", "active");
      intentContext.practice_count = practiceCount || 0;
    } catch (ctxError) {
      // Non-blocking — continue without context
    }

    const intentResult = detectIntent(trimmed, config, intentContext);
    if (intentResult) {
      // Save deterministic response
      await supabase.from("support_ai_chat").insert({
        owner_type: "anonymous_case",
        owner_id: owner.ownerId,
        role: "assistant",
        message_text: intentResult.answer,
        ai_response: intentResult,
        source_session_id: owner.sessionId,
        model_used: "deterministic",
        created_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, response: intentResult });
    }

    // Build context for AI
    const context = await buildSupportChatContext(supabase, owner.ownerId);

    // Read prompt
    const { readModulePrompt, readCorePrompt } = await import("../lib/prompts.js");
    const chatPrompt = readModulePrompt("support", "ai-chat.md");
    const conversationStyle = readCorePrompt("conversation-style.md");
    const systemPrompt = `${chatPrompt}\n\n${conversationStyle}\n\nКонтекст пользователя:\n${JSON.stringify(context, null, 2)}`;

    // Call AI
    const { runTask, TASK_TYPES } = await import("../lib/modelRouter.js");
    const model = process.env.AI_MODEL_TRIAGE || "gpt-5.5";
    const fallbackModel = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
    const reasoningEffort = process.env.AI_REASONING_EFFORT || "medium";

    let aiResult;
    try {
      aiResult = await runTask(TASK_TYPES.PATIENT_DIALOG, {
        systemPrompt,
        userPrompt: trimmed,
        model,
        fallbackModel,
        reasoningEffort,
      });
    } catch (aiError) {
      console.error("[sendSupportMessage] AI error:", aiError.message);
      const errorType = aiError.message?.includes("timeout") ? "timeout" :
                         aiError.message?.includes("network") ? "network_error" : "ai_error";
      const errorResponse = buildFallbackResponse(errorType, config);
      await supabase.from("support_ai_chat").insert({
        owner_type: "anonymous_case",
        owner_id: owner.ownerId,
        role: "assistant",
        message_text: errorResponse.answer,
        ai_response: errorResponse,
        source_session_id: owner.sessionId,
        model_used: "error",
        created_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, response: errorResponse });
    }

    // Parse AI response
    let parsed;
    try {
      const raw = aiResult.raw || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: raw.slice(0, 2000), safety_note: null, confidence: "low", suggest_followup: false };
    } catch {
      parsed = { answer: (aiResult.raw || "").slice(0, 2000), safety_note: null, confidence: "low", suggest_followup: false };
    }

    // Safety check: if safety_note exists, log it
    if (parsed.safety_note) {
      console.log("[sendSupportMessage] safety_note detected:", parsed.safety_note.slice(0, 100));
    }

    // Save assistant message
    const requestId = `chat-${owner.sessionId || "no-session"}-${Date.now()}`;
    await supabase.from("support_ai_chat").insert({
      owner_type: "anonymous_case",
      owner_id: owner.ownerId,
      role: "assistant",
      message_text: parsed.answer || "",
      ai_response: parsed,
      source_session_id: owner.sessionId,
      request_id: requestId,
      model_used: aiResult.model_used || model,
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, response: parsed });
  } catch (error) {
    console.error("handleSendSupportMessage error:", error.message);
    return res.status(500).json({ ok: false, error: "Ошибка отправки." });
  }
}

// Build context for Support quick chat AI
async function buildSupportChatContext(supabase, ownerId) {
  const context = {};

  // Display name
  const { data: profile } = await supabase
    .from("support_owner_profiles")
    .select("display_name")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .maybeSingle();
  context.display_name = profile?.display_name || null;

  // Latest session summary
  const { data: latestSession } = await supabase
    .from("sessions")
    .select("user_report, support_plan, care_recommendation, patient_text, created_at")
    .eq("anonymous_owner_id", ownerId)
    .eq("module", "support")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSession) {
    context.latest_report_summary = (latestSession.user_report || "").slice(0, 800);
    context.care_recommendation = latestSession.care_recommendation || null;
    context.support_plan = latestSession.support_plan || null;
    context.latest_session_date = latestSession.created_at;
  }

  // Recent check-ins (last 14 days)
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: checkins } = await supabase
    .from("support_daily_checkins")
    .select("checkin_date, wellbeing_score, anxiety_score, comment")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .gte("checkin_date", since)
    .order("checkin_date", { ascending: true });
  context.recent_checkins = checkins || [];

  // Active practices
  const { data: practices } = await supabase
    .from("support_owner_practices")
    .select("practice_key, title, user_status, helpfulness")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .limit(10);
  context.active_practices = practices || [];

  // Recent chat messages (last 5)
  const { data: recentChat } = await supabase
    .from("support_ai_chat")
    .select("role, message_text")
    .eq("owner_type", "anonymous_case")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(5);
  context.recent_chat = (recentChat || []).reverse();

  // UI capabilities — what the user can access
  context.available_sections = [
    "report", "history", "checkins", "practices",
    "specialist_request", "profile", "access",
  ];
  context.practice_count = (practices || []).length;
  context.has_report = !!latestSession?.user_report;
  context.has_specialist = false; // resolved separately if needed
  context.service_request_available = true;

  return context;
}

export { syncPracticesFromReport };
