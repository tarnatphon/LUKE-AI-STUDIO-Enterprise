#!/usr/bin/env node
"use strict";

/**
 * Luke AI Workflow — publishing.
 *
 * The builder used to stop at "here is some text". This suite pins the part that
 * takes the text out of the app:
 *
 *   - the free channel library (authority numbers, link type, how signup works,
 *     which channels can really post through an API and which cannot — Medium's
 *     API was closed in 2025 and Hashnode's became paid in 2026, so both must
 *     stay manual instead of being advertised as automatable);
 *   - the one-click post (prefilled editor/share URL + the exact text);
 *   - the API plan per channel, including Telegraph's two-step account → page;
 *   - the relay's outbound guard (no localhost, no LAN, no http, no credentials
 *     in the URL) — this is the only place the app makes a user-chosen request;
 *   - the runtime: credentials are stored apart from workflows, never returned
 *     by /state, and a dry run never shows a secret;
 *   - the two new step types (`publish`, `onepost`) in the runtime sanitiser, the
 *     seeds, and the frontend wiring.
 *
 * No network: every request builder is inspected, never sent. One local relay
 * call is made to a throwaway HTTP server to prove the request really goes out.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..", "..");
const registry = require("../server/social-publish-channels.cjs");
const relay = require("../server/ai-workflow-publish.cjs");
const { AiWorkflowRuntime } = require("../server/ai-workflow-runtime.cjs");

const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
let passed = 0;

const DRAFT = {
  title: "กระเป๋าผ้า OEM ที่ทนทานจริง",
  body: "# กระเป๋าผ้า OEM ที่ทนทานจริง\n\nวัตถุดิบทนทาน กันน้ำได้ และพิมพ์ลายได้ตามแบรนด์",
  tags: ["กระเป๋าผ้า", "OEM", "ขายส่ง"],
  canonicalUrl: "https://www.thaimodernbags.com/blog/canvas-oem",
};

function tmpRuntime() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-pub-"));
  return { rt: new AiWorkflowRuntime({ root: rootDir }), rootDir };
}

async function main() {
  // ── channel library ───────────────────────────────────────────────────────

  test("the library covers free channels with their authority, link type and signup", () => {
    const list = registry.listChannels();
    assert.ok(list.length >= 14, `expected a real library, got ${list.length}`);
    const ids = list.map((channel) => channel.id);
    assert.equal(new Set(ids).size, ids.length, "channel ids must be unique");
    for (const channel of list) {
      assert.ok(Number.isInteger(channel.da), `${channel.id} has a DA estimate`);
      assert.ok(Number.isInteger(channel.pa), `${channel.id} has a PA estimate`);
      if (channel.authority === "self") {
        // A forum or WordPress site the user hosts has no third-party authority
        // to quote, and pretending otherwise would be a lie in the UI.
        assert.equal(channel.da, 0, `${channel.id} does not invent a DA for a self-hosted site`);
        assert.equal(channel.pa, 0, `${channel.id} does not invent a PA for a self-hosted site`);
        assert.equal(channel.localAllowed, true, `${channel.id} may point at a LAN address`);
      } else {
        assert.ok(channel.da >= 60, `${channel.id} has a DA estimate`);
        assert.ok(channel.pa >= 40, `${channel.id} has a PA estimate`);
        assert.equal(channel.authority, "approx", `${channel.id} states its numbers are estimates`);
        assert.equal(channel.localAllowed, false, `${channel.id} is a public site, not a LAN target`);
      }
      assert.ok(["dofollow", "nofollow", "mixed", "ugc"].includes(channel.linkType), `${channel.id} link type`);
      assert.ok(["api", "manual", "import"].includes(channel.automation), `${channel.id} automation`);
      assert.match(channel.signupUrl, /^https:\/\//, `${channel.id} signup link`);
      assert.ok(channel.why.length > 20, `${channel.id} explains why it is worth using`);
      assert.ok(channel.steps.length >= 1, `${channel.id} explains the manual route`);
    }
    const byId = Object.fromEntries(list.map((channel) => [channel.id, channel]));
    // The channels that really can post unattended.
    for (const id of ["devto", "telegraph", "gist", "telegram", "discord", "mastodon", "wordpresscom", "blogger"]) {
      assert.equal(byId[id].automation, "api", `${id} can post through the relay`);
    }
    // The two that cannot, for reasons that are stated rather than hidden.
    assert.equal(byId.medium.automation, "import", "Medium stopped issuing API tokens (Jan 2025)");
    assert.equal(byId.hashnode.automation, "manual", "Hashnode's GraphQL API is Pro-only since May 2026");
    assert.match(byId.medium.why, /2025/);
    assert.match(byId.hashnode.why, /2026/);
    // A no-signup channel has to exist: that is the "one click, zero forms" case.
    assert.ok(list.some((channel) => /ไม่ต้องสมัคร/.test(channel.signup)), "Telegraph-style no-signup channel");
    // Highest authority first is what the UI sorts on, so the numbers must exist.
    const top = [...list].sort((a, b) => b.da - a.da)[0];
    assert.ok(top.da >= 90, "the library reaches the DA 90+ platforms");
  });

  test("a one-click post carries the text and a prefilled URL where the site allows it", () => {
    const linkedin = registry.composePost("linkedin", DRAFT);
    assert.match(linkedin.openUrl, /^https:\/\/www\.linkedin\.com\/feed\/\?/);
    assert.match(decodeURIComponent(linkedin.openUrl), /shareActive=true/);
    assert.match(decodeURIComponent(linkedin.openUrl.replace(/\+/g, " ")), /กระเป๋าผ้า OEM/);
    assert.equal(linkedin.text.includes("# กระเป๋าผ้า"), false, "the markdown title is not repeated in the post");
    assert.equal(linkedin.automation, "manual");
    assert.ok(linkedin.warnings.some((warning) => /กดโพสต์เอง/.test(warning)));

    const reddit = registry.composePost("reddit", DRAFT);
    assert.match(reddit.openUrl, /reddit\.com\/submit\?/);
    assert.ok(reddit.warnings.some((warning) => /กฎซับ/.test(warning)), "Reddit warns about community rules");

    const devto = registry.composePost("devto", DRAFT);
    assert.equal(devto.openUrl, "https://dev.to/new");
    assert.match(devto.text, /^กระเป๋าผ้า OEM ที่ทนทานจริง/);
    assert.match(devto.text, /#กระเป๋าผ้า #OEM #ขายส่ง/);

    // A channel with no editor still yields text to paste.
    const discord = registry.composePost("discord", DRAFT);
    assert.match(discord.text, /#OEM/);
  });

  test("the one-click post warns about canonical and about body limits", () => {
    const noCanonical = registry.composePost("devto", { ...DRAFT, canonicalUrl: "" });
    assert.ok(noCanonical.warnings.some((warning) => /canonical/.test(warning)));
    const telegram = registry.composePost("telegram", { title: "t", body: "x".repeat(5000), tags: [] });
    assert.ok(telegram.warnings.some((warning) => /ตัด/.test(warning)), "over-long body is reported");
    const medium = registry.composePost("medium", DRAFT);
    assert.ok(medium.warnings.some((warning) => /Import|ด้วยมือ/.test(warning)));
  });

  test("API plans are built from the channel, not from a pasted URL", () => {
    const withoutKey = (() => {
      try { registry.buildPlan("devto", { draft: DRAFT, credentials: {} }); return null; } catch (error) { return error; }
    })();
    assert.ok(withoutKey, "DEV without a key must fail");
    assert.equal(withoutKey.missingCredential, "apiKey");
    assert.match(withoutKey.message, /API key/);

    const devto = registry.buildPlan("devto", { draft: DRAFT, credentials: { apiKey: "abc123" } })[0];
    assert.equal(devto.method, "POST");
    assert.equal(devto.url, "https://dev.to/api/articles");
    assert.match(devto.headers.Authorization, /^Basic /);
    const payload = JSON.parse(devto.body);
    assert.equal(payload.article.published, true);
    assert.equal(payload.article.canonical_url, DRAFT.canonicalUrl);
    assert.deepEqual(payload.article.tags.slice(0, 2), ["กระเป๋าผ้า", "OEM"]);

    // Telegraph needs no account at all: account → page, with the token carried.
    const telegraph = registry.buildPlan("telegraph", {
      draft: { ...DRAFT, body: "ย่อหน้าแรก\n\n## หัวข้อย่อย\n\n- ข้อ 1\n- ข้อ 2" },
      credentials: {},
    });
    assert.equal(telegraph.length, 2);
    assert.match(telegraph[0].url, /createAccount$/);
    assert.equal(telegraph[0].save.accessToken, "result.access_token");
    const page = JSON.parse(telegraph[1].body);
    assert.equal(page.access_token, "{{accessToken}}", "the token from step 1 is carried into step 2");
    assert.ok(page.content.some((node) => node.tag === "h3"), "a markdown heading becomes a Telegraph heading node");
    const list = page.content.find((node) => node.tag === "ul");
    assert.equal(list.children.length, 2, "markdown bullets become Telegraph list items");

    const telegram = registry.buildPlan("telegram", {
      draft: DRAFT,
      credentials: { token: "123:abc", chatId: "@mychannel" },
    })[0];
    assert.equal(telegram.url, "https://api.telegram.org/bot123:abc/sendMessage");
    assert.match(telegram.body, /@mychannel/);
    assert.match(telegram.body, /thaimodernbags/);

    const discord = registry.buildPlan("discord", {
      draft: DRAFT,
      credentials: { webhookUrl: "https://discord.com/api/webhooks/1/abc" },
    })[0];
    assert.equal(discord.url, "https://discord.com/api/webhooks/1/abc");
    assert.equal(JSON.parse(discord.body).content.includes("#OEM"), true);

    // Manual channels never produce a plan.
    for (const id of ["medium", "hashnode", "linkedin", "reddit", "quora", "tumblr", "substack", "facebook"]) {
      assert.throws(() => registry.buildPlan(id, { draft: DRAFT, credentials: {} }), /API|ไว้ใจ|ไม่ได้เปิด|ปิด/, `${id} cannot be automated`);
    }
  });

  test("the draft normaliser keeps titles, tags and links sane", () => {
    const draft = registry.normalizeDraft({ body: "บรรทัดแรก\nบรรทัดสอง", tags: "#OEM, ขายส่ง, OEM" });
    assert.equal(draft.title, "บรรทัดแรก", "a missing title falls back to the first line");
    assert.deepEqual(draft.tags, ["OEM", "ขายส่ง"], "tags are de-duplicated and lose their #");
    assert.equal(registry.normalizeDraft({ title: "x", tags: new Array(20).fill("t").map((_, i) => `t${i}`) }).tags.length, 8);
    assert.equal(registry.normalizeDraft({}).title, "โพสต์ใหม่");
  });

  test("Bluesky and the self-hosted forum family are first-class channels", () => {
    const byId = Object.fromEntries(registry.listChannels().map((channel) => [channel.id, channel]));

    // Bluesky: free, no app review, 300 graphemes, and a two-step plan.
    assert.equal(byId.bsky.automation, "api");
    assert.equal(byId.bsky.limits.body, 300);
    assert.ok(byId.bsky.steps.some((step) => /App Password/.test(step)));
    const bsky = registry.buildPlan("bsky", {
      draft: DRAFT,
      credentials: { handle: "acme.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" },
    });
    assert.equal(bsky.length, 2, "createSession then createRecord");
    assert.match(bsky[0].url, /com\.atproto\.server\.createSession$/);
    assert.match(bsky[1].url, /com\.atproto\.repo\.createRecord$/);
    assert.equal(JSON.parse(bsky[0].body).identifier, "acme.bsky.social");
    assert.match(bsky[1].headers.Authorization, /^Bearer \{\{accessJwt\}\}$/);
    const record = JSON.parse(bsky[1].body);
    assert.equal(record.collection, "app.bsky.feed.post");
    assert.ok(record.record.text.length <= 300, "the text is cut to the 300-grapheme limit");
    assert.equal(record.record.$type, "app.bsky.feed.post");
    // A long Thai post must be cut by grapheme, never mid-character.
    const long = registry.buildPlan("bsky", {
      draft: { title: "ก".repeat(400), body: "ข".repeat(400) },
      credentials: { handle: "a.bsky.social", appPassword: "x" },
    });
    const text = JSON.parse(long[1].body).record.text;
    assert.equal([...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(text)].length, 300);
    // A record uri is at://…, which is not a link a reader can click; it has to
    // be turned into a bsky.app URL, and the DID works when no handle is stored.
    assert.equal(registry.helpers.bskyPostUrl({
      uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz",
    }), "https://bsky.app/profile/did:plc:abc/post/3kxyz");
    const bskyUrl = registry.publishedUrl("bsky", { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz" }, { handle: "acme.bsky.social" });
    assert.equal(bskyUrl, "https://bsky.app/profile/acme.bsky.social/post/3kxyz");

    // The forum family: every one of them is a real POST to a URL the user owns.
    const forums = ["discourse", "xenforo", "nodebb", "flarum", "phpbb"];
    for (const id of forums) {
      const channel = byId[id];
      assert.equal(channel.automation, "api", `${id} really posts`);
      assert.equal(channel.group, "community");
      assert.equal(channel.authority, "self");
      assert.equal(channel.localAllowed, true);
      assert.ok(channel.rate.perDay > 0 && channel.rate.minIntervalSeconds >= 60, `${id} has a written limit`);
      assert.ok(channel.credentialFields.some((field) => field.key === "baseUrl"), `${id} asks for the forum URL`);
      assert.ok(channel.credentialFields.some((field) => field.type === "toggle"), `${id} offers the LAN opt-in`);
      // A missing base URL is an explanation, not a stack trace.
      assert.throws(() => registry.buildPlan(id, { draft: DRAFT, credentials: { apiKey: "k", token: "t" } }), /URL/);
    }

    const discourse = registry.buildPlan("discourse", {
      draft: DRAFT,
      credentials: { baseUrl: "https://forum.acme.co.th/", apiKey: "k", apiUsername: "somchai", categoryId: "5" },
    });
    assert.equal(discourse[0].url, "https://forum.acme.co.th/posts.json", "trailing slash is normalised");
    assert.equal(discourse[0].headers["Api-Key"], "k");
    assert.equal(discourse[0].headers["Api-Username"], "somchai");
    assert.match(discourse[0].body, /"raw"/);

    const xenforo = registry.buildPlan("xenforo", {
      draft: DRAFT, credentials: { baseUrl: "https://xf.acme.co.th", apiKey: "k", nodeId: "12" },
    });
    assert.match(xenforo[0].url, /\/api\/threads\/$/);
    assert.equal(xenforo[0].headers["XF-Api-Key"], "k");
    // XenForo only reads form-encoded bodies.
    assert.match(xenforo[0].headers["Content-Type"], /x-www-form-urlencoded/);
    assert.match(xenforo[0].body, /node_id=12/);

    const nodebb = registry.buildPlan("nodebb", {
      draft: DRAFT, credentials: { baseUrl: "https://nb.acme.co.th", token: "t", cid: "3" },
    });
    assert.match(nodebb[0].url, /\/api\/v3\/topics$/);
    assert.match(nodebb[0].headers.Authorization, /^Bearer t$/);

    const flarum = registry.buildPlan("flarum", {
      draft: DRAFT, credentials: { baseUrl: "https://fl.acme.co.th", token: "t" },
    });
    assert.match(flarum[0].url, /\/api\/discussions$/);
    assert.match(flarum[0].headers.Authorization, /^Token t$/);
    assert.match(flarum[0].body, /"type": ?"discussions"/);

    const phpbb = registry.buildPlan("phpbb", {
      draft: DRAFT, credentials: { baseUrl: "https://php.acme.co.th", apiKey: "k", forumId: "2" },
    });
    assert.equal(phpbb[0].url, "https://php.acme.co.th/app.php/api/v1/forums/2/topics");
    assert.equal(phpbb[0].headers["X-API-Key"], "k");

    // WordPress self-hosted: HTML body, Basic auth, dofollow when the site allows it.
    assert.equal(byId.wordpress.linkType, "dofollow");
    const wp = registry.buildPlan("wordpress", {
      draft: DRAFT, credentials: { siteUrl: "https://acme.co.th", username: "admin", appPassword: "abcd efgh" },
    });
    assert.equal(wp[0].url, "https://acme.co.th/wp-json/wp/v2/posts");
    assert.match(wp[0].headers.Authorization, /^Basic /);
    assert.match(Buffer.from(wp[0].headers.Authorization.slice(6), "base64").toString(), /^admin:abcd efgh$/);
    assert.match(wp[0].body, /<p>/, "WordPress expects HTML, not markdown");

    // Pantip is manual on purpose, and the rules are stated before the click.
    assert.equal(byId.pantip.automation, "manual");
    assert.ok(byId.pantip.rules.length >= 2);
    const pantip = registry.composePost("pantip", DRAFT);
    assert.ok(pantip.warnings.some((warning) => /1 กระทู้/.test(warning)), "the daily limit is shown");
    assert.ok(pantip.warnings.some((warning) => /บัตรประชาชน/.test(warning)), "ID verification is shown");
  });

  test("the credential form asks for a URL as text and a LAN opt-in as a toggle", () => {
    const discourse = registry.credentialFields(registry.getChannel("discourse"));
    const byKey = Object.fromEntries(discourse.map((field) => [field.key, field]));
    assert.equal(byKey.baseUrl.secret, false, "a forum URL is not a secret");
    assert.equal(byKey.apiKey.secret, true);
    assert.equal(byKey.allowLocalNetwork.type, "toggle");
    assert.equal(byKey.allowLocalNetwork.secret, false);
    const bsky = registry.credentialFields(registry.getChannel("bsky"));
    assert.deepEqual(bsky.map((field) => field.key), ["handle", "appPassword", "pds"]);
    assert.equal(bsky.find((field) => field.key === "appPassword").secret, true);
  });

  // ── outbound guard ────────────────────────────────────────────────────────

  test("the relay refuses loopback, LAN, metadata and non-https targets", () => {
    const ok = ["https://dev.to/api/articles", "https://api.telegra.ph/createPage", "https://api.telegram.org/bot123/sendMessage"];
    for (const url of ok) assert.ok(relay.assertSafeOutboundUrl(url), `${url} is allowed`);
    assert.ok(relay.assertSafeOutboundUrl("https://[2001:4860:4860::8888]/"), "a public IPv6 literal is allowed");

    const blocked = [
      "http://dev.to/api/articles", // not https
      "https://127.0.0.1/api/social-agency/state", // loopback
      "https://localhost:1420/api/ai-workflow/state",
      "https://10.0.0.5/hook",
      "https://192.168.1.1/",
      "https://172.20.0.1/",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://user:pass@dev.to/api/articles", // credentials in URL
      "https://printer.local/hook",
      "https://box.internal/hook",
      "not-a-url",
    ];
    for (const url of blocked) {
      assert.throws(() => relay.assertSafeOutboundUrl(url), /ไม่อนุญาต|ต้องเป็น https|ไม่ถูกต้อง|ไม่มีชื่อโฮสต์|username/, `${url} must be refused`);
    }
    // The one deliberate exception: a server the operator runs on this machine.
    assert.ok(relay.assertSafeOutboundUrl("http://localhost:8080/wp-json/wp/v2/posts", { allowLocalDev: true }));
    // An opt-in is scoped: dev means this machine, LAN means this network, and
    // neither of them ever reaches link-local (cloud metadata) addresses.
    assert.throws(() => relay.assertSafeOutboundUrl("https://192.168.1.20/api"), /ไม่อนุญาต/);
    assert.ok(relay.assertSafeOutboundUrl("https://192.168.1.20/api", { allowLocalNetwork: true }));
    assert.ok(relay.assertSafeOutboundUrl("http://forum.local/", { allowLocalNetwork: true }));
    assert.ok(relay.assertSafeOutboundUrl("https://[fd00::1]/", { allowLocalNetwork: true }));
    assert.throws(() => relay.assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data/", { allowLocalNetwork: true }), /ไม่อนุญาต/);
    assert.throws(() => relay.assertSafeOutboundUrl("https://100.64.0.1/", { allowLocalNetwork: true }), /ไม่อนุญาต/);
    assert.throws(() => relay.assertSafeOutboundUrl("https://192.168.1.20/api", { allowLocalDev: true }), /ไม่อนุญาต/);
    assert.equal(relay.classifyAddress("192.168.1.20"), "private");
    assert.equal(relay.classifyAddress("127.0.0.1"), "loopback");
    assert.equal(relay.classifyAddress("169.254.169.254"), "linklocal");
    assert.equal(relay.classifyAddress("100.64.0.1"), "cgnat");
    assert.equal(relay.classifyAddress("8.8.8.8"), "public");
    assert.equal(relay.isPrivateIpv4("192.168.0.10"), true);
    assert.equal(relay.isPrivateIpv4("8.8.8.8"), false);
    assert.equal(relay.isPrivateIpv6("fe80::1"), true);
    assert.equal(relay.isPrivateIpv6("2001:4860:4860::8888"), false);
  });

  test("only publishing headers get through, and placeholders resolve", () => {
    const headers = relay.sanitizeHeaders({
      "Content-Type": "application/json",
      Authorization: "Basic abc",
      Cookie: "session=1",
      Host: "evil.example",
      "X-HTTP-Method-Override": "DELETE",
      Accept: "application/json",
    });
    assert.deepEqual(Object.keys(headers).sort(), ["accept", "authorization", "content-type"]);
    // Forums authenticate with their own header names; those are allowlisted by
    // name, not by letting a channel invent headers.
    const vendor = relay.sanitizeHeaders({
      "Api-Key": "a", "Api-Username": "b", "XF-Api-Key": "c", "XF-Api-User": "d", "X-API-Key": "e",
      "X-Evil": "f",
    });
    assert.deepEqual(Object.keys(vendor).sort(), ["api-key", "api-username", "x-api-key", "xf-api-key", "xf-api-user"]);
    assert.equal(headers.authorization, "Basic abc");
    assert.equal(relay.fillPlaceholders("{{accessToken}}", { accessToken: "tok" }), "tok");
    assert.equal(relay.fillPlaceholders({ a: "{{x}}/b", n: 2 }, { x: "y" }).a, "y/b");
  });

  test("the relay really posts, and refuses a target that redirects somewhere unchecked", async () => {
    let received = null;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received = { method: req.method, url: req.url, headers: req.headers, body };
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://127.0.0.1:9/evil" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, url: "https://example.test/post/1" }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const result = await relay.sendRequest(
        { method: "POST", url: `http://127.0.0.1:${port}/publish`, headers: { "Content-Type": "application/json" }, body: { hello: "world" } },
        { allowLocalDev: true },
      );
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(received.method, "POST");
      assert.equal(received.body, '{"hello":"world"}');
      assert.equal(received.headers.cookie, undefined, "no cookie is forwarded");

      // A redirect is not followed: the location would not have passed the guard.
      const redirected = await relay.sendRequest(
        { method: "POST", url: `http://127.0.0.1:${port}/redirect`, headers: {}, body: "{}" },
        { allowLocalDev: true },
      );
      assert.equal(redirected.status, 302);
      assert.equal(redirected.ok, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("a plan runs in order and carries a saved value into the next request", async () => {
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        seen.push({ url: req.url, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: { access_token: "tok-from-account", url: "https://telegra.ph/x" } }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const plan = [
        { method: "POST", url: `http://127.0.0.1:${port}/account`, headers: {}, body: "{}", save: { accessToken: "result.access_token" } },
        { method: "POST", url: `http://127.0.0.1:${port}/page`, headers: {}, body: { access_token: "{{accessToken}}" } },
      ];
      const { results, variables } = await relay.runPlan(plan, { allowLocalDev: true });
      assert.equal(results.length, 2);
      assert.equal(variables.accessToken, "tok-from-account");
      assert.equal(JSON.parse(seen[1].body).access_token, "tok-from-account");
      assert.equal(relay.fillPlaceholders("{{nope}}", {}), "", "an unknown placeholder never becomes undefined");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ── runtime ───────────────────────────────────────────────────────────────

  test("keys are stored apart from workflows and never come back in /state", async () => {
    const { rt, rootDir } = tmpRuntime();
    const state = rt.getState();
    assert.ok(Array.isArray(state.channels) && state.channels.length >= 14, "/state carries the channel library");
    assert.equal(JSON.stringify(state).includes("secret-value"), false);

    rt.updateCredentials("telegram", { token: "123:secret-value", chatId: "@ch" });
    const credentialsFile = path.join(rootDir, "app", "runtime-state", "ai-workflow", "publish-credentials.json");
    assert.ok(fs.existsSync(credentialsFile), "credentials live in their own file");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(credentialsFile).mode & 0o777, 0o600, "the file is owner-only");
    }
    const fileText = fs.readFileSync(credentialsFile, "utf8");
    assert.match(fileText, /secret-value/);
    assert.equal(fs.readFileSync(rt.filePath, "utf8").includes("secret-value"), false, "the workflow state never holds a key");

    const after = rt.getState();
    assert.equal(JSON.stringify(after).includes("secret-value"), false, "/state still hides the value");
    assert.deepEqual(after.channelCredentials.telegram, { token: true, chatId: true });
    assert.deepEqual(rt.credentialStatus().telegram, { token: true, chatId: true });

    // Clearing a field with an empty string removes it.
    rt.updateCredentials("telegram", { chatId: "" });
    assert.deepEqual(rt.credentialStatus().telegram, { token: true, chatId: false });
    assert.throws(() => rt.updateCredentials("medium", { token: "x" }), /ไม่ได้ใช้คีย์/);
  });

  test("a dry run shows the request with the secret masked", async () => {
    const { rt } = tmpRuntime();
    rt.updateCredentials("devto", { apiKey: "super-secret-key" });
    const result = await rt.sendPublish({ channelId: "devto", draft: DRAFT, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    const text = JSON.stringify(result);
    assert.equal(text.includes("super-secret-key"), false, "the key is replaced in the preview");
    assert.match(result.requests[0].headers.Authorization, /Basic \[set\]/);
    assert.equal(result.requests[0].url, "https://dev.to/api/articles");
    assert.match(result.requests[0].body, /canonical_url/);
  });

  test("the LAN opt-in is stored per channel, and only the forum channels get it", async () => {
    const received = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        received.push({ url: req.url, headers: req.headers, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: 7, topic_slug: "welcome", slug: "welcome" }));
      });
    });
    await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
    const port = server.address().port;
    const { rt } = tmpRuntime();
    try {
      // A self-hosted forum on this machine: without the opt-in, the relay
      // refuses before a packet is sent — the guard, not the workflow, decides.
      rt.updateCredentials("discourse", {
        baseUrl: `http://127.0.0.1:${port}`, apiKey: "k", apiUsername: "somchai",
      });
      const blocked = await rt.sendPublish({ channelId: "discourse", draft: DRAFT });
      assert.equal(blocked.ok, undefined, "the refusal is thrown, not posted");
    } catch (error) {
      assert.match(error.message, /ไม่อนุญาต|ต้องเป็น https/);
    }
    assert.equal(received.length, 0, "nothing left the process without the opt-in");

    try {
      rt.updateCredentials("discourse", { allowLocalNetwork: "1" });
      const sent = await rt.sendPublish({ channelId: "discourse", draft: DRAFT });
      assert.equal(sent.ok, true, JSON.stringify(sent));
      assert.equal(received.length, 1);
      assert.equal(received[0].url, "/posts.json");
      assert.equal(received[0].headers["api-key"], "k");
      assert.equal(received[0].headers["api-username"], "somchai");

      // A public channel has no LAN opt-in even if the flag is in the file, so a
      // stray toggle can never widen the guard for dev.to.
      assert.equal(registry.listChannels().find((c) => c.id === "devto").localAllowed, false);
      assert.equal(rt.credentialStatus().discourse.allowLocalNetwork, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("a channel's daily limit and minimum interval are enforced by us, not the platform", async () => {
    const { rt } = tmpRuntime();
    // A first post is allowed; the second is refused before it is built, and the
    // refusal says how long to wait — that is gap #3 closing.
    const now = Date.now();
    rt._recordPublish("discourse", now);
    const status = rt.rateStatus("discourse", now + 1000);
    assert.equal(status.usedToday, 1);
    assert.equal(status.remainingToday, status.perDay - 1);
    assert.equal(status.blocked, true);
    assert.ok(status.intervalLeftSeconds > 0);

    const refused = await rt.sendPublish({ channelId: "discourse", draft: DRAFT });
    assert.equal(refused.ok, false);
    assert.equal(refused.rateLimited, true);
    assert.match(refused.message, /โพสต์\/วัน/);
    assert.ok(refused.rate.waitSeconds > 0);

    // A dry run is not a post: it must still be allowed, and must not stamp.
    rt.updateCredentials("discourse", {
      baseUrl: "https://forum.acme.co.th", apiKey: "k", apiUsername: "somchai",
    });
    const dry = await rt.sendPublish({ channelId: "discourse", draft: DRAFT, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(rt.rateStatus("discourse", now + 1000).usedToday, 1);

    // Two days later the window has cleared.
    const later = now + 2 * 24 * 60 * 60 * 1000;
    assert.equal(rt.rateStatus("discourse", later).blocked, false);
    assert.equal(rt.rateStatus("discourse", later).usedToday, 0);

    // The rate log holds timestamps only — never a post, never a key.
    const log = fs.readFileSync(path.join(rt.stateDir, "publish-rate.json"), "utf8");
    assert.match(log, /^\s*\{/);
    assert.equal(log.includes("กระเป๋า"), false);
    assert.equal(log.includes("somchai"), false);
  });

  test("a channel without an API returns the one-click route instead of throwing", async () => {
    const { rt } = tmpRuntime();
    const result = await rt.sendPublish({ channelId: "medium", draft: DRAFT });
    assert.equal(result.ok, false);
    assert.equal(result.manual, true);
    assert.match(result.message, /API/);
    assert.equal(result.openUrl, "https://medium.com/new-story");
    assert.match(result.text, /กระเป๋าผ้า/);
    const preview = rt.previewPublish({ channelId: "reddit", draft: DRAFT });
    assert.match(preview.openUrl, /reddit\.com\/submit/);
  });

  test("the two new step types survive the sanitiser, and only real API channels can be automated", () => {
    const { rt } = tmpRuntime();
    const workflow = rt.createWorkflow({ name: "publishing" });
    const steps = [
      { id: "s1", type: "input", name: "หัวข้อ", config: { text: "หัวข้อ" } },
      { id: "s2", type: "onepost", name: "DEV", config: { channel: "devto", title: "{{input}}", body: "{{input}}", tags: ["a", "b"] } },
      { id: "s3", type: "publish", name: "Telegram", config: { channel: "telegram", body: "{{input}}" } },
      { id: "s4", type: "output", name: "ผลลัพธ์", config: {} },
    ];
    const saved = rt.updateWorkflow(workflow.id, { steps });
    assert.deepEqual(saved.steps.map((step) => step.type), ["input", "onepost", "publish", "output"]);
    assert.equal(saved.steps[1].config.appendCanonical, true, "canonical is appended by default");
    assert.deepEqual(saved.steps[1].config.tags, ["a", "b"]);

    assert.throws(
      () => rt.updateWorkflow(workflow.id, { steps: [{ id: "x", type: "onepost", name: "?", config: { channel: "nope" } }] }),
      /ไม่รู้จักช่องทาง/,
    );
    assert.throws(
      () => rt.updateWorkflow(workflow.id, { steps: [{ id: "x", type: "publish", name: "?", config: { channel: "medium" } }] }),
      /โพสต์อัตโนมัติไม่ได้/,
    );
  });

  test("the seeds include a working publishing recipe", () => {
    const { rt } = tmpRuntime();
    const workflows = rt.getState().workflows;
    const recipes = workflows.filter((workflow) => workflow.steps.some((step) => ["publish", "onepost"].includes(step.type)));
    assert.ok(recipes.length >= 2, "there is a recipe that publishes");
    const syndication = recipes.find((workflow) => workflow.name.includes("High DA"));
    assert.ok(syndication, "the syndication recipe exists");
    const types = syndication.steps.map((step) => step.type);
    assert.ok(types.includes("publish") && types.includes("onepost"), "it mixes one-click and automatic channels");
    const channelsUsed = syndication.steps.filter((step) => step.config?.channel).map((step) => step.config.channel);
    assert.ok(channelsUsed.includes("devto") && channelsUsed.includes("telegraph"), "it uses the two easiest free channels");
    for (const step of syndication.steps) {
      if (!["publish", "onepost"].includes(step.type)) continue;
      assert.ok(registry.listChannels().some((channel) => channel.id === step.config.channel), `${step.name} names a real channel`);
    }
  });

  test("run records keep the channel, not the post body", () => {
    const { rt } = tmpRuntime();
    const workflow = rt.getState().workflows[0];
    const run = rt.recordRun({
      workflowId: workflow.id,
      status: "success",
      startedAt: new Date().toISOString(),
      nodes: [{
        id: "s1", name: "DEV", type: "onepost", status: "done", output: "พร้อมโพสต์", durationMs: 5,
        artifact: { kind: "post", channel: "devto", channelName: "DEV Community", url: "https://dev.to/x", text: "ก".repeat(5000) },
      }],
    });
    const artifact = run.nodes[0].artifact;
    assert.equal(artifact.kind, "post");
    assert.equal(artifact.channel, "devto");
    assert.equal(artifact.channelName, "DEV Community");
    assert.equal(artifact.url, "https://dev.to/x");
    assert.equal(Object.prototype.hasOwnProperty.call(artifact, "text"), false, "the body is not copied into the state file");
  });

  // ── frontend wiring ───────────────────────────────────────────────────────

  test("the builder offers both publishing steps and really calls the relay", () => {
    const lib = read("app", "frontend", "src", "workflow-builder", "lib.js");
    assert.match(lib, /publish: \{ label: "โพสต์อัตโนมัติ"/);
    assert.match(lib, /onepost: \{ label: "โพสต์คลิกเดียว"/);
    assert.match(lib, /import \{ CHANNELS, channelById, composeChannelPost \} from "\.\/channels\.js"/);
    assert.match(lib, /composeChannelPost\(cfg\.channel, draft\)/);
    assert.match(lib, /postJson\("\/api\/ai-workflow\/publish\/send", \{ channelId: cfg\.channel, draft \}\)/);
    assert.match(lib, /kind: "post"/);
    assert.match(lib, /STEP_GROUPS = \[/);

    const channels = read("app", "frontend", "src", "workflow-builder", "channels.js");
    assert.match(channels, /import registry from "\.\.\/\.\.\/\.\.\/\.\.\/scripts\/server\/social-publish-channels\.cjs"/);

    const builder = read("app", "frontend", "src", "components", "WorkflowBuilder.jsx");
    assert.match(builder, /function ChannelsPanel/);
    assert.match(builder, /ช่องทางฟรี/);
    assert.match(builder, /className="awb-post-strip"/);
    assert.match(builder, /\/api\/ai-workflow\/publish\/credentials/);
    assert.match(builder, /onAddStep=\{addChannelStep\}/);
    assert.match(builder, /publish-credentials\.json/, "the UI says where the key is stored");
    // The library has to explain the numbers, not just print them.
    assert.match(builder, /nofollow/);
    assert.match(builder, /ไม่ใช่ปัจจัยจัดอันดับของ Google/);
    const css = read("app", "frontend", "src", "workflow-builder.css");
    for (const selector of [".awb-channel-card", ".awb-post-strip", ".awb-credential-box", ".awb-palette-group", ".awb-palette-tab"]) {
      assert.ok(css.includes(selector), `missing ${selector}`);
    }
  });

  // Reported from the app: "เข้าเมนู Luke AI Workflow ไม่เห็น palette กลุ่ม
  // เผยแพร่ (ฟรี)". The group existed but the palette stacked all ten nodes in a
  // 218px column that scrolled, so the last group sat below the fold with no
  // visible scrollbar. The palette now shows one group at a time behind tabs.
  test("every node is reachable from a palette tab", () => {
    const lib = read("app", "frontend", "src", "workflow-builder", "lib.js");
    const groupsBlock = lib.slice(lib.indexOf("export const STEP_GROUPS"), lib.indexOf("export const STEP_TYPES"));
    const declared = [...groupsBlock.matchAll(/id: "(\w+)"/g)].map((match) => match[1]);
    assert.ok(declared.length >= 3, `the palette declares its groups (${declared.length})`);

    const typesBlock = lib.slice(lib.indexOf("export const STEP_TYPES"), lib.indexOf("export const PUBLISHABLE_CHANNELS"));
    const used = [...new Set([...typesBlock.matchAll(/group: "(\w+)"/g)].map((match) => match[1]))];

    // A node whose group has no tab is a node no user can add.
    const orphans = used.filter((group) => !declared.includes(group));
    assert.deepEqual(orphans, [], `no node sits in a group without a tab: ${orphans.join(", ")}`);
    const empty = declared.filter((group) => !used.includes(group));
    assert.deepEqual(empty, [], `no tab opens onto an empty group: ${empty.join(", ")}`);

    // The tab labels have to be short enough for the column.
    for (const match of groupsBlock.matchAll(/id: "(\w+)", label: "[^"]+", short: "([^"]+)"/g)) {
      assert.ok(match[2].length <= 12, `${match[1]} has a short tab label (${match[2]})`);
    }
    assert.match(groupsBlock, /short: "เผยแพร่"/, "the publishing group is titled เผยแพร่");
  });

  test("the palette shows one group at a time, behind real tabs", () => {
    const builder = read("app", "frontend", "src", "components", "WorkflowBuilder.jsx");
    assert.match(builder, /const \[paletteGroup, setPaletteGroup\] = useState\(STEP_GROUPS\[0\]\.id\)/);
    assert.match(builder, /className="awb-palette-tabs" role="tablist"/);
    assert.match(builder, /role="tab"/);
    assert.match(builder, /aria-selected=\{active\}/);
    assert.match(builder, /aria-controls=\{`awb-panel-\$\{group\.id\}`\}/);
    // Only the selected group's nodes are rendered — that is what fixes the fold.
    assert.match(builder, /STEP_GROUPS\.find\(\(entry\) => entry\.id === paletteGroup\)/);
    assert.match(builder, /Object\.entries\(STEP_TYPES\)\.filter\(\(\[, meta\]\) => meta\.group === group\.id\)/);
    // ...and there is a one-click way in that does not depend on finding the tab.
    assert.match(builder, /className="awb-chip action"/);
    assert.match(builder, /setPaletteGroup\("publish"\); setRightTab\("channels"\)/);

    const css = read("app", "frontend", "src", "workflow-builder.css");
    assert.match(css, /\.awb-palette-tabs \{[^}]*flex-wrap: wrap/, "the tab row wraps instead of overflowing the column");
    assert.match(css, /\.awb-palette-tab\.active \{/, "the selected tab is visible");
  });

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok - ${name}`);
    } catch (error) {
      console.error(`  FAIL - ${name}\n${error.stack || error}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`PASS: ${passed} AI Workflow publishing checks`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
