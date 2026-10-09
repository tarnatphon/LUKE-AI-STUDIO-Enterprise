#!/usr/bin/env node
"use strict";

/**
 * Social Agency — tests for scripts/social-agency-fb-token.cjs, the Page-token
 * helper people run once when wiring the Facebook connector.
 *
 * The helper exists because the failure mode it prevents is invisible: a Page
 * token minted from a *short-lived* user token carries that expiry, so posting
 * works today and dies tomorrow. The helper therefore has to do more than fetch
 * a token — it has to refuse one that is wrong. These checks are what that
 * refusal is, plus the two properties that matter for a credential tool: a token
 * never reaches stdout unless you asked to reveal it, and Meta's habit of
 * echoing the input token back inside its error text must not spray it into a
 * scrollback file.
 *
 * Everything is mocked: an in-process HTTP server speaks the three Graph
 * endpoints the helper calls. No network, no real account, no token anywhere.
 */

const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(ROOT, "scripts", "social-agency-fb-token.cjs");

const APP_ID = "987654321";
const APP_SECRET = "appsecret_abcdefghij";
const SHORT_USER_TOKEN = "EAAshortlivedusertokenAAAAAAAAAAAAAAAA";
const LONG_USER_TOKEN = "EAAlonglivedusertokenBBBBBBBBBBBBBBBBBBBB";
const GOOD_PAGE = { id: "136018459777356", name: "Oven Banba", token: "EAApagegoodtokenCCCCCCCCCCCCCCCCCCCCCC" };
const STALE_PAGE = { id: "17840000000000001", name: "Doi Hom Coffee", token: "EAApagebadtokenDDDDDDDDDDDDDDDDDDDDDD" };

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A stand-in for graph.facebook.com. `/v25.0/me/accounts` on either host is the
// same request here, so paths are matched on suffix.
function startMockGraph() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const q = url.searchParams;
    const send = (payload, code = 200) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    calls.push(url.pathname);
    if (url.pathname.endsWith("/oauth/access_token")) {
      if (q.get("client_id") !== APP_ID || q.get("client_secret") !== APP_SECRET || q.get("fb_exchange_token") !== SHORT_USER_TOKEN) {
        // Meta echoes the bad token back — the helper has to scrub that.
        return send({ error: { message: `Invalid OAuth access token - Cannot parse access token ${q.get("fb_exchange_token")}` } });
      }
      return send({ access_token: LONG_USER_TOKEN, token_type: "bearer", expires_in: 5184000 });
    }
    if (url.pathname.endsWith("/me/accounts")) {
      if (q.get("access_token") !== LONG_USER_TOKEN) return send({ error: { message: "Error validating access token: the session has expired" } });
      return send({ data: [
        { id: GOOD_PAGE.id, name: GOOD_PAGE.name, category: "Bakery", access_token: GOOD_PAGE.token },
        { id: STALE_PAGE.id, name: STALE_PAGE.name, category: "Cafe", access_token: STALE_PAGE.token },
      ] });
    }
    if (url.pathname.endsWith("/debug_token")) {
      if (q.get("access_token") !== `${APP_ID}|${APP_SECRET}`) return send({ error: { message: "Invalid app access token" } });
      const input = q.get("input_token");
      if (input === GOOD_PAGE.token) {
        return send({ data: { app_id: APP_ID, type: "PAGE", id: GOOD_PAGE.id, valid: true, expires_at: 0, issued_at: 1700000000,
          scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "pages_manage_engagement"] } });
      }
      if (input === STALE_PAGE.token) {
        return send({ data: { app_id: APP_ID, type: "PAGE", id: STALE_PAGE.id, valid: true, expires_at: Math.floor(Date.now() / 1000) + 86400, scopes: ["pages_show_list"] } });
      }
      if (input === LONG_USER_TOKEN) {
        return send({ data: { app_id: APP_ID, type: "USER", id: "1022", valid: true, expires_at: Math.floor(Date.now() / 1000) + 5184000, scopes: ["pages_show_list"] } });
      }
      return send({ data: { valid: false, error: { message: "Invalid OAuth access token." } } });
    }
    return send({ error: { message: `unexpected path ${url.pathname}` } }, 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port })));
}

