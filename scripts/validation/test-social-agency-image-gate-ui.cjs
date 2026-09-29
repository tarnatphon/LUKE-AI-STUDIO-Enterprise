#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the image review gate has to be readable, and it has to say
 * when the picture on screen was not built from the real product photo.
 *
 * Two defects from the same screen are guarded here:
 *
 *  1. `.sa-shell input { width: 100%; min-height: 36px; background: <card> }`
 *     was written for text fields but matched checkboxes too, so the review
 *     gate's confirmation checkbox rendered as a large white square that pushed
 *     its label text into the button below it. The rule has to stay off
 *     checkbox/radio, with an explicit size rule for them.
 *  2. `imageJob.refMode` / `imageJob.warning` were recorded but never shown, so
 *     an image generated without the product reference could be approved (and
 *     published) without anyone being told.
 *
 * The frontend is not rendered here — these are source-level invariants, the
 * same approach test-frontend-link-safety.cjs takes for the guard it protects —
 * plus real assertions against the shared helper the tabs call.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const src = (...parts) => fs.readFileSync(path.join(root, "app", "frontend", "src", ...parts), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Comments would otherwise be read as part of the selector before them.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Every rule whose selector targets `.sa-shell input` (or the same thing with a
// state pseudo-class), so the guard can be checked rule by rule instead of
// grepping for one blessed string.
function shellInputRules(css) {
  const out = [];
  for (const block of css.split("}")) {
    const [selectorText = "", body = ""] = block.split("{");
    for (const raw of selectorText.split(",")) {
      const sel = raw.trim().replace(/\s+/g, " ");
      if (/^\.sa-shell input(?::[a-z-]+(?:\([^)]*\))?|\[[^\]]*\])*$/.test(sel)) out.push({ sel, body });
    }
  }
  return out;
}

function cssRule(css, dataSelectorPart) {
  const found = [];
  for (const block of css.split("}")) {
    const [selectorText = "", body = ""] = block.split("{");
    for (const raw of selectorText.split(",")) {
      const sel = raw.trim().replace(/\s+/g, " ");
      if (sel.includes(dataSelectorPart)) found.push({ sel, body });
    }
  }
  return found;
}

