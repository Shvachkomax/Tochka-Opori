// Anonymous Continuation Credential storage helpers.
// Used by api/session.js and api/analyze.js to create/rotate credentials.

import {
  generateContinuationCredential,
  getOwnerType,
  ContinuationConfigError,
} from "./continuation-credential.js";

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
  const { lookupCode, secret, secretHash } = generateContinuationCredential(module);

  // Fetch current version to increment it atomically.
  const { data: existing } = await supabase
    .from("continuation_credentials")
    .select("secret_version")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .maybeSingle();

  const nextVersion = (existing?.secret_version || 0) + 1;

  const { data: upserted, error: upsertError } = await supabase
    .from("continuation_credentials")
    .upsert({
      module,
      owner_type: ownerType,
      owner_id: ownerId,
      lookup_code: lookupCode,
      secret_hash: secretHash,
      secret_version: nextVersion,
      rotated_at: new Date().toISOString(),
      revoked_at: null,
    }, {
      onConflict: "owner_type,owner_id",
    })
    .select("lookup_code")
    .single();

  if (upsertError || !upserted) {
    console.error("rotateContinuationCredential upsert error", upsertError);
    throw new Error("Failed to rotate continuation credential");
  }

  return { lookupCode: upserted.lookup_code, secret, combinedCode: `${upserted.lookup_code}-${secret}`, secretVersion: nextVersion };
}

export { ContinuationConfigError };
