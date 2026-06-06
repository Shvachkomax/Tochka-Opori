import { getSupabase } from "../lib/supabase.js";
import { generateExpertCode } from "../lib/expertCode.js";

const VALID_ROLES = ["psychiatrist", "psychologist", "psychotherapist", "clinical_psychologist", "neurologist", "other"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { name, email, telegram, role, specialty, city, organization } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "Укажите имя (минимум 2 символа)" });
    }
    if (name.trim().length > 200) {
      return res.status(400).json({ ok: false, error: "Имя не должно превышать 200 символов" });
    }

    if (!role || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ ok: false, error: "Укажите корректную роль" });
    }

    if (email && email.length > 200) {
      return res.status(400).json({ ok: false, error: "Email не должен превышать 200 символов" });
    }
    if (telegram && telegram.length > 200) {
      return res.status(400).json({ ok: false, error: "Telegram не должен превышать 200 символов" });
    }
    if (specialty && specialty.length > 300) {
      return res.status(400).json({ ok: false, error: "Специализация не должна превышать 300 символов" });
    }
    if (city && city.length > 200) {
      return res.status(400).json({ ok: false, error: "Город не должен превышать 200 символов" });
    }
    if (organization && organization.length > 300) {
      return res.status(400).json({ ok: false, error: "Организация не должна превышать 300 символов" });
    }

    // Generate unique access_code
    let access_code;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      access_code = generateExpertCode();
      const { data: existing } = await getSupabase()
        .from("experts")
        .select("id")
        .eq("access_code", access_code)
        .maybeSingle();

      if (!existing) break;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return res.status(500).json({ ok: false, error: "Не удалось сгенерировать уникальный код" });
    }

    const { data: newExpert, error: insertError } = await getSupabase()
      .from("experts")
      .insert({
        name: name.trim(),
        email: email?.trim() || null,
        telegram: telegram?.trim() || null,
        role,
        specialty: specialty?.trim() || null,
        city: city?.trim() || null,
        organization: organization?.trim() || null,
        access_code,
        is_active: true,
      })
      .select("id, name, role, specialty, city, organization")
      .single();

    if (insertError) {
      console.error("Expert insert error:", insertError);
      return res.status(500).json({ ok: false, error: "Ошибка регистрации специалиста" });
    }

    return res.status(200).json({
      ok: true,
      expert: {
        id: newExpert.id,
        name: newExpert.name,
        role: newExpert.role,
        specialty: newExpert.specialty,
        city: newExpert.city,
        organization: newExpert.organization,
      },
      access_code,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка регистрации",
    });
  }
}
