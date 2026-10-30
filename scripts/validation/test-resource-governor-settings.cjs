#!/usr/bin/env node
"use strict";

/**
 * The memory governor, explained and adjustable from the app.
 *
 * A model could be released with the reason living only in the terminal, and
 * the thresholds only reachable by hand-editing `app/runtime-state/
 * resource-governor.json`. That is a setting nobody finds and a decision nobody
 * can explain — which is exactly how "why did my chat model disappear?" became
 * unanswerable.
 *
 * What must stay true:
 *   - a value that cannot be true is reported, never saved;
 *   - an override is only what the user changed, so one machine can go back to
 *     its shipped defaults without guessing them;
 *   - the same numbers the timer uses are the ones the panel shows;
 *   - the card renders the live pressure and the last release, not a blank form.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..", "..");
const settings = require(path.join(root, "scripts", "server", "resource-governor-settings.cjs"));
const governor = require(path.join(root, "scripts", "server", "resource-governor.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const panelSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "PerformancePanel.jsx"),
  "utf8",
);
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-governor-settings-"));
  const file = path.join(tmp, "resource-governor.json");

  // ── validation ──────────────────────────────────────────────────────────
  test("ค่าที่ไม่ใช่ตัวเลขถูกปฏิเสธ พร้อมบอกเหตุผล ไม่ใช่บันทึกเงียบ ๆ", () => {
    const { overrides, rejected } = settings.normalizeOverrides({ criticalSwapGb: "มาก" });
    assert.deepStrictEqual(overrides, {});
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].key, "criticalSwapGb");
    assert.match(rejected[0].reason, /ตัวเลข/);
  });

  test("ค่านอกช่วงถูกปฏิเสธ (swap ติดลบ, ratio เกิน 1)", () => {
    const negative = settings.normalizeOverrides({ criticalSwapGb: -4 });
    assert.strictEqual(negative.rejected[0].key, "criticalSwapGb");
    assert.match(negative.rejected[0].reason, /อยู่ระหว่าง/);

    const ratio = settings.normalizeOverrides({ availableRatioTight: 1.5 });
    assert.strictEqual(ratio.rejected[0].key, "availableRatioTight");
    assert.deepStrictEqual(ratio.overrides, {});
  });

  test("critical ต่ำกว่า tight ไม่มีทางเกิดได้ ถูกปฏิเสธ", () => {
    const { overrides, rejected } = settings.normalizeOverrides({
      tightSwapGb: 3,
      criticalSwapGb: 1,
    });
    assert.strictEqual(overrides.tightSwapGb, 3);
    assert.strictEqual(overrides.criticalSwapGb, undefined, "the impossible value is dropped");
    assert.match(rejected.map((entry) => entry.key).join(","), /criticalSwapGb/);
  });

  test("key ที่ governor ไม่รู้จักถูกปฏิเสธ ไม่ใช่เขียนลงไฟล์", () => {
    const { overrides, rejected } = settings.normalizeOverrides({ makeEverythingFast: 1 });
    assert.deepStrictEqual(overrides, {});
    assert.strictEqual(rejected[0].key, "makeEverythingFast");
    assert.match(rejected[0].reason, /ไม่ใช่ค่าที่ governor ใช้/);
  });

  test("เปิด/ปิดรับได้ทั้ง true/false และ \"true\"/\"false\"", () => {
    assert.strictEqual(settings.normalizeOverrides({ enabled: false }).overrides.enabled, false);
    assert.strictEqual(settings.normalizeOverrides({ enabled: "true" }).overrides.enabled, true);
    assert.strictEqual(settings.normalizeOverrides({ enabled: "maybe" }).rejected.length, 1);
  });

  // ── storing ─────────────────────────────────────────────────────────────
  test("บันทึกทับเฉพาะ key ที่ส่งมา ไม่ลบที่เหลือ", () => {
    settings.saveOverrides({ file, input: { overrides: { criticalSwapGb: 8, idleMinutes: 30 } } });
    settings.saveOverrides({ file, input: { overrides: { criticalSwapGb: 6 } } });
    const stored = settings.readOverrides(file);
    assert.strictEqual(stored.criticalSwapGb, 6);
    assert.strictEqual(stored.idleMinutes, 30, "the untouched key survives");
  });

  test("ส่ง null = คืนค่านั้นให้ค่า default ของเครื่อง ไม่ใช่ล้างทั้งหมด", () => {
    settings.saveOverrides({ file, input: { overrides: { criticalSwapGb: null } } });
    const stored = settings.readOverrides(file);
    assert.strictEqual(stored.criticalSwapGb, undefined);
    assert.strictEqual(stored.idleMinutes, 30);
  });

  test("reset = กลับไปใช้ค่าที่มากับเครื่องจริง ๆ (ลบไฟล์ทิ้ง)", () => {
    settings.saveOverrides({ file, input: { reset: true } });
    assert.deepStrictEqual(settings.readOverrides(file), {});
    assert.strictEqual(fs.existsSync(file), false, "no file, no override");
  });

  test("ไฟล์ที่แก้ด้วยมือและมี key แปลก ๆ ถูกกรองตอนอ่าน", () => {
    fs.writeFileSync(file, JSON.stringify({ criticalSwapGb: 7, somethingElse: true }), "utf8");
    const stored = settings.readOverrides(file);
    assert.deepStrictEqual(stored, { criticalSwapGb: 7 });
  });

  // ── describing ──────────────────────────────────────────────────────────
  test("describe บอกทั้งค่า default ของ tier, override ของผู้ใช้ และ policy ที่ใช้จริง", () => {
    const described = settings.describeGovernorSettings({
      tier: "high",
      overrides: { criticalSwapGb: 8 },
      file: "app/runtime-state/resource-governor.json",
      status: { pressure: { level: "ok" } },
    });
    assert.strictEqual(described.tier, "high");
    assert.strictEqual(described.defaults.criticalSwapGb, governor.TIER_POLICIES.high.criticalSwapGb);
    assert.strictEqual(described.overrides.criticalSwapGb, 8);
    assert.strictEqual(described.policy.criticalSwapGb, 8, "the override is what acts");
    assert.strictEqual(described.policy.idleMinutes, governor.TIER_POLICIES.high.idleMinutes, "the rest is the tier");
    assert.ok(described.fields.length >= 8, "the panel has fields to draw");
    for (const field of described.fields) {
      assert.ok(field.label && field.help, `${field.key} explains itself`);
    }
  });

  test("ทุก field ที่ panel วาด เป็น key ที่ governor อ่านจริง", () => {
    const known = Object.keys(governor.DEFAULT_POLICY);
    for (const field of settings.EDITABLE_FIELDS) {
      assert.ok(known.includes(field.key), `${field.key} is part of the policy`);
    }
  });

  // ── routes ──────────────────────────────────────────────────────────────
  test("serve.cjs: GET และ POST /api/resource-governor มีจริง", () => {
    assert.match(
      serveSource,
      /req\.url === "\/api\/resource-governor" && \(req\.method === "GET" \|\| req\.method === "POST"\)/,
    );
    assert.match(serveSource, /saveGovernorOverrides\(\{ file: RESOURCE_GOVERNOR_STATE_PATH, input: body \}\)/);
    assert.match(serveSource, /describeGovernorSettings\(\{/);
  });

  test("serve.cjs: ไฟล์ override ที่เขียนด้วยมือก็ผ่านการกรองชุดเดียวกัน", () => {
    assert.match(
      serveSource,
      /function readResourceGovernorOverrides\(\)[\s\S]{0,600}?return readGovernorOverrides\(RESOURCE_GOVERNOR_STATE_PATH\);/,
    );
  });

  test("PerformancePanel อ่านและบันทึกผ่าน route เดียวกัน", () => {
    assert.match(panelSource, /fetch\("\/api\/resource-governor"\)/);
    assert.match(panelSource, /method: "POST"/);
    assert.match(panelSource, /JSON\.stringify\(\{ overrides: overrides \|\| \{\} \}\)/);
    assert.match(panelSource, /JSON\.stringify\(\{ reset: true \}\)/);
    assert.match(panelSource, /<GovernorSettingsCard/);
  });

  // ── what the card shows ─────────────────────────────────────────────────
  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "governor-card-"));
  const entryFile = path.join(work, "entry.jsx");
  fs.writeFileSync(
    entryFile,
    [
      `export { default as GovernorSettingsCard } from ${JSON.stringify(
        path.join(frontend, "src", "components", "GovernorSettingsCard.jsx"),
      )};`,
      'export { createElement } from "react";',
      'export { renderToStaticMarkup } from "react-dom/server";',
    ].join("\n"),
  );
  await vite.build({
    root: frontend,
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: {
      ssr: entryFile,
      outDir: path.join(work, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "governor.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const built = require(path.join(work, "out", "governor.cjs"));

  const data = settings.describeGovernorSettings({
    tier: "high",
    overrides: { criticalSwapGb: 8 },
    file: "app/runtime-state/resource-governor.json",
    status: {
      enabled: true,
      tier: "high",
      lastSweepAt: Date.now(),
      pressure: {
        level: "critical",
        reason: "swap in use: 5.24 GB (critical at 4 GB) · memory compressor holding 5.13 GB (critical at 4 GB)",
      },
      decision: { code: "MEMORY_CRITICAL", engine: "text", reason: "releasing Chat model (4.98 GB, idle 0 min)" },
      lastRelease: { engine: "text", code: "MEMORY_CRITICAL", sizeGb: 4.98, at: Date.now() },
    },
  });

  const markup = built.renderToStaticMarkup(
    built.createElement(built.GovernorSettingsCard, { data, busy: "", note: "" }),
  );

  try {
    test("การ์ดบอกว่าตอนนี้เครื่องเป็นอย่างไร และ governor ทำอะไรล่าสุด", () => {
      assert.match(markup, /Memory governor/);
      assert.match(markup, /critical/);
      assert.match(markup, /swap in use: 5\.24 GB/);
      assert.match(markup, /releasing Chat model/);
      assert.match(markup, /4\.98 GB/);
    });

    test("การ์ดแสดงค่าที่ใช้จริง และทำเครื่องหมายว่าค่าไหนถูกแก้", () => {
      assert.match(markup, /id="governor-criticalSwapGb"[^>]*value="8"/);
      assert.match(markup, /id="governor-idleMinutes"[^>]*value="45"/, "the tier default fills the rest");
      assert.match(markup, />reset</, "an overridden field can go back to the shipped value");
    });

    test("การ์ดอธิบายทุกช่อง ไม่ใช่ตัวเลขลอย ๆ", () => {
      assert.match(markup, /Swap in use above this releases a model even if it was used a second ago/);
      assert.match(markup, /The compressor holding this much means the machine is short right now/);
      assert.match(markup, /app\/runtime-state\/resource-governor\.json/);
    });

    test("ยังไม่มีข้อมูล = บอกว่ากำลังอ่าน ไม่ใช่ฟอร์มเปล่า", () => {
      const empty = built.renderToStaticMarkup(
        built.createElement(built.GovernorSettingsCard, { data: null, busy: "", note: "" }),
      );
      assert.match(empty, /Reading the governor/);
      assert.match(empty, /Memory governor/);
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok - ${name}`);
    } catch (err) {
      console.error(`  FAIL - ${name}\n${err.stack || err}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${tests.length} resource governor settings checks`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
