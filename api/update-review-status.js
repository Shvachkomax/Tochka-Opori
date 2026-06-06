import { getSupabase } from "../lib/supabase.js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected", "needs_review", "local_auto_saved"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { review_id, status, reviewer_comment, admin_secret } = req.body || {};

    if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: "Неверный пароль администратора" });
    }

    if (!review_id) {
      return res.status(400).json({ ok: false, error: "Не указан review_id" });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Недопустимый статус. Разрешены: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    // Fetch current review
    const { data: current, error: fetchError } = await getSupabase()
      .from("case_reviews")
      .select("json_data")
      .eq("id", review_id)
      .maybeSingle();

    if (fetchError || !current) {
      return res.status(404).json({ ok: false, error: "Запись не найдена" });
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

    const { error: updateError } = await getSupabase()
      .from("case_reviews")
      .update({ json_data: updatedJsonData })
      .eq("id", review_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Ошибка обновления статуса" });
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
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка обновления статуса",
    });
  }
}
