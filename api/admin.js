import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions, timingSafeEqual, getAdminTokenFromHeader } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { logAdminAction, getClientIp } from "../lib/security/audit.js";
import { generateInviteToken, generateExpertAccessToken, hashToken } from "../lib/security/council-token.js";
import { sendEmail } from "../lib/email/provider.js";

function resolveRole(token) {
  if (!token) return null;
  if (process.env.SUPER_ADMIN_TOKEN && timingSafeEqual(token, process.env.SUPER_ADMIN_TOKEN)) return "super";
  if (process.env.SUPPORT_ADMIN_TOKEN && timingSafeEqual(token, process.env.SUPPORT_ADMIN_TOKEN)) return "support";
  if (process.env.BODY_ADMIN_TOKEN && timingSafeEqual(token, process.env.BODY_ADMIN_TOKEN)) return "body";
  return null;
}

function checkAccess(role, requiredModule) {
  if (!role) return false;
  if (role === "super") return true;
  if (requiredModule === "support" && role === "support") return true;
  if (requiredModule === "body" && role === "body") return true;
  // council: only super (explicit check for clarity)
  if (requiredModule === "council") return false;
  return false;
}

function extractPassword(req) {
  // Prefer Authorization header, fall back to body field
  const headerToken = getAdminTokenFromHeader(req);
  if (headerToken) return headerToken;
  const { password } = req.body || {};
  return password || null;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 100, prefix: "admin:" });
  const limited = await limit(req, res);
  if (limited) return;

  const { action } = req.body || {};

  try {
    switch (action) {
      case "verify":
        return await handleVerify(req, res);
      case "listBodyIntake":
        return await handleListBodyIntake(req, res);
      case "getBodyIntakeDetail":
        return await handleGetBodyIntakeDetail(req, res);
      case "deleteBodyIntake":
        return await handleDeleteBodyIntake(req, res);
      case "restoreBodyIntake":
        return await handleRestoreBodyIntake(req, res);
      case "listBodyDailyLogs":
        return await handleListBodyDailyLogs(req, res);
      case "getBodyDailyLogDetail":
        return await handleGetBodyDailyLogDetail(req, res);
      case "deleteBodyDailyLog":
        return await handleDeleteBodyDailyLog(req, res);
      case "saveBodyExpertReview":
        return await handleSaveBodyExpertReview(req, res);
      case "listBodyExpertReviews":
        return await handleListBodyExpertReviews(req, res);
      case "exportBodyExpertCases":
        return await handleExportBodyExpertCases(req, res);
      case "createCouncilInvitation":
        return await handleCreateCouncilInvitation(req, res);
      case "listCouncilInvitations":
        return await handleListCouncilInvitations(req, res);
      case "getCouncilInvitationDetail":
        return await handleGetCouncilInvitationDetail(req, res);
      case "revokeCouncilInvitation":
        return await handleRevokeCouncilInvitation(req, res);
      case "listCouncilExperts":
        return await handleListCouncilExperts(req, res);
      case "getCouncilExpertDetail":
        return await handleGetCouncilExpertDetail(req, res);
      case "approveCouncilExpert":
        return await handleApproveCouncilExpert(req, res);
      case "rejectCouncilExpert":
        return await handleRejectCouncilExpert(req, res);
      case "pauseCouncilExpert":
        return await handlePauseCouncilExpert(req, res);
      case "revokeCouncilExpertToken":
        return await handleRevokeCouncilExpertToken(req, res);
      case "exportCouncilExperts":
        return await handleExportCouncilExperts(req, res);
      case "trashCouncilInvitation":
        return await handleTrashCouncilInvitation(req, res);
      case "trashCouncilExpert":
        return await handleTrashCouncilExpert(req, res);
      case "listCouncilTrash":
        return await handleListCouncilTrash(req, res);
      case "restoreCouncilInvitation":
        return await handleRestoreCouncilInvitation(req, res);
      case "restoreCouncilExpert":
        return await handleRestoreCouncilExpert(req, res);
      case "permanentlyDeleteCouncilInvitation":
        return await handlePermanentlyDeleteCouncilInvitation(req, res);
      case "permanentlyDeleteCouncilExpert":
        return await handlePermanentlyDeleteCouncilExpert(req, res);
      case "createCouncilEmailDraft":
        return await handleCreateCouncilEmailDraft(req, res);
      case "updateCouncilEmailDraft":
        return await handleUpdateCouncilEmailDraft(req, res);
      case "previewCouncilEmailRecipients":
        return await handlePreviewCouncilEmailRecipients(req, res);
      case "sendCouncilEmailTest":
        return await handleSendCouncilEmailTest(req, res);
      case "sendCouncilEmailCampaign":
        return await handleSendCouncilEmailCampaign(req, res);
      case "listCouncilEmailCampaigns":
        return await handleListCouncilEmailCampaigns(req, res);
      case "getCouncilEmailCampaign":
        return await handleGetCouncilEmailCampaign(req, res);
      case "cancelCouncilEmailDraft":
        return await handleCancelCouncilEmailDraft(req, res);
      case "listUsageWallets":
        return await handleListUsageWallets(req, res);
      case "getUsageWallet":
        return await handleGetUsageWallet(req, res);
      case "adjustUsageBalance":
        return await handleAdjustUsageBalance(req, res);
      case "refillUsageWallet":
        return await handleRefillUsageWallet(req, res);
      case "pauseUsageWallet":
        return await handlePauseUsageWallet(req, res);
      case "restoreUsageWallet":
        return await handleRestoreUsageWallet(req, res);
      case "exportUsageLedger":
        return await handleExportUsageLedger(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function handleVerify(req, res) {
  try {
    const password = extractPassword(req);
    const role = resolveRole(password);
    if (!role) {
      const ip = getClientIp(req);
      await logAdminAction("unknown", "admin_login_failure", { ipAddress: ip });
      return res.status(403).json({ ok: false, error: "Неверный пароль" });
    }
    await logAdminAction(role, "admin_login_success", { ipAddress: getClientIp(req) });
    return res.status(200).json({ ok: true, role });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка проверки" });
  }
}

async function handleListBodyIntake(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit: reqLimit = 50, offset = 0, showDeleted = false, source: sourceFilter } = req.body || {};

  const supabase = getSupabase();
  let query = supabase
    .from("body_intake_forms")
    .select("*", { count: "exact" });

  if (showDeleted) {
    query = query.not("deleted_at", "is", null);
  } else {
    query = query.is("deleted_at", null);
  }

  if (sourceFilter) {
    query = query.eq("source", sourceFilter);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + reqLimit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  let records = data || [];
  const sessionIds = records.map(r => r.session_id).filter(Boolean);
  if (sessionIds.length > 0) {
    const { data: clients } = await supabase
      .from("body_clients")
      .select("*")
      .in("session_id", sessionIds);
    const clientMap = {};
    (clients || []).forEach(c => { clientMap[c.session_id] = c; });
    records = records.map(r => ({
      ...r,
      client: clientMap[r.session_id] || null,
    }));
  }

  return res.status(200).json({ ok: true, records, count: count || 0 });
}

async function handleGetBodyIntakeDetail(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("body_intake_forms")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  let record = data;
  if (record && record.session_id) {
    const { data: client } = await supabase
      .from("body_clients")
      .select("*")
      .eq("session_id", record.session_id)
      .single();
    record = { ...record, client: client || null };
  }

  return res.status(200).json({ ok: true, record });
}

async function handleDeleteBodyIntake(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("body_intake_forms")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: role,
    })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "delete_body_intake", {
    targetType: "body_intake_form",
    targetId: id,
    module: "body",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleRestoreBodyIntake(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("body_intake_forms")
    .update({
      deleted_at: null,
      deleted_by: null,
    })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "restore_body_intake", {
    targetType: "body_intake_form",
    targetId: id,
    module: "body",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleListBodyDailyLogs(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit: reqLimit = 50, offset = 0, session_id: sessionFilter } = req.body || {};

  const supabase = getSupabase();
  let query = supabase
    .from("body_daily_logs")
    .select("*", { count: "exact" });

  if (sessionFilter) {
    query = query.eq("session_id", sessionFilter);
  }

  const { data, error, count } = await query
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + reqLimit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleGetBodyDailyLogDetail(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("body_daily_logs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, record: data });
}

async function handleDeleteBodyDailyLog(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("body_daily_logs")
    .delete()
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "delete_body_daily_log", {
    targetType: "body_daily_log",
    targetId: id,
    module: "body",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleSaveBodyExpertReview(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { review } = req.body || {};
  if (!review || !review.session_id || !review.target_type || !review.target_id) {
    return res.status(400).json({ ok: false, error: "Missing required review fields" });
  }

  const supabase = getSupabase();
  const payload = {
    session_id: review.session_id,
    target_type: review.target_type,
    target_id: review.target_id,
    reviewer_name: review.reviewer_name || "Алена Жукова",
    reviewer_role: review.reviewer_role || "body_expert",
    rating_safety: review.rating_safety || null,
    rating_usefulness: review.rating_usefulness || null,
    rating_practicality: review.rating_practicality || null,
    rating_tone: review.rating_tone || null,
    error_tags: review.error_tags || [],
    what_ai_did_well: review.what_ai_did_well || null,
    what_ai_missed: review.what_ai_missed || null,
    corrected_recommendation: review.corrected_recommendation || null,
    suggested_questions: review.suggested_questions || null,
    expert_comment: review.expert_comment || null,
    source_payload: review.source_payload || null,
    ai_output: review.ai_output || null,
  };

  const { error } = await supabase
    .from("body_expert_reviews")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "save_expert_review", {
    targetType: "body_expert_review",
    targetId: review.session_id,
    module: "body",
    ipAddress: getClientIp(req),
    details: { target_type: review.target_type, reviewer_name: review.reviewer_name },
  });

  return res.status(200).json({ ok: true });
}

async function handleListBodyExpertReviews(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit: reqLimit = 50, offset = 0 } = req.body || {};

  const supabase = getSupabase();
  const { data, error, count } = await supabase
    .from("body_expert_reviews")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + reqLimit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleExportBodyExpertCases(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("body_expert_reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "export_expert_cases", {
    targetType: "body_expert_review",
    module: "body",
    ipAddress: getClientIp(req),
    details: { record_count: (data || []).length },
  });

  const lines = (data || []).map(r => JSON.stringify({
    session_id: r.session_id,
    target_type: r.target_type,
    target_id: r.target_id,
    reviewer_name: r.reviewer_name,
    reviewer_role: r.reviewer_role,
    rating_safety: r.rating_safety,
    rating_usefulness: r.rating_usefulness,
    rating_practicality: r.rating_practicality,
    rating_tone: r.rating_tone,
    error_tags: r.error_tags,
    what_ai_did_well: r.what_ai_did_well,
    what_ai_missed: r.what_ai_missed,
    corrected_recommendation: r.corrected_recommendation,
    suggested_questions: r.suggested_questions,
    expert_comment: r.expert_comment,
    source_payload: r.source_payload,
    ai_output: r.ai_output,
    created_at: r.created_at,
  }));

  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", `attachment; filename="body-expert-cases-${new Date().toISOString().split("T")[0]}.jsonl"`);
  return res.status(200).send(lines.join("\n"));
}

// --- Clinical Council handlers (SUPER_ADMIN only) ---

async function handleCreateCouncilInvitation(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { first_name, last_name, email, specialty, organization, notes, expires_days } = req.body || {};
  if (!first_name || !last_name) {
    return res.status(400).json({ ok: false, error: "Missing required fields: first_name, last_name" });
  }

  const { raw, hash, inviteCode } = generateInviteToken();
  const supabase = getSupabase();

  const expiresAt = expires_days
    ? new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // default 30 days

  const { error } = await supabase
    .from("clinical_council_invitations")
    .insert({
      invite_code: inviteCode,
      token_hash: hash,
      invited_first_name: first_name,
      invited_last_name: last_name,
      invited_email: email || null,
      specialty: specialty || null,
      organization: organization || null,
      invited_by: role,
      notes: notes || null,
      status: "created",
      expires_at: expiresAt,
    });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "create_council_invitation", {
    targetType: "clinical_council_invitation",
    targetId: inviteCode,
    module: "council",
    ipAddress: getClientIp(req),
    details: { first_name, last_name, email },
  });

  return res.status(200).json({
    ok: true,
    invitation: {
      code: inviteCode,
      token: raw,
      expires_at: expiresAt,
    },
  });
}

async function handleListCouncilInvitations(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit: reqLimit = 50, offset = 0, status } = req.body || {};
  const supabase = getSupabase();

  let query = supabase
    .from("clinical_council_invitations")
    .select("id, invite_code, invited_first_name, invited_last_name, invited_email, specialty, organization, invited_by, status, expires_at, use_count, max_uses, created_at, accepted_at, revoked_at", { count: "exact" });

  query = query.is("deleted_at", null);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + reqLimit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleGetCouncilInvitationDetail(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clinical_council_invitations")
    .select("id, invite_code, invited_first_name, invited_last_name, invited_email, specialty, organization, invited_by, notes, status, expires_at, max_uses, use_count, opened_at, accepted_at, revoked_at, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, record: data });
}

async function handleRevokeCouncilInvitation(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_invitations")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "revoke_council_invitation", {
    targetType: "clinical_council_invitation",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleListCouncilExperts(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit: reqLimit = 50, offset = 0, status } = req.body || {};
  const supabase = getSupabase();

  let query = supabase
    .from("clinical_council_experts")
    .select("id, first_name, last_name, email, phone, specialty, position, organization, professional_note, status, role, public_name_consent, approved_by, approved_at, created_at", { count: "exact" });

  query = query.is("deleted_at", null);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + reqLimit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleGetCouncilExpertDetail(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clinical_council_experts")
    .select("id, invitation_id, first_name, last_name, email, phone, specialty, position, organization, professional_note, status, role, public_name_consent, participation_terms_accepted_at, approved_by, approved_at, rejected_at, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, record: data });
}

async function handleApproveCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();

  // Generate access token for the expert
  const { raw: accessRaw, hash: accessHash } = generateExpertAccessToken();

  const { error } = await supabase
    .from("clinical_council_experts")
    .update({
      status: "active",
      approved_by: role,
      approved_at: new Date().toISOString(),
      access_token_hash: accessHash,
      access_token_generated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "approve_council_expert", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    ok: true,
    expert_id: id,
    access_token: accessRaw,
  });
}

async function handleRejectCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_experts")
    .update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending_review");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "reject_council_expert", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handlePauseCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_experts")
    .update({ status: "paused" })
    .eq("id", id)
    .eq("status", "active");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "pause_council_expert", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleRevokeCouncilExpertToken(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();

  // Check expert exists and is active
  const { data: expert, error: fetchError } = await supabase
    .from("clinical_council_experts")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchError || !expert) {
    return res.status(404).json({ ok: false, error: "Эксперт не найден" });
  }

  if (expert.status !== "active") {
    return res.status(400).json({ ok: false, error: "Токен можно отозвать только у активного эксперта" });
  }

  const { error } = await supabase
    .from("clinical_council_experts")
    .update({
      access_token_hash: null,
      access_token_generated_at: null,
      status: "paused",
    })
    .eq("id", id)
    .eq("status", "active");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "pause_council_expert", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
    details: { reason: "token_revoked" },
  });

  return res.status(200).json({ ok: true });
}

async function handleExportCouncilExperts(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clinical_council_experts")
    .select("id, first_name, last_name, email, phone, specialty, position, organization, professional_note, status, role, public_name_consent, approved_by, approved_at, rejected_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "export_council_experts", {
    targetType: "clinical_council_expert",
    module: "council",
    ipAddress: getClientIp(req),
    details: { record_count: (data || []).length },
  });

  const lines = (data || []).map(r => JSON.stringify({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    specialty: r.specialty,
    position: r.position,
    organization: r.organization,
    professional_note: r.professional_note,
    status: r.status,
    role: r.role,
    public_name_consent: r.public_name_consent,
    approved_by: r.approved_by,
    approved_at: r.approved_at,
    rejected_at: r.rejected_at,
    created_at: r.created_at,
  }));

  res.setHeader("Content-Type", "application/jsonl");
  res.setHeader("Content-Disposition", `attachment; filename="council-experts-${new Date().toISOString().split("T")[0]}.jsonl"`);
  return res.status(200).send(lines.join("\n"));
}

// ---- Soft delete / trash handlers ----

async function handleTrashCouncilInvitation(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_invitations")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: role,
      status: "revoked",
      revoked_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_invitation_trashed", {
    targetType: "clinical_council_invitation",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleTrashCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_experts")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: role,
      status: "revoked",
      access_token_hash: null,
    })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_expert_trashed", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleListCouncilTrash(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const supabase = getSupabase();

  const [invitations, experts] = await Promise.all([
    supabase
      .from("clinical_council_invitations")
      .select("id, invite_code, invited_first_name, invited_last_name, invited_email, specialty, organization, status, expires_at, use_count, max_uses, deleted_at, deleted_by")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(50),
    supabase
      .from("clinical_council_experts")
      .select("id, first_name, last_name, email, specialty, position, organization, status, role, approved_at, deleted_at, deleted_by")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(50),
  ]);

  const records = [];
  (invitations.data || []).forEach(r => {
    records.push({
      type: "invitation",
      id: r.id,
      name: `${r.invited_first_name || ""} ${r.invited_last_name || ""}`.trim(),
      email: r.invited_email,
      code: r.invite_code,
      previous_status: r.status,
      specialty: r.specialty,
      organization: r.organization,
      deleted_at: r.deleted_at,
      deleted_by: r.deleted_by,
    });
  });
  (experts.data || []).forEach(r => {
    records.push({
      type: r.status === "pending_review" ? "candidate" : "expert",
      id: r.id,
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
      email: r.email,
      code: null,
      previous_status: r.status,
      specialty: r.specialty,
      organization: r.organization,
      deleted_at: r.deleted_at,
      deleted_by: r.deleted_by,
    });
  });

  records.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

  return res.status(200).json({ ok: true, records });
}

