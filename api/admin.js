import { getSupabase } from "../lib/supabase.js";

function resolveRole(token) {
  if (!token) return null;
  if (process.env.SUPER_ADMIN_TOKEN && token === process.env.SUPER_ADMIN_TOKEN) return "super";
  if (process.env.SUPPORT_ADMIN_TOKEN && token === process.env.SUPPORT_ADMIN_TOKEN) return "support";
  if (process.env.BODY_ADMIN_TOKEN && token === process.env.BODY_ADMIN_TOKEN) return "body";
  return null;
}

function checkAccess(role, requiredModule) {
  if (!role) return false;
  if (role === "super") return true;
  if (requiredModule === "support" && role === "support") return true;
  if (requiredModule === "body" && role === "body") return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

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
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function handleVerify(req, res) {
  try {
    const { password } = req.body || {};
    const role = resolveRole(password);
    if (!role) {
      return res.status(403).json({ ok: false, error: "Неверный пароль" });
    }
    return res.status(200).json({ ok: true, role });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка проверки" });
  }
}

async function handleListBodyIntake(req, res) {
  const { password, limit = 50, offset = 0, showDeleted = false, source: sourceFilter } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  // Merge body_clients info for each record
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
  const { password, id } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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

  // Merge body_clients info
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
  const { password, id } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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

  return res.status(200).json({ ok: true });
}

async function handleRestoreBodyIntake(req, res) {
  const { password, id } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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

  return res.status(200).json({ ok: true });
}

async function handleListBodyDailyLogs(req, res) {
  const { password, limit = 50, offset = 0, session_id: sessionFilter } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleGetBodyDailyLogDetail(req, res) {
  const { password, id } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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
  const { password, id } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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

  return res.status(200).json({ ok: true });
}

async function handleSaveBodyExpertReview(req, res) {
  const { password, review } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

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

  const { data, error } = await supabase
    .from("body_expert_reviews")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, review: data });
}

async function handleListBodyExpertReviews(req, res) {
  const { password, limit = 50, offset = 0 } = req.body || {};
  const role = resolveRole(password);
  if (!checkAccess(role, "body")) {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  const supabase = getSupabase();
  const { data, error, count } = await supabase
    .from("body_expert_reviews")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, records: data || [], count: count || 0 });
}

async function handleExportBodyExpertCases(req, res) {
  const { password } = req.body || {};
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
