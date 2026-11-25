import {
  SEC003_PREVIEW_RUNTIME,
  fingerprintServerCredential,
  inspectSupabaseServerCredential,
} from "./runtime-isolation.js";

export const SUPABASE_KEY_ATTESTATION_ENDPOINT =
  `${SEC003_PREVIEW_RUNTIME.supabaseUrl}/rest/v1/`;

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
 * Attests a candidate server key only against the source-controlled test
 * project root. The response body is deliberately never consumed or returned.
 */
export async function attestSupabaseServiceRoleKey(rawKey, dependencies = {}) {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const keyType = classifyKey(key);

  let inspected;
  try {
    inspected = inspectSupabaseServerCredential(
      key,
      SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
    );
  } catch (error) {
    return blocked(keyType, preflightStatus(error));
  }

  const endpoint = dependencies.endpoint || SUPABASE_KEY_ATTESTATION_ENDPOINT;
  if (endpoint !== SUPABASE_KEY_ATTESTATION_ENDPOINT) {
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
    response = await fetchImpl(SUPABASE_KEY_ATTESTATION_ENDPOINT, {
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
    status: "VERIFIED_TEST_PROJECT",
    fingerprint: fingerprintServerCredential(key),
    passed: true,
  });
}