// Async on purpose: the mock server lives in this process, so a blocking
// spawnSync would park the event loop, the server could never answer, and every
// request would die on the helper's timeout.
function run(args, { input, port, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [HELPER, ...args], {
      cwd: ROOT,
      env: { ...process.env, LUKE_FB_GRAPH_HOST: "127.0.0.1", LUKE_FB_GRAPH_PORT: String(port), LUKE_FB_GRAPH_TLS: "0", ...env },
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      resolve({ status: err ? (Number.isInteger(err.code) ? err.code : 1) : 0, stdout: stdout || "", stderr: stderr || "" });
    });
    child.stdin.end(input ?? "");
  });
}

async function main() {
  const { server, calls, port } = await startMockGraph();
  const MINT_ARGS = ["--app-id", APP_ID, "--app-secret", APP_SECRET, "--token", SHORT_USER_TOKEN];
  const mint = (extra = [], input) => run([...MINT_ARGS, ...extra], { port, input });
  // `calls` accumulates for the whole run, so "did this test make a request" has
  // to be measured against a baseline rather than the array length.
  const since = (mark) => calls.slice(mark);

  test("helper prints usage without touching the network", async () => {
    const res = await run(["--help"], { port });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /Facebook Page token helper/);
    assert.match(res.stdout, /--page <pageId>/);
    assert.match(res.stdout, /Page Access Token \(long-lived\)/, "help should say where the value goes");
    assert.strictEqual(calls.length, 0, "--help must not call Meta");
  });

  test("--curl prints the three-call ladder and makes no request", async () => {
    const mark = calls.length;
    const res = await run(["--curl", "--app-id", APP_ID], { port });
    assert.strictEqual(res.status, 0, res.stderr);
    const bare = await run(["--curl"], { port });
    assert.strictEqual(bare.status, 0, "curl preview works with nothing supplied at all");
    assert.match(bare.stdout, /client_id=APP_ID/);
    assert.strictEqual(since(mark).length, 0, "--curl is offline by definition");
    assert.match(res.stdout, /grant_type=fb_exchange_token/);
    assert.match(res.stdout, /\/me\/accounts/);
    assert.match(res.stdout, /\/debug_token/);
    assert.match(res.stdout, new RegExp(`client_id=${APP_ID}`));
    assert.ok(!res.stdout.includes(APP_SECRET), "curl preview must not embed the real app secret");
  });

  test("mint lists pages and keeps tokens masked", async () => {
    const res = await mint();
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, /พบ 2 เพจ/);
    assert.match(res.stdout, new RegExp(GOOD_PAGE.id));
    assert.match(res.stdout, /never/);
    assert.ok(!res.stdout.includes(GOOD_PAGE.token), "listing must not print a full page token");
    assert.ok(!res.stdout.includes(LONG_USER_TOKEN), "listing must not print the long-lived user token");
    assert.match(res.stdout, new RegExp(`--page ${GOOD_PAGE.id}`), "should offer the reveal path");
    assert.ok(calls.some((c) => c.endsWith("/me/accounts")), "me/accounts was called");
  });

  test("--page hands back the exact values to paste, with the page id the app needs", async () => {
    const res = await mint(["--page", GOOD_PAGE.id]);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(GOOD_PAGE.token));
    assert.match(res.stdout, /วางใน Social Agency → Connectors → Facebook Page/);
    assert.match(res.stdout, new RegExp(`Page ID\\s+${GOOD_PAGE.id}`));
    assert.match(res.stdout, /gitignored/);
    assert.match(res.stdout, /อย่า git add/);
  });

  test("a token that expires is refused, not handed over", async () => {
    const res = await mint(["--page", STALE_PAGE.id]);
    assert.match(res.stdout, /หมดอายุ .* นี่คือ short-lived-derived token/);
    assert.match(res.stdout, /สิทธิ์ pages_manage_posts หายไป/);
    assert.match(res.stdout, /ยังไม่มีเพจไหนที่ผ่าน/);
    assert.ok(!res.stdout.includes("วางใน Social Agency"), "a broken token must not come with a paste block");
    const strict = await mint(["--page", STALE_PAGE.id, "--strict"]);
    assert.strictEqual(strict.status, 1, "--strict has to fail the run");
  });

  test("--check tells a user token from a page token", async () => {
    const base = ["--check", "--app-id", APP_ID, "--app-secret", APP_SECRET];
    const userToken = await run([...base, "--token", LONG_USER_TOKEN], { port });
    assert.match(userToken.stdout, /type = USER — ไม่ใช่ Page token/);
    const pageToken = await run([...base, "--token", GOOD_PAGE.token], { port });
    assert.strictEqual(pageToken.status, 0, pageToken.stderr);
    assert.match(pageToken.stdout, new RegExp(`Page ID\\s+${GOOD_PAGE.id}`), "debug_token id is used when the token is the only input");
    assert.match(pageToken.stdout, /never/);
    const junk = await run([...base, "--token", "EAAgarbage".padEnd(40, "z")], { port });
    assert.match(junk.stdout, /Meta ไม่รับ token นี้/);
  });

  test("Meta's error echo never carries the token to the terminal", async () => {
    const res = await run(["--app-id", APP_ID, "--app-secret", "wrongsecret_abcdefghijklmn", "--token", SHORT_USER_TOKEN], { port });
    assert.strictEqual(res.status, 1);
    const combined = `${res.stdout}${res.stderr}`;
    assert.ok(!combined.includes(SHORT_USER_TOKEN), "short-lived token leaked into the error output");
    assert.match(combined, /‹redacted›/);
    assert.ok(!combined.includes(APP_SECRET), "app secret leaked into the error output");
  });

  test("a 1-char arg must not redact every letter out of the message", async () => {
    const res = await run(["--app-id", APP_ID, "--app-secret", "s", "--token", SHORT_USER_TOKEN], { port });
    assert.strictEqual(res.status, 1);
    assert.match(`${res.stdout}${res.stderr}`, /Invalid OAuth access token - Cannot parse access token/);
  });

  test("a value in the wrong slot is caught before any request goes out", async () => {
    const mark = calls.length;
    const res = await run(["--app-id", "abc", "--app-secret", `EAA${"x".repeat(60)}`, "--token", GOOD_PAGE.id], { port });
    assert.strictEqual(res.status, 2, res.stderr);
    assert.match(res.stderr, /App ID ต้องเป็นตัวเลขล้วน/);
    assert.match(res.stderr, /มีแต่ตัวเลข — น่าจะเป็น Page ID\/App ID/);
    assert.match(res.stderr, /App Secret ขึ้นต้นด้วย EAA/);
    assert.strictEqual(since(mark).filter((c) => c.endsWith("/oauth/access_token")).length, 0, "no request for obviously wrong input");
  });

  test("--prompt consumes stdin one value per prompt, keeping secrets off the command line", async () => {
    const res = await run(["--app-id", APP_ID, "--prompt", "--page", GOOD_PAGE.id], { port, input: `${SHORT_USER_TOKEN}\n${APP_SECRET}\n` });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(GOOD_PAGE.token));
    const short = await run(["--app-id", APP_ID, "--prompt"], { port, input: `${SHORT_USER_TOKEN}\n` });
    assert.strictEqual(short.status, 1);
    assert.match(short.stderr, /ป้อนค่าไม่ครบ/);
  });

  test("--prompt also asks for a missing App ID, in one command", async () => {
    const res = await run(["--prompt", "--page", GOOD_PAGE.id], { port, input: `${APP_ID}\n${SHORT_USER_TOKEN}\n${APP_SECRET}\n` });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`app ${APP_ID}`));
    assert.match(res.stdout, new RegExp(GOOD_PAGE.token));
    const checkMode = await run(["--check", "--app-id", APP_ID, "--app-secret", APP_SECRET, "--prompt"], { port, input: `${GOOD_PAGE.token}\n` });
    assert.strictEqual(checkMode.status, 0, checkMode.stderr);
    assert.match(checkMode.stdout, /never/);
    // An App ID is required from somewhere; blank piped lines are skipped by
    // design, so the "never supplied" case is the non-interactive one.
    const noId = await run([], { port, env: { LUKE_FB_APP_ID: "", LUKE_FB_APP_SECRET: "", LUKE_FB_USER_TOKEN: "" } });
    assert.strictEqual(noId.status, 1);
    assert.match(noId.stderr, /ขาด --app-id/);
  });

  test("reads app id/secret/token from env, and still insists on a token", async () => {
    const viaEnv = await run(["--page", GOOD_PAGE.id], {
      port,
      env: { LUKE_FB_APP_ID: APP_ID, LUKE_FB_APP_SECRET: APP_SECRET, LUKE_FB_USER_TOKEN: SHORT_USER_TOKEN },
    });
    assert.strictEqual(viaEnv.status, 0, viaEnv.stderr);
    assert.match(viaEnv.stdout, new RegExp(GOOD_PAGE.token));
    const nothing = await run([], { port, env: { LUKE_FB_APP_ID: APP_ID, LUKE_FB_APP_SECRET: APP_SECRET, LUKE_FB_USER_TOKEN: "" } });
    assert.strictEqual(nothing.status, 1);
    assert.match(nothing.stderr, /ขาด --token/);
  });

  test("graph version is gated the same way the connector gates it", async () => {
    const tooOld = await mint(["--version", "v19.0"]);
    assert.strictEqual(tooOld.status, 1);
    assert.match(tooOld.stderr, /ไม่รองรับ|หมดอายุ|ไม่อยู่ในรายการที่แอปนี้รองรับ/);
    const junkVer = await mint(["--version", "banana"]);
    assert.strictEqual(junkVer.status, 1);
    assert.match(junkVer.stderr, /Graph API version/);
    const supported = await mint(["--version", "v21.0", "--page", GOOD_PAGE.id]);
    assert.strictEqual(supported.status, 0, supported.stderr);
    assert.match(supported.stdout, /Graph API v21\.0/);
  });

  test("hidden input survives a bracketed paste (raw mode, no echo)", async () => {
    // Piping can't reach the raw-mode reader — a pipe is never a TTY — so the
    // sanitiser is asserted directly. This is the "pasted token, Meta says
    // Cannot parse access token" bug: the escape wrapper survives as literal
    // "[200~" text if you only filter for printable characters.
    const { sanitizeHiddenLine, looksLikeToken } = require(HELPER);
    assert.strictEqual(sanitizeHiddenLine(`\u001b[200~${GOOD_PAGE.token}\u001b[201~`), GOOD_PAGE.token);
    assert.strictEqual(sanitizeHiddenLine(`  ${GOOD_PAGE.token}\u001b[?25l  \n`), GOOD_PAGE.token);
    assert.strictEqual(sanitizeHiddenLine("EAA\u001b[Cabc"), "EAAabc", "stray arrow key must not land in the value");
    assert.ok(looksLikeToken(GOOD_PAGE.token));
    assert.ok(!looksLikeToken(GOOD_PAGE.id), "a page id is not a token");
  });

  test("an unknown page id says so and lists what you do have", async () => {
    const res = await mint(["--page", "9999999999"]);
    assert.strictEqual(res.status, 2);
    assert.match(res.stdout, /ไม่พบเพจ 9999999999/);
    assert.match(res.stdout, new RegExp(GOOD_PAGE.name));
  });

  test("--json emits verdicts with tokens only on request", async () => {
    const masked = await mint(["--json"]);
    const parsed = JSON.parse(masked.stdout.slice(masked.stdout.indexOf("{")));
    assert.strictEqual(parsed.pages.length, 2);
    const good = parsed.pages.find((p) => p.pageId === GOOD_PAGE.id);
    assert.strictEqual(good.ok, true);
    assert.strictEqual(good.token, undefined, "no token in json unless revealed");
    assert.ok(parsed.pages.find((p) => p.pageId === STALE_PAGE.id).problems.length >= 1);
    const revealed = await mint(["--json", "--page", GOOD_PAGE.id]);
    const parsed2 = JSON.parse(revealed.stdout.slice(revealed.stdout.indexOf("{")));
    assert.strictEqual(parsed2.pages[0].token, GOOD_PAGE.token);
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
  server.close();
  if (!process.exitCode) console.log(`PASS: ${passed} facebook page-token helper checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
