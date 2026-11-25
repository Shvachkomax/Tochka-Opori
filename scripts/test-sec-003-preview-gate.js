import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import {
  APPROVED_TEST_VERCEL_PROJECTS,
  PRODUCTION_VERCEL_PROJECT,
} from "../lib/security/deployment-identities.js";
import {
  RUNTIME_ISOLATION_ENV,
  assertRuntimeDatabaseIsolation,
  fingerprintServerCredential,
} from "../lib/security/runtime-isolation.js";
import { TRUSTED_SUPABASE_PROJECTS } from "../lib/security/runtime-database-policy.js";
import {
  createGuardedSupabaseClientCache,
  createSupabaseClientForEnvironment,
} from "../lib/supabase.js";

const root = process.cwd();
const integrationBranch = "codex/sec-003-a3a5-integration";
const testProject = APPROVED_TEST_VERCEL_PROJECTS[0];
const testDatabase = TRUSTED_SUPABASE_PROJECTS.test;
const liveDatabase = TRUSTED_SUPABASE_PROJECTS.live;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const legacyKey = (ref, role = "service_role", signature = "synthetic-signature") => [
  encode({ alg: "HS256", typ: "JWT" }),
  encode({ ref, role }),
  signature,
].join(".");
const validTestKey = legacyKey(testDatabase.projectRef);
const validLiveKey = legacyKey(liveDatabase.projectRef);

const validPreview = Object.freeze({
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: integrationBranch,
  VERCEL_PROJECT_ID: testProject.id,
  DEPLOYMENT_PURPOSE: "test",
  [RUNTIME_ISOLATION_ENV.expectedGitRef]: integrationBranch,
  [RUNTIME_ISOLATION_ENV.expectedProjectRef]: testDatabase.projectRef,
  SUPABASE_URL: testDatabase.url,
  SUPABASE_SERVICE_ROLE_KEY: validTestKey,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validTestKey),
  CONTINUATION_SECRET_PEPPER: "synthetic-preview-pepper-with-at-least-32-bytes",
});

const validProduction = Object.freeze({
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: PRODUCTION_VERCEL_PROJECT.gitRef,
  VERCEL_PROJECT_ID: PRODUCTION_VERCEL_PROJECT.id,
  DEPLOYMENT_PURPOSE: "live",
  [RUNTIME_ISOLATION_ENV.expectedGitRef]: PRODUCTION_VERCEL_PROJECT.gitRef,
  [RUNTIME_ISOLATION_ENV.expectedProjectRef]: liveDatabase.projectRef,
  SUPABASE_URL: liveDatabase.url,
  SUPABASE_SERVICE_ROLE_KEY: validLiveKey,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validLiveKey),
  CONTINUATION_SECRET_PEPPER: "synthetic-production-pepper-with-at-least-32-bytes",
});

function changed(name, value) {
  return { name, env: { ...validPreview, ...value } };
}

function without(name, key) {
  const env = { ...validPreview };
  delete env[key];
  return { name, env };
}

