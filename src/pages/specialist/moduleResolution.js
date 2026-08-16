// Pure helpers for specialist module resolution.
// Extracted from SpecialistCabinet.jsx for testability.

const VALID_MODULES = ["support", "body"];

/**
 * Normalize allowed_modules from expert data.
 * Returns deduplicated array of valid modules, or empty array if invalid.
 */
export function normalizeAllowedModules(raw) {
  if (!Array.isArray(raw)) return [];
  const normalized = raw.filter((m) => VALID_MODULES.includes(m));
  return [...new Set(normalized)];
}

/**
 * Resolve the active module given stored module and allowed modules.
 * Returns the first permitted module if stored module is not allowed.
 * Returns "support" as final fallback if no modules are permitted.
 */
export function resolveModule(storedModule, allowedModules) {
  if (allowedModules.includes(storedModule)) return storedModule;
  return allowedModules[0] || "support";
}

/**
 * Check if a module selection is permitted.
 */
export function isModuleAllowed(module, allowedModules) {
  return allowedModules.includes(module);
}

/**
 * Get display label for a module.
 */
export function getModuleLabel(module) {
  if (module === "body") return "Здоровье & Стройность";
  return "Точка Опоры";
}
