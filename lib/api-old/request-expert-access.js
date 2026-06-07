import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, telegram, role, specialty, city, organization, comment } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите имя (минимум 2 символа)" });
    }

    if (!role) {
      return res.status(400).json({ ok: false, error: "Укажите роль" });
    }

    if (!email && !telegram) {
      return res.status(400).json({ ok: false, error: "Укажите хотя бы email или Telegram для связи" });
    }

    const validRoles = ["psychiatrist", "psychologist", "psychotherapist", "clinical_psychologist", "other"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: "Некорректная роль" });
    }

    if (comment && comment.length > 1000) {
      return res.status(400).json({ ok: false, error: "Комментарий не должен превышать 1000 символов" });
    }

    const { error: insertError } = await getSupabase().from("expert_requests").insert({
      name: name.trim(),
      email: email?.trim() || null,
      telegram: telegram?.trim() || null,
      role,
      specialty: specialty?.trim() || null,
      city: city?.trim() || null,
      organization: organization?.trim() || null,
      comment: comment?.trim() || null,
      status: "pending",
    });

    if (insertError) {
      console.error("Expert request insert error:", insertError);
      return res.status(500).json({ ok: false, error: "Ошибка отправки заявки" });
    }

    return res.status(200).json({
      ok: true,
      message: "Заявка отправлена. Доступ к режиму специалиста выдается вручную. Если заявка будет одобрена, вы получите код специалиста.",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка отправки заявки",
    });
  }
}
