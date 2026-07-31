import crypto from "crypto";
import { getSupabase } from "../lib/supabase.js";
import { maskText, maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { validateSessionAccess, generateSessionAccessToken } from "../lib/security/access-token.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
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
