import { DATABASE_REFS } from "./database-architecture.js";
import {
  APPROVED_TEST_VERCEL_PROJECT_IDS,
  PRODUCTION_VERCEL_PROJECT,
  trustedVercelProjectProfile,
} from "./deployment-identities.js";

export const RUNTIME_DATABASE_ENV = Object.freeze({
  expectedGitRef: "EXPECTED_VERCEL_GIT_COMMIT_REF",
  expectedProjectRef: "EXPECTED_SUPABASE_PROJECT",
  serviceRoleKeyFingerprint: "EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256",
});

export const TRUSTED_SUPABASE_PROJECTS = Object.freeze({
  test: Object.freeze({
    purpose: "test",
    projectRef: DATABASE_REFS.test,
    url: `https://${DATABASE_REFS.test}.supabase.co`,
  }),
  live: Object.freeze({
    purpose: "live",
    projectRef: DATABASE_REFS.live,
    url: `https://${DATABASE_REFS.live}.supabase.co`,
  }),
});

const VERCEL_IDENTITY_KEYS = Object.freeze([
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_PROJECT_ID",
  "VERCEL_GIT_COMMIT_REF",
]);

export function runtimeIsolationBlocked(reason) {
  const error = new Error(`Runtime isolation: ${reason}`);
  error.code = "RUNTIME_ISOLATION_BLOCKED";
  return error;
}

function block(reason) {
  throw runtimeIsolationBlocked(reason);
}

function requireNonEmpty(env, key, label) {
  const value = env[key];
  if (typeof value !== "string" || value.length === 0) block(`${label} is missing`);
  return value;
}

function resolveLocalPolicy(env) {
  const purpose = env.DEPLOYMENT_PURPOSE;
  if (purpose === "demo") {
    return Object.freeze({
      hosted: false,
      profile: "local-demo",
      purpose,
      connected: false,
      projectRef: null,
      supabaseUrl: null,
      deploymentIdentity: "local:demo",
    });
  }
  const project = TRUSTED_SUPABASE_PROJECTS[purpose];
  if (!project) block("local database purpose must be test, live or demo");
  return Object.freeze({
    hosted: false,
    profile: `local-${purpose}`,
    purpose,
    connected: true,
    projectRef: project.projectRef,
    supabaseUrl: project.url,
    deploymentIdentity: `local:${purpose}`,
  });
}

/**
 * Selects a source-controlled database profile before any credential is read.
 * Vercel system variables establish the hosted deployment identity. The
 * EXPECTED_* values only constrain that identity; they never replace it.
 */
export function resolveRuntimeDatabasePolicy(env = process.env) {
  const hasAnyVercelIdentity = VERCEL_IDENTITY_KEYS.some((key) => Boolean(env[key]));
  if (!hasAnyVercelIdentity) return resolveLocalPolicy(env);

  if (env.VERCEL !== "1") block("Vercel runtime marker is missing");
  const vercelEnvironment = requireNonEmpty(env, "VERCEL_ENV", "Vercel environment");
  const projectId = requireNonEmpty(env, "VERCEL_PROJECT_ID", "Vercel Project ID");
  const gitRef = requireNonEmpty(env, "VERCEL_GIT_COMMIT_REF", "Vercel Git ref");
  const profile = trustedVercelProjectProfile(projectId);
  if (!profile) block("Vercel Project ID is not trusted for database access");

  const expectedGitRef = requireNonEmpty(
    env,
    RUNTIME_DATABASE_ENV.expectedGitRef,
    RUNTIME_DATABASE_ENV.expectedGitRef,
  );
  if (gitRef !== expectedGitRef) block("Vercel Git ref does not match deployment policy");

  if (profile === "live") {
    if (vercelEnvironment !== "production") {
      block("Production database requires a Production deployment");
    }
    if (gitRef !== PRODUCTION_VERCEL_PROJECT.gitRef) {
      block("Production database requires the trusted Production Git ref");
    }
  } else {
    if (!APPROVED_TEST_VERCEL_PROJECT_IDS.includes(projectId)) {
      block("test deployment project is not allowlisted");
    }
    if (!new Set(["preview", "production"]).has(vercelEnvironment)) {
      block("test database requires a Vercel Preview or isolated test target");
    }
  }

  const project = TRUSTED_SUPABASE_PROJECTS[profile];
  if (env.DEPLOYMENT_PURPOSE !== project.purpose) {
    block(`DEPLOYMENT_PURPOSE must be ${project.purpose}`);
  }
  if (env[RUNTIME_DATABASE_ENV.expectedProjectRef] !== project.projectRef) {
    block(`${RUNTIME_DATABASE_ENV.expectedProjectRef} does not match the trusted profile`);
  }

  return Object.freeze({
    hosted: true,
    profile,
    purpose: project.purpose,
    connected: true,
    projectRef: project.projectRef,
    supabaseUrl: project.url,
    vercelEnvironment,
    vercelProjectId: projectId,
    gitRef,
    deploymentIdentity: `vercel:${vercelEnvironment}:${projectId}:${gitRef}:${profile}`,
  });
}
