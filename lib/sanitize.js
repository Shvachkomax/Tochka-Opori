const SENSITIVE_KEYS = [
  "contact", "phone", "telephone", "tel", "mobile",
  "email", "telegram", "tg", "username",
  "address", "passport", "snils", "inn",
];

export function maskSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveData);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();

    if (SENSITIVE_KEYS.includes(keyLower) || keyLower.includes("phone") || keyLower.includes("email") || keyLower.includes("telegram") || keyLower.includes("contact")) {
      if (typeof value === "string" && value.trim()) {
        result[key] = "[redacted]";
      } else {
        result[key] = value;
      }
    } else if (typeof value === "string") {
      result[key] = maskText(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = maskSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function maskText(text) {
  if (!text || typeof text !== "string") return text;

  let masked = text;

  // Phone numbers: Russian and international formats
  masked = masked.replace(
    /(\+?7|8)?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g,
    "[phone redacted]"
  );

  // Email addresses
  masked = masked.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "[email redacted]"
  );

  // Telegram usernames
  masked = masked.replace(
    /@[a-zA-Z0-9_]{3,32}/g,
    "[telegram redacted]"
  );

  return masked;
}

export function getPrivacySafeMode() {
  return process.env.PRIVACY_SAFE_MODE !== "false";
}
