import { getSupabase } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "needs_review", "local_auto_saved"];
const TRAINING_STATUSES = ["new", "reviewed", "needs_prompt_update", "approved_for_learning", "rejected", "archived"];
const SESSION_KINDS = ["initial", "follow_up", "diary_check", "support_toolkit_check", "crisis_check", "doctor_review", "other"];
const CASE_TYPES = ["anxiety", "sleep", "depression_like", "grief", "trauma", "body_tension", "adhd_like", "substance", "alcohol", "bipolar_red_flags", "psychosis_red_flags", "acute_psychosis", "suicide_risk", "self_harm_risk", "medication_issue", "mixed", "other"];

function authorizeExpert(req) {
  const { admin_secret, expert_id, expert_code } = req.body || {};
  const adminSecret = process.env.ADMIN_SECRET;
  const isAdmin = admin_secret && adminSecret && admin_secret === adminSecret;
  return { isAdmin, expertId: expert_id || null, expertCode: expert_code || null };
}

async function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case "save":
        return await handleSave(req, res);
      case "list":
        return await handleList(req, res);
      case "updateStatus":
        return await handleUpdateStatus(req, res);
      case "saveCorrection":
        return await handleSaveCorrection(req, res);
      case "exportJsonl":
        return await handleExportJsonl(req, res);
      case "listTrainingSessions":
        return await handleListTrainingSessions(req, res);
      case "saveTrainingSession":
        return await handleSaveTrainingSession(req, res);
      case "updateTrainingSession":
        return await handleUpdateTrainingSession(req, res);
      case "deleteTrainingSession":
        return await handleDeleteTrainingSession(req, res);
      case "createTrainingFromReview":
        return await handleCreateTrainingFromReview(req, res);
      case "exportTrainingCsv":
        return await handleExportTrainingCsv(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error("reviews fatal error", { message: error?.message, stack: error?.stack });
    return res.status(500).json({ ok: false, error: error?.message || "Fatal reviews error" });
  }
}

async function handleSave(req, res) {
  try {
    const review = req.body || {};

    const supabase = getSupabase();

    const localReview = { ...review, status: "local_auto_saved" };
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const DATA_DIR = path.join(process.cwd(), "data");
      const REVIEWS_DIR = path.join(DATA_DIR, "reviews");
      if (!fs.existsSync(REVIEWS_DIR)) {
        fs.mkdirSync(REVIEWS_DIR, { recursive: true });
      }
      const filePath = path.join(REVIEWS_DIR, `${review.case_id || review.sessionId || Date.now()}.json`);
      fs.writeFileSync(filePath, JSON.stringify(localReview, null, 2));
    } catch {}

    const privacy = getPrivacySafeMode();
    const cleanedReview = privacy ? maskSensitiveData(localReview) : localReview;

    const payload = {
      case_id: cleanedReview.case_id || cleanedReview.sessionId || `review-${Date.now()}`,
      session_id: cleanedReview.sessionId || null,
      public_code: cleanedReview.publicCode || null,
      json_data: cleanedReview,
      expert_id: cleanedReview.expert_id || null,
      expert_name: cleanedReview.expert_name || null,
      expert_role: cleanedReview.expert_role || null,
      expert_specialty: cleanedReview.expert_specialty || null,
    };

    const { error } = await supabase.from("case_reviews").insert(payload);

    if (error) {
      return res.status(200).json({
        ok: false,
        error: "Не удалось сохранить на сервере",
        local: true,
        localReview,
        supabaseError: error.message,
      });
    }

    return res.status(200).json({ ok: true, message: "Review saved" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error saving review" });
  }
}

async function handleList(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false, error: "Missing Supabase env vars",
        hasUrl: Boolean(supabaseUrl), hasServiceKey: Boolean(serviceKey),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const params = req.body || {};

    const debug = String(params.debug || "") === "1";

    if (debug) {
      const { data, error } = await supabase
        .from("case_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        return res.status(500).json({
          ok: false, error: "Failed to load reviews in debug mode",
          details: error.message, code: error.code || null, hint: error.hint || null,
        });
      }

      return res.status(200).json({ ok: true, debug: true, reviews: data || [], count: Array.isArray(data) ? data.length : 0 });
    }

    const status = String(params.status || "pending").toLowerCase();
    const environment = String(params.environment || "all").toLowerCase();
    const expertFilter = String(params.expert_filter || "all").toLowerCase();

    let limit = parseInt(String(params.limit || "50"), 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    let query = supabase
      .from("case_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "all") {
      query = query.filter("json_data->>status", "eq", status);
    }

    if (environment && environment !== "all") {
      query = query.filter("json_data->>environment", "eq", environment);
    }

    if (expertFilter === "with_expert") {
      query = query.not("expert_id", "is", null);
    }

    if (expertFilter === "without_expert") {
      query = query.filter("expert_id", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false, error: "Failed to load reviews",
        details: error.message, code: error.code || null, hint: error.hint || null,
      });
    }

    return res.status(200).json({ ok: true, reviews: data || [], count: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal list-reviews error", details: error?.message || String(error) });
  }
}