async function handleRestoreCouncilInvitation(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  // Restore but keep status revoked — admin must create new invite if needed
  const { error } = await supabase
    .from("clinical_council_invitations")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_invitation_restored", {
    targetType: "clinical_council_invitation",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handleRestoreCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  // Restore as paused (not active), clear access_token_hash
  const { error } = await supabase
    .from("clinical_council_experts")
    .update({
      deleted_at: null,
      deleted_by: null,
      status: "paused",
      access_token_hash: null,
    })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_expert_restored", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handlePermanentlyDeleteCouncilInvitation(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  // First null out the FK in clinical_council_experts to avoid violations
  await supabase
    .from("clinical_council_experts")
    .update({ invitation_id: null })
    .eq("invitation_id", id);

  const { error } = await supabase
    .from("clinical_council_invitations")
    .delete()
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: "Невозможно окончательно удалить: запись используется. " + error.message });
  }

  await logAdminAction(role, "council_invitation_purged", {
    targetType: "clinical_council_invitation",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

async function handlePermanentlyDeleteCouncilExpert(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing id" });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("clinical_council_experts")
    .delete()
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: "Невозможно окончательно удалить: " + error.message });
  }

  await logAdminAction(role, "council_expert_purged", {
    targetType: "clinical_council_expert",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

// ── Email Campaign helpers ──────────────────────────────────────────────────

function personalizeText(text, recipient) {
  if (!text) return "";
  const cabinetUrl = "https://tochka-opori.online/expert";
  return String(text)
    .replace(/\{\{first_name\}\}/g, recipient.first_name || "")
    .replace(/\{\{last_name\}\}/g, recipient.last_name || "")
    .replace(/\{\{specialty\}\}/g, recipient.specialty || "")
    .replace(/\{\{organization\}\}/g, recipient.organization || "")
    .replace(/\{\{expert_cabinet_url\}\}/g, cabinetUrl);
}

async function resolveRecipients(filter) {
  const supabase = getSupabase();
  const { group, expertIds } = filter || {};
  if (!group) return [];

  let query;

  if (group === "selected_records") {
    if (!expertIds || !expertIds.length) return [];
    query = supabase
      .from("clinical_council_experts")
      .select("id, first_name, last_name, email, specialty, organization, invitation_id")
      .in("id", expertIds)
      .is("deleted_at", null)
      .not("email", "is", null);
  } else {
    const statusMap = {
      active_experts: "active",
      pending_candidates: "pending_review",
      paused_experts: "paused",
    };
    const status = statusMap[group];
    if (!status) return [];

    query = supabase
      .from("clinical_council_experts")
      .select("id, first_name, last_name, email, specialty, organization, invitation_id")
      .eq("status", status)
      .is("deleted_at", null)
      .not("email", "is", null);
  }

  const { data } = await query;
  if (!data) return [];

  const seen = new Set();
  return data
    .filter((r) => {
      const e = (r.email || "").toLowerCase().trim();
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    })
    .map((r) => ({
      expert_id: r.id,
      invitation_id: r.invitation_id,
      email: r.email.toLowerCase().trim(),
      name: `${r.first_name || ""} ${r.last_name || ""}`.trim(),
      first_name: r.first_name || "",
      last_name: r.last_name || "",
      specialty: r.specialty || "",
      organization: r.organization || "",
    }));
}

async function generateDeliveries(supabase, campaignId, recipients) {
  const rows = recipients.map((r) => ({
    campaign_id: campaignId,
    expert_id: r.expert_id || null,
    invitation_id: r.invitation_id || null,
    recipient_email: r.email,
    recipient_name: r.name || null,
    status: "pending",
  }));

  const { data } = await supabase.from("clinical_council_email_deliveries").insert(rows).select();
  return data || [];
}

// ── Email Campaign handlers ─────────────────────────────────────────────────

async function handleCreateCouncilEmailDraft(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { subject, bodyText, recipientFilter } = req.body || {};
  if (!subject || !subject.trim()) {
    return res.status(400).json({ ok: false, error: "Тема письма обязательна" });
  }
  if (!bodyText || !bodyText.trim()) {
    return res.status(400).json({ ok: false, error: "Текст письма обязателен" });
  }

  const filter = recipientFilter || {};
  const recipients = await resolveRecipients(filter);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clinical_council_email_campaigns")
    .insert({
      subject: subject.trim(),
      body_text: bodyText.trim(),
      recipient_filter: filter,
      status: "draft",
      created_by: role,
      total_count: recipients.length,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_email_draft_created", {
    targetType: "clinical_council_email_campaign",
    targetId: data.id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true, campaign: data });
}

async function handleUpdateCouncilEmailDraft(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id, subject, bodyText, recipientFilter } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing campaign id" });
  }

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("clinical_council_email_campaigns")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Кампания не найдена" });
  }
  if (existing.status !== "draft") {
    return res.status(400).json({ ok: false, error: "Можно редактировать только черновик" });
  }

  const updates = {};
  if (subject !== undefined) updates.subject = subject.trim();
  if (bodyText !== undefined) updates.body_text = bodyText.trim();
  if (recipientFilter !== undefined) {
    updates.recipient_filter = recipientFilter;
    const recipients = await resolveRecipients(recipientFilter);
    updates.total_count = recipients.length;
  }

  const { data, error } = await supabase
    .from("clinical_council_email_campaigns")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_email_draft_updated", {
    targetType: "clinical_council_email_campaign",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true, campaign: data });
}

