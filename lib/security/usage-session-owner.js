import { isPilotSessionMatch } from "./module-availability.js";

// Kept for the existing session-owner tests and other callers. Usage history
// rejects legacy sessions as well as modern sessions without valid token proof.
export async function resolveUsageOwnerFromSession(session, accessToken, validateAccess) {
  if (!session?.session_id || !session.anonymous_owner_id) return null;
  if (!isPilotSessionMatch(session.json_data)) return null;
  if (session.legacy_access === true || !accessToken) return null;
  if (!(await validateAccess(session.session_id, accessToken))) return null;
  return session.anonymous_owner_id;
}

// Usage history is private to a token-authenticated canonical session. A public
// continuation lookup code is not a bearer credential for financial history.
export async function resolveUsageOwner({
  sessionId,
  module,
  accessToken,
  findSession,
  findBodyClient,
  validateAccess,
}) {
  if (!sessionId || !accessToken || !["support", "body"].includes(module)) return null;
  if (typeof findSession !== "function" || typeof validateAccess !== "function") return null;

  let session;
  try {
    session = await findSession(sessionId, module);
  } catch {
    return null;
  }
  if (!session?.session_id || !session.anonymous_owner_id) return null;
  if (!["support", "body"].includes(module) || session.module !== module) return null;
  if (session.legacy_access === true || !accessToken || typeof validateAccess !== "function") return null;
  if (!isPilotSessionMatch(session.json_data)) return null;

  if (module === "body") {
    if (typeof findBodyClient !== "function") return null;
    let bodyClient;
    try {
      bodyClient = await findBodyClient(session.session_id);
    } catch {
      return null;
    }
    if (
      bodyClient?.session_id !== session.session_id
      || bodyClient?.anonymous_owner_id !== session.anonymous_owner_id
    ) return null;
  }

  if (!(await validateAccess(session.session_id, accessToken, session))) return null;

  return {
    ownerId: session.anonymous_owner_id,
    ownerType: module === "support" ? "anonymous_case" : "anonymous_profile",
    module,
    sessionId: session.session_id,
  };
}
