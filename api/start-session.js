import crypto from "node:crypto";
import { getSupabase } from "../lib/supabase.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { requireClientToken } from "../lib/security/client-token.js";

function generateSessionId() {
  return "sess_" + crypto.randomBytes(16).toString("base64url").slice(0, 32);
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const tokenCheck = requireClientToken(["analyze"])(req, res);
  if (!tokenCheck) return;

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, prefix: "start-session:" });
  const limited = await limit(req, res);
  if (limited) return;

  try {
    const supabase = getSupabase();
    const sessionId = generateSessionId();
    const anonymousOwnerId = crypto.randomUUID();

    const { ensureWallet } = await import("../lib/usage/wallet.js");
    const wallet = await ensureWallet({
      ownerType: "anonymous_case",
      ownerId: anonymousOwnerId,
      module: "support",
    });

    const { error: insertError } = await supabase.from("sessions").insert({
      session_id: sessionId,
      module: "support",
      anonymous_owner_id: anonymousOwnerId,
      public_code: null,
      patient_text: "",
      conversation_history: [],
      json_data: { dialogDepth: 0 },
      legacy_access: false,
    });

    if (insertError) {
      console.error("start-session INSERT error:", insertError.message);
      return res.status(500).json({ ok: false, error: "Не удалось создать сессию. Попробуйте позже." });
    }

    const { generateSessionAccessToken } = await import("../lib/security/access-token.js");
    const accessToken = await generateSessionAccessToken(sessionId);

    return res.status(200).json({
      ok: true,
      session_id: sessionId,
      access_token: accessToken,
    });
  } catch (error) {
    console.error("start-session error:", error.message);
    return res.status(500).json({ ok: false, error: "Внутренняя ошибка сервера" });
  }
}