const blockedCases = [
  without("missing Vercel runtime marker", "VERCEL"),
  without("missing Vercel environment", "VERCEL_ENV"),
  without("missing Vercel Project ID", "VERCEL_PROJECT_ID"),
  without("missing Vercel Git ref", "VERCEL_GIT_COMMIT_REF"),
  without("missing expected Git ref", RUNTIME_ISOLATION_ENV.expectedGitRef),
  changed("wrong Git branch", { VERCEL_GIT_COMMIT_REF: "unexpected-branch" }),
  changed("wrong Vercel Project ID", { VERCEL_PROJECT_ID: "prj_untrusted" }),
  changed("Production project in Preview", {
    VERCEL_PROJECT_ID: PRODUCTION_VERCEL_PROJECT.id,
  }),
  without("missing DEPLOYMENT_PURPOSE", "DEPLOYMENT_PURPOSE"),
  changed("live purpose in Preview", { DEPLOYMENT_PURPOSE: "live" }),
  without("missing expected Supabase ref", RUNTIME_ISOLATION_ENV.expectedProjectRef),
  changed("wrong expected Supabase ref", {
    [RUNTIME_ISOLATION_ENV.expectedProjectRef]: "wrong-project-ref",
  }),
  changed("Production Supabase URL in Preview", { SUPABASE_URL: liveDatabase.url }),
  changed("wrong Supabase ref in URL", {
    SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  }),
  changed("malformed Supabase URL", { SUPABASE_URL: "not-a-url" }),
  changed("Supabase URL with path", { SUPABASE_URL: `${testDatabase.url}/rest/v1` }),
  changed("Supabase URL with query", { SUPABASE_URL: `${testDatabase.url}?redirect=1` }),
  changed("Supabase URL with userinfo", {
    SUPABASE_URL: `https://user@${testDatabase.projectRef}.supabase.co`,
  }),
  without("missing service-role key", "SUPABASE_SERVICE_ROLE_KEY"),
  without(
    "missing attested service-role fingerprint",
    RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint,
  ),
  changed("mismatched attested service-role fingerprint", {
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: "0".repeat(64),
  }),
  changed("foreign legacy service-role key", {
    SUPABASE_SERVICE_ROLE_KEY: validLiveKey,
  }),
  changed("wrong legacy role", {
    SUPABASE_SERVICE_ROLE_KEY: legacyKey(testDatabase.projectRef, "anon"),
  }),
  without("missing continuation pepper", "CONTINUATION_SECRET_PEPPER"),
  changed("short continuation pepper", { CONTINUATION_SECRET_PEPPER: "too-short" }),
  changed("pepper reused as DB credential", {
    CONTINUATION_SECRET_PEPPER: validPreview.SUPABASE_SERVICE_ROLE_KEY,
  }),
];

let checks = 0;
for (const scenario of blockedCases) {
  let clientCreations = 0;
  let scopeCalls = 0;
  assert.throws(
    () => createSupabaseClientForEnvironment(scenario.env, {
      createClientImpl: () => {
        clientCreations += 1;
        return {};
      },
      scopeDatabaseImpl: (client) => {
        scopeCalls += 1;
        return client;
      },
      organizationId: null,
    }),
    (error) => error?.code === "RUNTIME_ISOLATION_BLOCKED",
    scenario.name,
  );
  assert.equal(clientCreations, 0, `${scenario.name}: client creation must stay at zero`);
  assert.equal(scopeCalls, 0, `${scenario.name}: database wrapper calls must stay at zero`);
  checks += 1;
}

function expectMockClient(env, expectedUrl) {
  let clientCreations = 0;
  let scopeCalls = 0;
  const fakeClient = { kind: "synthetic-supabase-client" };
  const allowed = createSupabaseClientForEnvironment(env, {
    createClientImpl: (url, key) => {
      clientCreations += 1;
      assert.equal(url, expectedUrl);
      assert.equal(key, env.SUPABASE_SERVICE_ROLE_KEY);
      return fakeClient;
    },
    scopeDatabaseImpl: (client, organizationId) => {
      scopeCalls += 1;
      assert.equal(client, fakeClient);
      assert.equal(organizationId, null);
      return client;
    },
    organizationId: null,
  });
  assert.equal(allowed, fakeClient);
  assert.equal(clientCreations, 1);
  assert.equal(scopeCalls, 1);
  checks += 1;
}

expectMockClient(validPreview, testDatabase.url);
expectMockClient(validProduction, liveDatabase.url);
expectMockClient({
  DEPLOYMENT_PURPOSE: "test",
  [RUNTIME_ISOLATION_ENV.expectedProjectRef]: testDatabase.projectRef,
  SUPABASE_URL: testDatabase.url,
  SUPABASE_SERVICE_ROLE_KEY: validTestKey,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validTestKey),
  CONTINUATION_SECRET_PEPPER: "synthetic-local-pepper-with-at-least-32-bytes",
}, testDatabase.url);

