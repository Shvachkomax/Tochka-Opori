import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка авторизации",
    });
  }
}
