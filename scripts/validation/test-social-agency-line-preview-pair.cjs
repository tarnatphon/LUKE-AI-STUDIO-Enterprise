#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the LINE preview shows the same two images that a LINE send
 * carries: the AI image, then the real product photo. The React component is
 * server-rendered (no browser, no backend, no account). When the product photo
 * is still an external link, the preview says why only one image shows.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

async function main() {
  // The preview imports the shared CommonJS copy helper. Vite's dev SSR loader
  // cannot evaluate that file, so the component is bundled with Vite's own SSR
  // build (which converts CommonJS) and rendered with the same React the app uses.
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const os = require("node:os");
  const fs = require("node:fs");
  // Inside the frontend's node_modules so the bundler resolves the same React copy.
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-line-preview-"));
  const entry = path.join(work, "entry.jsx");
  const previewPath = path.join(frontend, "src", "social-agency", "PostPreview.jsx");
  fs.writeFileSync(entry, [
    `export { default as PostPreview } from ${JSON.stringify(previewPath)};`,
    'export { createElement } from "react";',
    'export { renderToStaticMarkup } from "react-dom/server";',
  ].join("\n"));
  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entry,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "preview.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { PostPreview, createElement, renderToStaticMarkup } = require(path.join(work, "out", "preview.cjs"));

  let passed = 0;
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  {
    const render = (platform, productImage, settings = {}) => renderToStaticMarkup(createElement(PostPreview, {
      platform,
      entry: { id: "e1", platform, date: "2026-10-27", time: "10:00", status: "planned", caption: "สินค้าใหม่มาแล้วค่ะ", image: { url: "/api/output-file?filename=ai.png" } },
      client: { id: "c1", settings, connectors: {} },
      product: { sku: "SSB-014", name: "กระเป๋าใส่รองเท้า", image: productImage },
      caption: "สินค้าใหม่มาแล้วค่ะ",
    }));
    const local = "/sa-products/c1/SSB-014.png";
    const remote = "https://www.thaimodernbags.com/images/ssb-014.jpg";

    test("LINE with a local product photo shows the AI image and the product photo", () => {
      const html = render("line", local);
      assert.match(html, /sa-post-preview-carousel/, "two-image layout");
      assert.equal((html.match(/<img\b/g) || []).length, 2, "exactly two images");
      assert.match(html, /\/api\/output-file\?filename=ai\.png/, "AI image is first");
      assert.match(html, /\/sa-products\/c1\/SSB-014\.png/, "product photo is second");
      assert.match(html, /รูปสินค้าจริง/, "second image is labelled");
      assert.doesNotMatch(html, /ยังไม่มีรูปสินค้าจริงในเครื่อง/, "no missing-photo note");
    });

    test("Facebook and Instagram keep the same pair", () => {
      for (const platform of ["facebook", "instagram"]) {
        const html = render(platform, local);
        assert.equal((html.match(/<img\b/g) || []).length, 2, `${platform}: two images`);
      }
    });

    test("LINE with a remote product photo shows one image and says why", () => {
      const html = render("line", remote);
      assert.doesNotMatch(html, /sa-post-preview-carousel/, "no second image");
      assert.equal((html.match(/<img\b/g) || []).length, 1, "one image only");
      assert.match(html, /ยังไม่มีรูปสินค้าจริงในเครื่อง/, "the note explains the missing photo");
    });

    test("productRefInPost off: one image, no note", () => {
      const html = render("line", remote, { productRefInPost: false });
      assert.equal((html.match(/<img\b/g) || []).length, 1, "single image");
      assert.doesNotMatch(html, /ยังไม่มีรูปสินค้าจริงในเครื่อง/, "no note when the pair is off");
    });

    test("TikTok stays unchanged: no product pair", () => {
      const html = render("tiktok", local);
      assert.doesNotMatch(html, /sa-post-preview-carousel/);
    });

    for (const [name, fn] of tests) {
      try {
        fn();
        passed += 1;
        console.log(`  ok - ${name}`);
      } catch (err) {
        console.error(`  FAIL - ${name}\n${err.stack || err}`);
        process.exitCode = 1;
        break;
      }
    }
    if (!process.exitCode) console.log(`PASS: ${passed} LINE preview pair checks`);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
