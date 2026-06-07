import { getSupabase } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import { maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "needs_review", "local_auto_saved"];

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
