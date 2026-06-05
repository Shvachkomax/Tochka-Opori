import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { publicCode } = req.body || {};

    if (!publicCode || typeof publicCode !== "string") {
      return res.status(400).json({ error: "Введите код диалога" });
    }

    const normalized = publicCode.trim().toUpperCase();

    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("public_code", normalized)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "Код не найден. Проверьте правильность ввода." });
    }

    return res.status(200).json({
      ok: true,
      session: {
        sessionId: data.session_id,
        publicCode: data.public_code,
        patient_input: data.patient_text,
        conversationHistory: data.conversation_history,
        user_report: data.user_report,
        doctor_report: data.doctor_report,
        supportPlan: data.support_plan,
        riskLevel: data.risk_level,
        ...(data.json_data ? data.json_data : {}),
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка при поиске сессии",
    });
  }
}
