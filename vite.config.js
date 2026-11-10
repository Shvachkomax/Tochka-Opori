import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { isMyPracticeTestEnvironment } from "./lib/my-practice/workspace-handler.js";

export function isPreviewTestEnvironment(env = process.env) {
  return isMyPracticeTestEnvironment(env);
}

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_ENABLE_PARTNER_TEST_ACCOUNTING": JSON.stringify(
      isPreviewTestEnvironment(process.env) ? "true" : "false"
    ),
    ...Object.fromEntries(["VITE_ENABLE_MY_PRACTICE_PILOT", "VITE_ENABLE_MY_PRACTICE_SERVER_UI"].map(key => [
      `import.meta.env.${key}`, JSON.stringify(process.env.VERCEL_ENV === "preview"
        && process.env.DEPLOYMENT_PURPOSE === "test" && process.env[key] === "true" ? "true"
        : isMyPracticeTestEnvironment(process.env) && process.env[key] === "true" ? "true" : "false"),
    ])),
    ...Object.fromEntries(['HEALTH', 'SUPPORT'].map(module => [
      `import.meta.env.VITE_${module}_LIVE_ENABLED`, JSON.stringify(
        process.env.VERCEL_ENV === 'preview' && process.env.DEPLOYMENT_PURPOSE === 'test'
          && process.env[`VITE_${module}_LIVE_ENABLED`] === 'true' ? 'true' : 'false'
      ),
    ])),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
