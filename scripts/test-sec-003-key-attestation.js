import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SUPABASE_KEY_ATTESTATION_ENDPOINT,
  SUPABASE_KEY_ATTESTATION_ENDPOINTS,
  attestSupabaseServiceRoleKey,
} from "../lib/security/supabase-key-attestation.js";
import { APPROVED_TEST_VERCEL_PROJECTS } from "../lib/security/deployment-identities.js";
import {
  RUNTIME_ISOLATION_ENV,
  fingerprintServerCredential,
} from "../lib/security/runtime-isolation.js";
import { TRUSTED_SUPABASE_PROJECTS } from "../lib/security/runtime-database-policy.js";
import { createSupabaseClientForEnvironment } from "../lib/supabase.js";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const legacyKey = ({
  ref = TRUSTED_SUPABASE_PROJECTS.test.projectRef,
  role = "service_role",
  alg = "HS256",
} = {}) => [
  encode({ alg, typ: "JWT" }),
  encode({ ref, role }),
  "synthetic-signature",
].join(".");

let checks = 0;

async function expectPreflightBlocked(rawKey, expectedStatus, dependencies = {}) {
  let fetchCalls = 0;
  const result = await attestSupabaseServiceRoleKey(rawKey, {
    ...dependencies,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network must not be reached");
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, expectedStatus);
  assert.equal(result.fingerprint, null);
  assert.equal(fetchCalls, 0);
  checks += 1;
}

await expectPreflightBlocked("", "BLOCKED_KEY_MISSING");
await expectPreflightBlocked("not-a-server-key", "BLOCKED_KEY_FORMAT");
await expectPreflightBlocked(legacyKey({ alg: "none" }), "BLOCKED_JWT_HEADER");
await expectPreflightBlocked(legacyKey({ role: "anon" }), "BLOCKED_PROJECT_OR_ROLE");
await expectPreflightBlocked(
  legacyKey({ ref: TRUSTED_SUPABASE_PROJECTS.live.projectRef }),
  "BLOCKED_PROJECT_OR_ROLE",
);
await expectPreflightBlocked(legacyKey(), "BLOCKED_TARGET", { target: "unknown" });

async function expectVerified(rawKey, expectedType, target = "test") {
  let fetchCalls = 0;
  let bodyCancels = 0;
  let bodyReads = 0;
  const result = await attestSupabaseServiceRoleKey(rawKey, {
    target,
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert.equal(url, SUPABASE_KEY_ATTESTATION_ENDPOINTS[target]);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.apikey, rawKey);
      assert.equal(options.headers.Accept, "application/openapi+json");
      assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "apikey"]);
      assert.equal(options.signal.aborted, false);
      return {
        status: 200,
        body: {
          cancel: async () => { bodyCancels += 1; },
          json: async () => { bodyReads += 1; },
          text: async () => { bodyReads += 1; },
        },
      };
    },
  });
  assert.equal(result.passed, true);
  assert.equal(result.keyType, expectedType);
  assert.equal(result.status, `VERIFIED_${target.toUpperCase()}_PROJECT`);
  assert.equal(result.fingerprint, fingerprintServerCredential(rawKey));
  assert.equal(fetchCalls, 1);
  assert.equal(bodyCancels, 1);
  assert.equal(bodyReads, 0);
  checks += 1;
}

const validTestLegacyKey = legacyKey();
const validLiveLegacyKey = legacyKey({ ref: TRUSTED_SUPABASE_PROJECTS.live.projectRef });
assert.equal(SUPABASE_KEY_ATTESTATION_ENDPOINT, SUPABASE_KEY_ATTESTATION_ENDPOINTS.test);
await expectVerified(validTestLegacyKey, "Legacy service_role JWT");
await expectVerified(`sb_secret_${"A".repeat(40)}`, "sb_secret");
await expectVerified(validLiveLegacyKey, "Legacy service_role JWT", "live");

for (const status of [401, 302]) {
  const result = await attestSupabaseServiceRoleKey(validTestLegacyKey, {
    fetchImpl: async () => ({
      status,
      body: { cancel: async () => {} },
    }),
  });
  assert.equal(result.passed, false);
  assert.equal(result.status, `BLOCKED_HTTP_${status}`);
  assert.equal(result.fingerprint, null);
  checks += 1;
}

