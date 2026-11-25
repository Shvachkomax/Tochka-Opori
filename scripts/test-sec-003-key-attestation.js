import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SUPABASE_KEY_ATTESTATION_ENDPOINT,
  attestSupabaseServiceRoleKey,
} from "../lib/security/supabase-key-attestation.js";
import {
  RUNTIME_ISOLATION_ENV,
  SEC003_PREVIEW_RUNTIME,
  fingerprintServerCredential,
} from "../lib/security/runtime-isolation.js";
import { createSupabaseClientForEnvironment } from "../lib/supabase.js";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const legacyKey = ({
  ref = SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
  role = "service_role",
  alg = "HS256",
} = {}) => [
  encode({ alg, typ: "JWT" }),
  encode({ ref, role }),
  "synthetic-signature",
].join(".");

let checks = 0;

async function expectPreflightBlocked(rawKey, expectedStatus) {
  let fetchCalls = 0;
  const result = await attestSupabaseServiceRoleKey(rawKey, {
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
  legacyKey({ ref: "blwogrdezfhprdpdnxtn" }),
  "BLOCKED_PROJECT_OR_ROLE",
);

async function expectVerified(rawKey, expectedType) {
  let fetchCalls = 0;
  let bodyCancels = 0;
  let bodyReads = 0;
  const result = await attestSupabaseServiceRoleKey(rawKey, {
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert.equal(url, SUPABASE_KEY_ATTESTATION_ENDPOINT);
      assert.equal(url, "https://eehyehlhiyztciaezaus.supabase.co/rest/v1/");
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
  assert.equal(result.status, "VERIFIED_TEST_PROJECT");
  assert.equal(result.fingerprint, fingerprintServerCredential(rawKey));
  assert.equal(fetchCalls, 1);
  assert.equal(bodyCancels, 1);
  assert.equal(bodyReads, 0);
  checks += 1;
}

const validLegacyKey = legacyKey();
await expectVerified(validLegacyKey, "Legacy service_role JWT");
await expectVerified(`sb_secret_${"A".repeat(40)}`, "sb_secret");

for (const status of [401, 302]) {
  const result = await attestSupabaseServiceRoleKey(validLegacyKey, {
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
const productionAttempt = await attestSupabaseServiceRoleKey(validLegacyKey, {
  endpoint: "https://blwogrdezfhprdpdnxtn.supabase.co/rest/v1/",
  fetchImpl: async () => {
    productionFetchCalls += 1;
    throw new Error("Production must never be reached");
  },
});
assert.equal(productionAttempt.status, "BLOCKED_ENDPOINT");
assert.equal(productionAttempt.passed, false);
assert.equal(productionAttempt.fingerprint, null);
assert.equal(productionFetchCalls, 0);
checks += 1;

const networkFailure = await attestSupabaseServiceRoleKey(validLegacyKey, {
  fetchImpl: async () => { throw new Error("synthetic network failure"); },
});
assert.equal(networkFailure.status, "BLOCKED_NETWORK");
assert.equal(networkFailure.passed, false);
assert.equal(networkFailure.fingerprint, null);
checks += 1;

const timeoutFailure = await attestSupabaseServiceRoleKey(validLegacyKey, {
  timeoutMs: 5,
  fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }),
});
assert.equal(timeoutFailure.status, "BLOCKED_TIMEOUT");
assert.equal(timeoutFailure.passed, false);
assert.equal(timeoutFailure.fingerprint, null);
checks += 1;

const runtimeBase = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: SEC003_PREVIEW_RUNTIME.branch,
  VERCEL_PROJECT_ID: SEC003_PREVIEW_RUNTIME.vercelProjectId,
  VERCEL_PROJECT_NAME: SEC003_PREVIEW_RUNTIME.vercelProjectName,
  DEPLOYMENT_PURPOSE: "test",
  EXPECTED_SUPABASE_PROJECT: SEC003_PREVIEW_RUNTIME.supabaseProjectRef,
  SUPABASE_URL: SEC003_PREVIEW_RUNTIME.supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: validLegacyKey,
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
  `SEC-003 key attestation: PASS (${checks} checks; mocked network only; 0 DB clients on gate failures)`,
);