async function handlePreviewCouncilEmailRecipients(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { recipientFilter } = req.body || {};
  if (!recipientFilter || !recipientFilter.group) {
    return res.status(400).json({ ok: false, error: "Не указана группа получателей" });
  }

  const recipients = await resolveRecipients(recipientFilter);
  const sample = recipients.slice(0, 10).map((r) => ({
    email: r.email,
    name: r.name,
    first_name: r.first_name,
    last_name: r.last_name,
    specialty: r.specialty,
    organization: r.organization,
  }));

  return res.status(200).json({
    ok: true,
    count: recipients.length,
    sample,
  });
}

async function handleSendCouncilEmailTest(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { subject, bodyText } = req.body || {};
  if (!subject || !subject.trim()) {
    return res.status(400).json({ ok: false, error: "Тема письма обязательна" });
  }
  if (!bodyText || !bodyText.trim()) {
    return res.status(400).json({ ok: false, error: "Текст письма обязателен" });
  }

  const rawTestTo = String(process.env.COUNCIL_EMAIL_TEST_TO || "").trim().toLowerCase();
  const testToConfigured = rawTestTo.length > 0;
  const testToValid = testToConfigured && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawTestTo);
  console.log("[email:test] COUNCIL_EMAIL_TEST_TO configured:", testToConfigured, "valid:", testToValid);

  if (!testToValid) {
    return res.status(400).json({ ok: false, error: "Не настроен адрес для тестового письма" });
  }

  const result = await sendEmail({
    to: rawTestTo,
    subject: `[ТЕСТ] ${subject.trim()}`,
    bodyText: bodyText.trim(),
  });
  console.log("[email:test] sendEmail result success:", result.success, "messageId present:", Boolean(result.messageId));

  if (!result.success) {
    return res.status(500).json({ ok: false, error: "Ошибка отправки теста" });
  }

  await logAdminAction(role, "council_email_test_sent", {
    targetType: "clinical_council_email_campaign",
    targetId: null,
    module: "council",
    ipAddress: getClientIp(req),
    details: { messageIdPresent: Boolean(result.messageId) },
  });

  const masked = rawTestTo.replace(/^(.).*(@.*)$/, "$1***$2");

  return res.status(200).json({ ok: true, messageId: result.messageId, testTo: masked });
}

