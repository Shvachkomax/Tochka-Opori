import crypto from "node:crypto";
import { generateAccessTokenMaterial } from "../security/access-token.js";
import { generateContinuationCredential } from "./continuation-credential.js";

export const HEALTH_BOOTSTRAP_MAX_ATTEMPTS = 5;

export function generateHealthSessionId() {
  return `health_${crypto.randomBytes(16).toString("base64url")}`;
}

function isUniqueConflict(error) {
  return error?.code === "23505";
}

function firstRpcRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function createHealthBootstrap({
  supabase,
  intake,
  bmi,
  source = "self_signup",
  specialistId = null,
  specialistName = null,
  sessionJson = {},
}, dependencies = {}) {
  if (!supabase || !intake || typeof intake !== "object" || Array.isArray(intake)) {
    return { success: false, reason: "invalid_input" };
  }

  const makeSessionId = dependencies.generateSessionId || generateHealthSessionId;
  const makeOwnerId = dependencies.generateOwnerId || (() => crypto.randomUUID());
  const makeTokenMaterial = dependencies.generateAccessTokenMaterial || generateAccessTokenMaterial;
  const makeContinuationCredential = dependencies.generateContinuationCredential || generateContinuationCredential;
  const maxAttempts = dependencies.maxAttempts || HEALTH_BOOTSTRAP_MAX_ATTEMPTS;
  const answers = { ...intake };
  delete answers.session_id;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let sessionId;
    let ownerId;
    let tokenMaterial;
    let continuation;
    try {
      sessionId = makeSessionId();
      ownerId = makeOwnerId();
      tokenMaterial = makeTokenMaterial();
      continuation = makeContinuationCredential("body");
    } catch (error) {
      console.error("[health-bootstrap] credential material generation failed:", error?.message || error);
      return { success: false, reason: "credential_generation_failed" };
    }

    const { data, error } = await supabase.rpc("bootstrap_health_intake", {
      p_session_id: sessionId,
      p_owner_id: ownerId,
      p_access_token_hash: tokenMaterial.tokenHash,
      p_lookup_code: continuation.lookupCode,
      p_secret_hash: continuation.secretHash,
      p_answers: answers,
      p_bmi: bmi ?? null,
      p_source: source || "self_signup",
      p_specialist_id: specialistId || null,
      p_specialist_name: specialistName || null,
      p_display_name: intake.display_name || null,
      p_goal: intake.goal || null,
      p_session_json: sessionJson || {},
    });

    if (error) {
      if (isUniqueConflict(error) && attempt < maxAttempts) continue;
      console.error("[health-bootstrap] atomic RPC failed:", error.code || "unknown");
      return {
        success: false,
        reason: isUniqueConflict(error) ? "identifier_conflict" : "database_error",
      };
    }

    const created = firstRpcRow(data);
    if (!created
      || created.session_id !== sessionId
      || created.anonymous_owner_id !== ownerId
      || !created.intake_id
      || !created.wallet_id
      || created.access_token_hash !== tokenMaterial.tokenHash) {
      console.error("[health-bootstrap] atomic RPC returned an invalid receipt");
      return { success: false, reason: "invalid_receipt" };
    }

    return {
      success: true,
      sessionId,
      ownerId,
      intakeId: created.intake_id,
      walletId: created.wallet_id,
      accessToken: tokenMaterial.rawToken,
      continuationCode: continuation.combinedCode,
      lookupCode: continuation.lookupCode,
      attempts: attempt,
    };
  }

  return { success: false, reason: "identifier_conflict" };
}

export async function saveHealthIntakeAnalysis({
  supabase,
  intakeId,
  sessionId,
  careLevel,
  routerMeta,
}) {
  if (!supabase || !intakeId || !sessionId) return false;

  const { data, error } = await supabase
    .from("body_intake_forms")
    .update({
      care_recommendation: careLevel || null,
      provider: routerMeta?.provider || null,
      ai_model: routerMeta?.model_used || null,
      task_type: routerMeta?.task_type || null,
      router_version: routerMeta?.router_version || null,
      request_duration_ms: routerMeta?.request_duration || null,
    })
    .eq("id", intakeId)
    .eq("session_id", sessionId)
    .select("id, session_id")
    .maybeSingle();

  if (error || data?.id !== intakeId || data?.session_id !== sessionId) {
    console.error("[health-bootstrap] intake analysis update failed:", error?.code || "row_mismatch");
    return false;
  }
  return true;
}
