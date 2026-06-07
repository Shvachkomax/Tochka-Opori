import { createClient } from "@supabase/supabase-js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "needs_review", "local_auto_saved"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { review_id, status, reviewer_comment, admin_secret } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return res.status(500).json({
        ok: false,
        error: "ADMIN_SECRET is not configured",
      });
    }

    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({
        ok: false,
        error: "Invalid admin_secret",
      });
    }

    if (!review_id) {
      return res.status(400).json({
        ok: false,
        error: "Missing review_id",
      });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid status",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars",
        hasUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(serviceKey),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch current review to merge into json_data
    const { data: current, error: fetchError } = await supabase
      .from("case_reviews")
      .select("json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        ok: false,
        error: "Failed to fetch review",
        details: fetchError.message,
        code: fetchError.code || null,
      });
    }

    if (!current) {
      return res.status(404).json({
        ok: false,
        error: "Review not found",
      });
    }

    const jsonData = current.json_data || {};

    const updates = {
      status,
      reviewed_by: "Maxim",
      reviewed_at: new Date().toISOString(),
      approved_for_training: status === "approved",
      local_only: status !== "approved" ? (jsonData.local_only ?? false) : false,
    };

    if (reviewer_comment !== undefined) {
      updates.reviewer_comment = reviewer_comment;
    }

    const updatedJsonData = { ...jsonData, ...updates };

    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: updatedJsonData })
      .eq("id", review_id);

    if (updateError) {
      console.error("update-review-status supabase error", {
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        code: updateError.code,
      });

      return res.status(500).json({
        ok: false,
        error: "Failed to update review status",
        details: updateError.message,
        code: updateError.code || null,
        hint: updateError.hint || null,
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
      review_id,
      status,
      approved_for_training: status === "approved",
    });
  } catch (error) {
    console.error("update-review-status fatal error", {
      message: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      ok: false,
      error: "Fatal update-review-status error",
      details: error?.message || String(error),
    });
  }
}