async function handleSendCouncilEmailCampaign(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing campaign id" });
  }

  const supabase = getSupabase();

  const { data: campaign, error: claimError } = await supabase
    .from("clinical_council_email_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select()
    .single();

  if (claimError || !campaign) {
    return res.status(400).json({ ok: false, error: "Кампания не найдена или уже отправлена" });
  }

  const recipients = await resolveRecipients(campaign.recipient_filter || {});

  if (recipients.length === 0) {
    await supabase
      .from("clinical_council_email_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", id);
    return res.status(200).json({ ok: true, sentCount: 0, failedCount: 0 });
  }

  if (recipients.length > 50) {
    await supabase
      .from("clinical_council_email_campaigns")
      .update({ status: "draft", started_at: null })
      .eq("id", id);
    return res.status(400).json({ ok: false, error: "Максимум 50 получателей для одной рассылки" });
  }

  const deliveries = await generateDeliveries(supabase, id, recipients);
  if (deliveries.length === 0) {
    await supabase
      .from("clinical_council_email_campaigns")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", id);
    return res.status(500).json({ ok: false, error: "Не удалось создать записи доставки" });
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const delivery of deliveries) {
    const recip = recipients.find((r) => r.email === delivery.recipient_email);
    if (!recip) {
      failedCount++;
      await supabase
        .from("clinical_council_email_deliveries")
        .update({ status: "skipped", error_message: "Recipient not found in snapshot" })
        .eq("id", delivery.id);
      continue;
    }

    try {
      const text = personalizeText(campaign.body_text, recip);
      const subj = personalizeText(campaign.subject, recip);

      const result = await sendEmail({
        to: recip.email,
        toName: recip.name,
        subject: subj,
        bodyText: text,
      });

      if (result.success) {
        sentCount++;
        await supabase
          .from("clinical_council_email_deliveries")
          .update({ status: "sent", provider_message_id: result.messageId || null, sent_at: new Date().toISOString() })
          .eq("id", delivery.id);
      } else {
        failedCount++;
        await supabase
          .from("clinical_council_email_deliveries")
          .update({ status: "failed", error_message: (result.error || "Unknown error").substring(0, 500) })
          .eq("id", delivery.id);
      }
    } catch (err) {
      failedCount++;
      await supabase
        .from("clinical_council_email_deliveries")
        .update({ status: "failed", error_message: (err.message || "Unknown error").substring(0, 500) })
        .eq("id", delivery.id);
    }
  }

  let finalStatus = "completed";
  if (failedCount > 0 && sentCount > 0) finalStatus = "partially_failed";
  else if (failedCount > 0 && sentCount === 0) finalStatus = "failed";

  await supabase
    .from("clinical_council_email_campaigns")
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
    })
    .eq("id", id);

  await logAdminAction(role, "council_email_campaign_started", {
    targetType: "clinical_council_email_campaign",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  await logAdminAction(role, "council_email_campaign_completed", {
    targetType: "clinical_council_email_campaign",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
    details: { sentCount, failedCount, totalCount: recipients.length },
  });

  return res.status(200).json({ ok: true, sentCount, failedCount, totalCount: recipients.length });
}

async function handleListCouncilEmailCampaigns(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { limit = 50, offset = 0 } = req.body || {};

  const supabase = getSupabase();
  const { data, error, count } = await supabase
    .from("clinical_council_email_campaigns")
    .select("id, subject, status, created_by, created_at, started_at, completed_at, total_count, sent_count, failed_count", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleGetCouncilEmailCampaign(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing campaign id" });
  }

  const supabase = getSupabase();
  const { data: campaign, error } = await supabase
    .from("clinical_council_email_campaigns")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !campaign) {
    return res.status(404).json({ ok: false, error: "Кампания не найдена" });
  }

  const { data: deliveries } = await supabase
    .from("clinical_council_email_deliveries")
    .select("id, expert_id, invitation_id, recipient_email, recipient_name, status, provider_message_id, error_message, sent_at, created_at")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  return res.status(200).json({ ok: true, campaign, deliveries: deliveries || [] });
}

async function handleCancelCouncilEmailDraft(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (!checkAccess(role, "council")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ ok: false, error: "Missing campaign id" });
  }

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("clinical_council_email_campaigns")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Кампания не найдена" });
  }

  if (existing.status !== "draft" && existing.status !== "sending") {
    return res.status(400).json({ ok: false, error: "Можно отменить только черновик или отправляемую кампанию" });
  }

  const { error } = await supabase
    .from("clinical_council_email_campaigns")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "council_email_campaign_cancelled", {
    targetType: "clinical_council_email_campaign",
    targetId: id,
    module: "council",
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({ ok: true });
}

