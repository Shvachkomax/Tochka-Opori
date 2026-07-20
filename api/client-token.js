import { applyCors, handleOptions, assertAllowedOrigin } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { generateClientToken } from "../lib/security/client-token.js";

const ALLOWED_MODULES = ["body", "support"];

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, prefix: "client-token:" });
  const limited = await limit(req, res);
  if (limited) return;

  try {
    const { action, module } = req.body || {};

    if (!action) {
      return res.status(400).json({ error: "Missing action (analyze|transcribe)" });
    }
    if (!ALLOWED_MODULES.includes(module)) {
      return res.status(400).json({ error: "Invalid or missing module" });
    }

    const result = generateClientToken(action, module);
    if (!result) {
      return res.status(500).json({ error: "CLIENT_API_SIGNING_SECRET not configured" });
    }

    return res.status(200).json({
      token: result.token,
      expires_at: new Date(result.expiresAt).toISOString(),
      ttl_seconds: 900,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Token generation failed" });
  }
}