async function handleUpdateStatus(req, res) {
  try {
    const { review_id, status, admin_secret } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return res.status(500).json({ ok: false, error: "ADMIN_SECRET is not configured" });
    }

    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Invalid admin_secret" });
    }

    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ ok: false, error: "Failed to fetch review", details: fetchError.message });
    }

    if (!current) {
      return res.status(404).json({ ok: false, error: "Review not found" });
    }

    const jsonData = current.json_data || {};

    const updates = {
      status,
      reviewed_by: "Maxim",
      reviewed_at: new Date().toISOString(),
      approved_for_training: status === "approved",
      local_only: status !== "approved" ? (jsonData.local_only ?? false) : false,
    };

    const updatedJsonData = { ...jsonData, ...updates };
    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: updatedJsonData })
      .eq("id", review_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Failed to update review status", details: updateError.message });
    }

    const actionLabel = {
      approved: "Одобрено",
      rejected: "Отклонено",
      needs_review: "Отмечено как требующее доработки",
      pending: "Возвращено в ожидание",
      local_auto_saved: "Возвращено в локальный черновик",
    };

    return res.status(200).json({
      ok: true,
      message: `${actionLabel[status] || "Статус обновлён"}.`,
      review_id, status,
      approved_for_training: status === "approved",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal update-review-status error", details: error?.message || String(error) });
  }
}

async function handleSaveCorrection(req, res) {
  try {
    const {
      review_id, status, admin_secret, action,
      doctor_correction, protocol_update, correction_comment,
    } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return res.status(500).json({ ok: false, error: "ADMIN_SECRET is not configured" });
    }

    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Invalid admin_secret" });
    }

    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ ok: false, error: "Failed to fetch review", details: fetchError.message });
    }

    if (!current) {
      return res.status(404).json({ ok: false, error: "Review not found" });
    }

    const jsonData = current.json_data || {};
    const doctorFeedback = jsonData.doctor_feedback || {};

    if (doctor_correction) {
      doctorFeedback.wrong_questions = doctor_correction.wrong_questions || doctorFeedback.wrong_questions || "";
      doctorFeedback.missing_questions = doctor_correction.missing_questions || doctorFeedback.missing_questions || "";
      doctorFeedback.bad_question_wording = doctor_correction.bad_question_wording || doctorFeedback.bad_question_wording || "";
      doctorFeedback.corrected_user_report = doctor_correction.corrected_user_report || doctorFeedback.corrected_user_report || "";
      doctorFeedback.corrected_doctor_report = doctor_correction.corrected_doctor_report || doctorFeedback.corrected_doctor_report || "";
    }

    if (protocol_update) {
      doctorFeedback.protocol_update = protocol_update;
    }

    if (correction_comment) {
      doctorFeedback.correction_comment = correction_comment;
    }

    const updates = {
      doctor_feedback: doctorFeedback,
      correction_comment: correction_comment || jsonData.correction_comment || null,
      protocol_update: protocol_update || jsonData.protocol_update || null,
    };

    if (status && ALLOWED_STATUSES.includes(status)) {
      updates.status = status;
      updates.approved_for_training = status === "approved";
      updates.reviewed_by = "Maxim";
      updates.reviewed_at = new Date().toISOString();
    }

    const updatedJsonData = { ...jsonData, ...updates };
    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: updatedJsonData })
      .eq("id", review_id);

    if (updateError) {
      return res.status(500).json({
        ok: false, error: "Failed to save correction",
        details: updateError.message, code: updateError.code || null,
      });
    }

    return res.status(200).json({
      ok: true,
      message: status === "approved" ? "Одобрено после правки." : "Правки сохранены.",
      review_id,
      status: status || jsonData.status,
      approved_for_training: status === "approved",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal save correction error", details: error?.message || String(error) });
  }
}

