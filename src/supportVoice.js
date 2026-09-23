export function appendVoiceText(existing, transcript) {
  const addition = (transcript || "").trim();
  if (!addition) return existing || "";
  const current = existing || "";
  if (!current) return addition;
  if (/\s$/.test(current)) return `${current}${addition}`;
  if (/[.!?,;:…]$/.test(current)) return `${current} ${addition}`;
  return `${current}\n${addition}`;
}
