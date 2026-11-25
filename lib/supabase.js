import { deploymentOrganizationId, scopeDatabase } from "./security/deployment-scope.js";
import { isMyPracticeTestServerEnabled } from "./my-practice/workspace-handler.js";
import {
  assertRuntimeDatabaseIsolation,
  fingerprintServerCredential,
} from "./security/runtime-isolation.js";
import { createClient } from "@supabase/supabase-js";

let _supabase = null;
let _supabaseBinding = null;

function databaseBinding(config, organizationId) {
  return Object.freeze({
    url: config.url,
    credentialFingerprint: fingerprintServerCredential(config.key),
    organizationId,
  });
}

function assertCachedClientBinding(binding) {
  if (
    !_supabaseBinding
    || _supabaseBinding.url !== binding.url
    || _supabaseBinding.credentialFingerprint !== binding.credentialFingerprint
    || _supabaseBinding.organizationId !== binding.organizationId
  ) {
    const error = new Error("Supabase client configuration changed after initialization");
    error.code = "SUPABASE_CLIENT_CONFIGURATION_CHANGED";
    throw error;
  }
}

function assertServerDatabaseConfiguration(env) {
  // Branch-scoped fail-closed guard: prevent ALL database access in the
  // My Practice Preview until the exact test project and feature gate are ready.
  if (env.MY_PRACTICE_REQUIRE_TEST_DB === "true" && !isMyPracticeTestServerEnabled(env)) {
    throw new Error("My Practice Preview: verified test database credentials not configured");
  }

  // This must run before checking the cached client. A previously initialized
  // process must not be able to reuse the client after its runtime identity or
  // connection configuration becomes invalid.
  assertRuntimeDatabaseIsolation(env);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
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

export function getSupabase() {
  const config = assertServerDatabaseConfiguration(process.env);
  const organizationId = deploymentOrganizationId();
  const binding = databaseBinding(config, organizationId);
  if (_supabase) {
    assertCachedClientBinding(binding);
    return _supabase;
  }
  const client = scopeDatabase(
    createClient(config.url, config.key),
    organizationId,
  );
  _supabase = client;
  _supabaseBinding = binding;
  return _supabase;
}