// ============================================================
// USAGE CREDITS ADMIN (SUPER_ADMIN only)
// ============================================================

async function requireSuperAdmin(req, res) {
  const password = extractPassword(req);
  const role = resolveRole(password);
  if (role !== "super") {
    res.status(403).json({ ok: false, error: "Нет доступа" });
    return null;
  }
  return role;
}

async function handleListUsageWallets(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { offset = 0, limit = 50 } = req.body || {};
  const supabase = getSupabase();

  const { data: wallets, error } = await supabase
    .from("usage_wallets")
    .select("id, owner_type, module, balance, status, visible_to_client, cycle_number, total_used, total_refilled, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const { count } = await supabase
    .from("usage_wallets")
    .select("id", { count: "exact", head: true });

  return res.json({ ok: true, wallets: wallets || [], total: count || 0 });
}

async function handleGetUsageWallet(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId } = req.body || {};
  if (!walletId) return res.status(400).json({ ok: false, error: "Missing walletId" });

  const supabase = getSupabase();
  const { data: wallet } = await supabase
    .from("usage_wallets")
    .select("*")
    .eq("id", walletId)
    .single();

  if (!wallet) return res.status(404).json({ ok: false, error: "Wallet not found" });

  const { data: entries } = await supabase
    .from("usage_ledger")
    .select("*")
    .eq("wallet_id", walletId)
    .order("created_at", { ascending: false })
    .limit(50);

  return res.json({ ok: true, wallet, entries: entries || [] });
}

