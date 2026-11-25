import { deploymentOrganizationId, scopeDatabase } from "./security/deployment-scope.js";
import { isMyPracticeTestServerEnabled } from "./my-practice/workspace-handler.js";
import {
  assertRuntimeDatabaseIsolation,
  fingerprintServerCredential,
} from "./security/runtime-isolation.js";
import { createClient } from "@supabase/supabase-js";

function databaseBinding(config, organizationId) {
  return Object.freeze({
    url: config.url,
    credentialFingerprint: fingerprintServerCredential(config.key),
    organizationId,
    runtimeIdentity: config.runtimeIdentity,
  });
}

function assertCachedClientBinding(cachedBinding, binding) {
  if (
    !cachedBinding
    || cachedBinding.url !== binding.url
    || cachedBinding.credentialFingerprint !== binding.credentialFingerprint
    || cachedBinding.organizationId !== binding.organizationId
    || cachedBinding.runtimeIdentity !== binding.runtimeIdentity
  ) {
    const error = new Error("Supabase client configuration changed after initialization");
    error.code = "SUPABASE_CLIENT_CONFIGURATION_CHANGED";
    throw error;
  }
}

function assertServerDatabaseConfiguration(env) {
  // Preserve the A3/A5 feature-specific gate in addition to the universal
  // connection policy below.
  if (env.MY_PRACTICE_REQUIRE_TEST_DB === "true" && !isMyPracticeTestServerEnabled(env)) {
    throw new Error("My Practice Preview: verified test database credentials not configured");
  }

  // This must run before checking the cached client. A previously initialized
  // process must not be able to reuse the client after its runtime identity or
  // connection configuration becomes invalid.
  const isolation = assertRuntimeDatabaseIsolation(env);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return {
    url: env.SUPABASE_URL,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    runtimeIdentity: isolation.connectionBinding,
  };
}

export function createSupabaseClientForEnvironment(env, dependencies = {}) {
  const config = assertServerDatabaseConfiguration(env);
  const createClientImpl = dependencies.createClientImpl || createClient;
  const scopeDatabaseImpl = dependencies.scopeDatabaseImpl || scopeDatabase;
  const organizationId = Object.hasOwn(dependencies, "organizationId")
    ? dependencies.organizationId
    : deploymentOrganizationId();
  return scopeDatabaseImpl(createClientImpl(config.url, config.key), organizationId);
}

export function createGuardedSupabaseClientCache(dependencies = {}) {
  const createClientImpl = dependencies.createClientImpl || createClient;
  const scopeDatabaseImpl = dependencies.scopeDatabaseImpl || scopeDatabase;
  const organizationIdResolver = dependencies.organizationIdResolver
    || deploymentOrganizationId;
  let cachedClient = null;
  let cachedBinding = null;

  return function getGuardedSupabase(env = process.env) {
    // Re-run every assertion before checking the cache. A warm process cannot
    // retain access after deployment identity or credential policy changes.
    const config = assertServerDatabaseConfiguration(env);
    const organizationId = organizationIdResolver(env);
    const binding = databaseBinding(config, organizationId);
    if (cachedClient) {
      assertCachedClientBinding(cachedBinding, binding);
      return cachedClient;
    }
    cachedClient = scopeDatabaseImpl(
      createClientImpl(config.url, config.key),
      organizationId,
    );
    cachedBinding = binding;
    return cachedClient;
  };
}

const getDefaultSupabase = createGuardedSupabaseClientCache();

export function getSupabase() {
  return getDefaultSupabase(process.env);
}
