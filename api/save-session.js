import { getSupabase } from "../lib/supabase.js";
import { generatePublicCode } from "../lib/publicCode.js";
import { maskText, maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ ok: false, error: "Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = req.body || {};
    let publicCode = body.publicCode;

    if (!publicCode) {
      publicCode = generatePublicCode();

      let attempts = 0;
      while (attempts < 5) {
        const { data: dup } = await getSupabase()
          .from("sessions")
          .select("id")
          .eq("public_code", publicCode)
          .maybeSingle();
        if (!dup) break;
        publicCode = generatePublicCode();
        attempts++;
      }
    }

    // Mask sensitive data before persisting
    const patientText = getPrivacySafeMode() ? maskText(body.patient_text || "") : (body.patient_text || "");
    const userReport = getPrivacySafeMode() ? maskText(body.user_report || "") : (body.user_report || "");
    const doctorReport = getPrivacySafeMode() ? maskText(body.doctor_report || "") : (body.doctor_report || "");

    let maskedConversationHistory = body.conversationHistory;
    if (getPrivacySafeMode() && Array.isArray(maskedConversationHistory)) {
      maskedConversationHistory = maskedConversationHistory.map(entry => {
        if (typeof entry === "object" && entry !== null) {
          const masked = { ...entry };
          if (masked.content) masked.content = maskText(masked.content);
          if (masked.text) masked.text = maskText(masked.text);
          return masked;
        }
        return maskText(String(entry));
      });
    }

    const payload = {
      public_code: publicCode,
      session_id: body.sessionId || `session-${Date.now()}`,
      patient_text: patientText,
      conversation_history: maskedConversationHistory || null,
      user_report: userReport,
      doctor_report: doctorReport,
      support_plan: body.supportPlan || null,
      risk_level: body.riskLevel || null,
      json_data: getPrivacySafeMode()
        ? maskSensitiveData({
            ...body,
            dialogDepth: body.dialogDepth ?? 0,
            previousPatientReport: body.previousPatientReport || "",
            previousDoctorReport: body.previousDoctorReport || "",
            homeTasks: body.homeTasks || "",
            resourceFactors: body.resourceFactors || "",
            questions: body.questions || null,
            answers: body.answers || {},
          })
        : {
            ...body,
            dialogDepth: body.dialogDepth ?? 0,
            previousPatientReport: body.previousPatientReport || "",
            previousDoctorReport: body.previousDoctorReport || "",
            homeTasks: body.homeTasks || "",
            resourceFactors: body.resourceFactors || "",
            questions: body.questions || null,
            answers: body.answers || {},
          },
      updated_at: new Date().toISOString(),
    };

    let response;

    const { data: existing, error: selectError } = await getSupabase()
      .from("sessions")
      .select("id")
      .eq("public_code", publicCode)
      .maybeSingle();

    if (selectError) {
      return res.status(500).json({ ok: false, error: `Select error: ${selectError.message}` });
    }

    if (existing) {
      response = await getSupabase()
        .from("sessions")
        .update(payload)
        .eq("public_code", publicCode);
    } else {
      response = await getSupabase().from("sessions").insert({ ...payload, created_at: new Date().toISOString() });
    }

    if (response.error) {
      return res.status(500).json({ ok: false, error: `Ошибка сохранения сессии: ${response.error.message}` });
    }

    return res.status(200).json({
      ok: true,
      publicCode,
      message: existing
        ? "Сессия обновлена. Код продолжения сохранён."
        : "Сессия сохранена. Сохраните код для продолжения.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save session" });
  }
}