async function handleAdjustUsageBalance(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId, amount, reason } = req.body || {};
  if (!walletId) return res.status(400).json({ ok: false, error: "Missing walletId" });
  if (amount === undefined || amount === null) return res.status(400).json({ ok: false, error: "Missing amount" });
  if (!reason) return res.status(400).json({ ok: false, error: "Reason required" });

  const { adminAdjustment } = await import("../lib/usage/wallet.js");
  const result = await adminAdjustment({ walletId, amount, reason, adminPassword: "super" });

  if (!result.success) return res.status(500).json({ ok: false, error: result.error });

  await logAdminAction(role, "usage_admin_adjustment", {
    targetType: "usage_wallet",
    targetId: walletId,
    module: "finance",
    ipAddress: getClientIp(req),
    details: { amount, reason, balance_before: result.balance_before, balance_after: result.balance_after },
  });

  return res.json({ ok: true, ...result });
}

async function handleRefillUsageWallet(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId, amount, reason } = req.body || {};
  if (!walletId) return res.status(400).json({ ok: false, error: "Missing walletId" });
  if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "Positive amount required" });

  const { manualRefill } = await import("../lib/usage/wallet.js");
  const result = await manualRefill({ walletId, amount, reason: reason || "Manual refill by admin", adminPassword: "super" });

  if (!result.success) return res.status(500).json({ ok: false, error: result.error });

  await logAdminAction(role, "usage_manual_refill", {
    targetType: "usage_wallet",
    targetId: walletId,
    module: "finance",
    ipAddress: getClientIp(req),
    details: { amount, balance_after: result.balance_after },
  });

  return res.json({ ok: true, ...result });
}

