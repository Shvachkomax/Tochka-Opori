import { getSupabase } from "../lib/supabase.js";

const ALLOWED_STATUSES = ["pending", "approved", "rejected"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { request_id, status, reviewer_comment, admin_secret } = req.body || {};

    if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: "Неверный пароль администратора" });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Не указан request_id" });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Недопустимый статус. Разрешены: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    const updates = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "Maxim",
    };

    if (reviewer_comment !== undefined) {
      updates.reviewer_comment = reviewer_comment;
    }

    const { error: updateError } = await getSupabase()
      .from("expert_requests")
      .update(updates)
      .eq("id", request_id);

    if (updateError) {
      return res.status(500).json({ ok: false, error: "Ошибка обновления статуса заявки" });
    }

    // NOTE: status=approved does NOT auto-create an expert.
    // Expert codes are issued manually by Maxim.

    const label = { approved: "Одобрено", rejected: "Отклонено", pending: "Возвращено в ожидание" };

    return res.status(200).json({
      ok: true,
      message: `${label[status] || "Статус обновлён"}.`,
      request_id,
      status,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка обновления статуса заявки",
    });
  }
}
