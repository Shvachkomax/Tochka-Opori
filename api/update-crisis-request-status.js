import { createClient } from "@supabase/supabase-js";

const ALLOWED_STATUSES = ["new", "in_progress", "closed", "false_alarm"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const { request_id, status, admin_comment, admin_secret } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return res.status(500).json({ ok: false, error: "ADMIN_SECRET is not configured" });
    }

    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Invalid admin_secret" });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id" });
    }

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
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

    const updates = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "in_progress" || status === "closed" || status === "false_alarm") {
      updates.handled_by = "Maxim";
      updates.handled_at = new Date().toISOString();
    }

    if (admin_comment) {
      updates.admin_comment = admin_comment;
    }

    const { error: updateError } = await supabase
      .from("crisis_requests")
      .update(updates)
      .eq("id", request_id);

    if (updateError) {
      return res.status(500).json({
        ok: false, error: "Failed to update crisis request status",
        details: updateError.message, code: updateError.code || null,
      });
    }

    const actionLabel = {
      new: "Возвращён в ожидание",
      in_progress: "Взято в работу",
      closed: "Закрыто",
      false_alarm: "Отмечено как тестовое",
    };

    return res.status(200).json({
      ok: true,
      message: `${actionLabel[status] || "Статус обновлён"}.`,
      request_id,
      status,
    });
  } catch (error) {
    console.error("update-crisis-request-status fatal error", {
      message: error?.message, stack: error?.stack,
    });
    return res.status(500).json({
      ok: false, error: "Fatal update-crisis-request-status error",
      details: error?.message || String(error),
    });
  }
}
