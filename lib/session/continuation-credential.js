// Anonymous Continuation Credential Pass
// Cross-device access credentials for support/health canonical owners.
// The user-visible value is one combined continuation code.
// Internally it has a lookup part (public identifier) and a secret part (bearer proof).

import crypto from "crypto";
import { generatePublicCode } from "../publicCode.js";

// No ambiguous characters: I, O, L, 0, 1 excluded.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SECRET_LENGTH = 12; // raw chars, formatted as XXXX-XXXX-XXXX
const PEPPER_ENV = "CONTINUATION_SECRET_PEPPER";

export const SUPPORTED_MODULES = ["support", "body"];
export const MODULE_OWNER_TYPES = {
  support: "anonymous_case",
  body: "anonymous_profile",
};

export class ContinuationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContinuationConfigError";
  }
}

function getPepper() {
  const pepper = process.env[PEPPER_ENV];
  if (!pepper) {
    throw new ContinuationConfigError("Server configuration error: continuation secret pepper missing");
  }
  return pepper;
}

function randomSecretString(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateContinuationSecret() {
  const raw = randomSecretString(SECRET_LENGTH);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function hashContinuationSecret(secret) {
  const pepper = getPepper();
  return crypto.createHmac("sha256", pepper).update(secret.toUpperCase()).digest("hex");
}

export function verifyContinuationSecret(secret, storedHash) {
  if (!secret || !storedHash) return false;
  const computed = hashContinuationSecret(secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

export function generateLookupCode(module) {
  if (module === "body") {
    const p1 = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 4);
    const p2 = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 3);
    return `HEALTH-${p1}-${p2}`;
  }
  return generatePublicCode();
}

export function formatContinuationCredential(module, lookupCode, secret) {
  return `${lookupCode}-${secret}`;
}

export function normalizeContinuationCredential(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseContinuationCredential(value) {
  const normalized = normalizeContinuationCredential(value);
  if (!normalized) return null;

  // Support: ТОЧКА-XXXX-XXXX-XXXX-XXXX-XXXX
  const supportMatch = normalized.match(/^(ТОЧКА-[A-Z0-9]{4}-[A-Z0-9]{4})-([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/);
  if (supportMatch) {
    return { module: "support", lookupCode: supportMatch[1], secret: supportMatch[2] };
  }

  // Body: HEALTH-XXXX-XXX-XXXX-XXXX-XXXX
  const bodyMatch = normalized.match(/^(HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3})-([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/);
  if (bodyMatch) {
    return { module: "body", lookupCode: bodyMatch[1], secret: bodyMatch[2] };
  }

  return null;
}

export function isLegacyShortCode(value) {
  const normalized = normalizeContinuationCredential(value);
  if (!normalized) return false;
  return /^(ТОЧКА-[A-Z0-9]{4}-[A-Z0-9]{4})$/.test(normalized) ||
         /^(HEALTH-[A-Z0-9]{4}-[A-Z0-9]{3})$/.test(normalized);
}

export function validateModuleOwnerType(module, ownerType) {
  return MODULE_OWNER_TYPES[module] === ownerType;
}

export function getOwnerType(module) {
  return MODULE_OWNER_TYPES[module];
}

export function getContinuationAttemptKey(clientIp, lookupCode) {
  const pepper = getPepper();
  const lookupHash = crypto.createHmac("sha256", pepper).update(lookupCode.toUpperCase()).digest("hex");
  return crypto.createHash("sha256").update(`${clientIp}:${lookupHash}`).digest("hex");
}

export function generateContinuationCredential(module) {
  if (!SUPPORTED_MODULES.includes(module)) {
    throw new Error(`Unsupported module for continuation credential: ${module}`);
  }
  const lookupCode = generateLookupCode(module);
  const secret = generateContinuationSecret();
  return {
    module,
    lookupCode,
    secret,
    combinedCode: formatContinuationCredential(module, lookupCode, secret),
    secretHash: hashContinuationSecret(secret),
  };
}
