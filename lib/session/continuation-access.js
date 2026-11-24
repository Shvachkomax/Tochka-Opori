import { resolveSessionAccess } from "../security/access-token.js";
import { SUPPORTED_MODULES } from "./continuation-credential.js";

// Resolve the canonical owner for continuation-code regeneration. Authentication
// is bound to the requested module. Support ownership comes from the authenticated
// sessions row; Health ownership comes from body_clients and must not conflict with
// the owner recorded on the authenticated sessions row.
export async function resolveContinuationRegenerationOwner({
  sessionId,
  accessToken,
  module,
  supabase,
  resolveAccess = resolveSessionAccess,
}) {
  if (!sessionId || !accessToken || !supabase || !SUPPORTED_MODULES.includes(module)) return null;

  const session = await resolveAccess(sessionId, accessToken, {
    expectedModule: module,
    supabase,
  });
  if (!session) return null;

  if (module === "support") {
    if (!session.anonymousOwnerId) return null;
    return {
      ownerId: session.anonymousOwnerId,
      ownerType: "anonymous_case",
      module,
      sessionId: session.sessionId,
    };
  }

  const { data: bodyClient, error } = await supabase
    .from("body_clients")
    .select("session_id, anonymous_owner_id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error || !bodyClient?.anonymous_owner_id) return null;
  if (session.anonymousOwnerId && session.anonymousOwnerId !== bodyClient.anonymous_owner_id) return null;

  return {
    ownerId: bodyClient.anonymous_owner_id,
    ownerType: "anonymous_profile",
    module,
    sessionId: bodyClient.session_id,
  };
}
