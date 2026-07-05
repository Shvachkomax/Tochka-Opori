import { getSupabase } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { maskSensitiveData, getPrivacySafeMode, maskText } from "../lib/sanitize.js";
import { runTextAnalysis } from "../lib/aiClient.js";
import { normalizeConversationHistory, normalizeSessionDetails, extractUserReport, extractDoctorReport, extractExpertFeedback } from "../lib/conversation.js";
import { readFileSync, existsSync } from "node:fs";

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
      case "trashTrainingSession":
        return await handleTrashTrainingSession(req, res);
      case "trashTrainingSessions":
        return await handleTrashTrainingSessions(req, res);
      case "restoreTrainingSession":
        return await handleRestoreTrainingSession(req, res);
      case "restoreTrainingSessions":
        return await handleRestoreTrainingSessions(req, res);
      case "permanentlyDeleteTrainingSession":
        return await handlePermanentDeleteTrainingSession(req, res);
      case "permanentlyDeleteTrainingSessions":
        return await handlePermanentlyDeleteTrainingSessions(req, res);
      case "createTrainingFromReview":
        return await handleCreateTrainingFromReview(req, res);
      case "exportTrainingCsv":
        return await handleExportTrainingCsv(req, res);
      case "getQualityAnalysisStats":
        return await handleGetQualityAnalysisStats(req, res);
      case "generateQualityInsight":
        return await handleGenerateQualityInsight(req, res);
      case "listQualityInsights":
        return await handleListQualityInsights(req, res);
      case "getQualityInsight":
        return await handleGetQualityInsight(req, res);
      case "updateQualityInsightStatus":
        return await handleUpdateQualityInsightStatus(req, res);
      case "getSessionTimeline":
        return await handleGetSessionTimeline(req, res);
      case "getSessionTimelineDetails":
        return await handleGetSessionTimelineDetails(req, res);
      case "softDeleteReview":
        return await handleSoftDeleteReview(req, res);
      case "restoreReview":
        return await handleRestoreReview(req, res);
      case "permanentDeleteReview":
        return await handlePermanentDeleteReview(req, res);
      case "deleteFullTestSession":
        return await handleDeleteFullTestSession(req, res);
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
    const showTrash = params.showTrash === true;

    let limit = parseInt(String(params.limit || "50"), 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    let query = supabase
      .from("case_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    // Active vs trash filter
    if (showTrash) {
      query = query.not("json_data->_deleted", "is", null);
    } else {
      query = query.filter("json_data->_deleted", "is", null);
    }

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
      voice_analysis_review,
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

    if (voice_analysis_review) {
      updates.voice_analysis_review = voice_analysis_review;
    }

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
    const showTrash = params.showTrash === true;

    let query = supabase
      .from("training_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    // Active vs trash filter
    if (showTrash) {
      query = query.not("json_data->_deleted", "is", null);
    } else {
      query = query.filter("json_data->_deleted", "is", null);
    }

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
      return res.status(500).json({
        ok: false,
        error: "Не удалось загрузить таблицу тренировок.",
        error_code: "DB_QUERY_FAILED",
        details: error.message,
        hint: "Проверьте соединение с БД и наличие колонок.",
      });
    }

    return res.status(200).json({ ok: true, sessions: data || [], count: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Fatal listTrainingSessions error",
      error_code: "FATAL",
      details: error?.message || String(error),
    });
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
        .filter("json_data->_deleted", "is", null)
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

    const { id, deletion_reason } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing id" });
    }

    // Fetch existing json_data
    const { data: existing } = await supabase
      .from("training_sessions")
      .select("json_data")
      .eq("id", id)
      .maybeSingle();

    const jd = existing?.json_data || {};
    jd._deleted = {
      at: new Date().toISOString(),
      by_expert_id: null,
      by_expert_name: "admin",
      reason: deletion_reason || null,
    };

    const { error } = await supabase
      .from("training_sessions")
      .update({ json_data: jd })
      .eq("id", id);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to move to trash", details: error.message });
    }

    return res.status(200).json({ ok: true, message: "Перемещено в корзину" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal deleteTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleTrashTrainingSession(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { id, deletion_reason } = req.body || {};
    if (!id) {
      return res.status(400).json({ ok: false, error: "Missing id" });
    }

    const { data: existing } = await supabase
      .from("training_sessions")
      .select("json_data")
      .eq("id", id)
      .maybeSingle();

    const jd = existing?.json_data || {};
    jd._deleted = {
      at: new Date().toISOString(),
      by_expert_id: req.body.expert_id || null,
      by_expert_name: req.body.expert_name || "admin",
      reason: deletion_reason || null,
    };

    const { data, error } = await supabase
      .from("training_sessions")
      .update({ json_data: jd })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to trash training session", details: error.message });
    }

    return res.status(200).json({ ok: true, message: "Перемещено в корзину", session: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal trashTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleTrashTrainingSessions(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { ids, deletion_reason } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing ids array" });
    }

    if (ids.length > 100) {
      return res.status(400).json({ ok: false, error: "Maximum 100 sessions per request" });
    }

    // Fetch all to get existing json_data
    const { data: existingAll } = await supabase
      .from("training_sessions")
      .select("id, json_data")
      .in("id", ids);

    const now = new Date().toISOString();
    const promises = (existingAll || []).map((row) => {
      const jd = row.json_data || {};
      jd._deleted = {
        at: now,
        by_expert_id: req.body.expert_id || null,
        by_expert_name: req.body.expert_name || "admin",
        reason: deletion_reason || null,
      };
      return supabase.from("training_sessions").update({ json_data: jd }).eq("id", row.id);
    });

    const results = await Promise.allSettled(promises);
    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length > 0) {
      return res.status(500).json({ ok: false, error: "Failed to trash some sessions", details: errors[0].reason?.message });
    }

    return res.status(200).json({
      ok: true,
      message: `Перемещено в корзину: ${existingAll?.length || 0}`,
      count: existingAll?.length || 0,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal trashTrainingSessions error", details: error?.message || String(error) });
  }
}

async function handleRestoreTrainingSession(req, res) {
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

    const { data: existing } = await supabase
      .from("training_sessions")
      .select("id, json_data")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ ok: false, error: "Training session not found" });
    }

    const jd = existing.json_data || {};
    if (!jd._deleted) {
      return res.status(400).json({ ok: false, error: "Training session is not in trash" });
    }

    delete jd._deleted;

    const { data, error } = await supabase
      .from("training_sessions")
      .update({ json_data: jd })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to restore training session", details: error.message });
    }

    return res.status(200).json({ ok: true, message: "Восстановлено", session: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal restoreTrainingSession error", details: error?.message || String(error) });
  }
}

