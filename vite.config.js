import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    ...Object.fromEntries(["VITE_ENABLE_MY_PRACTICE_PILOT", "VITE_ENABLE_MY_PRACTICE_SERVER_UI"].map(key => [
      `import.meta.env.${key}`, JSON.stringify(process.env.VERCEL_ENV === "preview"
        && process.env.DEPLOYMENT_PURPOSE === "test" && process.env[key] === "true" ? "true" : "false"),
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
