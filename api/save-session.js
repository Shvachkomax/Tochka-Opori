import { supabase } from "../lib/supabase.js";
import { generatePublicCode } from "../lib/publicCode.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    let publicCode = body.publicCode;

    if (!publicCode) {
      publicCode = generatePublicCode();

      let attempts = 0;
      while (attempts < 5) {
        const { data: existing } = await supabase
          .from("sessions")
          .select("id")
          .eq("public_code", publicCode)
          .maybeSingle();
        if (!existing) break;
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
      json_data: body,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("sessions")
      .select("id")
      .eq("public_code", publicCode)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("sessions")
        .update(payload)
        .eq("public_code", publicCode);
    } else {
      await supabase.from("sessions").insert({ ...payload, created_at: new Date().toISOString() });
    }

    return res.status(200).json({ ok: true, publicCode });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to save session" });
  }
}