async function handleExportJsonl(req, res) {
  try {
    const { admin_secret, status } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(500).json({ ok: false, error: "ADMIN_SECRET is not configured" });
    }
    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Invalid admin_secret" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const exportStatus = status || "approved";

    const { data, error } = await supabase
      .from("case_reviews")
      .select("*")
      .filter("json_data->>status", "eq", exportStatus)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        ok: false, error: "Failed to fetch reviews for export",
        details: error.message, code: error.code || null,
      });
    }

    const lines = (data || []).map((review) => {
      const { id, created_at, json_data, ...rest } = review;
      return JSON.stringify({
        ...(json_data || {}),
        export_id: id,
        export_created_at: created_at,
        ...rest,
        doctor_correction: rest.doctor_correction || json_data?.doctor_feedback || null,
        protocol_update: rest.protocol_update || json_data?.doctor_feedback?.protocol_update || null,
      });
    }).join("\n");

    const filename = `reviews-${exportStatus}-${new Date().toISOString().split("T")[0]}.jsonl`;

    res.setHeader("Content-Type", "application/jsonl");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(lines || "");
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal exportJsonl error", details: error?.message || String(error) });
  }
}

async function handleListTrainingSessions(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    const params = req.body || {};

    let query = supabase
      .from("training_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!isAdmin && expertId) {
      query = query.eq("expert_id", expertId);
    }

    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }
    if (params.expected_case_type && params.expected_case_type !== "all") {
      query = query.eq("expected_case_type", params.expected_case_type);
    }
    if (params.ai_detected_case_type && params.ai_detected_case_type !== "all") {
      query = query.eq("ai_detected_case_type", params.ai_detected_case_type);
    }
    if (params.session_kind && params.session_kind !== "all") {
      query = query.eq("session_kind", params.session_kind);
    }
    if (params.model_used && params.model_used !== "all") {
      query = query.eq("model_used", params.model_used);
    }
    if (params.public_code && params.public_code.trim()) {
      query = query.ilike("public_code", `%${params.public_code.trim()}%`);
    }

    const { data, error } = await query.limit(500);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to load training sessions", details: error.message });
    }

    return res.status(200).json({ ok: true, sessions: data || [], count: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal listTrainingSessions error", details: error?.message || String(error) });
  }
}

