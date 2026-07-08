import { readFileSync, existsSync } from "node:fs";
import { getModule, DEFAULT_MODULE } from "./modules.js";

/**
 * Resolve the path to a prompt file for a given module.
 * Falls back to the default module's prompt if the module-specific one doesn't exist.
 */
function resolvePromptPath(moduleId, filename) {
  const mod = getModule(moduleId);
  const candidates = [
    // Module-specific prompt (e.g., prompts/body/triage-system.md)
    new URL(`../${mod.promptsDir}${filename}`, import.meta.url),
    // Default module's prompt (e.g., prompts/support/triage-system.md)
    new URL(`../${getModule(DEFAULT_MODULE).promptsDir}${filename}`, import.meta.url),
    // Legacy paths for backward compatibility
    new URL(`../prompts/${filename}`, import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

/**
 * Read a prompt file for a given module.
 * Returns the content or null if not found.
 */
export function readPrompt(moduleId, filename) {
  const path = resolvePromptPath(moduleId, filename);
  if (!path) return null;
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read a prompt with fallback chain and legacy support.
 * Tries module-specific path first, then falls back lazily.
 */
export function readModulePrompt(moduleId, filename, fallbackContent = null) {
  const content = readPrompt(moduleId, filename);
  if (content) return content;
  // Legacy fallback — try from root prompts/
  try {
    const legacyPath = new URL(`../prompts/${filename}`, import.meta.url);
    if (existsSync(legacyPath)) {
      return readFileSync(legacyPath, "utf-8");
    }
  } catch {}
  return fallbackContent;
}

/**
 * Create symlinks at prompts/*.md → prompts/support/*.md for backward compat.
 * This is called once at module init.
 */
/**
 * Read a core prompt from prompts/core/ — shared across all modules.
 */
export function readCorePrompt(filename) {
  try {
    const path = new URL(`../prompts/core/${filename}`, import.meta.url);
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  } catch {}
  return null;
}

export function ensureLegacySymlinks() {
  // Only needed for Vercel/serverless — handled by deploy script
}
