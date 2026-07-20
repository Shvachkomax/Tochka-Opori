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

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
    return true;
  }
  return false;
}

export function handleOptions(req, res) {
  if (req.method !== "OPTIONS") return false;
  applyCors(req, res);
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