// An allowlisted test project may be production-shaped, but it is still bound
// to the test database and a configured Git ref.
expectMockClient({ ...validPreview, VERCEL_ENV: "production" }, testDatabase.url);

const opaqueKey = `sb_secret_${"A".repeat(40)}`;
const opaqueEnv = {
  ...validPreview,
  SUPABASE_SERVICE_ROLE_KEY: opaqueKey,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(opaqueKey),
};
assert.equal(assertRuntimeDatabaseIsolation(opaqueEnv).credentialKind, "opaque-secret");
checks += 1;

for (const [name, env] of [
  ["production project with test profile", {
    ...validProduction,
    DEPLOYMENT_PURPOSE: "test",
    [RUNTIME_ISOLATION_ENV.expectedProjectRef]: testDatabase.projectRef,
    SUPABASE_URL: testDatabase.url,
    SUPABASE_SERVICE_ROLE_KEY: validTestKey,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validTestKey),
  }],
  ["test project with live profile", {
    ...validPreview,
    VERCEL_ENV: "production",
    DEPLOYMENT_PURPOSE: "live",
    [RUNTIME_ISOLATION_ENV.expectedProjectRef]: liveDatabase.projectRef,
    SUPABASE_URL: liveDatabase.url,
    SUPABASE_SERVICE_ROLE_KEY: validLiveKey,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validLiveKey),
  }],
  ["partial Vercel identity outside hosted runtime", {
    DEPLOYMENT_PURPOSE: "test",
    VERCEL_ENV: "preview",
    [RUNTIME_ISOLATION_ENV.expectedProjectRef]: testDatabase.projectRef,
    SUPABASE_URL: testDatabase.url,
    SUPABASE_SERVICE_ROLE_KEY: validTestKey,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validTestKey),
    CONTINUATION_SECRET_PEPPER: "synthetic-local-pepper-with-at-least-32-bytes",
  }],
]) {
  let clientCreations = 0;
  assert.throws(
    () => createSupabaseClientForEnvironment(env, {
      createClientImpl: () => {
        clientCreations += 1;
        return {};
      },
      scopeDatabaseImpl: (client) => client,
      organizationId: null,
    }),
    (error) => error?.code === "RUNTIME_ISOLATION_BLOCKED",
    name,
  );
  assert.equal(clientCreations, 0, `${name}: client creation must stay at zero`);
  checks += 1;
}

// Cache reuse is bound to runtime identity, key, URL, and organization scope.
let cacheClientCreations = 0;
const cachedClient = { kind: "cached-synthetic-client" };
const getCached = createGuardedSupabaseClientCache({
  createClientImpl: () => {
    cacheClientCreations += 1;
    return cachedClient;
  },
  scopeDatabaseImpl: (client) => client,
  organizationIdResolver: (env) => env.SYNTHETIC_ORGANIZATION_ID || null,
});
assert.equal(getCached(validPreview), cachedClient);
assert.equal(getCached(validPreview), cachedClient);
assert.equal(cacheClientCreations, 1);

const changedBranch = {
  ...validPreview,
  VERCEL_GIT_COMMIT_REF: "codex/another-isolated-branch",
  [RUNTIME_ISOLATION_ENV.expectedGitRef]: "codex/another-isolated-branch",
};
assert.throws(
  () => getCached(changedBranch),
  (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
);
assert.equal(cacheClientCreations, 1);

const rotatedKey = legacyKey(testDatabase.projectRef, "service_role", "rotated-signature");
assert.throws(
  () => getCached({
    ...validPreview,
    SUPABASE_SERVICE_ROLE_KEY: rotatedKey,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(rotatedKey),
  }),
  (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
);
assert.throws(
  () => getCached({ ...validPreview, SYNTHETIC_ORGANIZATION_ID: "synthetic-org" }),
  (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
);
assert.equal(cacheClientCreations, 1);

assert.throws(
  () => getCached({ ...validPreview, SUPABASE_URL: liveDatabase.url }),
  (error) => error?.code === "RUNTIME_ISOLATION_BLOCKED",
);
assert.equal(cacheClientCreations, 1);
checks += 8;

function javascriptFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path === join(root, "lib", "api-old")) continue;
      output.push(...javascriptFiles(path));
    } else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) {
      output.push(path);
    }
  }
  return output;
}

