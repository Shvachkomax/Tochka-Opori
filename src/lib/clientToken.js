// Client token helper for /api/analyze and /api/transcribe
// Manages short-lived HMAC-signed tokens with caching

const STORAGE_PREFIX = "ct_";

function getCached(action, module) {
  try {
    const key = `${STORAGE_PREFIX}${action}:${module}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() >= parsed.expires_at - 30000) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function setCached(action, module, token, expiresAt) {
  try {
    const key = `${STORAGE_PREFIX}${action}:${module}`;
    localStorage.setItem(key, JSON.stringify({ token, expires_at: new Date(expiresAt).getTime() }));
  } catch {
    // storage full or blocked — ignore
  }
}

async function fetchToken(action, module) {
  const res = await fetch("/api/client-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, module }),
  });
  if (!res.ok) {
    throw new Error("Не удалось получить токен доступа");
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("Пустой токен");
  }
  setCached(action, module, data.token, data.expires_at);
  return data.token;
}

export async function getClientToken(module, purpose) {
  const cached = getCached(purpose, module);
  if (cached) return cached;
  return await fetchToken(purpose, module);
}

export async function withClientToken(module, purpose, fetchOptions = {}) {
  let token;
  try {
    token = await getClientToken(module, purpose);
    console.log("[clientToken] token obtained", { module, purpose, type: typeof token, prefix: String(token).slice(0, 10) });
  } catch (e) {
    console.error("[clientToken] token failed", { module, purpose, error: e.message });
    return { ok: false, error: "Не удалось получить токен доступа. Обновите страницу и попробуйте ещё раз." };
  }

  const headers = {
    ...fetchOptions.headers,
    "Authorization": `Bearer ${token}`,
  };

  return { ...fetchOptions, headers, _tokenRetried: false };
}

// Wrapper around fetch that auto-retries with a fresh token on 401
export async function fetchWithClientToken(url, module, purpose, options = {}) {
  const enhanced = await withClientToken(module, purpose, options);
  if (!enhanced.ok) return enhanced;

  let res = await fetch(url, enhanced);
  if (res.status === 401 && !enhanced._tokenRetried) {
    // Clear stale cache and retry once
    try {
      const key = `${STORAGE_PREFIX}${purpose}:${module}`;
      localStorage.removeItem(key);
    } catch {}
    const token = await fetchToken(purpose, module);
    const retryHeaders = {
      ...options.headers,
      "Authorization": `Bearer ${token}`,
    };
    res = await fetch(url, { ...options, headers: retryHeaders });
  }
  return res;
}
