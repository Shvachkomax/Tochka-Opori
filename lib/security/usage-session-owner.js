import { isPilotSessionMatch } from "./module-availability.js";

// Resolve a usage owner only from an in-scope session. Modern sessions require
// the access token even when the caller already knows the session/public code.
export async function resolveUsageOwnerFromSession(session, accessToken, validateAccess) {
  if (!session?.session_id || !session.anonymous_owner_id) return null;
  if (!isPilotSessionMatch(session.json_data)) return null;
  if (session.legacy_access !== true) {
    if (!accessToken) return null;
    if (!(await validateAccess(session.session_id, accessToken))) return null;
  }
  return session.anonymous_owner_id;
}
