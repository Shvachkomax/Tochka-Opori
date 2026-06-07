import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      crisis_text,
      contact,
      public_code,
      session_id,
      high_risk_detected,
      risk_markers,
      json_data,
    } = req.body || {};

    const text = String(crisis_text || "").trim();
    const contactStr = String(contact || "").trim();

    if (!text && !contactStr) {
      return res.status(400).json({
        ok: false,
        error: "Заполните описание ситуации или укажите контакт для связи.",
      });
    }

    if (text.length > 10000) {
      return res.status(400).json({ ok: false, error: "Текст слишком длинный (макс. 10 000 символов)." });
    }

    if (contactStr.length > 300) {
      return res.status(400).json({ ok: false, error: "Контакт слишком длинный (макс. 300 символов)." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars",
        hasUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(serviceKey),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const environment =
      process.env.VERCEL_ENV === "production"
        ? "production"
        : process.env.VERCEL_ENV === "preview"
          ? "staging"
          : "local";

    const { data, error } = await supabase.from("crisis_requests").insert({
      status: "new",
      priority: "urgent",
      crisis_text: text || null,
      contact: contactStr || null,
      source: "crisis_button",
      environment,
      public_code: public_code || null,
      session_id: session_id || null,
      high_risk_detected: Boolean(high_risk_detected),
      risk_markers: risk_markers || null,
      json_data: json_data || null,
    }).select("id").single();

    if (error) {
      console.error("save-crisis-request supabase error", {
        message: error.message,
        details: error.details,
        code: error.code,
      });
      return res.status(500).json({
        ok: false,
        error: "Failed to save crisis request",
        details: error.message,
      });
    }

    return res.status(200).json({
      ok: true,
      request_id: data.id,
    });
  } catch (error) {
    console.error("save-crisis-request fatal error", {
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      ok: false,
      error: "Fatal save-crisis-request error",
      details: error?.message || String(error),
    });
  }
}
