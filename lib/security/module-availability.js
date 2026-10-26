export function isAnMedSupportOnlyDeployment({
  supportOnly = process.env.SUPPORT_ONLY || process.env.ANMED_SUPPORT_ONLY,
  brand = process.env.VITE_APP_BRAND,
} = {}) {
  return supportOnly === "true" || ["anmed", "kgmu", "pneumointegration"].includes(brand);
}

export function isAnMedSupportFeatureEnabled(module, deployment) {
  const brand = deployment?.brand ?? process.env.VITE_APP_BRAND;
  return module === "support"
    && brand !== "pneumointegration"
    && isAnMedSupportOnlyDeployment(deployment);
}

export function isSupportOnlyPilot(deployment) {
  return isAnMedSupportOnlyDeployment(deployment);
}

export function getPilotId() {
  const brand = process.env.VITE_APP_BRAND;
  return process.env.PILOT_ID || (["anmed", "kgmu", "pneumointegration"].includes(brand) ? brand : null);
}

// A tagged session must not be opened through an unconfigured/default host.
export function isPilotSessionMatch(sessionJsonData) {
  const serverPilot = getPilotId();
  const sessionPilot = sessionJsonData?.pilot_id || null;
  if (!serverPilot) return !sessionPilot;
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
