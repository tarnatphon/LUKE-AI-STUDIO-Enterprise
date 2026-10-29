#!/usr/bin/env node
"use strict";

/**
 * Social Agency — the LinkedIn token has an expiry, and the screen that holds it
 * has to say so before a scheduled post dies on a 401.
 *
 * A member token lives 60 days, LinkedIn has no refresh flow, and the API never
 * tells you which day it expires. The app records the day the token was stored
 * (connectors.linkedin.tokenSavedAt) and these checks pin both halves of the
 * answer:
 *
 *   - the runtime derives an expiry date / days-left from that stamp and never
 *     invents one when the stamp is missing (tokens pasted before the field
 *     existed would otherwise be given a made-up deadline);
 *   - the Connectors card shows nothing while there is time, a quiet hint when
 *     it gets closer, and an alert with the exact command to re-mint it in the
 *     last week — including the "already expired" case.
 *
 * The card is rendered for real (React SSR through the app's own Vite build), so
 * what is asserted is what the operator sees, not the source that builds it.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");

const root = path.resolve(__dirname, "..", "..");
const frontend = path.join(root, "app", "frontend");
const fromFrontend = createRequire(path.join(frontend, "package.json"));

const DAY = 86400000;
const stampDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

function connectorsFixture({ daysLeft: daysLeftIn = null, savedAt = null, hasToken = true, dryRun = true } = {}) {
  const saved = savedAt || (daysLeftIn === null ? null : stampDaysAgo(60 - daysLeftIn));
  const expires = saved ? new Date(Date.parse(saved) + 60 * DAY).toISOString().slice(0, 10) : null;
  // The backend sends all three; deriving daysLeft from the stamp here keeps the
  // fixture honest for cases that only name a date (e.g. an expired token).
  const daysLeft = hasToken ? SocialAgencyRuntime._linkedinTokenDaysLeft(saved) : null;
  return {
    linkedin: {
      configured: hasToken,
      accessToken: hasToken ? "••••KWG6xQ" : "",
      hasToken,
      authorUrn: hasToken ? "urn:li:person:q15d9LxIrG" : "",
      dryRun,
      apiVersion: "202601",
      versionExpiresAt: "2027-01-31",
      tokenSavedAt: saved,
      tokenExpiresAt: expires,
      tokenDaysLeft: daysLeft,
    },
  };
}

const CLIENT = { id: "thai-modern-bags", name: "Thai Modern Bags Co.,Ltd." };

async function main() {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);

  // ── the derived numbers ───────────────────────────────────────────────────

  test("วันหมดอายุคำนวณจากวันที่เก็บ token (60 วัน) และไม่เดาเมื่อไม่รู้", () => {
    assert.strictEqual(SocialAgencyRuntime._linkedinTokenExpiry("2026-10-28T03:00:00.000Z"), "2026-12-27");
    assert.strictEqual(SocialAgencyRuntime._linkedinTokenExpiry(""), null);
    assert.strictEqual(SocialAgencyRuntime._linkedinTokenExpiry("not-a-date"), null);
    const left = SocialAgencyRuntime._linkedinTokenDaysLeft(stampDaysAgo(55));
    assert.strictEqual(left, 5, "55 days old leaves 5 of the 60");
    assert.strictEqual(SocialAgencyRuntime._linkedinTokenDaysLeft(null), null);
  });

  test("connectors view ส่ง tokenDaysLeft/tokenExpiresAt ให้หน้าจอ (และไม่รั่ว token)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sa-li-token-health-"));
    const rt = new SocialAgencyRuntime({ root: tmp });
    const clientId = rt.createClient({ name: "ร้านทดสอบ", firstProduct: "กระเป๋า" }).id;
    assert.strictEqual(rt.getConnectorsView(clientId).linkedin.tokenDaysLeft, null, "no token yet → nothing to count");
    rt.saveConnectors(clientId, { connectors: { linkedin: { accessToken: "AQVtoken-abcdefghijklmnop", authorUrn: "urn:li:person:AbC" } } });
    const fresh = rt.getConnectorsView(clientId).linkedin;
    assert.ok(Number.isFinite(fresh.tokenDaysLeft) && fresh.tokenDaysLeft >= 59, `fresh token should be ~59-60 days, got ${fresh.tokenDaysLeft}`);
    assert.match(fresh.tokenExpiresAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!JSON.stringify(fresh).includes("AQVtoken-abcdefghijklmnop"), "the view stays masked");
    const st = rt._read();
    st.clients.find((c) => c.id === clientId).connectors.linkedin.tokenSavedAt = stampDaysAgo(56);
    rt._write(st);
    assert.strictEqual(rt.getConnectorsView(clientId).linkedin.tokenDaysLeft, 4);
  });

  // ── the card ──────────────────────────────────────────────────────────────

  const vite = await import(pathToFileURL(fromFrontend.resolve("vite")).href);
  const { default: react } = await import(pathToFileURL(fromFrontend.resolve("@vitejs/plugin-react")).href);
  const cacheRoot = path.join(frontend, "node_modules", ".cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(cacheRoot, "sa-li-token-health-"));
  const entry = path.join(work, "entry.jsx");
  fs.writeFileSync(entry, [
    `export { ConnectorsDrawer } from ${JSON.stringify(path.join(frontend, "src", "social-agency", "drawers.jsx"))};`,
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
      rollupOptions: { output: { format: "cjs", entryFileNames: "card.cjs" } },
    },
    ssr: { noExternal: true },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const { ConnectorsDrawer, createElement, renderToStaticMarkup } = require(path.join(work, "out", "card.cjs"));

  const renderCard = (connectors) => renderToStaticMarkup(createElement(ConnectorsDrawer, {
    client: CLIENT,
    connectors,
    onClose() {},
    onSave() {},
    onTest() {},
    busy: false,
  }));

  try {
    test("เหลืออายุมาก → ไม่มีคำเตือนรบกวน", () => {
      const markup = renderCard(connectorsFixture({ daysLeft: 45 }));
      assert.doesNotMatch(markup, /token เหลืออายุ/, "no warning while there is plenty of time");
      assert.doesNotMatch(markup, /ขอใหม่แล้วบันทึกทับ/, "nothing to re-mint yet");
    });

    test("เหลือ 3 สัปดาห์ → บอกเป็นคำเตือนธรรมดาว่าไม่มี refresh token", () => {
      const markup = renderCard(connectorsFixture({ daysLeft: 14 }));
      assert.match(markup, /token เหลืออายุอีก 14 วัน/);
      assert.match(markup, /LinkedIn ไม่มี refresh token/);
      assert.match(markup, /หมดอายุประมาณ \d{4}-\d{2}-\d{2}/);
      assert.doesNotMatch(markup, /role="alert"[^>]*>token เหลืออายุ/, "not an alarm yet");
    });

    test("เหลือ ≤ 7 วัน → ขึ้น alert พร้อมคำสั่งขอ token ใหม่ที่รันได้", () => {
      const markup = renderCard(connectorsFixture({ daysLeft: 3 }));
      assert.match(markup, /role="alert"/);
      assert.match(markup, /token เหลืออายุอีก 3 วัน/);
      // The command is inside <code> so it is one click-drag away, and it holds
      // no < > — zsh would read those as redirection.
      assert.match(markup, /<code>node scripts\/social-agency-linkedin-token\.cjs --prompt --save<\/code>/);
    });

    test("หมดอายุแล้ว → บอกตรง ๆ ว่าโพสต์จะถูกปฏิเสธ", () => {
      const markup = renderCard(connectorsFixture({ savedAt: stampDaysAgo(75) }));
      assert.match(markup, /token หมดอายุแล้ว/);
      assert.match(markup, /โพสต์ LinkedIn จะถูกปฏิเสธ/);
    });

    test("ยังไม่มี token หรือไม่รู้วันที่วาง → ไม่เดาวันหมดอายุ", () => {
      const none = renderCard(connectorsFixture({ hasToken: false, daysLeft: null }));
      assert.doesNotMatch(none, /token เหลืออายุ/);
      const unknown = renderCard(connectorsFixture({ hasToken: true, daysLeft: null }));
      assert.doesNotMatch(unknown, /token เหลืออายุ/);
      assert.doesNotMatch(unknown, /token หมดอายุแล้ว/);
    });

    test("พิมพ์ token ใหม่แล้วยังไม่บันทึก → ไม่เอาการนับถอยหลังของ token เก่ามาเตือน", () => {
      // The field starts as the masked echo; a fresh value means the stored one
      // is about to be replaced, so the old countdown is noise.
      const markup = renderCard({ ...connectorsFixture({ daysLeft: 2 }), linkedin: { ...connectorsFixture({ daysLeft: 2 }).linkedin } });
      assert.match(markup, /token เหลืออายุอีก 2 วัน/, "the masked echo still shows the countdown");
      const source = fs.readFileSync(path.join(frontend, "src", "social-agency", "drawers.jsx"), "utf8");
      assert.match(source, /form\.linkedin\.accessToken && !\/\^••••\/\.test\(form\.linkedin\.accessToken\)/);
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  let passed = 0;
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
  if (!process.exitCode) console.log(`PASS: ${passed} LinkedIn token expiry checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