let productionFetchCalls = 0;
const productionAttempt = await attestSupabaseServiceRoleKey(validTestLegacyKey, {
  endpoint: SUPABASE_KEY_ATTESTATION_ENDPOINTS.live,
  fetchImpl: async () => {
    productionFetchCalls += 1;
    throw new Error("Production must never be reached by the Preview verifier");
  },
});
assert.equal(productionAttempt.status, "BLOCKED_ENDPOINT");
assert.equal(productionAttempt.passed, false);
assert.equal(productionAttempt.fingerprint, null);
assert.equal(productionFetchCalls, 0);
checks += 1;

const networkFailure = await attestSupabaseServiceRoleKey(validTestLegacyKey, {
  fetchImpl: async () => { throw new Error("synthetic network failure"); },
});
assert.equal(networkFailure.status, "BLOCKED_NETWORK");
assert.equal(networkFailure.passed, false);
assert.equal(networkFailure.fingerprint, null);
checks += 1;

const timeoutFailure = await attestSupabaseServiceRoleKey(validTestLegacyKey, {
  timeoutMs: 5,
  fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }),
});
assert.equal(timeoutFailure.status, "BLOCKED_TIMEOUT");
assert.equal(timeoutFailure.passed, false);
assert.equal(timeoutFailure.fingerprint, null);
checks += 1;

const integrationBranch = "codex/sec-003-a3a5-integration";
const runtimeBase = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: integrationBranch,
  VERCEL_PROJECT_ID: APPROVED_TEST_VERCEL_PROJECTS[0].id,
  DEPLOYMENT_PURPOSE: "test",
  [RUNTIME_ISOLATION_ENV.expectedGitRef]: integrationBranch,
  [RUNTIME_ISOLATION_ENV.expectedProjectRef]: TRUSTED_SUPABASE_PROJECTS.test.projectRef,
  SUPABASE_URL: TRUSTED_SUPABASE_PROJECTS.test.url,
  SUPABASE_SERVICE_ROLE_KEY: validTestLegacyKey,
  CONTINUATION_SECRET_PEPPER: "synthetic-preview-pepper-with-at-least-32-bytes",
};

for (const [name, fingerprint] of [
  ["missing expected SHA-256", undefined],
  ["mismatched expected SHA-256", "0".repeat(64)],
]) {
  let clientCreations = 0;
  const env = {
    ...runtimeBase,
    [RUNTIME_ISOLATION_ENV.serviceRoleKeyFingerprint]: fingerprint,
  };
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
  assert.equal(clientCreations, 0, `${name}: no client may be created`);
  checks += 1;
}

const verifierPath = new URL("./verify-sec-003-preview-key.js", import.meta.url);
const verifierFile = fileURLToPath(verifierPath);
const verifierSource = readFileSync(verifierPath, "utf8");
assert.equal(verifierSource.includes("/auth/v1/"), false);
assert.equal(verifierSource.includes("@supabase/supabase-js"), false);
assert.equal(verifierSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
assert.equal(verifierSource.includes("/usr/bin/pbpaste"), true);
assert.equal(verifierSource.includes("stdin"), true);
assert.equal(verifierSource.includes("target: \"live\""), false);
checks += 1;

const syntheticArgument = "synthetic-secret-must-not-be-echoed";
const rejectedArgument = spawnSync(process.execPath, [verifierFile, syntheticArgument], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(rejectedArgument.status, 1);
assert.equal(rejectedArgument.stdout.includes(syntheticArgument), false);
assert.equal(rejectedArgument.stderr.includes(syntheticArgument), false);
assert.deepEqual(
  rejectedArgument.stdout.trim().split("\n").map((line) => line.split(":")[0]),
  ["Тип ключа", "Статус проверки", "SHA-256", "BLOCKED"],
);
checks += 1;

const rejectedStdinKey = "synthetic-invalid-key-must-not-be-echoed";
const rejectedStdin = spawnSync(process.execPath, [verifierFile, "--stdin"], {
  cwd: process.cwd(),
  encoding: "utf8",
  input: rejectedStdinKey,
});
assert.equal(rejectedStdin.status, 1);
assert.equal(rejectedStdin.stdout.includes(rejectedStdinKey), false);
assert.equal(rejectedStdin.stderr.includes(rejectedStdinKey), false);
assert.equal(rejectedStdin.stdout.trim().endsWith("BLOCKED"), true);
checks += 1;

console.log(
  `Supabase key attestation: PASS (${checks} checks; mocked network only; 0 DB clients on gate failures)`,
);
