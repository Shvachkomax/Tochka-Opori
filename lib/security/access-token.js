import crypto from "crypto";
import { getSupabase } from "../supabase.js";

const TOKEN_BYTES = 32; // 256-bit token
const HASH_ALGORITHM = "sha256";

function hashToken(token) {
  return crypto.createHash(HASH_ALGORITHM).update(token).digest("hex");
}

// Generate a new access token for a session
// Returns raw token (to give to client once) and stores hash in DB
export async function generateSessionAccessToken(sessionId) {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("sessions")
      .update({
        access_token_hash: tokenHash,
        access_token_generated_at: new Date().toISOString(),
        legacy_access: false,
      })
      .eq("session_id", sessionId);

    if (error) {
      console.error("[access-token] Failed to store token hash:", error.message || error);
      return null;
    }

    return rawToken;
  } catch (err) {
    console.error("[access-token] Exception storing token hash:", err.message);
    return null;
  }
}

// Verify a session access token against stored hash
export async function validateSessionAccess(sessionId, rawToken) {
  if (!sessionId || !rawToken) return false;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .select("access_token_hash, legacy_access")
      .eq("session_id", sessionId)
      .single();

    if (error || !data) return false;

    // Legacy sessions can be accessed without token
    if (data.legacy_access === true) return true;

    // New sessions require a valid token
    if (!data.access_token_hash) return false;

    const computedHash = hashToken(rawToken);
    return crypto.timingSafeEqual(
      Buffer.from(computedHash),
      Buffer.from(data.access_token_hash)
    );
  } catch (err) {
    console.error("[access-token] Validation error:", err.message);
    return false;
  }
}