async function handleRestoreTrainingSessions(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing ids array" });
    }

    if (ids.length > 100) {
      return res.status(400).json({ ok: false, error: "Maximum 100 sessions per request" });
    }

    // Fetch all to get json_data
    const { data: existingAll } = await supabase
      .from("training_sessions")
      .select("id, json_data")
      .in("id", ids);

    const promises = (existingAll || []).map((row) => {
      const jd = row.json_data || {};
      if (!jd._deleted) return null; // skip active records
      delete jd._deleted;
      return supabase.from("training_sessions").update({ json_data: jd }).eq("id", row.id);
    }).filter(Boolean);

    const results = await Promise.allSettled(promises);
    const errors = results.filter((r) => r.status === "rejected");
    if (errors.length > 0) {
      return res.status(500).json({ ok: false, error: "Failed to restore some sessions", details: errors[0].reason?.message });
    }

    return res.status(200).json({
      ok: true,
      message: `Восстановлено: ${promises.length}`,
      count: promises.length,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal restoreTrainingSessions error", details: error?.message || String(error) });
  }
}

async function handlePermanentDeleteTrainingSession(req, res) {
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

    // Verify the record is in trash before deleting
    const { data: existing } = await supabase
      .from("training_sessions")
      .select("id, json_data")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ ok: false, error: "Training session not found" });
    }

    const jd = existing.json_data || {};
    if (!jd._deleted) {
      return res.status(400).json({ ok: false, error: "Cannot permanently delete active session. Move to trash first." });
    }

    const { error } = await supabase
      .from("training_sessions")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to permanently delete", details: error.message });
    }

    return res.status(200).json({ ok: true, message: "Запись удалена безвозвратно" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal permanentlyDeleteTrainingSession error", details: error?.message || String(error) });
  }
}

async function handlePermanentlyDeleteTrainingSessions(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Missing ids array" });
    }

    if (ids.length > 100) {
      return res.status(400).json({ ok: false, error: "Maximum 100 sessions per request" });
    }

    // Only delete records that are in trash
    const { data: trashCheck } = await supabase
      .from("training_sessions")
      .select("id, json_data")
      .in("id", ids);

    const trashIds = (trashCheck || [])
      .filter((row) => row.json_data?._deleted)
      .map((row) => row.id);

    if (trashIds.length === 0) {
      return res.status(400).json({ ok: false, error: "No matching records found in trash" });
    }

    const { data, error } = await supabase
      .from("training_sessions")
      .delete()
      .in("id", trashIds);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to permanently delete sessions", details: error.message });
    }

    return res.status(200).json({
      ok: true,
      message: `Удалено безвозвратно: ${data?.length || 0}`,
      count: data?.length || 0,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal permanentlyDeleteTrainingSessions error", details: error?.message || String(error) });
  }
}

// ─── Review soft-delete (trash) ─────────────────────────────────

async function handleSoftDeleteReview(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { review_id, deletion_reason } = req.body || {};
    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("id, json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !current) {
      return res.status(404).json({ ok: false, error: "Review not found", details: fetchError?.message });
    }

    const jd = current.json_data || {};
    jd._deleted = {
      at: new Date().toISOString(),
      by_expert_id: expertId || null,
      by_expert_name: "admin",
      reason: deletion_reason || null,
    };

    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: jd })
      .eq("id", review_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Failed to delete review", details: updateError.message });
    }

    return res.status(200).json({ ok: true, message: "Карточка перемещена в корзину" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal softDeleteReview error", details: error?.message || String(error) });
  }
}

async function handleRestoreReview(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { review_id } = req.body || {};
    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("id, json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !current) {
      return res.status(404).json({ ok: false, error: "Review not found", details: fetchError?.message });
    }

    const jd = current.json_data || {};
    if (!jd._deleted) {
      return res.status(400).json({ ok: false, error: "Review is not in trash" });
    }

    delete jd._deleted;

    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: jd })
      .eq("id", review_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Failed to restore review", details: updateError.message });
    }

    return res.status(200).json({ ok: true, message: "Карточка восстановлена из корзины" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal restoreReview error", details: error?.message || String(error) });
  }
}

