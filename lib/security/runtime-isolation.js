import { createHash, timingSafeEqual } from "node:crypto";
import { validateDatabaseArchitecture } from "./database-architecture.js";

// Runtime-only connection policy for the isolated SEC-003 Preview. This does
// not replace patient, specialist, or organization authorization.
export const SEC003_PREVIEW_RUNTIME = Object.freeze({
  branch: "codex/sec-003-legacy-bypass",
  vercelProjectId: "prj_BSzyfSJjjrCTI0RieWuVxR8qh3el",
  vercelProjectName: "tochka-opori-test",
  supabaseProjectRef: "eehyehlhiyztciaezaus",
  supabaseUrl: "https://eehyehlhiyztciaezaus.supabase.co",
});

const SERVICE_ROLE_KEY_FINGERPRINT_ENV = "EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256";

function block(reason) {
  const error = new Error(`Runtime isolation: ${reason}`);
  error.code = "RUNTIME_ISOLATION_BLOCKED";
  throw error;
}

export function fingerprintServerCredential(key) {
  return createHash("sha256").update(String(key || ""), "utf8").digest("hex");
}

function parseJwtObject(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    block("unsupported server credential format");
  }
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      block("unsupported server credential format");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "RUNTIME_ISOLATION_BLOCKED") throw error;
    block("unsupported server credential format");
  }
}

/**
 * Performs only local format/claim checks. For a legacy JWT this does not
 * verify the signature and is never treated as proof of project ownership.
 */
export function inspectSupabaseServerCredential(key, expectedRef) {
  if (typeof key !== "string" || key.length === 0) {
    block("server credential is missing");
  }

  if (key.startsWith("sb_secret_")) {
    if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) {
      block("unsupported server credential format");
    }
    return Object.freeze({ credentialKind: "opaque-secret" });
  }

  const segments = key.split(".");
  if (
    segments.length !== 3
    || !segments[2]
    || !/^[A-Za-z0-9_-]+$/.test(segments[2])
  ) {
    block("unsupported server credential format");
  }
  const header = parseJwtObject(segments[0]);
  const claims = parseJwtObject(segments[1]);
  if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    block("unsupported legacy JWT header");
  }
  if (claims.ref !== expectedRef || claims.role !== "service_role") {
    block("server credential belongs to another project or role");
  }
  return Object.freeze({
    credentialKind: "legacy-service-role",
    claimedProjectRef: claims.ref,
    claimedRole: claims.role,
  });
}

function validateServerCredential(env, expectedRef) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const inspected = inspectSupabaseServerCredential(key, expectedRef);

  // The fingerprint must come from an independent online attestation against
  // the allowlisted test project. It binds both opaque keys and legacy JWTs;
  // decoding legacy claims alone is not proof that the signature is valid.
  const expectedFingerprint = env[SERVICE_ROLE_KEY_FINGERPRINT_ENV];
  if (!/^[a-f0-9]{64}$/.test(String(expectedFingerprint || ""))) {
    block("attested server credential fingerprint is missing");
  }
  const actual = Buffer.from(fingerprintServerCredential(key), "hex");
  const expected = Buffer.from(expectedFingerprint, "hex");
  if (!timingSafeEqual(actual, expected)) {
    block("server credential fingerprint mismatch");
  }
  return inspected.credentialKind;
}

function validateExactSupabaseUrl(rawUrl) {
  if (rawUrl !== SEC003_PREVIEW_RUNTIME.supabaseUrl) {
    block("database URL is not the approved test origin");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    block("database URL is invalid");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hostname !== `${SEC003_PREVIEW_RUNTIME.supabaseProjectRef}.supabase.co`
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    block("database URL is not the approved test origin");
  }
}

function isSec003PreviewCandidate(env) {
  return env.VERCEL_GIT_COMMIT_REF === SEC003_PREVIEW_RUNTIME.branch
    || env.EXPECTED_SUPABASE_PROJECT === SEC003_PREVIEW_RUNTIME.supabaseProjectRef
    || (
      env.VERCEL_ENV === "preview"
      && env.VERCEL_PROJECT_ID === SEC003_PREVIEW_RUNTIME.vercelProjectId
    );
}

/**
 * Runs synchronously before a Supabase client can be created or returned.
 * Production/local behavior remains unchanged unless the SEC-003 Preview is
 * detected. Every other Vercel Preview still receives the existing generic
 * database-architecture check, so Preview cannot silently use the live DB.
 */
export function assertRuntimeDatabaseIsolation(env = process.env) {
  const sec003Candidate = isSec003PreviewCandidate(env);

  if (!sec003Candidate) {
    if (env.VERCEL_ENV !== "preview") {
      return Object.freeze({ enforced: false, profile: "unchanged" });
    }
    if (env.VERCEL !== "1" || !env.VERCEL_PROJECT_ID) {
      block("Vercel Preview identity is unavailable");
    }
    const generic = validateDatabaseArchitecture(env);
    return Object.freeze({
      enforced: true,
      profile: "generic-preview",
      purpose: generic.purpose,
      connected: generic.connected,
    });
  }

  if (env.VERCEL !== "1") block("Vercel runtime marker is missing");
  if (env.VERCEL_ENV !== "preview") block("SEC-003 must run as a Preview deployment");
  if (env.DEPLOYMENT_PURPOSE !== "test") block("DEPLOYMENT_PURPOSE must be test");
  if (env.VERCEL_GIT_COMMIT_REF !== SEC003_PREVIEW_RUNTIME.branch) {
    block("Git branch does not match the SEC-003 Preview");
  }
  if (env.VERCEL_PROJECT_ID !== SEC003_PREVIEW_RUNTIME.vercelProjectId) {
    block("Vercel Project ID does not match the approved test project");
  }
  if (
    env.VERCEL_PROJECT_NAME
    && env.VERCEL_PROJECT_NAME !== SEC003_PREVIEW_RUNTIME.vercelProjectName
  ) {
    block("Vercel project name does not match the approved test project");
  }
  if (env.EXPECTED_SUPABASE_PROJECT !== SEC003_PREVIEW_RUNTIME.supabaseProjectRef) {
    block("EXPECTED_SUPABASE_PROJECT does not match the approved test project");
  }

  validateExactSupabaseUrl(env.SUPABASE_URL);
  const credentialKind = validateServerCredential(env, SEC003_PREVIEW_RUNTIME.supabaseProjectRef);

  const pepper = env.CONTINUATION_SECRET_PEPPER;
  if (typeof pepper !== "string" || Buffer.byteLength(pepper, "utf8") < 32) {
    block("continuation secret pepper is missing or too short");
  }
  if (pepper === env.SUPABASE_SERVICE_ROLE_KEY) {
    block("continuation pepper must be separate from the database credential");
  }

  return Object.freeze({
    enforced: true,
    profile: "sec-003-preview",
    purpose: "test",
    connected: true,
    projectRef: SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
    credentialKind,
  });
}

export const RUNTIME_ISOLATION_ENV = Object.freeze({
  serviceRoleKeyFingerprint: SERVICE_ROLE_KEY_FINGERPRINT_ENV,
});
