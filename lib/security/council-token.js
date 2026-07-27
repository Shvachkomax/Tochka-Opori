import crypto from "crypto";

const TOKEN_BYTES = 32; // 256-bit token
const HASH_ALGORITHM = "sha256";

export function hashToken(raw) {
  return crypto.createHash(HASH_ALGORITHM).update(raw).digest("hex");
}

// --- Invite token ---

export function generateInviteToken() {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const hash = hashToken(raw);
  const inviteCode = generateInviteCode();
  return { raw, hash, inviteCode };
}

function generateInviteCode() {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "COUNCIL-";
  for (let i = 0; i < 4; i++) code += charset[Math.floor(Math.random() * charset.length)];
  code += "-";
  for (let i = 0; i < 3; i++) code += charset[Math.floor(Math.random() * charset.length)];
  return code;
}

// --- Expert access token ---

export function generateExpertAccessToken() {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const hash = hashToken(raw);
  return { raw, hash };
}

export function validateExpertAccess(raw, storedHash) {
  if (!raw || !storedHash) return false;
  try {
    const computed = hashToken(raw);
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
  } catch {
    return false;
  }
}
