import crypto from "crypto";
import { getSupabase } from "../supabase.js";

const TOKEN_BYTES = 32; // 256-bit token
const HASH_ALGORITHM = "sha256";

export function hashAccessToken(token) {
  return crypto.createHash(HASH_ALGORITHM).update(token).digest("hex");
}

export function accessTokenMatchesHash(rawToken, storedHash) {
  if (typeof rawToken !== "string" || !rawToken || typeof storedHash !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;

  const computed = Buffer.from(hashAccessToken(rawToken), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
}

export function generateAccessTokenMaterial() {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  return { rawToken, tokenHash: hashAccessToken(rawToken) };
}

// Generate a new access token for a session
// Returns raw token (to give to client once) and stores hash in DB.
// For body sessions that only exist in body_clients, we create the canonical
// sessions row so that validateSessionAccess() can verify the token.
export async function generateSessionAccessToken(sessionId, {
  module,
  anonymousOwnerId,
  publicCode,
  supabase: providedSupabase,
} = {}) {
  if (!sessionId
    || !["support", "body"].includes(module)
    || typeof anonymousOwnerId !== "string"
    || !anonymousOwnerId) return null;

  const { rawToken, tokenHash } = generateAccessTokenMaterial();

  try {
    const supabase = providedSupabase || getSupabase();
    const { data: existing, error: lookupError } = await supabase
      .from("sessions")
      .select("session_id, module, anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (lookupError) {
      console.error("[access-token] Failed to resolve canonical session:", lookupError.code || lookupError.message);
      return null;
    }

    if (existing) {
      if (existing.module !== module || existing.anonymous_owner_id !== anonymousOwnerId) {
        console.error("[access-token] Canonical session scope mismatch");
        return null;
      }

      const { data: updated, error } = await supabase
        .from("sessions")
        .update({
          access_token_hash: tokenHash,
          access_token_generated_at: new Date().toISOString(),
          legacy_access: false,
        })
        .eq("session_id", sessionId)
        .eq("module", module)
        .eq("anonymous_owner_id", anonymousOwnerId)
        .select("session_id, module, anonymous_owner_id, access_token_hash")
        .maybeSingle();

      if (error || !updated
        || updated.session_id !== sessionId
        || updated.module !== module
        || updated.anonymous_owner_id !== anonymousOwnerId
        || updated.access_token_hash !== tokenHash) {
        console.error("[access-token] Failed to store token hash:", error?.code || error?.message || "row_mismatch");
        return null;
      }
      return rawToken;
    }

    // A missing sessions row is recoverable only for an already existing Health
    // profile whose canonical owner exactly matches the proven continuation
    // credential. A unique conflict is a hard failure; never update that row.
    if (module !== "body"
      || typeof publicCode !== "string"
      || !/^HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(publicCode)) {
      console.error("[access-token] Missing canonical session cannot be created for this scope");
      return null;
    }

    const { data: bodyClient, error: bodyClientError } = await supabase
      .from("body_clients")
      .select("session_id, anonymous_owner_id")
      .eq("session_id", sessionId)
      .eq("anonymous_owner_id", anonymousOwnerId)
      .maybeSingle();
    if (bodyClientError
      || !bodyClient
      || bodyClient.session_id !== sessionId
      || bodyClient.anonymous_owner_id !== anonymousOwnerId) {
      console.error("[access-token] Health canonical owner verification failed");
      return null;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("sessions")
      .insert({
        session_id: sessionId,
        module: "body",
        anonymous_owner_id: anonymousOwnerId,
        public_code: publicCode,
        patient_text: "",
        conversation_history: [],
        json_data: {},
        access_token_hash: tokenHash,
        access_token_generated_at: new Date().toISOString(),
        legacy_access: false,
      })
      .select("session_id, module, anonymous_owner_id, access_token_hash")
      .single();

    if (insertError
      || !inserted
      || inserted.session_id !== sessionId
      || inserted.module !== "body"
      || inserted.anonymous_owner_id !== anonymousOwnerId
      || inserted.access_token_hash !== tokenHash) {
      console.error("[access-token] Failed to insert canonical Health session:", insertError?.code || insertError?.message || "row_mismatch");
      return null;
    }
    return rawToken;
  } catch (err) {
    console.error("[access-token] Exception storing token hash:", err.message);
    return null;
  }
}

// Resolve a session only after verifying the exact token hash. The historical
// legacy_access flag is metadata, not proof of possession, and never bypasses
// token verification.
export async function resolveSessionAccess(sessionId, rawToken, options = {}) {
  if (!sessionId || !rawToken) return null;

  const { expectedModule = null, supabase: providedSupabase = null } = options;
  if (expectedModule && !["support", "body"].includes(expectedModule)) return null;

  try {
    const supabase = providedSupabase || getSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .select("session_id, module, anonymous_owner_id, access_token_hash, legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error || !data || !data.access_token_hash) return null;
    if (expectedModule && data.module !== expectedModule) return null;
    if (!accessTokenMatchesHash(rawToken, data.access_token_hash)) return null;

    return {
      sessionId: data.session_id,
      module: data.module,
      anonymousOwnerId: data.anonymous_owner_id || null,
      legacyAccess: data.legacy_access === true,
    };
  } catch (err) {
    console.error("[access-token] Validation error:", err.message);
    return null;
  }
}

// Verify a session access token against the stored hash. Legacy sessions with
// a valid stored hash remain usable; arbitrary or missing tokens fail closed.
export async function validateSessionAccess(sessionId, rawToken, options = {}) {
  return !!(await resolveSessionAccess(sessionId, rawToken, options));
}
