import { getSupabase } from "../lib/supabase.js";
import { generateExpertCode } from "../lib/expertCode.js";
import { getPrivacySafeMode } from "../lib/sanitize.js";

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

    if (specialty && specialty.length > 300) {
      return res.status(400).json({ ok: false, error: "Специализация не должна превышать 300 символов" });
    }

    // In privacy-safe mode, never store personal contact fields
    const privacySafe = getPrivacySafeMode();
    const safeEmail = privacySafe ? null : (email?.trim() || null);
    const safeTelegram = privacySafe ? null : (telegram?.trim() || null);
    const safeCity = privacySafe ? null : (city?.trim() || null);
    const safeOrg = privacySafe ? null : (organization?.trim() || null);

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
        email: safeEmail,
        telegram: safeTelegram,
        role,
        specialty: specialty?.trim() || null,
        city: safeCity,
        organization: safeOrg,
        access_code,
        is_active: true,
      })
      .select("id, name, role, specialty")
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
