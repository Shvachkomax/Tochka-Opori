import { getSupabase } from "../lib/supabase.js";
import { maskText, maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action } = req.body || {};

  try {
    switch (action) {
      case "save":
        return await handleSave(req, res);
      case "load":
        return await handleLoad(req, res);
      case "updateSupportPlan":
        return await handleUpdateSupportPlan(req, res);
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
      sessionId, patient_text, conversationHistory,
      user_report, doctor_report, riskLevel, supportPlan,
      dialogDepth, previousPatientReport, previousDoctorReport,
      homeTasks, resourceFactors, questions, answers,
      voiceObservations, _debug, care_recommendation,
    } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "Missing sessionId" });
    }

    const supabase = getSupabase();

    const privacy = getPrivacySafeMode();
    const maskedPatientText = privacy ? maskText(patient_text || "") : patient_text;
    const maskedUserReport = privacy ? maskSensitiveData(user_report || "") : user_report;
    const maskedDoctorReport = privacy ? maskSensitiveData(doctor_report || "") : doctor_report;
    const maskedConversation = privacy ? maskSensitiveData(conversationHistory || []) : conversationHistory;

    const { generatePublicCode } = await import("../lib/publicCode.js");

    const existing = await supabase
      .from("sessions")
      .select("public_code")
      .eq("session_id", sessionId)
      .maybeSingle();

    let publicCode = existing?.data?.public_code;
    if (!publicCode) {
      publicCode = generatePublicCode();
    }

    const { data: existingRow } = await supabase
      .from("sessions")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    const payload = {
      session_id: sessionId,
      patient_text: maskedPatientText,
      conversation_history: maskedConversation,
      user_report: maskedUserReport,
      doctor_report: maskedDoctorReport,
      risk_level: riskLevel || null,
      support_plan: supportPlan || null,
      public_code: publicCode,
      json_data: {
        dialogDepth: dialogDepth ?? 0,
        previousPatientReport: previousPatientReport || "",
        previousDoctorReport: previousDoctorReport || "",
        homeTasks: homeTasks || "",
        resourceFactors: resourceFactors || "",
        questions: questions || null,
        answers: answers || {},
        voiceObservations: voiceObservations || null,
        _debug: _debug || null,
        care_recommendation: care_recommendation || null,
      },
    };

    let error;
    if (existingRow) {
      ({ error } = await supabase.from("sessions").update(payload).eq("session_id", sessionId));
    } else {
      ({ error } = await supabase.from("sessions").insert(payload));
    }

    if (error) {
      console.error("save-session supabase error", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось сохранить сессию. Попробуйте позже.",
        details: process.env.VERCEL ? undefined : error.message,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Сессия сохранена. Вы можете продолжить позже.",
      sessionId,
      publicCode,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка сохранения сессии",
    });
  }
}

async function handleLoad(req, res) {
  try {
    const { publicCode } = req.body || {};

    if (!publicCode || typeof publicCode !== "string") {
      return res.status(400).json({ error: "Введите код диалога" });
    }

    const normalized = publicCode.trim().toUpperCase();

    const { data, error } = await getSupabase()
      .from("sessions")
      .select("*")
      .eq("public_code", normalized)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        ok: false,
        error: "База данных временно недоступна. Попробуйте позже.",
      });
    }

    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "Код не найден. Проверьте правильность ввода (формат: ТОЧКА-XXXX-XXXX).",
      });
    }

    const jsonData = data.json_data || {};
    const session = {
      sessionId: data.session_id,
      publicCode: data.public_code,
      patient_input: data.patient_text,
      conversationHistory: data.conversation_history,
      user_report: data.user_report,
      doctor_report: data.doctor_report,
      supportPlan: data.support_plan,
      riskLevel: data.risk_level,
      dialogDepth: jsonData.dialogDepth ?? 0,
      previousPatientReport: jsonData.previousPatientReport || "",
      previousDoctorReport: jsonData.previousDoctorReport || "",
      homeTasks: jsonData.homeTasks || "",
      resourceFactors: jsonData.resourceFactors || "",
      questions: jsonData.questions || null,
      answers: jsonData.answers || {},
      ...(jsonData || {}),
    };

    return res.status(200).json({
      ok: true,
      message: "Сессия загружена. Можно продолжить разбор.",
      session,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка при поиске сессии",
    });
  }
}

async function handleUpdateSupportPlan(req, res) {
  try {
    const { public_code, session_id, support_plan } = req.body || {};

    if (!public_code && !session_id) {
      return res.status(400).json({ ok: false, error: "Missing public_code or session_id" });
    }

    let query = getSupabase().from("sessions").update({ support_plan, updated_at: new Date().toISOString() });

    if (public_code) {
      query = query.eq("public_code", public_code);
    } else {
      query = query.eq("session_id", session_id);
    }

    const { error } = await query;

    if (error) {
      console.error("updateSupportPlan error:", error);
      return res.status(500).json({ ok: false, error: "Failed to update support plan" });
    }

    return res.status(200).json({ ok: true, message: "План поддержки обновлён" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Error updating support plan" });
  }
}
