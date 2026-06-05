const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePublicCode() {
  const part = () =>
    Array.from({ length: 4 })
      .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
      .join("");

  return `ТОЧКА-${part()}-${part()}`;
}
