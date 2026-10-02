const SUPPORT_ONLY_BRANDS = new Set(["anmed", "pneumointegration"]);

export function isAnMedSupportOnlyDeployment({
  supportOnly = process.env.ANMED_SUPPORT_ONLY,
  brand = process.env.VITE_APP_BRAND,
} = {}) {
  return supportOnly === "true" || SUPPORT_ONLY_BRANDS.has(brand);
}

export function isSupportOnlyPilot(deployment) {
  return isAnMedSupportOnlyDeployment(deployment);
}

export function getPilotId() {
  return process.env.PILOT_ID || process.env.VITE_APP_BRAND || null;
}

export function isPilotSessionMatch(sessionJsonData) {
  const serverPilot = getPilotId();
  if (!serverPilot) return true;
  const sessionPilot = sessionJsonData?.pilot_id;
  if (!sessionPilot) return true;
  return sessionPilot === serverPilot;
}

export function isModuleAvailable(module, deployment) {
  return !(isAnMedSupportOnlyDeployment(deployment) && module === "body");
}

export function hasBodySessionReference(payload = {}) {
  return Object.entries(payload).some(([key, value]) => (
    /session|public|continuation|code/i.test(key)
    && typeof value === "string"
    && /^HEALTH-/i.test(value)
  ));
}

export function rejectUnavailableModule(res, module, deployment) {
  if (isModuleAvailable(module, deployment)) return false;
  res.status(403).json({ ok: false, error: "Модуль недоступен в этой сборке" });
  return true;
}