const activeServerFiles = [
  ...javascriptFiles(join(root, "api")),
  ...javascriptFiles(join(root, "lib")),
];
const directSdkImports = activeServerFiles
  .filter((file) => file !== join(root, "lib", "supabase.js"))
  .filter((file) => readFileSync(file, "utf8").includes("@supabase/supabase-js"))
  .map((file) => relative(root, file));
assert.deepEqual(directSdkImports, [], "active server code must use lib/supabase.js");

const directSupabaseFetches = activeServerFiles
  .filter((file) => file !== join(root, "lib", "security", "supabase-key-attestation.js"))
  .filter((file) => {
    const source = readFileSync(file, "utf8");
    return /(?:\bfetch|globalThis\.fetch|fetchImpl)\s*\(/.test(source)
      && (
        source.includes("SUPABASE_URL")
        || source.includes("supabase.co")
        || source.includes("/rest/v1")
        || source.includes("/auth/v1")
      );
  })
  .map((file) => relative(root, file));
assert.deepEqual(directSupabaseFetches, [], "active server code must not bypass the guarded client");

const attestationImports = activeServerFiles
  .filter((file) => file !== join(root, "lib", "security", "supabase-key-attestation.js"))
  .filter((file) => readFileSync(file, "utf8").includes("supabase-key-attestation"))
  .map((file) => relative(root, file));
assert.deepEqual(attestationImports, [], "operator attestation must not enter active runtime code");

const alternateCredentialVariables = activeServerFiles
  .filter((file) => /TEST_SUPABASE_(?:URL|SERVICE_ROLE_KEY)|SUPABASE_SECRET_KEYS/.test(
    readFileSync(file, "utf8"),
  ))
  .map((file) => relative(root, file));
assert.deepEqual(alternateCredentialVariables, [], "alternate Supabase credential variables forbidden");

const branchSpecificRuntime = activeServerFiles
  .filter((file) => readFileSync(file, "utf8").includes("codex/sec-003-legacy-bypass"))
  .map((file) => relative(root, file));
assert.deepEqual(branchSpecificRuntime, [], "runtime policy must not be tied to the old SEC branch");

const activeArchiveReferences = activeServerFiles
  .filter((file) => readFileSync(file, "utf8").includes("api-old"))
  .map((file) => relative(root, file));
assert.deepEqual(activeArchiveReferences, [], "archived API code must not enter active runtime code");

const childEnv = { ...process.env };
for (const key of new Set([
  ...Object.keys(validPreview),
  ...Object.keys(validProduction),
  "MY_PRACTICE_REQUIRE_TEST_DB",
  "MY_PRACTICE_SERVER_ENABLED",
  "MY_PRACTICE_ALLOWED_SUPABASE_REF",
])) delete childEnv[key];
const importCheck = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", "await import('./lib/supabase.js')"],
  { cwd: root, env: childEnv, encoding: "utf8" },
);
assert.equal(importCheck.status, 0, importCheck.stderr || "Supabase import must stay inert");

const apiModules = javascriptFiles(join(root, "api"))
  .map((apiFile) => `./${relative(root, apiFile).replaceAll("\\", "/")}`);
const apiImportCheck = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `await Promise.all(${JSON.stringify(apiModules)}.map((path) => import(path))); process.exit(0)`,
  ],
  { cwd: root, env: childEnv, encoding: "utf8" },
);
assert.equal(
  apiImportCheck.status,
  0,
  `API imports must not initialize Supabase: ${apiImportCheck.stderr}`,
);
checks += 9;

console.log(
  `Universal runtime isolation: PASS (${checks} checks; all blocked scenarios created 0 Supabase clients; no network)`,
);
