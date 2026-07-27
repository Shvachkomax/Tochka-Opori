import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions, timingSafeEqual, getAdminTokenFromHeader } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { logAdminAction, getClientIp } from "../lib/security/audit.js";
import { generateInviteToken, generateExpertAccessToken, hashToken } from "../lib/security/council-token.js";

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
      case "restoreCouncilExpert":
        return await handleRestoreCouncilExpert(req, res);
      case "revokeCouncilExpertToken":
        return await handleRevokeCouncilExpertToken(req, res);
      case "exportCouncilExperts":
        return await handleExportCouncilExperts(req, res);
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
  const { error } = await supabase
    .from("clinical_council_experts")
    .update({ status: "active" })
    .eq("id", id)
    .eq("status", "paused");

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  await logAdminAction(role, "restore_council_expert", {
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
