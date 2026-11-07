import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

// One level above app/: the img2img step rule that services/api.js imports lives in
// scripts/server/img2img-steps.cjs, because the server runtime requires the same
// file. The dev server reads files through /@fs/, so it has to be allowed to serve
// that path.
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Which commit is this bundle built from?
 *
 * "I rebuilt and the feature is still missing" is unanswerable from the screen
 * alone, and a stale app/dist looks exactly like a fresh one. So the build
 * stamps its own commit into the bundle and into app/dist/build-info.json,
 * where serve.cjs can read it back and compare it with the checkout it runs.
 *
 * Deliberately no wall-clock timestamp in either place: the repo rebuilds the
 * frontend in a temp folder and compares it byte for byte with the committed
 * app/dist (test-frontend-dist-freshness.cjs), so two builds of the same commit
 * have to be identical. The commit date is stable; "built at" is not.
 */
function readBuildStamp() {
  const git = (args) => execFileSync("git", ["-C", REPO_ROOT, ...args], {
    encoding: "utf8",
    timeout: 4000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const unknown = { available: false, commit: "", shortCommit: "", branch: "", dirty: false, commitDate: "" };
  try {
    const commit = git(["rev-parse", "HEAD"]);
    if (!commit) return unknown;
    const optional = (args) => {
      try { return git(args); } catch { return ""; }
    };
    let version = "";
    try {
      version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "app", "version.json"), "utf8")).version || "";
    } catch { /* version is decoration */ }
    return {
      available: true,
      commit,
      shortCommit: commit.slice(0, 7),
      branch: optional(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: optional(["status", "--porcelain"]).length > 0,
      commitDate: optional(["show", "-s", "--format=%cI", "HEAD"]),
      version,
    };
  } catch {
    return unknown;
  }
}

const BUILD_STAMP = readBuildStamp();

// Written into the build output (including a --outDir override) so the server
// can answer "what was this dist built from?" without parsing a bundle.
function writeBuildInfo() {
  let outDir = "";
  return {
    name: "luke-build-info",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      if (!outDir) return;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "build-info.json"), `${JSON.stringify(BUILD_STAMP, null, 2)}\n`);
    },
  };
}

/**
 * pdf.js renders text with data files it does not bundle: the 14 standard fonts
 * (so a PDF that never embedded Helvetica still draws) and the CJK/Thai cmaps
 * (so a CID-keyed PDF from a Thai office suite still decodes). Without them it
 * logs "Ensure that the `standardFontDataUrl` API parameter is provided" and
 * quietly substitutes glyphs — which is what the chat attachments were doing.
 *
 * The app is offline-first, so the data has to come from our own origin: copied
 * into the build next to index.html, and served from node_modules in dev so the
 * dev server behaves like the shipped app.
 */
function pdfDataFiles() {
  const pkg = path.join(REPO_ROOT, "app", "frontend", "node_modules", "pdfjs-dist");
  const dirs = ["standard_fonts", "cmaps"];
  let outDir = "";

  return {
    name: "luke-pdf-data",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!outDir) return;
      for (const dir of dirs) {
        const source = path.join(pkg, dir);
        if (!fs.existsSync(source)) continue; // dependencies are not installed yet
        fs.cpSync(source, path.join(outDir, "pdfjs", dir), { recursive: true });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/pdfjs\/(standard_fonts|cmaps)\/([\w.+-]+)$/.exec((request.url || "").split("?")[0]);
        if (!match) return next();
        const file = path.join(pkg, match[1], match[2]);
        if (!fs.existsSync(file)) return next();
        response.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(response);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), writeBuildInfo(), pdfDataFiles()],

  // Vite inlines these into the bundle at build time. import.meta.env keeps it
  // out of the global namespace, so nothing has to be declared for the linter.
  define: {
    "import.meta.env.VITE_LUKE_BUILD": JSON.stringify(JSON.stringify(BUILD_STAMP)),
  },

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
