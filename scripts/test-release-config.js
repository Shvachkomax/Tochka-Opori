import assert from "node:assert/strict";
import { isPreviewTestEnvironment } from "../vite.config.js";
import { isMyPracticeServerEnabled } from "../lib/my-practice/workspace-handler.js";

const base = { VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "test" };
assert.equal(isPreviewTestEnvironment(base), true, "Preview/test enables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "production", DEPLOYMENT_PURPOSE: "live" }), false, "Production/live disables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "live" }), false, "Preview/live disables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "preview" }), false, "Preview without explicit test purpose disables test-only UI");
assert.equal(isPreviewTestEnvironment({}), false, "Local build without deployment variables disables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "production", DEPLOYMENT_PURPOSE: "test", VERCEL_PROJECT_ID: "prj_BSzyfSJjjrCTI0RieWuVxR8qh3el" }), true, "allowlisted Test project may use a production-shaped target");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "production", DEPLOYMENT_PURPOSE: "test", VERCEL_PROJECT_ID: "prj_SeESCUVqpuz1yNdfsbZohp1eFGIx" }), false, "real Production project is never allowlisted");
const testProjectEnv={ MY_PRACTICE_SERVER_ENABLED: "true", MY_PRACTICE_ALLOWED_SUPABASE_REF: "eehyehlhiyztciaezaus", SUPABASE_URL: "https://eehyehlhiyztciaezaus.supabase.co", DEPLOYMENT_PURPOSE: "test", VERCEL_ENV: "production", VERCEL_PROJECT_ID: "prj_BSzyfSJjjrCTI0RieWuR8qh3el" };
assert.equal(isMyPracticeServerEnabled({ ...testProjectEnv, VERCEL_PROJECT_ID: "prj_BSzyfSJjjrCTI0RieWuR8qh3el" }), false, "invalid project IDs fail closed");
assert.equal(isMyPracticeServerEnabled({ ...testProjectEnv, VERCEL_PROJECT_ID: "prj_BSzyfSJjjrCTI0RieWuVxR8qh3el" }), true, "allowlisted Test project server gate opens only for Test Supabase");

console.log("Release configuration matrix: PASS (only explicit Preview+test enables test-only UI)");
