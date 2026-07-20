// Session access token helper
// Stores access_token alongside session_id in localStorage

const BODY_SESSION_KEY = "body_last_session_id";
const BODY_TOKEN_KEY = "body_last_access_token";
const SUPPORT_SESSION_KEY = "support_last_session_id";
const SUPPORT_TOKEN_KEY = "support_last_access_token";

export function saveBodySession(sessionId, accessToken) {
  try {
    if (sessionId) localStorage.setItem(BODY_SESSION_KEY, sessionId);
    if (accessToken) localStorage.setItem(BODY_TOKEN_KEY, accessToken);
  } catch {}
}

export function getBodySession() {
  try {
    return {
      sessionId: localStorage.getItem(BODY_SESSION_KEY),
      accessToken: localStorage.getItem(BODY_TOKEN_KEY),
    };
  } catch {
    return { sessionId: null, accessToken: null };
  }
}

export function saveSupportSession(sessionId, accessToken) {
  try {
    if (sessionId) localStorage.setItem(SUPPORT_SESSION_KEY, sessionId);
    if (accessToken) localStorage.setItem(SUPPORT_TOKEN_KEY, accessToken);
  } catch {}
}

export function getSupportSession() {
  try {
    return {
      sessionId: localStorage.getItem(SUPPORT_SESSION_KEY),
      accessToken: localStorage.getItem(SUPPORT_TOKEN_KEY),
    };
  } catch {
    return { sessionId: null, accessToken: null };
  }
}

export function clearBodySession() {
  try {
    localStorage.removeItem(BODY_SESSION_KEY);
    localStorage.removeItem(BODY_TOKEN_KEY);
  } catch {}
}

export function clearSupportSession() {
  try {
    localStorage.removeItem(SUPPORT_SESSION_KEY);
    localStorage.removeItem(SUPPORT_TOKEN_KEY);
  } catch {}
}

// Attach access_token to a session API request body if available
export function withAccessToken(body, sessionId) {
  const bodySession = getBodySession();
  const supportSession = getSupportSession();
  // Match by sessionId first
  if (bodySession.sessionId === sessionId && bodySession.accessToken) {
    return { ...body, access_token: bodySession.accessToken };
  }
  if (supportSession.sessionId === sessionId && supportSession.accessToken) {
    return { ...body, access_token: supportSession.accessToken };
  }
  // Fallback: return any token we have
  const token = bodySession.accessToken || supportSession.accessToken;
  if (token) {
    return { ...body, access_token: token };
  }
  return body;
}
