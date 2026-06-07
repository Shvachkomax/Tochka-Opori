import { getSupabase } from "../lib/supabase.js";
import { getPrivacySafeMode } from "../lib/sanitize.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case "login":
        return await handleLogin(req, res);
      case "register":
        return await handleRegister(req, res);
      case "listRequests":
        return await handleListRequests(req, res);
      case "updateRequestStatus":
        return await handleUpdateRequestStatus(req, res);
      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Internal error" });
  }
}

async function handleLogin(req, res) {
  try {
    const { access_code } = req.body || {};

    if (!access_code || typeof access_code !== "string") {
      return res.status(400).json({ ok: false, error: "Введите код специалиста" });
    }

    const trimmed = access_code.trim().toUpperCase();

    const { data, error } = await getSupabase()
      .from("experts")
      .select("id, name, role, specialty, city, organization")
      .eq("access_code", trimmed)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("Expert login error:", error);
      return res.status(500).json({ ok: false, error: "Ошибка проверки кода" });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Код специалиста не найден" });
    }

    return res.status(200).json({
      ok: true,
      expert: {
        id: data.id,
        name: data.name,
        role: data.role,
        specialty: data.specialty,
        city: data.city,
        organization: data.organization,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка авторизации" });
  }
}

async function handleRegister(req, res) {
  try {
    const { name, role, specialty } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите имя (минимум 2 символа)" });
    }

    if (!role) {
      return res.status(400).json({ ok: false, error: "Укажите роль" });
    }

    const validRoles = ["psychiatrist", "psychologist", "psychotherapist", "clinical_psychologist", "other"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: "Некорректная роль" });
    }

    const { generateExpertCode } = await import("../lib/expertCode.js");
    const accessCode = generateExpertCode();

    const privacy = getPrivacySafeMode();

    const { data: newExpert, error } = await getSupabase()
      .from("experts")
      .insert({
        name: name.trim(),
        role,
        specialty: specialty?.trim() || null,
        email: privacy ? null : null,
        telegram: privacy ? null : null,
        city: privacy ? null : null,
        organization: privacy ? null : null,
        access_code: accessCode,
        is_active: true,
        source: "self_register",
      })
      .select("id, name, role, specialty")
      .single();

    if (error) {
      console.error("Expert registration error:", error);
      return res.status(500).json({
        ok: false,
        error: "Ошибка регистрации. Попробуйте позже.",
        details: error.message,
        code: error.code,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Регистрация прошла успешно!",
      expert: newExpert,
      access_code: accessCode,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка регистрации",
    });
  }
}

async function handleListRequests(req, res) {
  try {
    const params = req.body || {};
    const status = params.status || "pending";
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = parseInt(params.offset) || 0;

    let query = getSupabase()
      .from("expert_requests")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: "Ошибка загрузки заявок" });
    }

    return res.status(200).json({
      ok: true,
      requests: data || [],
      total: count || 0,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка загрузки заявок" });
  }
}

async function handleUpdateRequestStatus(req, res) {
  try {
    const { request_id, status, reviewer_comment, admin_secret } = req.body || {};

    if (!admin_secret || admin_secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ ok: false, error: "Неверный пароль администратора" });
    }

    if (!request_id) {
      return res.status(400).json({ ok: false, error: "Не указан request_id" });
    }

    const ALLOWED = ["pending", "approved", "rejected"];
    if (!status || !ALLOWED.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Недопустимый статус. Разрешены: ${ALLOWED.join(", ")}`,
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

    const label = { approved: "Одобрено", rejected: "Отклонено", pending: "Возвращено в ожидание" };

    return res.status(200).json({
      ok: true,
      message: `${label[status] || "Статус обновлён"}.`,
      request_id,
      status,
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Ошибка обновления статуса заявки" });
  }
}
