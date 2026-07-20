import crypto from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function cryptoPart(length = 4) {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

export function generateExpertCode() {
  return `EXPERT-${cryptoPart(4)}-${cryptoPart(4)}`;
}
