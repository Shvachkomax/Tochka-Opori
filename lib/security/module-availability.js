export function isAnMedSupportOnlyDeployment({
  supportOnly = process.env.SUPPORT_ONLY || process.env.ANMED_SUPPORT_ONLY,
  brand = process.env.VITE_APP_BRAND,
} = {}) {
  return supportOnly === "true" || ["anmed", "kgmu"].includes(brand);
}

export function isAnMedSupportFeatureEnabled(module, deployment) {
  return module === "support" && isAnMedSupportOnlyDeployment(deployment);
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
