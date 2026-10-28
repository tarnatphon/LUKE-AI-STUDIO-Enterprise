#!/usr/bin/env node
"use strict";

/**
 * Social Agency — LinkedIn member token helper (scripts/social-agency-linkedin-token.cjs).
 *
 * LinkedIn has no "generate token" button; the OAuth 2.0 authorization-code flow
 * is the step operators get stuck on, so the helper walks it: authorize URL →
 * pasted callback → code exchange → /v2/userinfo → token + urn:li:person:…
 *
 * Everything runs offline: the OAuth token endpoint and the API live on a local
 * mock server (LUKE_LI_OAUTH_HOST / LUKE_LI_HOST / LUKE_LI_PORT / LUKE_LI_TLS=0).
 * No LinkedIn account, no network, no real token.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { SocialAgencyRuntime } = require("../server/social-agency-runtime.cjs");
const {
  parseArgs,
  buildAuthorizeUrl,
  extractCode,
  exchangeCode,
  fetchMember,
  expiryDate,
  saveToApp,
  readStoredToken,
  curlSnippet,
  main,
} = require("../social-agency-linkedin-token.cjs");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Flags the help text should only ever use; keeps copy-paste examples honest.
const HELP_FLAGS = ["--prompt", "--client-id", "--client-secret", "--redirect", "--callback", "--state", "--code",
  "--save", "--client", "--check", "--curl", "--json", "--reveal", "--root", "--help"];

const CLIENT_ID = "86abc123def4567";
const CLIENT_SECRET = "linkedin-client-secret-0123456789";
const REDIRECT = "https://www.example-shop.test/li-callback";
const ACCESS_TOKEN = "AQVmembertokenXYZ0123456789abcdefghijklmnop";
const SUB = "AbC123xyz";

// Capture what the script prints without leaking it into the test log.
async function capture(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    const code = await fn();
    return { code, out: chunks.join("") };
  } finally {
    process.stdout.write = original;
    process.stderr.write = originalErr;
  }
}

async function main2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sa-li-token-"));
  const rt = new SocialAgencyRuntime({ root });
  const clientId = rt.createClient({ name: "Thai Modern Bags Co.,Ltd.", industry: "กระเป๋า", tone: "เจ้าของแบรนด์", firstProduct: "กระเป๋าใส่รองเท้า" }).id;

  // ── mock LinkedIn ────────────────────────────────────────────────────────
  const seen = [];
  let tokenReply = { status: 200, json: { access_token: ACCESS_TOKEN, expires_in: 5184000, scope: "openid profile w_member_social" } };
  let userinfoReply = { status: 200, json: { sub: SUB, name: "Ekky Test", given_name: "Ekky" } };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, contentType: req.headers["content-type"], body });
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/oauth/v2/accessToken") return send(tokenReply.status, tokenReply.json);
      if (req.url === "/v2/userinfo") return send(userinfoReply.status, userinfoReply.json);
      return send(404, { message: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  // Point the helper at the mock and put the environment back afterwards. Must be
  // awaited, or the restore runs while main() is still mid-request.
  const withEnv = async (fn) => {
    const before = { ...process.env };
    process.env.LUKE_LI_OAUTH_HOST = "127.0.0.1";
    process.env.LUKE_LI_HOST = "127.0.0.1";
    process.env.LUKE_LI_PORT = String(port);
    process.env.LUKE_LI_TLS = "0";
    delete process.env.LUKE_LI_CLIENT_ID;
    delete process.env.LUKE_LI_CLIENT_SECRET;
    delete process.env.LUKE_LI_REDIRECT;
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  };

  // ── URL building ────────────────────────────────────────────────────────

  test("ลิงก์ขออนุญาตชี้ LinkedIn พร้อม state/scope/redirect ที่ถูกต้อง", () => {
    const url = new URL(buildAuthorizeUrl({ clientId: CLIENT_ID, redirect: REDIRECT, state: "abc123" }));
    assert.strictEqual(url.hostname, "www.linkedin.com");
    assert.strictEqual(url.pathname, "/oauth/v2/authorization");
    assert.strictEqual(url.searchParams.get("response_type"), "code");
    assert.strictEqual(url.searchParams.get("client_id"), CLIENT_ID);
    assert.strictEqual(url.searchParams.get("redirect_uri"), REDIRECT);
    assert.strictEqual(url.searchParams.get("state"), "abc123");
    assert.strictEqual(url.searchParams.get("scope"), "openid profile w_member_social", "w_member_social must be requested or posting fails later");
  });

  test("ขาด Client ID / Redirect URL หรือใช้ http ภายนอก → ปฏิเสธก่อนเปิดเบราว์เซอร์", () => {
    assert.throws(() => buildAuthorizeUrl({ redirect: REDIRECT, state: "s" }), /Client ID/);
    assert.throws(() => buildAuthorizeUrl({ clientId: CLIENT_ID, state: "s" }), /Redirect URL/);
    assert.throws(() => buildAuthorizeUrl({ clientId: CLIENT_ID, redirect: "not a url", state: "s" }), /Redirect URL ไม่ถูกต้อง/);
    assert.throws(() => buildAuthorizeUrl({ clientId: CLIENT_ID, redirect: "ftp://x.test/cb", state: "s" }), /https/);
    assert.doesNotThrow(() => buildAuthorizeUrl({ clientId: CLIENT_ID, redirect: "http://127.0.0.1:8080/cb", state: "s" }), "localhost http is allowed");
  });

  // ── callback parsing ────────────────────────────────────────────────────

  test("อ่าน code จาก URL ที่เบราว์เซอร์เด้งไป (และตรวจ state)", () => {
    const full = `https://www.example-shop.test/li-callback?code=AQScode123&state=abc123`;
    assert.deepStrictEqual(extractCode(full, { state: "abc123" }), { code: "AQScode123", state: "abc123" });
    assert.deepStrictEqual(extractCode("?code=AQScode123&state=abc123", { state: "abc123" }), { code: "AQScode123", state: "abc123" });
    assert.deepStrictEqual(extractCode("AQScode123456789012345678", {}), { code: "AQScode123456789012345678", state: null });
    // bracketed paste must not corrupt the code
    assert.strictEqual(extractCode(`\u001b[200~${full}\u001b[201~`, { state: "abc123" }).code, "AQScode123");
  });

  test("state ไม่ตรง / ไม่มี code / ผู้ใช้กดยกเลิก → บอกสาเหตุภาษาไทย", () => {
    assert.throws(() => extractCode("https://x.test/cb?code=AAA&state=othe", { state: "abc123" }), /state ไม่ตรง/);
    assert.throws(() => extractCode("https://x.test/cb?state=abc123", { state: "abc123" }), /ไม่มี \?code=/);
    assert.throws(
      () => extractCode("https://x.test/cb?error=user_cancelled_authorize&error_description=The+user+cancelled", { state: "abc123" }),
      /user_cancelled_authorize[\s\S]*กดยกเลิก/,
    );
    assert.throws(() => extractCode("", {}), /ไม่มีข้อมูลให้อ่าน/);
  });

  // ── exchange ────────────────────────────────────────────────────────────

  test("แลก code → token: ส่งฟอร์มถูกต้องและได้ age/สิทธิ์กลับมา", async () => {
    await withEnv(async () => {
      seen.length = 0;
      const out = await exchangeCode({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirect: REDIRECT, code: "AQScode123", host: "127.0.0.1" });
      assert.strictEqual(out.accessToken, ACCESS_TOKEN);
      assert.strictEqual(out.expiresIn, 5184000);
      assert.match(out.scope, /w_member_social/);
      const call = seen.find((s) => s.url === "/oauth/v2/accessToken");
      assert.strictEqual(call.method, "POST");
      assert.match(call.contentType, /application\/x-www-form-urlencoded/);
      const form = new URLSearchParams(call.body);
      assert.strictEqual(form.get("grant_type"), "authorization_code");
      assert.strictEqual(form.get("code"), "AQScode123");
      assert.strictEqual(form.get("redirect_uri"), REDIRECT);
      assert.strictEqual(form.get("client_id"), CLIENT_ID);
      assert.strictEqual(form.get("client_secret"), CLIENT_SECRET);
    });
  });

  test("LinkedIn ตอบ error → ข้อความบอกสาเหตุและปิดบัง secret/code", async () => {
    await withEnv(async () => {
      tokenReply = { status: 400, json: { error: "invalid_request", error_description: `redirect_uri does not match (${CLIENT_SECRET})` } };
      try {
        await assert.rejects(
          () => exchangeCode({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirect: REDIRECT, code: "AQScode123", host: "127.0.0.1" }),
          (err) => {
            assert.match(err.message, /แลก code เป็น token ไม่สำเร็จ/);
            assert.match(err.message, /redirect_uri does not match/);
            assert.ok(!err.message.includes(CLIENT_SECRET), "the client secret is redacted");
            return true;
          },
        );
      } finally {
        tokenReply = { status: 200, json: { access_token: ACCESS_TOKEN, expires_in: 5184000, scope: "openid profile w_member_social" } };
      }
    });
  });

  test("token ถูกปฏิเสธ (401) ที่ /v2/userinfo → บอกให้ตรวจสิทธิ์ openid profile", async () => {
    await withEnv(async () => {
      userinfoReply = { status: 401, json: { message: "Invalid access token" } };
      try {
        await assert.rejects(() => fetchMember({ accessToken: ACCESS_TOKEN, host: "127.0.0.1" }), /401[\s\S]*openid profile/);
      } finally {
        userinfoReply = { status: 200, json: { sub: SUB, name: "Ekky Test" } };
      }
    });
  });

  test("ได้ urn:li:person: จาก sub", async () => {
    await withEnv(async () => {
      const member = await fetchMember({ accessToken: ACCESS_TOKEN, host: "127.0.0.1" });
      assert.strictEqual(member.urn, `urn:li:person:${SUB}`);
      assert.strictEqual(member.name, "Ekky Test");
    });
  });

  test("คำนวณวันหมดอายุจาก expires_in", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    assert.strictEqual(expiryDate(5184000, now), "2026-12-27", "60 days later");
    assert.strictEqual(expiryDate(null, now), null);
  });

  // ── end to end through main() ───────────────────────────────────────────

  test("โฟลว์เต็ม (--callback) พิมพ์ token + URN ให้คัดลอก และไม่โชว์ secret", async () => {
    await withEnv(async () => {
      seen.length = 0;
      const state = "state1234567890";
      const callback = `${REDIRECT}?code=AQScode123&state=${state}`;
      // --callback carries its own state; build the same one the script would use
      const { code, out } = await capture(() => main({
        "client-id": CLIENT_ID,
        "client-secret": CLIENT_SECRET,
        redirect: REDIRECT,
        state,
        callback,
        json: true,
        _: [],
      }));
      assert.strictEqual(code, 0, out);
      assert.match(out, /Member Access Token : AQVmembertoken/);
      assert.match(out, new RegExp(`urn:li:person:${SUB}`));
      assert.match(out, /หมดอายุประมาณ \d{4}-\d{2}-\d{2}/);
      assert.ok(!out.includes(CLIENT_SECRET), "client secret never printed");
      const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
      assert.strictEqual(json.member.urn, `urn:li:person:${SUB}`);
      assert.strictEqual(json.saved, null);
      assert.ok(json.token, "--json without --save still returns the token for pasting");
    });
  });

  test("--save เขียนลง connectors.json (token, URN, tokenSavedAt) และไม่พิมพ์ token", async () => {
    await withEnv(async () => {
      const callback = `${REDIRECT}?code=AQScode123`;
      const { code, out } = await capture(() => main({
        "client-id": CLIENT_ID,
        "client-secret": CLIENT_SECRET,
        redirect: REDIRECT,
        callback,
        save: true,
        root,
        client: clientId,
        _: [],
      }));
      assert.strictEqual(code, 0, out);
      assert.ok(!out.includes(ACCESS_TOKEN), "the token is not echoed when it is saved");
      assert.match(out, /token AQVm…klmnop/, "a masked tail is enough to recognize the token");

      const stored = readStoredToken({ root, clientId });
      assert.strictEqual(stored.accessToken, ACCESS_TOKEN);
      assert.strictEqual(stored.authorUrn, `urn:li:person:${SUB}`);
      assert.strictEqual(stored.dryRun, true, "saving a token must not silently switch dry-run off");
      const view = rt.getConnectorsView(clientId);
      assert.strictEqual(view.linkedin.configured, true);
      assert.strictEqual(view.linkedin.accessToken, "••••mnop", "masked in the app view");
      assert.ok(!JSON.stringify(view).includes(ACCESS_TOKEN));
      const savedAt = rt._read().clients.find((c) => c.id === clientId).connectors.linkedin.tokenSavedAt;
      assert.ok(savedAt, "tokenSavedAt recorded — the readiness checker needs it for the 60-day warning");
      assert.ok(Date.now() - Date.parse(savedAt) < 60000);
    });
  });

  test("state ที่ไม่ตรงกับ --state → หยุด (กัน URL จากการเข้าสู่ระบบครั้งก่อน)", async () => {
    await withEnv(async () => {
      const exchangesBefore = seen.filter((s) => s.url === "/oauth/v2/accessToken").length;
      await assert.rejects(
        () => capture(() => main({
          "client-id": CLIENT_ID,
          "client-secret": CLIENT_SECRET,
          redirect: REDIRECT,
          state: "expected-state-1",
          callback: `${REDIRECT}?code=AQScode123&state=stale-state-99`,
          _: [],
        })),
        /state ไม่ตรง/,
      );
      const exchangesAfter = seen.filter((s) => s.url === "/oauth/v2/accessToken").length;
      assert.strictEqual(exchangesAfter, exchangesBefore, "the code is never exchanged when state does not match");
    });
  });

  test("โฟลว์เต็มด้วย --code (ไม่ผ่าน state) ยังทำงานได้", async () => {
    await withEnv(async () => {
      const { code, out } = await capture(() => main({
        "client-id": CLIENT_ID,
        "client-secret": CLIENT_SECRET,
        redirect: REDIRECT,
        code: "AQScode123",
        _: [],
      }));
      assert.strictEqual(code, 0, out);
      assert.match(out, /ไม่ได้ตรวจ state/);
    });
  });

  test("--check: token ที่บันทึกไว้ใช้ได้และ URN ตรง", async () => {
    await withEnv(async () => {
      const { code, out } = await capture(() => main({ check: true, client: clientId, root, json: true, _: [] }));
      assert.strictEqual(code, 0, out);
      assert.match(out, /token ใช้ได้/);
      assert.match(out, /Author URN ในแอปตรงกับ token/);
      assert.match(out, /dry-run ของ LinkedIn ยังเปิดอยู่/, "warns that a live send still needs dry-run off");
      assert.match(out, /อายุราว 60 วัน/);
      assert.ok(!out.includes(ACCESS_TOKEN), "even --check never prints the token");
    });
  });

  test("--check: URN ไม่ตรงกับ token → exit 1 พร้อมวิธีแก้", async () => {
    await withEnv(async () => {
      rt.saveConnectors(clientId, { connectors: { linkedin: { authorUrn: "urn:li:person:SomeoneElse" } } });
      userinfoReply = { status: 200, json: { sub: SUB, name: "Ekky Test" } };
      try {
        const { code, out } = await capture(() => main({ check: true, client: clientId, root, _: [] }));
        assert.strictEqual(code, 1);
        assert.match(out, /ไม่ตรงกับ token/);
      } finally {
        rt.saveConnectors(clientId, { connectors: { linkedin: { authorUrn: `urn:li:person:${SUB}` } } });
      }
    });
  });

  test("--check ตอนยังไม่มี token → exit 1 และบอกคำสั่งที่ต้องรัน", async () => {
    const freshId = rt.createClient({ name: "ลูกค้าใหม่", industry: "ของใช้", tone: "เจ้าของแบรนด์", firstProduct: "ของใช้" }).id;
    const { code, out } = await capture(() => main({ check: true, client: freshId, root, _: [] }));
    assert.strictEqual(code, 1);
    assert.match(out, /ยังไม่มี token/);
    assert.match(out, /social-agency-linkedin-token\.cjs --prompt --save/);
        assert.match(out, new RegExp(freshId), "the hint names the actual client id");
  });

  // ── offline helpers ─────────────────────────────────────────────────────

  test("--curl พิมพ์คำสั่งเทียบเท่าโดยไม่ต่อเน็ต", async () => {
    const { code, out } = await capture(() => main({ curl: true, "client-id": CLIENT_ID, redirect: REDIRECT, code: "AQScode", _: [] }));
    assert.strictEqual(code, 0);
    assert.match(out, /curl -X POST https:\/\/www\.linkedin\.com\/oauth\/v2\/accessToken/);
    assert.match(out, /grant_type=authorization_code/);
    assert.match(out, /api\.linkedin\.com\/v2\/userinfo/);
    assert.ok(!out.includes(CLIENT_SECRET), "no secret in the snippet");
  });

  test("help ไม่มีวงเล็บมุมที่ทำให้ zsh พัง และระบุขั้นตอนครบ", async () => {
    const { code, out } = await capture(() => main({ help: true, _: [] }));
    assert.strictEqual(code, 0);
    for (const line of out.split("\n").filter((l) => /^\s+--/.test(l))) {
      assert.doesNotMatch(line, /[<>]/, `placeholder brackets: ${line.trim()}`);
    }
    assert.match(out, /Share on LinkedIn/, "names the product to add");
    assert.match(out, /Redirect URL/, "names the setting to register");
    assert.match(out, /--prompt --save --client CLIENT_ID/);
  });

  test("ตัวอย่างใน help รันได้จริง: ไม่มี --check คู่กับ --save และไม่มีพาธสมมติ", async () => {
    const { out } = await capture(() => main({ help: true, _: [] }));
    const examples = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("node scripts/social-agency-linkedin-token.cjs"));
    assert.ok(examples.length >= 3, `expected runnable examples, got ${examples.length}`);
    for (const line of examples) {
      assert.doesNotMatch(line, /[<>]/, `placeholder brackets: ${line}`);
      // --check overrides the whole flow, so pairing it with --save would just confuse
      assert.ok(!(line.includes("--check") && line.includes("--save")), `--check + --save in one example: ${line}`);
      const flags = line.match(/--[a-z-]+/g) || [];
      for (const flag of flags) assert.ok(HELP_FLAGS.includes(flag), `unknown flag in an example: ${flag}`);
    }
  });

  test("parseArgs อ่านค่าได้ครบและปฏิเสธ flag ที่ไม่มีค่า", () => {
    const args = parseArgs(["--client-id", CLIENT_ID, "--save", "--client", "abc", "--check", "--json"]);
    assert.strictEqual(args["client-id"], CLIENT_ID);
    assert.strictEqual(args.save, true);
    assert.strictEqual(args.client, "abc");
    assert.strictEqual(args.check, true);
    assert.throws(() => parseArgs(["--redirect"]), /ต้องการค่าสำหรับ --redirect/);
  });

  test("ขาด Client Secret → หยุดก่อนยิงเน็ต พร้อมบอกทาง", async () => {
    seen.length = 0;
    await assert.rejects(() => capture(() => main({ "client-id": CLIENT_ID, redirect: REDIRECT, code: "AQScode", _: [] })), /Client Secret/);
    assert.strictEqual(seen.length, 0, "nothing left the machine");
  });

  test("curlSnippet ปิดบัง token เมื่อมีอยู่", () => {
    const snippet = curlSnippet({ clientId: CLIENT_ID, clientSecret: "x", redirect: REDIRECT, code: "c", token: ACCESS_TOKEN });
    assert.ok(!snippet.includes(ACCESS_TOKEN), "the full token is not in the snippet");
    assert.match(snippet, /Bearer AQVm…/);
  });

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
  server.close();
  if (!process.exitCode) console.log(`PASS: ${tests.length} LinkedIn token helper checks`);
}

main2().catch((err) => {
  console.error(err);
  process.exit(1);
});
