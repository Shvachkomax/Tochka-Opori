import crypto from "crypto";

const ALLOWED_ORIGINS = [
  "https://tochka-opori.online",
  "https://www.tochka-opori.online",
  "https://health.tochka-opori.online",
];

function isLocalhost(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (isLocalhost(origin)) return true;
  return false;
}

// Strict CORS: rejects non-whitelisted origins (not just omitting headers)
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Vary", "Origin");
    return true;
  }
  // Non-browser requests (curl, scripts) without Origin header are still allowed
  if (!origin) return true;
  return false;
}

export function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  const allowed = applyCors(req, res);
  if (!allowed) {
    res.status(403).json({ error: "Origin not allowed" });
    return true;
  }
  res.status(204).end();
  return true;
}

export function assertAllowedOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (isOriginAllowed(origin)) return true;
  res.status(403).json({ error: "Origin not allowed" });
  return false;
}

// Timing-safe string comparison
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Sensitive header helpers
export function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}

export function getAdminTokenFromHeader(req) {
  const auth = req.headers["x-admin-token"] || req.headers.authorization;
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return auth.trim();
}
