import crypto from "crypto";

const SIGNING_SECRET = process.env.CLIENT_API_SIGNING_SECRET;
const TOKEN_TTL_MS = 15 * 60 * 1000;
const ALLOWED_ACTIONS = ["analyze", "transcribe"];

export function generateClientToken(action, module) {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`Unknown action: ${action}`);
  }
  if (!module) {
    throw new Error("Module is required");
  }
  const secret = SIGNING_SECRET;
  if (!secret) {
    throw new Error("CLIENT_API_SIGNING_SECRET not configured");
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + TOKEN_TTL_MS;
  const nonce = crypto.randomBytes(12).toString("hex");

  const payload = `${action}:${module}:${issuedAt}:${expiresAt}:${nonce}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return { token: `${Buffer.from(payload).toString("base64url")}.${signature}`, expiresAt };
}

export function verifyClientToken(tokenStr) {
  const secret = SIGNING_SECRET;
  if (!secret) {
    throw new Error("CLIENT_API_SIGNING_SECRET not configured");
  }

  const dot = tokenStr.lastIndexOf(".");
  if (dot === -1) return null;

  const encoded = tokenStr.slice(0, dot);
  const signature = tokenStr.slice(dot + 1);
  const payload = Buffer.from(encoded, "base64url").toString("utf-8");

  const parts = payload.split(":");
  if (parts.length !== 5) return null;

  const [action, module, issuedAtStr, expiresAtStr, nonce] = parts;
  const issuedAt = parseInt(issuedAtStr, 10);
  const expiresAt = parseInt(expiresAtStr, 10);

  if (isNaN(issuedAt) || isNaN(expiresAt)) return null;

  // Verify expiry
  if (Date.now() > expiresAt) return null;

  // Verify HMAC
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  return { action, module, issuedAt, expiresAt, nonce };
}

// Middleware: extracts Bearer token from Authorization header and verifies
export function requireClientToken(allowedActions) {
  return function check(req, res) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "Требуется авторизация" });
      return null;
    }

    const token = auth.slice(7);
    const result = verifyClientToken(token);
    if (!result) {
      res.status(401).json({ error: "Токен недействителен или истёк" });
      return null;
    }

    if (!allowedActions.includes(result.action)) {
      res.status(403).json({ error: "Действие не разрешено" });
      return null;
    }

    return result;
  };
}
