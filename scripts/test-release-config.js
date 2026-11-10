import assert from "node:assert/strict";
import { isPreviewTestEnvironment } from "../vite.config.js";

const base = { VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "test" };
assert.equal(isPreviewTestEnvironment(base), true, "Preview/test enables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "production", DEPLOYMENT_PURPOSE: "live" }), false, "Production/live disables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "preview", DEPLOYMENT_PURPOSE: "live" }), false, "Preview/live disables test-only UI");
assert.equal(isPreviewTestEnvironment({ VERCEL_ENV: "preview" }), false, "Preview without explicit test purpose disables test-only UI");
assert.equal(isPreviewTestEnvironment({}), false, "Local build without deployment variables disables test-only UI");

console.log("Release configuration matrix: PASS (only explicit Preview+test enables test-only UI)");
