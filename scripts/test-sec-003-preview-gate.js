import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import {
  RUNTIME_ISOLATION_ENV,
  SEC003_PREVIEW_RUNTIME,
  assertRuntimeDatabaseIsolation,
  fingerprintServerCredential,
} from "../lib/security/runtime-isolation.js";
import {
  createSupabaseClientForEnvironment,
  getSupabase,
} from "../lib/supabase.js";

const root = process.cwd();
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const legacyKey = (ref, role = "service_role", signature = "synthetic-signature") => [
  encode({ alg: "HS256", typ: "JWT" }),
  encode({ ref, role }),
  signature,
].join(".");
const validLegacyKey = legacyKey(SEC003_PREVIEW_RUNTIME.supabaseProjectRef);

const valid = Object.freeze({
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: SEC003_PREVIEW_RUNTIME.branch,
  VERCEL_PROJECT_ID: SEC003_PREVIEW_RUNTIME.vercelProjectId,
  VERCEL_PROJECT_NAME: SEC003_PREVIEW_RUNTIME.vercelProjectName,
  DEPLOYMENT_PURPOSE: "test",
  EXPECTED_SUPABASE_PROJECT: SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
  SUPABASE_URL: SEC003_PREVIEW_RUNTIME.supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: validLegacyKey,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(validLegacyKey),
  CONTINUATION_SECRET_PEPPER: "synthetic-preview-pepper-with-at-least-32-bytes",
});

function changed(name, value) {
  return { name, env: { ...valid, ...value } };
}

function without(name, key) {
  const env = { ...valid };
  delete env[key];
  return { name, env };
}