async function main() {
  const css = src("social-agency.css");
  const cssRules = stripComments(css);
  const drawers = src("social-agency", "drawers.jsx");
  const runsTab = src("social-agency", "RunsTab.jsx");
  const { productRefNotice, PRODUCT_REF_MODE_LABEL } = await import(
    pathToFileURL(path.join(root, "app", "frontend", "src", "social-agency", "lib.js")).href
  );

  test("no box-sizing rule for a bare input can reach a checkbox or radio", () => {
    const rules = shellInputRules(cssRules);
    assert.ok(rules.length >= 2, `expected the shell input rules, found ${rules.length}`);
    // The text-field styling must be guarded; state pseudo-classes (:focus,
    // :disabled) may stay unguarded because they set no box properties here.
    const textField = rules.find((r) => /width:\s*100%/.test(r.body) && /min-height/.test(r.body));
    assert.ok(textField, "the text-field rule for .sa-shell input disappeared — did the styling move?");
    assert.strictEqual(textField.sel, '.sa-shell input:not([type="checkbox"]):not([type="radio"])', `unexpected selector: ${textField.sel}`);
    for (const rule of rules) {
      if (/\[type="(checkbox|radio|range)"\]/.test(rule.sel)) continue; // aimed at these controls on purpose
      const touchesBox = /(^|[\s;{])(width|min-height|background|padding)\s*:/.test(rule.body);
      if (touchesBox) {
        assert.strictEqual(rule.sel, '.sa-shell input:not([type="checkbox"]):not([type="radio"])', `this rule can still restyle a checkbox: ${rule.sel}`);
      }
    }
  });

  test("checkboxes and radios get an explicit inline size instead of a text-field box", () => {
    const toggleRules = shellInputRules(cssRules).filter((r) => /\[type="(checkbox|radio)"\]/.test(r.sel));
    const rule = toggleRules.find((r) => r.sel === '.sa-shell input[type="checkbox"]');
    assert.ok(rule, "no .sa-shell input[type=checkbox] rule found");
    assert.ok(toggleRules.some((r) => r.sel === '.sa-shell input[type="radio"]'), "radios need the same rule");
    const width = Number((rule.body.match(/width:\s*([\d.]+)px/) || [])[1]);
    assert.ok(width > 0 && width <= 20, `checkbox width must be a control, not a text field (got ${width}px)`);
    assert.match(rule.body, /min-height:\s*0/, "a checkbox must not inherit min-height: 36px");
    assert.match(rule.body, /flex:\s*none/, "a checkbox must not stretch inside a flex row");
    assert.match(rule.body, /background:\s*none/, "the card background is what made it a big white square");
  });

  test("the confirmation label lays the checkbox out in its own column", () => {
    const [rule] = cssRule(cssRules, ".sa-image-gate-confirm").filter((r) => r.sel === ".sa-image-gate-confirm");
    assert.ok(rule, "no .sa-image-gate-confirm rule");
    assert.match(rule.body, /grid-template-columns:\s*auto 1fr/, "text must wrap beside the checkbox, not under it");
    assert.match(rule.body, /align-items:\s*start/);
    const [buttonRule] = cssRule(cssRules, ".sa-image-gate .sa-btn").filter((r) => r.sel === ".sa-image-gate .sa-btn");
    assert.ok(buttonRule, "no .sa-image-gate .sa-btn rule");
    assert.match(buttonRule.body, /align-self:\s*flex-start/, "the button must not stretch over the label");
  });

  test("the gate markup separates the checkbox from its label text", () => {
    const gate = drawers.slice(drawers.indexOf("function ImageReviewGate"), drawers.indexOf("function ImageRefLine"));
    assert.ok(gate.length > 200, "ImageReviewGate not found");
    assert.match(gate, /className="sa-image-gate-confirm"/);
    assert.match(gate, /<input type="checkbox" className="sa-image-gate-check"/);
    assert.match(gate, /<span>ฉันดูภาพนี้เทียบกับรูปสินค้าจริงของ SKU \{entry\.sku\} แล้ว/, "the label text is its own element");
  });

  test("the gate and the approval queue both surface the product-reference warning", () => {
    assert.match(drawers.slice(drawers.indexOf("function ImageReviewGate")), /productRefNotice\(entry\)/);
    assert.match(runsTab, /productRefNotice\(entry\)/, "the queue card has to warn too");
    assert.match(runsTab, /sa-warn-banner/, "the queue warning needs the visible banner style");
    assert.match(cssRules, /\.sa-warn-banner\s*\{/, "no .sa-warn-banner style");
  });

  test("the entry drawer shows which reference mode built the picture on screen", () => {
    assert.match(drawers, /function ImageRefLine\(\{ entry \}\)/);
    assert.match(drawers, /<ImageRefLine entry=\{entry\} \/>/);
    assert.match(drawers, /PRODUCT_REF_MODE_LABEL/);
  });

  test("the connectors drawer can switch mode and denoise, and explains the trade-off", () => {
    assert.match(drawers, /productRefMode/);
    assert.match(drawers, /productRefDenoise/);
    assert.match(drawers, /<option value="img2img">/);
    assert.match(drawers, /<option value="reference">/);
    assert.match(drawers, /type="range" min="0.15" max="0.75"/);
  });

  // ── the helper the interface reads, exercised for real ───────────────────
  test("productRefNotice stays quiet only when the backend was given the photo", () => {
    assert.strictEqual(productRefNotice({ imageJob: { status: "done", refMode: "img2img", usedProductRef: true } }), null);
    assert.strictEqual(productRefNotice({ imageJob: { status: "running" } }), null, "a job in flight says nothing yet");
    assert.strictEqual(productRefNotice({}), null);
    assert.strictEqual(productRefNotice(undefined), null);
  });

  test("productRefNotice warns for every mode that could show the wrong product", () => {
    const warned = [
      { status: "done", refMode: "reference", usedProductRef: true },
      { status: "done", refMode: "none", usedProductRef: false },
      { status: "done", refMode: undefined, usedProductRef: undefined },
    ];
    for (const imageJob of warned) {
      const notice = productRefNotice({ imageJob });
      assert.ok(notice && notice.level === "warn", `expected a warning for ${JSON.stringify(imageJob)}`);
      assert.ok(notice.text.length > 10);
    }
    const off = productRefNotice({ imageJob: { status: "done", refMode: "off" } });
    assert.strictEqual(off.level, "info", "an explicit setting is information, not a warning");
  });

  test("a warning written by the runtime is shown verbatim, and every mode has a label", () => {
    const notice = productRefNotice({ imageJob: { status: "done", refMode: "none", warning: "ไม่ได้ใช้รูปสินค้าอ้างอิง: ไม่พบไฟล์รูปสินค้า" } });
    assert.strictEqual(notice.level, "warn");
    assert.match(notice.text, /ไม่ได้ใช้รูปสินค้าอ้างอิง: ไม่พบไฟล์รูปสินค้า/);
    for (const mode of ["img2img", "reference", "none", "off"]) {
      assert.ok(PRODUCT_REF_MODE_LABEL[mode], `no label for refMode ${mode}`);
    }
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${passed} image gate UI checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
