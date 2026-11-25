import {
  fingerprintServerCredential,
  inspectSupabaseServerCredential,
} from "./runtime-isolation.js";
import { TRUSTED_SUPABASE_PROJECTS } from "./runtime-database-policy.js";

export const SUPABASE_KEY_ATTESTATION_ENDPOINTS = Object.freeze(
  Object.fromEntries(Object.entries(TRUSTED_SUPABASE_PROJECTS).map(([target, project]) => [
    target,
    `${project.url}/rest/v1/`,
  ])),
);

// The operator command is deliberately test-only. Production attestation, if
// approved later, must call the library with an explicit trusted target.
export const SUPABASE_KEY_ATTESTATION_ENDPOINT = SUPABASE_KEY_ATTESTATION_ENDPOINTS.test;

function blocked(keyType, status) {
  return Object.freeze({
    keyType,
    status,
    fingerprint: null,
    passed: false,
  });
}

function classifyKey(key) {
  if (!key) return "UNKNOWN";
  if (key.startsWith("sb_secret_")) return "sb_secret";
  if (key.split(".").length === 3) return "Legacy JWT";
  return "UNKNOWN";
}

function preflightStatus(error) {
  const message = String(error?.message || "");
  if (message.includes("missing")) return "BLOCKED_KEY_MISSING";
  if (message.includes("header")) return "BLOCKED_JWT_HEADER";
  if (message.includes("project or role")) return "BLOCKED_PROJECT_OR_ROLE";
  return "BLOCKED_KEY_FORMAT";
}

/**
 * Attests a candidate server key only against a source-controlled Supabase
 * project root. The response body is never consumed, saved, or returned.
 */
export async function attestSupabaseServiceRoleKey(rawKey, dependencies = {}) {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const keyType = classifyKey(key);
  const target = dependencies.target || "test";
  const project = TRUSTED_SUPABASE_PROJECTS[target];
  const trustedEndpoint = SUPABASE_KEY_ATTESTATION_ENDPOINTS[target];
  if (!project || !trustedEndpoint) return blocked(keyType, "BLOCKED_TARGET");

  let inspected;
  try {
    inspected = inspectSupabaseServerCredential(key, project.projectRef);
  } catch (error) {
    return blocked(keyType, preflightStatus(error));
  }

  const endpoint = dependencies.endpoint || trustedEndpoint;
  if (endpoint !== trustedEndpoint) {
    return blocked(keyType, "BLOCKED_ENDPOINT");
  }

  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return blocked(keyType, "BLOCKED_NETWORK_UNAVAILABLE");
  }

  const timeoutMs = Number.isFinite(dependencies.timeoutMs)
    && dependencies.timeoutMs > 0
    ? dependencies.timeoutMs
    : 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(trustedEndpoint, {
      method: "GET",
      headers: {
        Accept: "application/openapi+json",
        apikey: key,
      },
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    return blocked(
      keyType,
      controller.signal.aborted ? "BLOCKED_TIMEOUT" : "BLOCKED_NETWORK",
    );
  } finally {
    clearTimeout(timeout);
  }

  const httpStatus = Number(response?.status);
  try {
    await response?.body?.cancel?.();
  } catch {
    // Authentication is determined solely by status. The body is never read.
  }

  if (httpStatus !== 200) {
    const suffix = Number.isInteger(httpStatus) ? `_${httpStatus}` : "";
    return blocked(keyType, `BLOCKED_HTTP${suffix}`);
  }

  return Object.freeze({
    keyType: inspected.credentialKind === "legacy-service-role"
      ? "Legacy service_role JWT"
      : "sb_secret",
    status: `VERIFIED_${target.toUpperCase()}_PROJECT`,
    fingerprint: fingerprintServerCredential(key),
    passed: true,
  });
}
