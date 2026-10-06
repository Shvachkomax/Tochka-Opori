// Session access credential helper.
// session_id + access_token form ONE credential pair: they are stored
// atomically under a single key, read strictly together and are never
// mixed across sessions or modules. A partial or stale pair is never
// created; unrecoverable legacy state is cleared so the user re-enters
// the continuation code instead of sending a wrong token.

const BODY_PAIR_KEY = "body_session_pair";
const BODY_SESSION_KEY = "body_last_session_id";
const BODY_TOKEN_KEY = "body_last_access_token";
const BODY_RESULT_KEY = "body_last_result";
const SUPPORT_PAIR_KEY = "support_session_pair";
const SUPPORT_SESSION_KEY = "support_last_session_id";
const SUPPORT_TOKEN_KEY = "support_last_access_token";

function isValidPair(pair) {
  return !!pair
    && typeof pair.sessionId === "string" && pair.sessionId.trim() !== ""
    && typeof pair.accessToken === "string" && pair.accessToken.trim() !== "";
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePairKey(key, sessionId, accessToken) {
  try {
    localStorage.setItem(key, JSON.stringify({ sessionId, accessToken }));
    return true;
  } catch {
    return false;
  }
}

function clearBodyKeys() {
  try {
    localStorage.removeItem(BODY_PAIR_KEY);
    localStorage.removeItem(BODY_SESSION_KEY);
    localStorage.removeItem(BODY_TOKEN_KEY);
  } catch {}
}

function clearSupportKeys() {
  try {
    localStorage.removeItem(SUPPORT_PAIR_KEY);
    localStorage.removeItem(SUPPORT_SESSION_KEY);
    localStorage.removeItem(SUPPORT_TOKEN_KEY);
  } catch {}
}

function removeLegacyBodyKeys() {
  try {
    localStorage.removeItem(BODY_SESSION_KEY);
    localStorage.removeItem(BODY_TOKEN_KEY);
  } catch {}
}

function removeLegacySupportKeys() {
  try {
    localStorage.removeItem(SUPPORT_SESSION_KEY);
    localStorage.removeItem(SUPPORT_TOKEN_KEY);
  } catch {}
}

// Atomic pair save: both values are written together or nothing changes.
// A successful write replaces the pair and drops legacy keys; a failed
// write leaves the previous consistent pair untouched; a partial call
// (missing session_id or token) clears the pair so a new session can
// never end up next to an older token.
export function saveBodySession(sessionId, accessToken) {
  if (sessionId && accessToken) {
    if (writePairKey(BODY_PAIR_KEY, sessionId, accessToken)) {
      removeLegacyBodyKeys();
    }
    return;
  }
  clearBodyKeys();
}

export function saveSupportSession(sessionId, accessToken) {
  if (sessionId && accessToken) {
    if (writePairKey(SUPPORT_PAIR_KEY, sessionId, accessToken)) {
      removeLegacySupportKeys();
    }
    return;
  }
  clearSupportKeys();
}

// Legacy body recovery is accepted ONLY when body_last_result confirms
// that this exact session_id and access_token were issued together.
// Both legacy keys being present is not enough: a poisoned pair can be
// exactly "new session_id + previous session's token". Unverifiable or
// mismatching legacy state is cleared (fail closed, re-login by code).
function recoverLegacyBodyPair() {
  const legacySessionId = localStorage.getItem(BODY_SESSION_KEY);
  const legacyToken = localStorage.getItem(BODY_TOKEN_KEY);
  if (legacySessionId && legacyToken) {
    const result = readJson(BODY_RESULT_KEY);
    if (result && result.session_id === legacySessionId && result.access_token === legacyToken) {
      return { sessionId: legacySessionId, accessToken: legacyToken };
    }
  }
  return null;
}

// Support legacy recovery: support has no independent verification
// record like body_last_result. Support callers always wrote both keys
// together, so a complete legacy pair is migrated as-is; server-side
// validateSessionAccess remains the security boundary. A partial legacy
// state is cleared.
function recoverLegacySupportPair() {
  const legacySessionId = localStorage.getItem(SUPPORT_SESSION_KEY);
  const legacyToken = localStorage.getItem(SUPPORT_TOKEN_KEY);
  if (legacySessionId && legacyToken) {
    return { sessionId: legacySessionId, accessToken: legacyToken };
  }
  return null;
}

function readPair(pairKey, recoverLegacy, clearKeys, removeLegacyKeys) {
  const pair = readJson(pairKey);
  if (isValidPair(pair)) {
    return { sessionId: pair.sessionId, accessToken: pair.accessToken };
  }
  const legacy = recoverLegacy();
  if (legacy && writePairKey(pairKey, legacy.sessionId, legacy.accessToken)) {
    removeLegacyKeys();
    return legacy;
  }
  clearKeys();
  return { sessionId: null, accessToken: null };
}

export function getBodySession() {
  try {
    return readPair(BODY_PAIR_KEY, recoverLegacyBodyPair, clearBodyKeys, removeLegacyBodyKeys);
  } catch {
    return { sessionId: null, accessToken: null };
  }
}

export function getSupportSession() {
  try {
    return readPair(SUPPORT_PAIR_KEY, recoverLegacySupportPair, clearSupportKeys, removeLegacySupportKeys);
  } catch {
    return { sessionId: null, accessToken: null };
  }
}

export function clearBodySession() {
  clearBodyKeys();
}

export function clearSupportSession() {
  clearSupportKeys();
}

// Attach the access_token to a session API request body only when the
// stored credential pair belongs to this exact session. The token of a
// different session or module is never used as a fallback.
export function withAccessToken(body, sessionId) {
  const bodySession = getBodySession();
  if (bodySession.sessionId === sessionId && bodySession.accessToken) {
    return { ...body, access_token: bodySession.accessToken };
  }
  const supportSession = getSupportSession();
  if (supportSession.sessionId === sessionId && supportSession.accessToken) {
    return { ...body, access_token: supportSession.accessToken };
  }
  return body;
}
