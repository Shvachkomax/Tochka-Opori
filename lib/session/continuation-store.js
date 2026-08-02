// Anonymous Continuation Credential storage helpers.
// Used by api/session.js and api/analyze.js to create/rotate credentials.

import crypto from "crypto";
import {
  generateContinuationCredential,
  getOwnerType,
  ContinuationConfigError,
} from "./continuation-credential.js";

// Privacy-safe fingerprint: sha256(value).slice(0, 12)
export function fingerprint(value) {
  if (!value) return "none";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

export async function getOrCreateContinuationCredential({ module, ownerId, supabase }) {
  const ownerType = getOwnerType(module);

  const { data: existing } = await supabase
    .from("continuation_credentials")
    .select("id, module, owner_type, owner_id, lookup_code, secret_hash, secret_version, created_at, rotated_at, revoked_at")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existing) {
    return { credential: existing, secret: null, isNew: false };
  }

  const { lookupCode, secret, combinedCode, secretHash } = generateContinuationCredential(module);

  const { data: inserted, error } = await supabase
    .from("continuation_credentials")
    .insert({
      module,
      owner_type: ownerType,
      owner_id: ownerId,
      lookup_code: lookupCode,
      secret_hash: secretHash,
      secret_version: 1,
      created_at: new Date().toISOString(),
    })
    .select("id, module, owner_type, owner_id, lookup_code, secret_hash, secret_version, created_at, rotated_at, revoked_at")
    .single();

  if (error) {
    console.error("getOrCreateContinuationCredential insert error", error);
    throw new Error("Failed to create continuation credential");
  }

  return { credential: inserted, secret, isNew: true, combinedCode };
}

export async function rotateContinuationCredential({ module, ownerId, supabase }) {
  const ownerType = getOwnerType(module);

  // 1. Find the single existing credential by owner — require exactly one.
  const { data: existing, error: findError } = await supabase
    .from("continuation_credentials")
    .select("id, lookup_code, secret_version, revoked_at")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (findError) {
    console.error("[rotate] credential lookup error:", findError.code, "module:", module);
    throw new Error("Failed to lookup credential");
  }

  if (!existing || existing.length === 0) {
    console.error("[rotate] no credential found for owner, module:", module);
    throw new Error("Credential not found");
  }

  if (existing.length > 1) {
    // Security: multiple credentials for same owner — rotation forbidden until cleanup.
    const ids = existing.map(c => c.id).join(",");
    console.error("[rotate] SECURITY: multiple credentials for owner, module:", module, "count:", existing.length, "ids_hash:", fingerprint(ids));
    throw new Error("Security error: multiple credentials detected. Contact support.");
  }

  const credential = existing[0];
  const oldLookup = credential.lookup_code;
  const oldVersion = credential.secret_version || 0;

  // 2. Generate new lookup/secret/hash.
  const { lookupCode: newLookup, secret, secretHash: newHash } = generateContinuationCredential(module);
  const now = new Date().toISOString();

  // 3. Update the existing credential by ID — explicit update, not upsert.
  const { data: updated, error: updateError } = await supabase
    .from("continuation_credentials")
    .update({
      lookup_code: newLookup,
      secret_hash: newHash,
      secret_version: oldVersion + 1,
      rotated_at: now,
      revoked_at: null,
    })
    .eq("id", credential.id)
    .select("id, lookup_code, secret_version")
    .single();

  if (updateError || !updated) {
    console.error("[rotate] update error:", updateError?.code, "module:", module);
    throw new Error("Failed to rotate credential");
  }

  // 4. Verify update integrity.
  if (updated.id !== credential.id) {
    console.error("[rotate] SECURITY: updated row id mismatch");
    throw new Error("Rotation verification failed");
  }
  if (updated.lookup_code !== newLookup) {
    console.error("[rotate] lookup_code mismatch after update");
    throw new Error("Rotation verification failed");
  }
  if (updated.secret_version !== oldVersion + 1) {
    console.error("[rotate] secret_version mismatch after update");
    throw new Error("Rotation verification failed");
  }

  // 5. Verify old lookup is gone and new lookup exists.
  const { data: oldCheck } = await supabase
    .from("continuation_credentials")
    .select("id")
    .eq("lookup_code", oldLookup)
    .maybeSingle();

  const { data: newCheck } = await supabase
    .from("continuation_credentials")
    .select("id")
    .eq("lookup_code", newLookup)
    .maybeSingle();

  if (oldCheck) {
    console.error("[rotate] SECURITY: old lookup_code still exists after rotation");
    // Don't fail — the old row was updated in place, so this shouldn't happen.
    // If it does, it means a race condition or data drift.
  }
  if (!newCheck) {
    console.error("[rotate] new lookup_code not found after rotation");
    throw new Error("Rotation verification failed: new credential missing");
  }

  return {
    lookupCode: newLookup,
    secret,
    combinedCode: `${newLookup}-${secret}`,
    secretVersion: oldVersion + 1,
    oldLookupFingerprint: fingerprint(oldLookup),
    newLookupFingerprint: fingerprint(newLookup),
    credentialIdFingerprint: fingerprint(credential.id),
  };
}

export { ContinuationConfigError };
