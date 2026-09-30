import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// One level above app/: the img2img step rule that services/api.js imports lives in
// scripts/server/img2img-steps.cjs, because the server runtime requires the same
// file. The dev server reads files through /@fs/, so it has to be allowed to serve
// that path.
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    // Output to app/dist/ so serve.cjs can find it
    outDir: "../dist",
    emptyOutDir: true,
    // app/dist is not tracked by git, so when a chunk goes missing there is
    // nothing to restore it from. The manifest is the authoritative list of
    // what the build emits, which is what mac.sh checks the build against.
    manifest: true,
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // Default is the folder holding the lockfile (app/frontend). The shared
      // img2img step rule sits above it, so allow the whole checkout.
      allow: [REPO_ROOT],
    },
    proxy: {
      "/txt2img": { target: "http://127.0.0.1:8080", changeOrigin: true },
      "/img2img":  { target: "http://127.0.0.1:8080", changeOrigin: true },
      "/v1":       { target: "http://127.0.0.1:8080", changeOrigin: true },
      "/api":      { target: "http://127.0.0.1:1422", changeOrigin: true },
    }
  },
}));
