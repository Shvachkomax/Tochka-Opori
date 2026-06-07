import { createClient } from "@supabase/supabase-js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "needs_review", "local_auto_saved"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { review_id, status, admin_secret, action, doctor_correction, protocol_update, correction_comment } = req.body || {};

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
      return res.status(500).json({
        ok: false, error: "Missing Supabase env vars",
        hasUrl: Boolean(supabaseUrl), hasServiceKey: Boolean(serviceKey),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        ok: false, error: "Failed to fetch review",
        details: fetchError.message, code: fetchError.code || null,
      });
    }

    if (!current) {
      return res.status(404).json({ ok: false, error: "Review not found" });
    }

    const jsonData = current.json_data || {};

    if (action === "save_correction") {
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
    }

    // Default: just update status (backward-compatible)
    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

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
      return res.status(500).json({
        ok: false, error: "Failed to update review status",
        details: updateError.message, code: updateError.code || null,
      });
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
    console.error("update-review-status fatal error", { message: error?.message, stack: error?.stack });
    return res.status(500).json({
      ok: false, error: "Fatal update-review-status error",
      details: error?.message || String(error),
    });
  }
}
