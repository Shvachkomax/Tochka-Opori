const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function part(length = 4) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

export function generateExpertCode() {
  return `EXPERT-${part(4)}-${part(4)}`;
}