async function handlePermanentDeleteReview(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { review_id } = req.body || {};
    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    // Verify it's in trash
    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("id, json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !current) {
      return res.status(404).json({ ok: false, error: "Review not found", details: fetchError?.message });
    }

    const jd = current.json_data || {};
    if (!jd._deleted) {
      return res.status(400).json({ ok: false, error: "Cannot permanently delete active review. Move to trash first." });
    }

    const { error: deleteError } = await supabase
      .from("case_reviews")
      .delete()
      .eq("id", review_id);

    if (deleteError) {
      return res.status(500).json({ ok: false, error: "Failed to permanently delete review", details: deleteError.message });
    }

    return res.status(200).json({ ok: true, message: "Запись case_review удалена безвозвратно" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal permanentDeleteReview error", details: error?.message || String(error) });
  }
}

async function handleDeleteFullTestSession(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const { review_id } = req.body || {};
    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Missing review_id" });
    }

    // Fetch the review
    const { data: review, error: fetchError } = await supabase
      .from("case_reviews")
      .select("id, session_id, public_code, json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !review) {
      return res.status(404).json({ ok: false, error: "Review not found", details: fetchError?.message });
    }

    const sessionId = review.session_id;
    const publicCode = review.public_code;
    const results = { case_review: false, session: false, training_sessions: false };

    // 1. Delete case_review
    const { error: delReviewError } = await supabase
      .from("case_reviews")
      .delete()
      .eq("id", review_id);
    if (delReviewError) {
      return res.status(500).json({ ok: false, error: "Failed to delete case_review", details: delReviewError.message });
    }
    results.case_review = true;

    // 2. Delete sessions by session_id or public_code
    if (sessionId) {
      const { error: delSessionError } = await supabase
        .from("sessions")
        .delete()
        .eq("session_id", sessionId);
      results.session = !delSessionError;
    }
    if (!results.session && publicCode) {
      const { error: delSessionError } = await supabase
        .from("sessions")
        .delete()
        .eq("public_code", publicCode);
      results.session = !delSessionError;
    }

    // 3. Delete training_sessions by case_review_id or public_code
    if (publicCode) {
      const { error: delTsError } = await supabase
        .from("training_sessions")
        .delete()
        .eq("public_code", publicCode);
      results.training_sessions = !delTsError;
    }
    // Also delete training_sessions linked by case_review_id
    const { error: delTsByIdError } = await supabase
      .from("training_sessions")
      .delete()
      .eq("case_review_id", review_id);
    if (delTsByIdError && results.training_sessions === false) {
      // leave as false if both failed
    } else if (!delTsByIdError) {
      results.training_sessions = true;
    }

    return res.status(200).json({
      ok: true,
      message: "Тестовая сессия удалена полностью",
      deleted: results,
      sessionId,
      publicCode,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal deleteFullTestSession error", details: error?.message || String(error) });
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
      .filter("json_data->_deleted", "is", null)
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
    const showTrash = params.showTrash === true;

    let query = supabase
      .from("training_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (showTrash) {
      query = query.not("json_data->_deleted", "is", null);
    } else {
      query = query.filter("json_data->_deleted", "is", null);
    }

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

    const SESSION_KIND_LABELS = {
      initial: "Первичная сессия",
      follow_up: "Повторная сессия",
      diary_check: "Проверка дневника",
      support_toolkit_check: "Проверка практик",
      crisis_check: "Срочное обращение",
      doctor_review: "Врачебный разбор",
      other: "Другое",
    };
    const CASE_TYPE_LABELS = {
      anxiety: "Тревога", sleep: "Сон", depression_like: "Депрессивные признаки",
      grief: "Утрата / горе", trauma: "Травматический опыт", body_tension: "Телесное напряжение",
      adhd_like: "Нарушение внимания / исполнительные функции", substance: "ПАВ / вещества",
      alcohol: "Алкоголь", bipolar_red_flags: "Биполярные красные флаги",
      psychosis_red_flags: "Психотические красные флаги", acute_psychosis: "Острый психоз",
      suicide_risk: "Суицидальный риск", self_harm_risk: "Риск самоповреждения",
      medication_issue: "Вопросы лекарств", mixed: "Смешанный случай", other: "Другое",
    };
    const STATUS_LABELS = {
      new: "Новый", reviewed: "Просмотрен", needs_prompt_update: "Нужно обновить промпт",
      approved_for_learning: "Одобрен для обучения", rejected: "Отклонён", archived: "Архив",
    };

    const csvColumns = [
      { key: "id", label: "ID" },
      { key: "created_at", label: "Дата создания" },
      { key: "public_code", label: "Код пациента" },
      { key: "session_sequence", label: "Номер сессии" },
      { key: "session_kind", label: "Тип сессии" },
      { key: "follow_up_after_days", label: "Дней до повторной" },
      { key: "expert_name", label: "Имя эксперта" },
      { key: "expert_role", label: "Роль эксперта" },
      { key: "scenario_played", label: "Сценарий" },
      { key: "expected_case_type", label: "Ожидаемый тип случая" },
      { key: "ai_detected_case_type", label: "Что распознала система" },
      { key: "ai_detected_secondary_types", label: "Вторичные признаки" },
      { key: "detection_quality", label: "Качество распознавания" },
      { key: "model_used", label: "Модель" },
      { key: "fallback_used", label: "Fallback" },
      { key: "questions_quality", label: "Вопросы" },
      { key: "report_quality", label: "Отчёт" },
      { key: "safety_quality", label: "Safety" },
      { key: "language_quality", label: "Язык" },
      { key: "support_toolkit_quality", label: "Практики" },
      { key: "continuation_quality", label: "Продолжение" },
      { key: "repeated_questions", label: "Повторы" },
      { key: "missed_risk_flags", label: "Пропущены риски" },
      { key: "wrong_recommendation", label: "Неверная рекомендация" },
      { key: "remembered_context", label: "Учла контекст" },
      { key: "status", label: "Статус" },
      { key: "short_summary", label: "Краткий вывод" },
      { key: "main_problem", label: "Основная проблема" },
      { key: "expert_comment", label: "Комментарий эксперта" },
      { key: "action_needed", label: "Что исправить" },
      { key: "classification_comment", label: "Комментарий по классификации" },
      { key: "continuation_comment", label: "Комментарий по продолжению" },
      { key: "approved_for_learning", label: "Одобрен для обучения" },
      // Trash columns (read from json_data._deleted)
      { key: "json_data", label: "Дата удаления", getter: (r) => r.json_data?._deleted?.at || "" },
      { key: "json_data", label: "Удалил", getter: (r) => r.json_data?._deleted?.by_expert_name || "" },
      { key: "json_data", label: "Причина удаления", getter: (r) => r.json_data?._deleted?.reason || "" },
    ];

    const csvEscape = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, "\"\"")}"`;
      }
      return s;
    };

    const headerLine = csvColumns.map((c) => c.label).join(",");
    const lines = [headerLine];
    for (const row of data || []) {
      const vals = csvColumns.map((c) => {
        // Use getter if provided (for derived fields like json_data._deleted)
        if (c.getter) return csvEscape(c.getter(row));
        let v = row[c.key];
        if (c.key === "session_kind") v = SESSION_KIND_LABELS[v] || v;
        if (c.key === "expected_case_type" || c.key === "ai_detected_case_type") v = CASE_TYPE_LABELS[v] || v;
        if (c.key === "status") v = STATUS_LABELS[v] || v;
        if (c.key === "ai_detected_secondary_types" && Array.isArray(v)) return v.map((t) => CASE_TYPE_LABELS[t] || t).join("; ");
        if (["fallback_used","repeated_questions","missed_risk_flags","wrong_recommendation","remembered_context","approved_for_learning"].includes(c.key)) return v ? "1" : "0";
        return csvEscape(v);
      });
      lines.push(vals.join(","));
    }

    const filename = showTrash
      ? `training-sessions-trash-${new Date().toISOString().split("T")[0]}.csv`
      : `training-sessions-${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send("\uFEFF" + lines.join("\n"));
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal exportTrainingCsv error", details: error?.message || String(error) });
  }
}

async function handleGetQualityAnalysisStats(req, res) {
  try {
    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { data: lastInsight } = await supabase
      .from("quality_review_insights")
      .select("created_at, review_count, review_ids")
      .eq("analysis_type", "new_approved")
      .in("status", ["new", "under_review", "accepted", "partially_accepted"])
      .order("created_at", { ascending: false })
      .limit(1);

    const lastAnalysis = lastInsight && lastInsight.length > 0 ? lastInsight[0] : null;

    let query = supabase
      .from("case_reviews")
      .select("id", { count: "exact", head: false })
      .filter("json_data->>status", "eq", "approved")
      .filter("json_data->>approved_for_training", "eq", "true")
      .is("quality_analysis_id", null);

    const { data: newReviews, error: countError, count } = await query;

    if (countError) {
      return res.status(500).json({ ok: false, error: "Failed to count reviews", details: countError.message });
    }

    const newCount = count || (newReviews ? newReviews.length : 0);
    const reviewIds = (newReviews || []).map((r) => r.id);

    return res.status(200).json({
      ok: true,
      new_approved_count: newCount,
      unanalyzed_review_ids: reviewIds,
      last_analysis_at: lastAnalysis?.created_at || null,
      last_analysis_review_count: lastAnalysis?.review_count || 0,
      recommended_to_analyze: newCount >= 10,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal getQualityAnalysisStats error", details: error?.message || String(error) });
  }
}

async function handleGenerateQualityInsight(req, res) {
  try {
    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { analysis_type, review_ids: selectedIds, admin_secret } = req.body || {};
    const mode = analysis_type || "new_approved";

    let targetReviewIds = [];

    if (mode === "selected" && Array.isArray(selectedIds) && selectedIds.length > 0) {
      targetReviewIds = selectedIds;
    } else {
      const { data: newReviews } = await supabase
        .from("case_reviews")
        .select("id")
        .filter("json_data->>status", "eq", "approved")
        .filter("json_data->>approved_for_training", "eq", "true")
        .is("quality_analysis_id", null)
        .order("created_at", { ascending: true })
        .limit(30);

      targetReviewIds = (newReviews || []).map((r) => r.id);
    }

    if (targetReviewIds.length === 0) {
      return res.status(200).json({ ok: false, error: "Нет кейсов для анализа" });
    }

    const { data: reviews, error: fetchError } = await supabase
      .from("case_reviews")
      .select("*")
      .in("id", targetReviewIds);

    if (fetchError) {
      return res.status(500).json({ ok: false, error: "Failed to fetch reviews", details: fetchError.message });
    }

    const privacy = getPrivacySafeMode();

    const preparedCases = (reviews || []).map((review) => {
      const json = review.json_data || {};
      if (privacy) {
        json.patient_input = maskText(json.patient_input || "");
        json.patient_text = maskText(json.patient_text || "");
        json.input = maskText(json.input || "");
        json.user_report = maskText(json.user_report || "");
        json.doctor_report = maskText(json.doctor_report || "");
      }
      return {
        review_id: review.id,
        public_code: review.public_code || json.public_code || json.publicCode || null,
        case_type: json.ai_detected_case_type || json.aiDiagnosis || null,
        scenario_played: json.scenario_played || null,
        questions: json.questions ? json.questions.slice(0, 30) : [],
        answers: json.answers ? Object.entries(json.answers).slice(0, 30).map(([k, v]) => ({ q: k, a: typeof v === "string" ? v.slice(0, 300) : JSON.stringify(v).slice(0, 300) })) : [],
        patient_report: (json.user_report || "").slice(0, 2000),
        doctor_report: (json.doctor_report || "").slice(0, 2000),
        expert_assessment: json.expert_assessment || json.doctor_feedback?.expert_assessment || null,
        doctor_correction: json.doctor_feedback?.corrected_user_report ? {
          corrected_user_report: (json.doctor_feedback.corrected_user_report || "").slice(0, 1000),
          corrected_doctor_report: (json.doctor_feedback.corrected_doctor_report || "").slice(0, 1000),
          wrong_questions: json.doctor_feedback.wrong_questions || null,
          missing_questions: json.doctor_feedback.missing_questions || null,
        } : null,
        quality_scores: {
          questions: json.doctor_feedback?.questions_quality || null,
          report: json.doctor_feedback?.report_quality || null,
          safety: json.doctor_feedback?.safety_quality || null,
          language: json.doctor_feedback?.language_quality || null,
        },
        model_used: json.model_used || json.model || null,
        is_follow_up: json.isContinuation || json.is_follow_up || false,
      };
    });

    const systemPrompt = readSystemPrompt();
    const userPrompt = JSON.stringify(preparedCases, null, 2);

    const qualityModel = process.env.AI_MODEL_QUALITY_REVIEW || process.env.AI_MODEL_REPORT || process.env.AI_MODEL_TRIAGE || "gpt-5.5";
    const qualityFallback = process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini";
    const reasoningEffort = process.env.AI_QUALITY_REASONING_EFFORT || "medium";

    let result;
    try {
      result = await runTextAnalysis({
        systemPrompt,
        userPrompt,
        model: qualityModel,
        fallbackModel: qualityFallback,
        reasoningEffort,
      });
    } catch (aiError) {
      console.log("Quality insight AI error", { message: aiError?.message, code: aiError?.code });
      return res.status(500).json({
        ok: false,
        error: "Ошибка AI-анализа: " + (aiError?.message || "неизвестная ошибка"),
        technical: aiError?.code || null,
      });
    }

    if (!result || !result.parsed) {
      console.log("Quality insight AI returned unparseable response", { raw: result?.raw?.slice(0, 200) });
      return res.status(500).json({
        ok: false,
        error: "AI вернул невалидный ответ. Кейсы не отмечены как проанализированные. Попробуйте снова.",
      });
    }

    const parsed = result.parsed;
    const dateFrom = (reviews || []).length > 0 ? reviews.reduce((a, b) => a.created_at < b.created_at ? a : b).created_at : null;
    const dateTo = (reviews || []).length > 0 ? reviews.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at : null;

    const insightPayload = {
      analysis_type: mode,
      status: "new",
      review_count: targetReviewIds.length,
      review_ids: targetReviewIds,
      date_from: dateFrom,
      date_to: dateTo,
      model_used: result.model_used,
      fallback_used: result.fallback_used || false,
      summary: typeof parsed.summary === "string" ? parsed.summary : (parsed.summary?.overall_observations?.join(". ") || parsed.summary?.scope_note || JSON.stringify(parsed.summary) || null),
      strengths: parsed.strengths || [],
      recurring_problems: parsed.recurring_problems || [],
      safety_findings: parsed.safety_findings || [],
      language_findings: parsed.language_findings || [],
      missed_domains: parsed.missed_domains || [],
      recommendations: parsed.recommendations || [],
      proposed_prompt_changes: parsed.proposed_prompt_changes || [],
      proposed_logic_changes: parsed.proposed_logic_changes || [],
      regression_tests: parsed.regression_tests || [],
      risk_of_changes: parsed.risk_of_changes || null,
    };

    const { data: insight, error: insertError } = await supabase
      .from("quality_review_insights")
      .insert(insightPayload)
      .select()
      .single();

    if (insertError) {
      console.log("Quality insight insert error", { message: insertError.message });
      return res.status(500).json({
        ok: false,
        error: "Не удалось сохранить обзор. Кейсы не отмечены как проанализированные. Попробуйте снова.",
        details: insertError.message,
      });
    }

    const insightId = insight.id;

    for (const reviewId of targetReviewIds) {
      const { error: updateError } = await supabase
        .from("case_reviews")
        .update({
          quality_analysis_id: insightId,
          quality_analyzed_at: new Date().toISOString(),
        })
        .eq("id", reviewId);

      if (updateError) {
        console.log("Failed to update review quality_analysis_id", { reviewId, error: updateError.message });
      }
    }

    console.log("Quality insight generation", {
      reviewCount: targetReviewIds.length,
      modelUsed: result.model_used,
      fallbackUsed: result.fallback_used || false,
      analysisType: mode,
      insightId,
    });

    return res.status(200).json({
      ok: true,
      insight_id: insightId,
      review_count: targetReviewIds.length,
      model_used: result.model_used,
      fallback_used: result.fallback_used || false,
      message: `Обзор создан: ${targetReviewIds.length} кейсов, модель ${result.model_used}`,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal generateQualityInsight error", details: error?.message || String(error) });
  }
}

function readSystemPrompt() {
  const candidates = [
    new URL("../prompts/quality-review-analyst.md", import.meta.url),
    "./prompts/quality-review-analyst.md",
    "/var/task/prompts/quality-review-analyst.md",
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return readFileSync(candidate, "utf-8");
      }
    } catch {}
  }
  return 'Ты анализируешь группу экспертно проверенных диалогов сервиса психического triage «Точка опоры». Ответь строгим JSON и ничего кроме JSON.';
}

function buildTrainingObject(t) {
  return {
    scenario_played: t.scenario_played || "",
    expected_case_type: t.expected_case_type || "",
    ai_detected_case_type: t.ai_detected_case_type || "",
    ai_detected_secondary_types: t.ai_detected_secondary_types || [],
    detection_quality: t.detection_quality || null,
    questions_quality: t.questions_quality || null,
    report_quality: t.report_quality || null,
    safety_quality: t.safety_quality || null,
    language_quality: t.language_quality || null,
    support_toolkit_quality: t.support_toolkit_quality || null,
    continuation_quality: t.continuation_quality || null,
    repeated_questions: Boolean(t.repeated_questions),
    missed_risk_flags: Boolean(t.missed_risk_flags),
    wrong_recommendation: Boolean(t.wrong_recommendation),
    remembered_context: Boolean(t.remembered_context),
    expert_comment: t.expert_comment || "",
    missed_domain: t.missed_domain || "",
    action_needed: t.action_needed || "",
  };
}

async function handleListQualityInsights(req, res) {
  try {
    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    let query = supabase
      .from("quality_review_insights")
      .select("*")
      .order("created_at", { ascending: false });

    if (!isAdmin && expertId) {
      query = query.eq("created_by_expert_id", expertId);
    }

    const { data, error } = await query.limit(50);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to load insights", details: error.message });
    }

    return res.status(200).json({ ok: true, insights: data || [], count: Array.isArray(data) ? data.length : 0 });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal listQualityInsights error", details: error?.message || String(error) });
  }
}

async function handleGetQualityInsight(req, res) {
  try {
    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { insight_id } = req.body || {};
    if (!insight_id) {
      return res.status(400).json({ ok: false, error: "Missing insight_id" });
    }

    const { data, error } = await supabase
      .from("quality_review_insights")
      .select("*")
      .eq("id", insight_id)
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to load insight", details: error.message });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Insight not found" });
    }

    return res.status(200).json({ ok: true, insight: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal getQualityInsight error", details: error?.message || String(error) });
  }
}

async function handleUpdateQualityInsightStatus(req, res) {
  try {
    const { isAdmin } = authorizeExpert(req);
    if (!isAdmin) {
      return res.status(401).json({ ok: false, error: "Admin access required" });
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { insight_id, status, admin_comment } = req.body || {};
    if (!insight_id) {
      return res.status(400).json({ ok: false, error: "Missing insight_id" });
    }

    const allowedStatuses = ["new", "under_review", "accepted", "partially_accepted", "rejected", "archived"];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const updates = { status, updated_at: new Date().toISOString() };
    if (admin_comment !== undefined) {
      updates.admin_comment = admin_comment;
    }

    if (status === "under_review") {
      updates.reviewed_at = new Date().toISOString();
    }
    if (status === "accepted" || status === "partially_accepted") {
      updates.accepted_at = new Date().toISOString();
    }
    if (status === "rejected") {
      updates.rejected_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("quality_review_insights")
      .update(updates)
      .eq("id", insight_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to update insight status", details: error.message });
    }

    const statusLabels = {
      new: "Новый",
      under_review: "Рассматривается",
      accepted: "Принят к работе",
      partially_accepted: "Принят частично",
      rejected: "Отклонён",
      archived: "Архив",
    };

    return res.status(200).json({
      ok: true,
      insight: data,
      message: `Статус обновлён: ${statusLabels[status] || status}`,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal updateQualityInsightStatus error", details: error?.message || String(error) });
  }
}

async function handleGetSessionTimeline(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId, expertCode } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "Access denied" });
    }

    const { public_code } = req.body || {};
    if (!public_code || typeof public_code !== "string" || !public_code.trim()) {
      return res.status(400).json({ ok: false, error: "Missing public_code" });
    }

    const code = public_code.trim();

    // 1. Search sessions
    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .or(`public_code.eq.${code},json_data->>public_code.eq.${code},json_data->>sessionCode.eq.${code},json_data->>code.eq.${code}`)
      .order("created_at", { ascending: true });

    // 2. Search case_reviews
    const { data: caseReviews } = await supabase
      .from("case_reviews")
      .select("*")
      .or(`public_code.eq.${code},session_public_code.eq.${code},json_data->>public_code.eq.${code},json_data->>session_public_code.eq.${code},json_data->>publicCode.eq.${code},json_data->>sessionCode.eq.${code},json_data->>code.eq.${code}`)
      .order("created_at", { ascending: true });

    // 3. Search training_sessions (exclude deleted)
    const { data: trainingSessions } = await supabase
      .from("training_sessions")
      .select("*")
      .eq("public_code", code)
      .filter("json_data->_deleted", "is", null)
      .order("created_at", { ascending: true });

    // Build a unified items list from sessions + case_reviews + training_sessions
    const items = [];

    // Check if expert has access to this code
    const hasAccessToCode = (itemExpertId) => {
      if (isAdmin) return true;
      return itemExpertId === expertId;
    };

    // Process sessions
    if (sessions) {
      for (const s of sessions) {
        if (!hasAccessToCode(s.expert_id)) continue;
        items.push({
          source: "session",
          session_id: s.session_id || s.id,
          case_review_id: null,
          training_session_id: null,
          created_at: s.created_at,
          session_sequence: null,
          session_kind: s.session_kind || "initial",
          status: s.status || null,
          model_used: s.model_used || s.json_data?.model_used || null,
          fallback_used: Boolean(s.fallback_used || s.json_data?.fallback_used),
          patient_text_preview: (s.patient_text || s.json_data?.patient_text || s.json_data?.input || "").slice(0, 200),
          user_report_available: !!extractUserReport(s, s.json_data || {}),
          doctor_report_available: !!extractDoctorReport(s, s.json_data || {}),
          conversation_available: !!(s.conversation_history || s.json_data?.conversation_history || s.json_data?.conversationHistory),
          support_plan_available: !!(s.support_plan || s.json_data?.support_plan),
          diary_available: !!(s.diary || s.json_data?.diary),
          expert_id: s.expert_id,
          expert_name: s.expert_name || null,
          json_data: s.json_data || null,
        });
      }
    }

    // Process case_reviews
    if (caseReviews) {
      for (const r of caseReviews) {
        if (!hasAccessToCode(r.expert_id)) continue;
        const j = r.json_data || {};
        items.push({
          source: "case_review",
          session_id: r.session_id || null,
          case_review_id: r.id,
          training_session_id: null,
          created_at: r.created_at,
          session_sequence: null,
          session_kind: j.session_kind || "initial",
          status: j.status || null,
          model_used: j.model_used || null,
          fallback_used: Boolean(j.fallback_used),
          patient_text_preview: (j.patient_text || j.input || j.patient_input || "").slice(0, 200),
          user_report_available: !!extractUserReport(r, j),
          doctor_report_available: !!extractDoctorReport(r, j),
          conversation_available: !!(j.conversation_history || j.conversationHistory || j.questions),
          support_plan_available: !!(j.support_plan),
          diary_available: !!(j.diary),
          expert_id: r.expert_id,
          expert_name: r.expert_name || null,
          json_data: j,
        });
      }
    }

    // Process training_sessions
    if (trainingSessions) {
      for (const t of trainingSessions) {
        if (!hasAccessToCode(t.expert_id)) continue;
        items.push({
          source: "training_session",
          session_id: t.session_id || null,
          case_review_id: t.case_review_id || null,
          training_session_id: t.id,
          created_at: t.created_at,
          session_sequence: t.session_sequence || null,
          session_kind: t.session_kind || "initial",
          status: t.status || null,
          model_used: t.model_used || null,
          fallback_used: Boolean(t.fallback_used),
          patient_text_preview: (t.short_summary || t.main_problem || "").slice(0, 200),
          user_report_available: false,
          doctor_report_available: false,
          conversation_available: false,
          support_plan_available: false,
          diary_available: false,
          expert_id: t.expert_id,
          expert_name: t.expert_name || null,
          json_data: t.json_data || null,
          // Training-specific fields
          scenario_played: t.scenario_played || null,
          expected_case_type: t.expected_case_type || null,
          ai_detected_case_type: t.ai_detected_case_type || null,
          detection_quality: t.detection_quality || null,
          questions_quality: t.questions_quality || null,
          report_quality: t.report_quality || null,
          safety_quality: t.safety_quality || null,
          language_quality: t.language_quality || null,
          support_toolkit_quality: t.support_toolkit_quality || null,
          continuation_quality: t.continuation_quality || null,
          repeated_questions: Boolean(t.repeated_questions),
          missed_risk_flags: Boolean(t.missed_risk_flags),
          wrong_recommendation: Boolean(t.wrong_recommendation),
          remembered_context: Boolean(t.remembered_context),
          expert_comment: t.expert_comment || null,
        });
      }
    }

    // Sort by created_at, then by id for ties
    items.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      if (da !== db) return da - db;
      return (a.session_id || a.case_review_id || a.training_session_id || "").localeCompare(
        b.session_id || b.case_review_id || b.training_session_id || ""
      );
    });

    // Assign display sequence
    let displaySeq = 1;
    for (const item of items) {
      item.display_sequence = item.session_sequence || displaySeq;
      if (!item.session_sequence) displaySeq++;
    }

    // Calculate intervals
    for (let i = 0; i < items.length; i++) {
      if (i === 0) {
        items[i].interval_after_previous = null;
      } else {
        const prev = new Date(items[i - 1].created_at);
        const curr = new Date(items[i].created_at);
        const diffMs = curr.getTime() - prev.getTime();
        const diffHours = Math.round(diffMs / (1000 * 60 * 60));
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffHours < 1) {
          items[i].interval_after_previous = "В тот же день";
        } else if (diffHours < 24) {
          items[i].interval_after_previous = `Через ${diffHours} ч.`;
        } else if (diffDays === 1) {
          items[i].interval_after_previous = "На следующий день";
        } else {
          const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          items[i].interval_after_previous = `Через ${days} д.`;
        }
      }

      // Remove json_data from response to keep it lightweight
      delete items[i].json_data;
    }

    return res.status(200).json({
      ok: true,
      public_code: code,
      session_count: items.length,
      single_session_message: items.length === 1 ? "Других обращений по этому коду пока нет" : null,
      items,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal getSessionTimeline error", details: error?.message || String(error) });
  }
}

async function handleGetSessionTimelineDetails(req, res) {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { isAdmin, expertId } = authorizeExpert(req);
    if (!isAdmin && !expertId) {
      return res.status(401).json({ ok: false, error: "access_denied" });
    }

    const { case_review_id, session_id, training_session_id, public_code } = req.body || {};

    if (!case_review_id && !session_id && !training_session_id) {
      return res.status(400).json({ ok: false, error: "Missing identifier: case_review_id, session_id, or training_session_id required" });
    }

    const privacy = getPrivacySafeMode();

    // Helper to check ownership
    function checkAccess(record) {
      if (isAdmin) return true;
      if (!record) return false;
      return record.expert_id === expertId;
    }

    let session = {};

    // Load from case_reviews
    if (case_review_id) {
      const { data: review, error: fetchError } = await supabase
        .from("case_reviews")
        .select("*")
        .eq("id", case_review_id)
        .maybeSingle();

      if (fetchError) {
        return res.status(500).json({ ok: false, error: "Failed to fetch case review", details: fetchError.message });
      }

      if (!review) {
        return res.status(404).json({ ok: false, error: "Case review not found" });
      }

      if (!checkAccess(review)) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      // If public_code provided, verify it matches
      if (public_code && review.public_code && review.public_code !== public_code) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      const j = review.json_data || {};

        session = {
          session_id: review.session_id || null,
          case_review_id: review.id,
          training_session_id: null,
          created_at: review.created_at,
          session_kind: j.session_kind || "initial",
          session_sequence: j.session_sequence || null,
          status: j.status || null,
          model_used: j.model_used || null,
          fallback_used: Boolean(j.fallback_used),
          expert_id: review.expert_id,
          expert_name: review.expert_name || null,
          patient_text: j.patient_text || j.input || j.patient_input || j.text || "",
          conversation_history: j.conversation_history || j.conversationHistory || [],
          user_report: extractUserReport(review, j) || "",
          doctor_report: extractDoctorReport(review, j) || "",
          voice_observations: j.voice_observations || null,
          doctor_feedback: extractExpertFeedback(review, j),
          doctor_correction: null,
          corrected_user_report: "",
          corrected_doctor_report: "",
          correction_comment: review.correction_comment || "",
          protocol_update: review.protocol_update || "",
        support_plan: j.support_plan || null,
        diary: j.diary || null,
        continuation_comment: j.continuation_comment || "",
      };

      // Fill correction fields from extracted doctor_feedback
      const dfb = session.doctor_feedback || {};
      if (dfb.correctedUserReport || dfb.correctedDoctorReport) {
        session.doctor_correction = {
          corrected_user_report: dfb.correctedUserReport || "",
          corrected_doctor_report: dfb.correctedDoctorReport || "",
          wrong_questions: dfb.wrongQuestions || "",
          missing_questions: dfb.missingQuestions || "",
          bad_question_wording: dfb.badQuestionWording || "",
        };
        session.corrected_user_report = dfb.correctedUserReport || "";
        session.corrected_doctor_report = dfb.correctedDoctorReport || "";
        session.correction_comment = dfb.correctionComment || session.correction_comment || "";
        session.protocol_update = dfb.protocolUpdate || session.protocol_update || "";
      }

      // Normalize conversation history (handles all formats + fallbacks)
      const { rounds: chRounds } = normalizeConversationHistory(session.conversation_history, j);
      session.conversation_history = chRounds;

      // Also try to link to a training_session via case_review_id
      const { data: linkedTraining } = await supabase
        .from("training_sessions")
        .select("*")
        .eq("case_review_id", case_review_id)
        .maybeSingle();

      if (linkedTraining) {
        session.training_session_id = linkedTraining.id;
        session.training = buildTrainingObject(linkedTraining);
      }
    }

    // Load from sessions
    if (session_id && !session.case_review_id) {
      const { data: s, error: fetchError } = await supabase
        .from("sessions")
        .select("*")
        .eq("session_id", session_id)
        .maybeSingle();

      if (fetchError) {
        return res.status(500).json({ ok: false, error: "Failed to fetch session", details: fetchError.message });
      }

      if (!s) {
        return res.status(404).json({ ok: false, error: "Session not found" });
      }

      if (!checkAccess(s)) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      if (public_code && s.public_code && s.public_code !== public_code) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      const sj = s.json_data || {};

      session = {
        session_id: s.session_id,
        case_review_id: null,
        training_session_id: null,
        created_at: s.created_at,
        session_kind: s.session_kind || "initial",
        session_sequence: null,
        status: s.status || null,
        model_used: s.model_used || null,
        fallback_used: Boolean(s.fallback_used),
        expert_id: s.expert_id,
        expert_name: s.expert_name || null,
        patient_text: s.patient_text || sj.patient_text || sj.input || "",
        conversation_history: s.conversation_history || sj.conversation_history || sj.conversationHistory || [],
        user_report: extractUserReport(s, sj) || "",
        doctor_report: extractDoctorReport(s, sj) || "",
        voice_observations: sj.voice_observations || null,
        doctor_feedback: extractExpertFeedback(s, sj),
        doctor_correction: null,
        corrected_user_report: "",
        corrected_doctor_report: "",
        correction_comment: "",
        protocol_update: "",
        support_plan: s.support_plan || sj.support_plan || null,
        diary: s.diary || sj.diary || null,
        continuation_comment: sj.continuation_comment || "",
      };

      // Fill correction fields from extracted doctor_feedback
      const dfb = session.doctor_feedback || {};
      if (dfb.correctedUserReport || dfb.correctedDoctorReport) {
        session.doctor_correction = {
          corrected_user_report: dfb.correctedUserReport || "",
          corrected_doctor_report: dfb.correctedDoctorReport || "",
          wrong_questions: dfb.wrongQuestions || "",
          missing_questions: dfb.missingQuestions || "",
          bad_question_wording: dfb.badQuestionWording || "",
        };
        session.corrected_user_report = dfb.correctedUserReport || "";
        session.corrected_doctor_report = dfb.correctedDoctorReport || "";
      }

      // Normalize conversation history
      const { rounds: chRounds2 } = normalizeConversationHistory(session.conversation_history, sj);
      session.conversation_history = chRounds2;

      // Try to link case_review by session_id
      const { data: linkedReview } = await supabase
        .from("case_reviews")
        .select("*")
        .eq("session_id", session_id)
        .maybeSingle();

      if (linkedReview && checkAccess(linkedReview)) {
        session.case_review_id = linkedReview.id;
        const lj = linkedReview.json_data || {};
        const ldf = lj.doctor_feedback || {};

        // Merge in additional data from case_review
        if (!session.doctor_report) session.doctor_report = lj.doctor_report || lj.specialist_report || "";
        if (!session.user_report) session.user_report = lj.user_report || lj.patient_report || "";
        if (!session.voice_observations) session.voice_observations = lj.voice_observations || null;
        if (ldf.corrected_user_report || ldf.corrected_doctor_report) {
          session.doctor_correction = {
            corrected_user_report: ldf.corrected_user_report || "",
            corrected_doctor_report: ldf.corrected_doctor_report || "",
            wrong_questions: ldf.wrong_questions || "",
            missing_questions: ldf.missing_questions || "",
            bad_question_wording: ldf.bad_question_wording || "",
          };
        }
        if (ldf.correction_comment) session.correction_comment = ldf.correction_comment;
        if (ldf.corrected_user_report) session.corrected_user_report = ldf.corrected_user_report;
        if (ldf.corrected_doctor_report) session.corrected_doctor_report = ldf.corrected_doctor_report;
        session.doctor_feedback = ldf;
      }

      // Try to link training_session by session_id
      const { data: linkedTraining } = await supabase
        .from("training_sessions")
        .select("*")
        .eq("session_id", session_id)
        .maybeSingle();

      if (linkedTraining) {
        session.training_session_id = linkedTraining.id;
        session.training = buildTrainingObject(linkedTraining);
      }
    }

    // Load from training_sessions directly
    if (training_session_id && !session.case_review_id && !session.session_id) {
      const { data: t, error: fetchError } = await supabase
        .from("training_sessions")
        .select("*")
        .eq("id", training_session_id)
        .maybeSingle();

      if (fetchError) {
        return res.status(500).json({ ok: false, error: "Failed to fetch training session", details: fetchError.message });
      }

      if (!t) {
        return res.status(404).json({ ok: false, error: "Training session not found" });
      }

      if (!checkAccess(t)) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      if (public_code && t.public_code && t.public_code !== public_code) {
        return res.status(403).json({ ok: false, error: "access_denied" });
      }

      session = {
        session_id: t.session_id || null,
        case_review_id: t.case_review_id || null,
        training_session_id: t.id,
        created_at: t.created_at,
        session_kind: t.session_kind || "initial",
        session_sequence: t.session_sequence || null,
        status: t.status || null,
        model_used: t.model_used || null,
        fallback_used: Boolean(t.fallback_used),
        expert_id: t.expert_id,
        expert_name: t.expert_name || null,
        patient_text: t.short_summary || t.main_problem || "",
        conversation_history: [],
        user_report: "",
        doctor_report: "",
        doctor_feedback: {},
        doctor_correction: null,
        corrected_user_report: "",
        corrected_doctor_report: "",
        correction_comment: "",
        protocol_update: "",
        support_plan: null,
        diary: null,
        continuation_comment: t.continuation_comment || "",
        training: buildTrainingObject(t),
      };

      // Try to link case_review for more data
      if (t.case_review_id) {
        const { data: linkedReview } = await supabase
          .from("case_reviews")
          .select("*")
          .eq("id", t.case_review_id)
          .maybeSingle();

        if (linkedReview && checkAccess(linkedReview)) {
          const lj = linkedReview.json_data || {};
          session.case_review_id = linkedReview.id;
          session.patient_text = lj.patient_text || lj.input || lj.patient_input || session.patient_text || "";
          session.conversation_history = lj.conversation_history || lj.conversationHistory || [];
          session.user_report = extractUserReport(linkedReview, lj) || session.user_report || "";
          session.doctor_report = extractDoctorReport(linkedReview, lj) || session.doctor_report || "";
          session.doctor_feedback = extractExpertFeedback(linkedReview, lj);

          const dfb = session.doctor_feedback || {};
          if (dfb.correctedUserReport || dfb.correctedDoctorReport) {
            session.doctor_correction = {
              corrected_user_report: dfb.correctedUserReport || "",
              corrected_doctor_report: dfb.correctedDoctorReport || "",
              wrong_questions: dfb.wrongQuestions || "",
              missing_questions: dfb.missingQuestions || "",
              bad_question_wording: dfb.badQuestionWording || "",
            };
            session.corrected_user_report = dfb.correctedUserReport || "";
            session.corrected_doctor_report = dfb.correctedDoctorReport || "";
          }

          const { rounds: ljRounds } = normalizeConversationHistory(session.conversation_history, lj);
          session.conversation_history = ljRounds;
        }
      }

      // Normalize standalone training session history too
      if (!Array.isArray(session.conversation_history) || session.conversation_history.length === 0 || !session.conversation_history[0]?.round) {
        const { rounds: stRounds } = normalizeConversationHistory(session.conversation_history);
        session.conversation_history = stRounds;
      }
    }

    // Apply privacy-safe masking
    if (privacy) {
      session.patient_text = maskText(session.patient_text || "");
      session.user_report = maskText(session.user_report || "");
      session.doctor_report = maskText(session.doctor_report || "");
      session.conversation_history = (session.conversation_history || []).map((rnd) => ({
        ...rnd,
        question: maskText(rnd.question || ""),
        answer: maskText(rnd.answer || ""),
      }));
      if (session.diary) {
        if (typeof session.diary === "string") {
          session.diary = maskText(session.diary);
        } else if (typeof session.diary === "object") {
          session.diary = maskSensitiveData(session.diary);
        }
      }
      if (session.support_plan) {
        if (typeof session.support_plan === "string") {
          session.support_plan = maskText(session.support_plan);
        } else if (typeof session.support_plan === "object") {
          session.support_plan = maskSensitiveData(session.support_plan);
        }
      }
      const df = session.doctor_feedback || {};
      for (const key of Object.keys(df)) {
        if (typeof df[key] === "string") df[key] = maskText(df[key]);
      }
    }

    return res.status(200).json({
      ok: true,
      public_code: public_code || null,
      session: session,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Fatal getSessionTimelineDetails error", details: error?.message || String(error) });
  }
}