async function handleSaveTrainingSession(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId, expertCode } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const params = req.body || {};
    const privacy = getPrivacySafeMode();
    const sessionData = privacy ? maskSensitiveData(params) : params;

    if (!sessionData.public_code && (sessionData.session_kind === "follow_up" || sessionData.session_kind === "diary_check" || sessionData.session_kind === "support_toolkit_check")) {
      return res.status(200).json({
        ok: true,
        warning: "Для повторной сессии лучше указать код пациента, иначе связь с предыдущими контактами потеряется.",
        session: null,
      });
    }

    if (sessionData.public_code) {
      const { data: existing } = await supabase
        .from("training_sessions")
        .select("session_sequence")
        .eq("public_code", sessionData.public_code)
        .order("session_sequence", { ascending: false })
        .limit(1);

      const maxSeq = existing && existing.length > 0 ? (existing[0].session_sequence || 0) : 0;
      sessionData.session_sequence = maxSeq + 1;
    } else {
      sessionData.session_sequence = sessionData.session_sequence || 1;
    }

    if (!isAdmin && expertId) {
      sessionData.expert_id = expertId;
    }

    const payload = {
      public_code: sessionData.public_code || null,
      session_id: sessionData.session_id || null,
      case_review_id: sessionData.case_review_id || null,
      expert_id: sessionData.expert_id || expertId || null,
      expert_name: sessionData.expert_name || null,
      expert_role: sessionData.expert_role || null,
      session_sequence: sessionData.session_sequence,
      session_kind: sessionData.session_kind || "initial",
      previous_public_code: sessionData.previous_public_code || null,
      follow_up_after_days: sessionData.follow_up_after_days || null,
      test_round: sessionData.test_round || null,
      scenario_played: sessionData.scenario_played || null,
      expected_case_type: sessionData.expected_case_type || null,
      ai_detected_case_type: sessionData.ai_detected_case_type || null,
      ai_detected_secondary_types: sessionData.ai_detected_secondary_types || null,
      detection_quality: sessionData.detection_quality || null,
      missed_domain: sessionData.missed_domain || null,
      classification_comment: sessionData.classification_comment || null,
      model_used: sessionData.model_used || null,
      fallback_used: Boolean(sessionData.fallback_used),
      questions_quality: sessionData.questions_quality || null,
      report_quality: sessionData.report_quality || null,
      safety_quality: sessionData.safety_quality || null,
      language_quality: sessionData.language_quality || null,
      support_toolkit_quality: sessionData.support_toolkit_quality || null,
      continuation_quality: sessionData.continuation_quality || null,
      repeated_questions: Boolean(sessionData.repeated_questions),
      missed_risk_flags: Boolean(sessionData.missed_risk_flags),
      wrong_recommendation: Boolean(sessionData.wrong_recommendation),
      remembered_context: Boolean(sessionData.remembered_context),
      status: sessionData.status || "new",
      short_summary: sessionData.short_summary || null,
      main_problem: sessionData.main_problem || null,
      expert_comment: sessionData.expert_comment || null,
      action_needed: sessionData.action_needed || null,
      continuation_comment: sessionData.continuation_comment || null,
      approved_for_learning: Boolean(sessionData.approved_for_learning),
      json_data: sessionData.json_data || null,
    };

    const { data, error } = await supabase
      .from("training_sessions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to save training session", details: error.message });
    }

    return res.status(200).json({ ok: true, session: data, message: "Строка добавлена" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal saveTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleUpdateTrainingSession(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const { id, updates } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing training session id" });
    }

    if (!isAdmin && expertId) {
      const { data: existing } = await supabase
        .from("training_sessions")
        .select("expert_id")
        .eq("id", id)
        .single();
      if (!existing || existing.expert_id !== expertId) {
        return res.status(403).json({ ok: false, error: "Access denied: not your session" });
      }
    }

    const clean = {};
    const allowedFields = [
      "session_kind", "scenario_played", "expected_case_type", "ai_detected_case_type",
      "ai_detected_secondary_types", "detection_quality", "missed_domain", "classification_comment",
      "model_used", "fallback_used", "questions_quality", "report_quality", "safety_quality",
      "language_quality", "support_toolkit_quality", "continuation_quality",
      "repeated_questions", "missed_risk_flags", "wrong_recommendation", "remembered_context",
      "status", "short_summary", "main_problem", "expert_comment", "action_needed",
      "continuation_comment", "approved_for_learning", "follow_up_after_days",
      "test_round", "public_code", "previous_public_code", "scenario_played",
    ];
    for (const key of allowedFields) {
      if (key in updates) {
        clean[key] = updates[key];
      }
    }
    clean.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("training_sessions")
      .update(clean)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to update training session", details: error.message });
    }

    return res.status(200).json({ ok: true, session: data, message: "Сохранено" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal updateTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleDeleteTrainingSession(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { id } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing id" });
    }

    const { error } = await supabase
      .from("training_sessions")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to delete", details: error.message });
    }

    return res.status(200).json({ ok: true, message: "Удалено" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal deleteTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleCreateTrainingFromReview(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const params = req.body || {};
    const { review_id, scenario_played, expected_case_type, session_kind, expert_comment, public_code } = params;

    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    const { data: review, error: fetchError } = await supabase
      .from("case_reviews")
      .select("*")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !review) {
      return res.status(404).json({ ok: false, error: "Review not found", details: fetchError?.message });
    }

    const jsonData = review.json_data || {};
    let foundCode = public_code ||
      review.public_code ||
      jsonData.public_code ||
      jsonData.publicCode ||
      jsonData.session?.public_code ||
      jsonData.sessionCode ||
      jsonData.code ||
      null;

    if (review.session_id) {
      const { data: linkedSession } = await supabase
        .from("sessions")
        .select("public_code")
        .eq("session_id", review.session_id)
        .maybeSingle();
      if (linkedSession?.public_code) {
        foundCode = foundCode || linkedSession.public_code;
      }
    }

    const { data: existing } = await supabase
      .from("training_sessions")
      .select("session_sequence")
      .eq("public_code", foundCode)
      .order("session_sequence", { ascending: false })
      .limit(1);

    const maxSeq = existing && existing.length > 0 ? (existing[0].session_sequence || 0) : 0;

    const payload = {
      public_code: foundCode,
      session_id: review.session_id || review.sessionId || null,
      case_review_id: review_id,
      expert_id: jsonData.expert_id || expertId || null,
      expert_name: jsonData.expert_name || null,
      expert_role: jsonData.expert_role || null,
      session_sequence: foundCode ? maxSeq + 1 : 1,
      session_kind: session_kind || "initial",
      scenario_played: scenario_played || null,
      expected_case_type: expected_case_type || null,
      model_used: jsonData.model_used || null,
      fallback_used: Boolean(jsonData.fallback_used),
      expert_comment: expert_comment || null,
      status: "new",
      json_data: {
        review_created_at: review.created_at,
        review_status: jsonData.status,
        environment: jsonData.environment,
        source: jsonData.source,
      },
    };

    const { data, error } = await supabase
      .from("training_sessions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to create training session", details: error.message });
    }

    return res.status(200).json({
      ok: true,
      session: data,
      public_code: foundCode,
      session_sequence: payload.session_sequence,
      message: foundCode
        ? `Создана запись #${payload.session_sequence} для кода ${foundCode}`
        : "Создана запись (код не указан)",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal createTrainingFromReview error", details: error?.message || String(error) });
  }
}

async function handleExportTrainingCsv(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const params = req.body || {};
    let query = supabase
      .from("training_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (!isAdmin && expertId) {
      query = query.eq("expert_id", expertId);
    }
    if (params.status && params.status !== "all") query = query.eq("status", params.status);
    if (params.expected_case_type && params.expected_case_type !== "all") query = query.eq("expected_case_type", params.expected_case_type);
    if (params.session_kind && params.session_kind !== "all") query = query.eq("session_kind", params.session_kind);

    const { data, error } = await query.limit(1000);
    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to fetch for CSV", details: error.message });
    }

    const headers = [
      "id", "created_at", "public_code", "session_sequence", "session_kind",
      "follow_up_after_days", "expert_name", "expert_role",
      "scenario_played", "expected_case_type", "ai_detected_case_type",
      "ai_detected_secondary_types", "detection_quality", "model_used", "fallback_used",
      "questions_quality", "report_quality", "safety_quality", "language_quality",
      "support_toolkit_quality", "continuation_quality",
      "repeated_questions", "missed_risk_flags", "wrong_recommendation", "remembered_context",
      "status", "short_summary", "main_problem", "expert_comment", "action_needed",
      "classification_comment", "continuation_comment", "approved_for_learning",
    ];

    const csvEscape = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, "\"\"")}"`;
      }
      return s;
    };

    const lines = [headers.join(",")];
    for (const row of data || []) {
      const vals = headers.map((h) => {
        const v = row[h];
        if (h === "ai_detected_secondary_types" && Array.isArray(v)) return v.join("; ");
        if (h === "fallback_used" || h === "repeated_questions" || h === "missed_risk_flags" || h === "wrong_recommendation" || h === "remembered_context" || h === "approved_for_learning") return v ? "1" : "0";
        return csvEscape(v);
      });
      lines.push(vals.join(","));
    }

    const filename = `training-sessions-${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send("\uFEFF" + lines.join("\n"));
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal exportTrainingCsv error", details: error?.message || String(error) });
  }
}
