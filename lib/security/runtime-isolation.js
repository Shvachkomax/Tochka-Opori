import { createHash, timingSafeEqual } from "node:crypto";
import { validateDatabaseArchitecture } from "./database-architecture.js";
import {
  RUNTIME_DATABASE_ENV,
  resolveRuntimeDatabasePolicy,
  runtimeIsolationBlocked,
} from "./runtime-database-policy.js";

function block(reason) {
  throw runtimeIsolationBlocked(reason);
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

  // This value must be produced by a separate operator attestation against an
  // exact source-controlled project endpoint. Decoded JWT claims alone are not
  // evidence that the key is valid or belongs to that project.
  const expectedFingerprint = env[RUNTIME_DATABASE_ENV.serviceRoleKeyFingerprint];
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

function validateExactSupabaseUrl(rawUrl, policy) {
  if (rawUrl !== policy.supabaseUrl) {
    block("database URL is not the trusted profile origin");
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
    || parsed.hostname !== `${policy.projectRef}.supabase.co`
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    block("database URL is not the trusted profile origin");
  }
}

function validateContinuationPepper(env) {
  const pepper = env.CONTINUATION_SECRET_PEPPER;
  if (typeof pepper !== "string" || Buffer.byteLength(pepper, "utf8") < 32) {
    block("continuation secret pepper is missing or too short");
  }
  if (pepper === env.SUPABASE_SERVICE_ROLE_KEY) {
    block("continuation pepper must be separate from the database credential");
  }
}

/**
 * Synchronous, universal database gate. It executes before a Supabase client
 * can be created or returned from cache. Hosted identity, database origin,
 * independently attested key fingerprint, and continuation pepper must all
 * agree with one trusted profile.
 */
export function assertRuntimeDatabaseIsolation(env = process.env) {
  const policy = resolveRuntimeDatabasePolicy(env);
  let architecture;
  try {
    architecture = validateDatabaseArchitecture(env);
  } catch (error) {
    block(error?.message || "database architecture check failed");
  }

  if (!policy.connected) {
    return Object.freeze({
      enforced: true,
      profile: policy.profile,
      purpose: policy.purpose,
      connected: false,
      connectionBinding: policy.deploymentIdentity,
    });
  }
  if (!architecture.connected || architecture.purpose !== policy.purpose) {
    block("database architecture does not match the trusted runtime profile");
  }
  if (env[RUNTIME_DATABASE_ENV.expectedProjectRef] !== policy.projectRef) {
    block(`${RUNTIME_DATABASE_ENV.expectedProjectRef} does not match the trusted profile`);
  }

  validateExactSupabaseUrl(env.SUPABASE_URL, policy);
  const credentialKind = validateServerCredential(env, policy.projectRef);
  validateContinuationPepper(env);

  return Object.freeze({
    enforced: true,
    profile: policy.profile,
    purpose: policy.purpose,
    connected: true,
    projectRef: policy.projectRef,
    credentialKind,
    connectionBinding: policy.deploymentIdentity,
  });
}

export const RUNTIME_ISOLATION_ENV = RUNTIME_DATABASE_ENV;
