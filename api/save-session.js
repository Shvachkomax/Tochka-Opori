import { getSupabase } from "../lib/supabase.js";
import { generatePublicCode } from "../lib/publicCode.js";

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

    const payload = {
      public_code: publicCode,
      session_id: body.sessionId || `session-${Date.now()}`,
      patient_text: body.patient_text || "",
      conversation_history: body.conversationHistory || null,
      user_report: body.user_report || "",
      doctor_report: body.doctor_report || "",
      support_plan: body.supportPlan || null,
      risk_level: body.riskLevel || null,
      json_data: {
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