async function handlePauseUsageWallet(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId } = req.body || {};
  if (!walletId) return res.status(400).json({ ok: false, error: "Missing walletId" });

  const { setWalletStatus } = await import("../lib/usage/wallet.js");
  const ok = await setWalletStatus({ walletId, status: "paused" });

  if (!ok) return res.status(500).json({ ok: false, error: "Failed to pause wallet" });

  await logAdminAction(role, "usage_wallet_paused", {
    targetType: "usage_wallet",
    targetId: walletId,
    module: "finance",
    ipAddress: getClientIp(req),
  });

  return res.json({ ok: true });
}

async function handleRestoreUsageWallet(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId } = req.body || {};
  if (!walletId) return res.status(400).json({ ok: false, error: "Missing walletId" });

  const { setWalletStatus } = await import("../lib/usage/wallet.js");
  const ok = await setWalletStatus({ walletId, status: "active" });

  if (!ok) return res.status(500).json({ ok: false, error: "Failed to restore wallet" });

  await logAdminAction(role, "usage_wallet_restored", {
    targetType: "usage_wallet",
    targetId: walletId,
    module: "finance",
    ipAddress: getClientIp(req),
  });

  return res.json({ ok: true });
}

async function handleExportUsageLedger(req, res) {
  const role = await requireSuperAdmin(req, res);
  if (!role) return;

  const { walletId } = req.body || {};
  const supabase = getSupabase();
  let query = supabase
    .from("usage_ledger")
    .select("id, wallet_id, entry_type, amount, balance_before, balance_after, resource_type, request_id, module, session_id, provider, model, input_tokens, output_tokens, audio_seconds, image_count, estimated_cost, created_at")
    .order("created_at", { ascending: false });

  if (walletId) query = query.eq("wallet_id", walletId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  await logAdminAction(role, "usage_ledger_exported", {
    targetType: "usage_ledger",
    module: "finance",
    ipAddress: getClientIp(req),
    details: { count: (data || []).length, wallet_id: walletId || "all" },
  });

  return res.json({ ok: true, entries: data || [] });
}
