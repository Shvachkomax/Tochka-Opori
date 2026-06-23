import { getSupabase } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { maskSensitiveData, getPrivacySafeMode, maskText } from "../lib/sanitize.js";
import { runTextAnalysis } from "../lib/aiClient.js";
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

    const filename = `training-sessions-${new Date().toISOString().split("T")[0]}.csv`;
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