const blockedCases = [
  without("missing DEPLOYMENT_PURPOSE", "DEPLOYMENT_PURPOSE"),
  changed("production purpose", { DEPLOYMENT_PURPOSE: "production" }),
  without("missing expected Supabase ref", "EXPECTED_SUPABASE_PROJECT"),
  changed("wrong expected Supabase ref", { EXPECTED_SUPABASE_PROJECT: "wrong-project-ref" }),
  changed("Production Supabase URL", { SUPABASE_URL: "https://blwogrdezfhprdpdnxtn.supabase.co" }),
  changed("wrong Supabase ref in URL", { SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" }),
  changed("malformed Supabase URL", { SUPABASE_URL: "not-a-url" }),
  changed("Supabase URL with path", { SUPABASE_URL: `${SEC003_PREVIEW_RUNTIME.supabaseUrl}/rest/v1` }),
  changed("Supabase URL with query", { SUPABASE_URL: `${SEC003_PREVIEW_RUNTIME.supabaseUrl}?redirect=1` }),
  changed("Supabase URL with userinfo", { SUPABASE_URL: `https://user@${SEC003_PREVIEW_RUNTIME.supabaseProjectRef}.supabase.co` }),
  without("missing service-role key", "SUPABASE_SERVICE_ROLE_KEY"),
  without(
    "missing attested service-role fingerprint",
    RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint,
  ),
  changed("mismatched attested service-role fingerprint", {
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: "0".repeat(64),
  }),
  changed("foreign legacy service-role key", { SUPABASE_SERVICE_ROLE_KEY: legacyKey("blwogrdezfhprdpdnxtn") }),
  changed("wrong legacy role", { SUPABASE_SERVICE_ROLE_KEY: legacyKey(SEC003_PREVIEW_RUNTIME.supabaseProjectRef, "anon") }),
  without("missing continuation pepper", "CONTINUATION_SECRET_PEPPER"),
  changed("short continuation pepper", { CONTINUATION_SECRET_PEPPER: "too-short" }),
  changed("pepper reused as DB credential", {
    CONTINUATION_SECRET_PEPPER: valid.SUPABASE_SERVICE_ROLE_KEY,
  }),
  changed("Production Vercel environment", { VERCEL_ENV: "production" }),
  without("missing Vercel runtime marker", "VERCEL"),
  without("missing Git branch", "VERCEL_GIT_COMMIT_REF"),
  changed("wrong Git branch", { VERCEL_GIT_COMMIT_REF: "main" }),
  changed("wrong Vercel Project ID", { VERCEL_PROJECT_ID: "prj_wrong" }),
  changed("wrong Vercel project name", { VERCEL_PROJECT_NAME: "wrong-project" }),
];

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
}

let positiveClientCreations = 0;
let positiveScopeCalls = 0;
const fakeClient = { kind: "synthetic-supabase-client" };
const allowed = createSupabaseClientForEnvironment(valid, {
  createClientImpl: (url, key) => {
    positiveClientCreations += 1;
    assert.equal(url, SEC003_PREVIEW_RUNTIME.supabaseUrl);
    assert.equal(key, valid.SUPABASE_SERVICE_ROLE_KEY);
    return fakeClient;
  },
  scopeDatabaseImpl: (client, organizationId) => {
    positiveScopeCalls += 1;
    assert.equal(client, fakeClient);
    assert.equal(organizationId, null);
    return client;
  },
  organizationId: null,
});
assert.equal(allowed, fakeClient);
assert.equal(positiveClientCreations, 1);
assert.equal(positiveScopeCalls, 1);

const opaqueKey = `sb_secret_${"A".repeat(40)}`;
const opaqueBase = {
  ...valid,
  SUPABASE_SERVICE_ROLE_KEY: opaqueKey,
};
assert.throws(
  () => assertRuntimeDatabaseIsolation({
    ...opaqueBase,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: undefined,
  }),
  /attested server credential fingerprint is missing/,
);
assert.throws(
  () => assertRuntimeDatabaseIsolation({
    ...opaqueBase,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: "0".repeat(64),
  }),
  /fingerprint mismatch/,
);
assert.equal(assertRuntimeDatabaseIsolation({
  ...opaqueBase,
  [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprintServerCredential(opaqueKey),
}).credentialKind, "opaque-secret");

const genericPreview = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "unrelated-preview-branch",
  VERCEL_PROJECT_ID: "prj_unrelated_test_project",
  DEPLOYMENT_PURPOSE: "test",
  SUPABASE_URL: SEC003_PREVIEW_RUNTIME.supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: legacyKey(SEC003_PREVIEW_RUNTIME.supabaseProjectRef),
};
assert.equal(assertRuntimeDatabaseIsolation(genericPreview).profile, "generic-preview");
assert.throws(
  () => assertRuntimeDatabaseIsolation({
    ...genericPreview,
    DEPLOYMENT_PURPOSE: "live",
    SUPABASE_URL: "https://blwogrdezfhprdpdnxtn.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: legacyKey("blwogrdezfhprdpdnxtn"),
  }),
  /Preview/,
);

const productionEnv = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_PROJECT_ID: "prj_production_project",
  DEPLOYMENT_PURPOSE: "live",
  SUPABASE_URL: "https://blwogrdezfhprdpdnxtn.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: legacyKey("blwogrdezfhprdpdnxtn"),
};
assert.deepEqual(
  assertRuntimeDatabaseIsolation(productionEnv),
  { enforced: false, profile: "unchanged" },
);
let productionClientCreations = 0;
const productionClient = createSupabaseClientForEnvironment(productionEnv, {
  createClientImpl: (url, key) => {
    productionClientCreations += 1;
    assert.equal(url, productionEnv.SUPABASE_URL);
    assert.equal(key, productionEnv.SUPABASE_SERVICE_ROLE_KEY);
    return { kind: "synthetic-production-client" };
  },
  scopeDatabaseImpl: (client) => client,
  organizationId: null,
});
assert.equal(productionClient.kind, "synthetic-production-client");
assert.equal(productionClientCreations, 1);

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
assert.deepEqual(directSupabaseFetches, [], "active server code must not bypass the guarded client with fetch");

const attestationImports = activeServerFiles
  .filter((file) => file !== join(root, "lib", "security", "supabase-key-attestation.js"))
  .filter((file) => readFileSync(file, "utf8").includes("supabase-key-attestation"))
  .map((file) => relative(root, file));
