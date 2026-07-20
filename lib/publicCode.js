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

export function generatePublicCode() {
  return `ТОЧКА-${cryptoPart(4)}-${cryptoPart(4)}`;
}
