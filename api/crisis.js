import { getSupabase } from "../lib/supabase.js";
import { getPrivacySafeMode } from "../lib/sanitize.js";

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
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function handleSave(req, res) {
  try {
    const {
      crisis_text, contact, public_code, session_id,
      high_risk_detected, risk_markers,
    } = req.body || {};

    const privacy = getPrivacySafeMode();

    if (privacy) {
      return res.status(200).json({
        ok: true,
        privacy_mode: true,
        message: "Режим приватности: обращение не сохранено. Если вам нужна помощь — позвоните 112 или 103.",
      });
    }

    if (!crisis_text && !contact) {
      return res.status(400).json({ ok: false, error: "Опишите ситуацию или укажите контакт" });
    }

    const { error } = await getSupabase()
      .from("crisis_requests")
      .insert({
        crisis_text: crisis_text || null,
        contact: contact || null,
        public_code: public_code || null,
        session_id: session_id || null,
        high_risk_detected: high_risk_detected || false,
        risk_markers: risk_markers || null,
      });

    if (error) {
      console.error("save-crisis-request error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить обращение" });
    }

    return res.status(200).json({
      ok: true,
      message: "Обращение получено. Если ситуация срочная — звоните 112 или 103.",
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка сохранения" });
  }
}

async function handleList(req, res) {
  try {
    const params = req.body || {};
    const adminSecret = process.env.ADMIN_SECRET;

    if (!params.admin_secret || params.admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const privacy = getPrivacySafeMode();

    if (privacy) {
      return res.status(200).json({
        ok: true,
        privacy_mode: true,
        requests: [],
        message: "Crisis request persistence is disabled in PRIVACY_SAFE_MODE",
      });
    }

    const status = params.status || "new";
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = parseInt(params.offset) || 0;

    let query = getSupabase()
      .from("crisis_requests")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to load crisis requests" });
    }

    return res.status(200).json({
      ok: true,
      requests: data || [],
      total: count || 0,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error loading crisis requests" });
  }
}

async function handleUpdateStatus(req, res) {
  try {
    const { request_id, status, admin_secret } = req.body || {};

    const adminSecret = process.env.ADMIN_SECRET;

    if (!admin_secret || admin_secret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Missing request_id" });
    }

    const ALLOWED = ["new", "in_progress", "closed", "false_alarm"];
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });
    }

    const { error } = await getSupabase()
      .from("crisis_requests")
      .update({
        status,
        handled_by: "admin",
        handled_at: new Date().toISOString(),
      })
      .eq("id", request_id);

    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to update crisis request" });
    }

    return res.status(200).json({
      ok: true,
      message: "Статус обновлён",
      request_id,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error updating crisis request" });
  }
}