assert.deepEqual(
  attestationImports,
  [],
  "the operator-only key attestation helper must not be imported by active server code",
);

const alternateCredentialVariables = activeServerFiles
  .filter((file) => /TEST_SUPABASE_(?:URL|SERVICE_ROLE_KEY)|SUPABASE_SECRET_KEYS/.test(
    readFileSync(file, "utf8"),
  ))
  .map((file) => relative(root, file));
assert.deepEqual(
  alternateCredentialVariables,
  [],
  "active server code must not use alternate Supabase credential variables",
);

const activeArchiveReferences = activeServerFiles
  .filter((file) => readFileSync(file, "utf8").includes("api-old"))
  .map((file) => relative(root, file));
assert.deepEqual(activeArchiveReferences, [], "archived API code must not be imported by active server code");

const childEnv = { ...process.env };
for (const key of [
  ...Object.keys(valid),
  RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint,
  "MY_PRACTICE_REQUIRE_TEST_DB",
  "MY_PRACTICE_SERVER_ENABLED",
  "MY_PRACTICE_ALLOWED_SUPABASE_REF",
]) delete childEnv[key];
const importCheck = spawnSync(
  process.execPath,
  ["--input-type=module", "--eval", "await import('./lib/supabase.js')"],
  { cwd: root, env: childEnv, encoding: "utf8" },
);
assert.equal(importCheck.status, 0, importCheck.stderr || "Supabase import must not initialize a client");

const apiModules = javascriptFiles(join(root, "api"))
  .map((apiFile) => `./${relative(root, apiFile).replaceAll("\\", "/")}`);
const apiImportCheck = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `await Promise.all(${JSON.stringify(apiModules)}.map((modulePath) => import(modulePath))); process.exit(0)`,
  ],
  { cwd: root, env: childEnv, encoding: "utf8" },
);
assert.equal(
  apiImportCheck.status,
  0,
  `API modules must not initialize Supabase during import: ${apiImportCheck.stderr}`,
);

const mutableKeys = [
  ...new Set([
    ...Object.keys(valid),
    RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint,
    "MY_PRACTICE_REQUIRE_TEST_DB",
    "MY_PRACTICE_SERVER_ENABLED",
    "MY_PRACTICE_ALLOWED_SUPABASE_REF",
    "DEPLOYMENT_ORGANIZATION_ID",
  ]),
];
const saved = Object.fromEntries(mutableKeys.map((key) => [key, process.env[key]]));
try {
  for (const key of mutableKeys) delete process.env[key];
  Object.assign(process.env, valid);
  const cached = getSupabase();
  assert.ok(cached, "valid SEC-003 config must allow the central server client");
  process.env.VERCEL_ENV = "production";
  assert.throws(
    () => getSupabase(),
    (error) => error?.code === "RUNTIME_ISOLATION_BLOCKED",
    "an initialized client must not bypass a later failed runtime check",
  );

  Object.assign(process.env, valid);
  process.env.DEPLOYMENT_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
  assert.throws(
    () => getSupabase(),
    (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
    "an organization-scope change must not reuse a client with the previous scope",
  );
  delete process.env.DEPLOYMENT_ORGANIZATION_ID;

  const rotatedKey = legacyKey(
    SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
    "service_role",
    "rotated-synthetic-signature",
  );
  process.env.SUPABASE_SERVICE_ROLE_KEY = rotatedKey;
  process.env[RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint] =
    fingerprintServerCredential(rotatedKey);
  assert.throws(
    () => getSupabase(),
    (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
    "a valid key rotation must not reuse a client initialized with the previous key",
  );

  for (const key of mutableKeys) delete process.env[key];
  Object.assign(process.env, productionEnv);
  assert.throws(
    () => getSupabase(),
    (error) => error?.code === "SUPABASE_CLIENT_CONFIGURATION_CHANGED",
    "a fully changed valid environment must not receive the cached test client",
  );
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log(
  `SEC-003 Preview runtime gate: PASS (${blockedCases.length + 17} checks, `
  + "all blocked cases created 0 DB clients; no network)",
);
