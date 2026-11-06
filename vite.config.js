import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_HEALTH_LIVE_ENABLED': JSON.stringify(
      process.env.VERCEL_ENV === 'preview' && process.env.DEPLOYMENT_PURPOSE === 'test'
        && process.env.VITE_HEALTH_LIVE_ENABLED === 'true' ? 'true' : 'false'
    ),
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
