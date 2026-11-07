#!/usr/bin/env node
"use strict";

/**
 * "Warning: UnknownErrorException: Ensure that the `standardFontDataUrl` API
 * parameter is provided."
 *
 * That line showed up in the launch log of a real install every time a PDF was
 * attached to a chat message. It is not noise: pdf.js says it because the file
 * relies on the 14 standard fonts (Helvetica, Courier, Times, Symbol,
 * Dingbats) — or on a CJK/Thai cmap — and it could not find the glyph data. It
 * substitutes, and the extracted text is then a guess.
 *
 * Two things have to hold, and neither is visible from the source alone:
 *
 *   1. the data ships with the app (vite copies pdfjs-dist/standard_fonts and
 *      pdfjs-dist/cmaps to app/dist/pdfjs), and
 *   2. the chat actually points pdf.js at it.
 *
 * So this suite builds the smallest PDF that triggers the warning, runs pdf.js
 * over it both ways, and requires the quiet one. The Node build of pdf.js reads
 * the data from a filesystem path where the browser reads it from a URL; that
 * is the only difference.
 *
 * Run: node scripts/validation/test-pdf-attachments.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const pdfPackage = path.join(frontend, "node_modules", "pdfjs-dist");
const chatSource = fs.readFileSync(path.join(frontend, "src", "components", "TextChat.jsx"), "utf8");
const viteSource = fs.readFileSync(path.join(frontend, "vite.config.js"), "utf8");
const distPdf = path.join(root, "app", "dist", "pdfjs");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

/**
 * One page, one Helvetica run — Helvetica is a standard font, so a viewer has
 * to find glyph data that the file itself does not carry.
 */
function standardFontPdf() {
  const stream = "BT /F1 24 Tf 20 50 Td (Hello LUKE) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

async function extract(pdfjs, data, options) {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const task = pdfjs.getDocument({ data, disableWorker: true, verbosity: 1, ...options });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    await task.destroy();
    return { text: content.items.map((item) => item.str).join(""), warnings };
  } finally {
    console.warn = realWarn;
  }
}

async function main() {
  console.log("=== PDF attachments ===\n");

  // ── 1. the wiring: chat points at data that ships with the app ────────────
  assert(
    /standardFontDataUrl: `\$\{pdfData\}standard_fonts\/`/.test(chatSource),
    "chat tells pdf.js where the standard fonts are",
  );
  assert(/cMapUrl: `\$\{pdfData\}cmaps\/`/.test(chatSource), "and where the CJK/Thai cmaps are");
  assert(
    /new URL\("pdfjs\/", document\.baseURI\)/.test(chatSource),
    "resolved against the page, so the app works offline instead of calling a CDN",
  );
  assert(
    /fs\.cpSync\(source, path\.join\(outDir, "pdfjs", dir\)/.test(viteSource)
      && /const dirs = \["standard_fonts", "cmaps"\]/.test(viteSource),
    "the build copies both folders into app/dist/pdfjs",
  );
  assert(
    /configureServer\(server\)/.test(viteSource) && /\/pdfjs\\\/\(standard_fonts\|cmaps\)/.test(viteSource),
    "and the dev server serves them, so dev matches the shipped app",
  );

  const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
  assert(
    /pfb\|bcmap/.test(serveSource) && /"\.pfb":/.test(serveSource),
    "the static server answers .pfb/.bcmap as files, not as the SPA shell",
  );

  // ── 2. the data is really in the build ───────────────────────────────────
  if (!fs.existsSync(pdfPackage)) {
    console.log("\n  SKIP: pdfjs-dist is not installed (npm ci --prefix app/frontend)");
    console.log(`\nPASS: ${checks} checks — the wiring is right, the data was not checked.`);
    return;
  }
  if (!fs.existsSync(distPdf)) {
    console.log("\n  SKIP: app/dist has not been built (npm --prefix app/frontend run build)");
    console.log(`\nPASS: ${checks} checks — the wiring is right, the built data was not checked.`);
    return;
  }

  const fonts = fs.readdirSync(path.join(distPdf, "standard_fonts"));
  const cmaps = fs.readdirSync(path.join(distPdf, "cmaps"));
  assert(fonts.includes("LiberationSans-Regular.ttf"), "the build carries the Liberation fonts Helvetica falls back to");
  assert(fonts.some((name) => name.endsWith(".pfb")), "and the Foxit standard-font replacements");
  const packed = cmaps.filter((name) => name.endsWith(".bcmap"));
  assert(packed.length > 150, `and ${packed.length} packed cmaps for CJK/Thai (LICENSE beside them)`);

  // ── 3. the behaviour, measured rather than assumed ───────────────────────
  // pdf.js keeps its font cache in module state and cannot be asked to start
  // over, so each case gets its own module instance — same file, distinct URL.
  const pdfjsUrl = `file://${path.join(pdfPackage, "legacy", "build", "pdf.mjs").split(path.sep).join("/")}`;
  // A fresh copy per case: pdf.js takes ownership of the buffer it is given and
  // detaches it, so the second run would be handed an empty array.
  const blind = await extract(await import(`${pdfjsUrl}?case=blind`), standardFontPdf());
  assert(
    blind.warnings.some((line) => /standardFontDataUrl/.test(line)),
    "without the parameter the fixture really does raise the warning this suite exists for",
  );
  assert(blind.text.includes("Hello LUKE"), "and the text still comes out, which is why nobody noticed");

  // Only the standard fonts here: cmaps are fetched by URL, which the Node
  // build of pdf.js cannot do from a filesystem path. The wiring for cmaps is
  // checked above and their presence in the build is checked below.
  const pointed = await extract(await import(`${pdfjsUrl}?case=pointed`), standardFontPdf(), {
    standardFontDataUrl: `${path.join(pdfPackage, "standard_fonts")}${path.sep}`,
  });
  assert(pointed.warnings.length === 0, `with it, pdf.js is quiet (${pointed.warnings.length} warnings)`);
  assert(pointed.text.includes("Hello LUKE"), "and the text is the same, now from real glyph data");

  console.log(`\nPASS: ${checks} checks — attachments draw with the app's own font data.`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
