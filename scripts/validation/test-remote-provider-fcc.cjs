"use strict";

/**
 * The Free Claude Code bridge, driven over a real socket.
 *
 * FCC is a *local proxy*, not another cloud key. It answers Anthropic Messages
 * on /v1/messages, needs no API key by default, and lives at 127.0.0.1:8082.
 * That is three differences from every other link in the Work chain, and each
 * one is a way this integration can quietly do nothing at all. So this suite
 * stands up a stand-in FCC and proves:
 *
 *   1. the request is Anthropic-shaped (system prompt outside `messages`,
 *      alternating turns, max_tokens), on the right path, with the right headers;
 *   2. the Anthropic SSE — content_block_start / content_block_delta / error —
 *      is read as one answer, including Thai text split across reads;
 *   3. a keyless connect works, a remote URL cannot be saved, and the optional
 *      proxy token never reaches the browser;
 *   4. when FCC is not running, the chain moves to the next link rather than
 *      losing the turn;
 *   5. the live route and the Settings panel still agree on what "connected" is.
 *
 * Run: node scripts/validation/test-remote-provider-fcc.cjs
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const SCRATCH_FILE = path.join(os.tmpdir(), `luke-fcc-test-${process.pid}.json`);
const REAL_KEY_FILE = path.join(root, "app", "runtime-state", "text-chat", "remote-text-provider.json");

function realKeySnapshot() {
  return fs.existsSync(REAL_KEY_FILE)
    ? { mtime: fs.statSync(REAL_KEY_FILE).mtimeMs, content: fs.readFileSync(REAL_KEY_FILE, "utf8") }
    : null;
}

const realKeyBefore = realKeySnapshot();

process.env.LUKE_REMOTE_PROVIDER_FILE = SCRATCH_FILE;

const provider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const settingsSource = fs.readFileSync(
  path.join(root, "app", "frontend", "src", "components", "Settings.jsx"),
  "utf8",
);
const docsSource = fs.readFileSync(path.join(root, "docs", "beta7", "fcc-work-chat-bridge.md"), "utf8");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function anthropicFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function openAiFrame(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** A loopback URL that nothing is listening on, for the "FCC is off" case. */
async function closedPort() {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  // ── the stand-in FCC ────────────────────────────────────────────────────
  const seen = [];
  let mode = "answer";

  const fcc = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/v1/models")) {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [
          { id: "nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b" },
          { id: "open_router/openrouter/free" },
        ],
      }));
      return;
    }

    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(raw || "{}"); } catch {}
      seen.push({ method: req.method, url: req.url, headers: req.headers, payload });

      if (mode === "unauthorized") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { message: "Missing proxy authentication token" } }));
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });

      if (mode === "errorFrame") {
        res.write(anthropicFrame("error", {
          type: "error",
          error: { type: "overloaded_error", message: "Every FCC provider refused" },
        }));
        res.end();
        return;
      }

      // The shape FCC actually streams: message_start, an eager text block,
      // deltas (one of them Thai), and message_stop. No [DONE] marker.
      res.write(anthropicFrame("message_start", { type: "message_start", message: { id: "msg_1" } }));
      res.write(anthropicFrame("content_block_start", {
        type: "content_block_start", index: 0, content_block: { type: "text", text: "Work " },
      }));
      res.write(anthropicFrame("content_block_delta", {
        type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "answered " },
      }));
      res.write(anthropicFrame("content_block_delta", {
        type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "เป็นภาษาไทย" },
      }));
      res.write(anthropicFrame("content_block_stop", { type: "content_block_stop", index: 0 }));
      res.write(anthropicFrame("message_stop", { type: "message_stop" }));
      res.end();
    });
  });

  await new Promise((resolve) => fcc.listen(0, "127.0.0.1", resolve));
  const fccUrl = `http://127.0.0.1:${fcc.address().port}/v1`;

  // A second stand-in for the ordinary cloud link, so a dead FCC can be
  // proved to fall through instead of swallowing the turn.
  const cloud = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let payload = {};
      try { payload = JSON.parse(raw || "{}"); } catch {}
      seen.push({ method: req.method, url: req.url, headers: req.headers, payload, cloud: true });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(openAiFrame("the cloud link answered"));
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const cloudUrl = `http://127.0.0.1:${cloud.address().port}/v1`;

  process.env.LUKE_FCC_BASE_URL = fccUrl;
  process.env.LUKE_REMOTE_PROVIDER_BASE_URL = cloudUrl;

  const MESSAGES = [
    { role: "system", content: "the Work contract" },
    { role: "user", content: "fix the failing test" },
    { role: "assistant", content: "on it" },
    { role: "user", content: "and keep going" },
    { role: "tool", content: "a stray tool result" },
  ];

  try {
    section("1. The bridge is a different kind of link");
    const fccProvider = provider.PROVIDERS.fcc;
    check("FCC is in the catalogue", Boolean(fccProvider));
    check("it is keyless and local", fccProvider.keyless === true && fccProvider.local === true);
    check("it speaks Anthropic Messages", fccProvider.apiFormat === "anthropic-messages");
    check("it is opt-in, not in the default cloud chain",
      !provider.DEFAULT_ORDER.includes("fcc"), provider.DEFAULT_ORDER.join(" -> "));
    check("its default address is loopback port 8082 with /v1",
      /^http:\/\/127\.0\.0\.1:8082\/v1$/.test(fccProvider.baseUrl), fccProvider.baseUrl);
    check("the request goes to /v1/messages, never /chat/completions",
      provider.remoteEndpoint("fcc").endsWith("/v1/messages")
      && !provider.remoteEndpoint("fcc").includes("chat/completions"),
      provider.remoteEndpoint("fcc"));
    check("a Claude tier name is left for FCC to resolve",
      /sonnet/.test(fccProvider.model), fccProvider.model);
    check("its model list asks for routable ids", fccProvider.modelsQuery === "?view=messages");

    section("2. The body is Anthropic-shaped, not Chat Completions");
    const body = provider.buildRemotePayload({
      providerId: "fcc",
      messages: MESSAGES,
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 1024,
    });
    check("the system prompt is a top-level field", body.system === "the Work contract", String(body.system));
    check("and not a message with a system role",
      !body.messages.some((message) => message.role === "system"));
    check("tool transcripts are still dropped",
      !body.messages.some((message) => message.content === "a stray tool result"));
    check("turns alternate and consecutive ones are merged",
      body.messages.length === 3 && body.messages[0].role === "user"
      && body.messages[1].role === "assistant" && body.messages[2].role === "user",
      JSON.stringify(body.messages.map((message) => message.role)));
    check("max_tokens is required and honoured", body.max_tokens === 1024, String(body.max_tokens));
    check("it asks to stream", body.stream === true);
    check("generation settings survive the translation",
      body.temperature === 0.3 && body.top_p === 0.9);
    check("a missing output cap gets a safe default",
      provider.buildRemotePayload({ providerId: "fcc" }).max_tokens === 8192);
    const cloudBody = provider.buildRemotePayload({ providerId: "nvidia", messages: MESSAGES });
    check("the ordinary cloud links keep their original shape",
      cloudBody.messages[0].role === "system" && !("system" in cloudBody)
      && !("max_tokens" in cloudBody));

    section("3. The headers belong to a local Anthropic proxy");
    const withToken = provider.remoteHeaders("freecc", "fcc");
    const withoutToken = provider.remoteHeaders("", "fcc");
    check("a token goes in x-api-key", withToken["x-api-key"] === "freecc");
    check("the Anthropic version header is present", withToken["anthropic-version"] === provider.ANTHROPIC_VERSION);
    check("no bearer token is invented for the bridge", !("authorization" in withToken));
    check("with no token, no credential header is sent at all",
      !("x-api-key" in withoutToken) && !("authorization" in withoutToken));
    check("the old cloud callers are unchanged",
      provider.remoteHeaders("sk-secret-123456").authorization === "Bearer sk-secret-123456");

    section("4. The URL cannot become a request to somebody else's host");
    check("a bare loopback host is completed with /v1",
      provider.parseBaseUrl("http://127.0.0.1:9999", { requireLoopback: true }) === "http://127.0.0.1:9999/v1");
    check("a LAN address is refused",
      provider.parseBaseUrl("http://10.0.0.5:8082/v1", { requireLoopback: true }) === null);
    check("a public host is refused",
      provider.parseBaseUrl("https://evil.example/v1", { requireLoopback: true }) === null);
    check("credentials in the URL are refused",
      provider.parseBaseUrl("http://user:pw@127.0.0.1:8082/v1", { requireLoopback: true }) === null);
    check("a query string is refused",
      provider.parseBaseUrl("http://127.0.0.1:8082/v1?x=1", { requireLoopback: true }) === null);
    let refused = false;
    try { provider.localBaseUrlOrThrow("http://192.168.1.20:8082/v1"); } catch { refused = true; }
    check("and saving one is an error the user can read", refused);
    check("the provider-specific override wins over the global one",
      provider.baseUrlFor("fcc") === fccUrl && provider.baseUrlFor("nvidia") === cloudUrl,
      `${provider.baseUrlFor("fcc")} / ${provider.baseUrlFor("nvidia")}`);

    section("5. Connecting a keyless bridge");
    let status = await provider.providerStatus();
    check("nothing is connected on a fresh machine", status.chain.length === 0);
    check("and the live route would not leave this machine",
      !provider.hasCloudBrain(await provider.readConfig()));

    await provider.setLocalProvider({ providerId: "fcc", enabled: true, baseUrl: fccUrl });

    const config = await provider.readConfig();
    check("the bridge is enabled without a key",
      provider.isConnected(config, "fcc") === true && !config.keys.fcc);
    check("hasCloudBrain agrees with the chain", provider.hasCloudBrain(config) === true);
    check("it is placed first, ahead of the cloud links", config.order[0] === "fcc", config.order.join(" -> "));
    check("its address is remembered", config.bases.fcc === fccUrl);
    status = await provider.providerStatus();
    const statusItem = status.providers.find((item) => item.id === "fcc");
    check("the panel says connected", statusItem.configured === true && status.chain.includes("fcc"));
    check("and exposes the URL, since it is not a secret", statusItem.baseUrl === fccUrl);
    check("and marks it keyless", statusItem.keyless === true);
    check("the config file is owner-only",
      (fs.statSync(SCRATCH_FILE).mode & 0o777) === 0o600,
      String(fs.statSync(SCRATCH_FILE).mode & 0o777));

    let badUrlRejected = false;
    try {
      await provider.setLocalProvider({ providerId: "fcc", enabled: true, baseUrl: "http://10.0.0.5:8082/v1" });
    } catch {
      badUrlRejected = true;
    }
    check("a remote URL cannot be saved", badUrlRejected && (await provider.readConfig()).bases.fcc === fccUrl);

    const TOKEN = "fcc-SECRET-token-1234";
    await provider.setLocalProvider({ providerId: "fcc", enabled: true, token: TOKEN });
    status = await provider.providerStatus();
    check("an optional proxy token can be saved", (await provider.readStoredKey("fcc")) === TOKEN);
    check("and never reaches the browser", !JSON.stringify(status).includes(TOKEN));
    check("the panel shows only a hint", /^…\w{1,6}$/.test(status.providers.find((item) => item.id === "fcc").keyHint));

    section("6. A real turn through the stand-in FCC");
    seen.length = 0;
    mode = "answer";
    // Clear the token so this turn proves the keyless path too.
    await provider.setLocalProvider({ providerId: "fcc", enabled: true, token: "" });

    const answer = await provider.streamRemoteChain({ messages: MESSAGES });
    const request = seen.find((entry) => !entry.cloud && entry.method === "POST");
    check("it called /v1/messages", request?.url === "/v1/messages", String(request?.url));
    check("the Anthropic version header arrived",
      request?.headers["anthropic-version"] === provider.ANTHROPIC_VERSION);
    check("no credential was sent", !request?.headers["x-api-key"] && !request?.headers.authorization);
    check("the Work contract travelled as `system`",
      request?.payload?.system === "the Work contract", String(request?.payload?.system));
    check("and max_tokens was present", Number.isInteger(request?.payload?.max_tokens));
    check("the eager text and both deltas form one answer",
      answer.content === "Work answered เป็นภาษาไทย", answer.content);
    check("Thai survived the stream", /ภาษาไทย/.test(answer.content));
    check("it names the bridge that answered", answer.providerId === "fcc", String(answer.providerId));
    check("no failure was recorded", (answer.failures || []).length === 0);

    section("7. Models and the Test button work without a key");
    seen.length = 0;
    const listed = await provider.listRemoteModels("fcc");
    check("the model list came from /v1/models?view=messages",
      listed.ok === true && seen[0]?.url === "/v1/models?view=messages", String(seen[0]?.url));
    check("and carries routable ids",
      listed.models.includes("nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b")
      && listed.models.includes("open_router/openrouter/free"),
      JSON.stringify(listed.models));

    seen.length = 0;
    const tested = await provider.testRemoteProvider("fcc");
    check("Test answers without a saved key", tested.ok === true, tested.message);
    check("and reached the bridge", seen.some((entry) => entry.url === "/v1/messages"));

    section("8. Refusals are reported in words the user can act on");
    mode = "unauthorized";
    seen.length = 0;
    const authFailure = await provider.streamRemoteChain({ messages: MESSAGES });
    check("a proxy-token refusal is classified",
      authFailure.failures[0]?.code === "local_bridge_auth", JSON.stringify(authFailure.failures));
    check("and says what to do", /Proxy Authentication/i.test(authFailure.failures[0]?.message || ""));
    check("and is retryable, so the cloud links still get a turn",
      provider.isRetryable("local_bridge_auth") === true);

    mode = "errorFrame";
    const streamFailure = await provider.streamRemoteChain({ messages: MESSAGES });
    check("an SSE error frame before any token is a failed link",
      streamFailure.failures[0]?.code === "upstream_error", JSON.stringify(streamFailure.failures));
    check("and its own words are kept",
      /Every FCC provider refused/.test(streamFailure.failures[0]?.message || ""),
      streamFailure.failures[0]?.message);
    check("nothing was spliced onto a partial answer", streamFailure.content === "");
    mode = "answer";

    section("9. When FCC is not running, the chain moves on");
    const deadPort = await closedPort();
    process.env.LUKE_FCC_BASE_URL = `http://127.0.0.1:${deadPort}/v1`;
    await provider.saveKey("nvidia", "sk-nvidia-SECRET-key-0001");
    seen.length = 0;

    const fellThrough = await provider.streamRemoteChain({ messages: MESSAGES });
    check("the dead bridge was recorded as unreachable",
      fellThrough.failures[0]?.code === "unreachable", JSON.stringify(fellThrough.failures));
    check("the message names the program to start",
      /fcc-server/.test(fellThrough.failures[0]?.message || ""), fellThrough.failures[0]?.message);
    check("the next link answered",
      fellThrough.providerId === "nvidia" && fellThrough.content === "the cloud link answered",
      `${fellThrough.providerId}: ${fellThrough.content}`);
    check("and the ordinary link used the ordinary protocol",
      seen.some((entry) => entry.cloud && entry.url === "/v1/chat/completions"));
    process.env.LUKE_FCC_BASE_URL = fccUrl;

    section("10. Disconnecting, and the wiring outside this module");
    await provider.setLocalProvider({ providerId: "fcc", enabled: false });
    const after = await provider.readConfig();
    check("disconnect removes the enable flag and the token",
      !after.enabled.fcc && !after.keys.fcc);
    check("and the bridge leaves the chain",
      !(await provider.providerStatus()).chain.includes("fcc"));
    check("the server exposes a local-bridge endpoint",
      /\/api\/text-runtime\/remote-provider\/local/.test(serveSource)
      && /remoteTextProvider\.setLocalProvider\(/.test(serveSource));
    check("the live route uses the same definition of connected",
      /remoteTextProvider\.hasCloudBrain\(config\)/.test(serveSource));
    check("Settings offers a URL and a no-key Connect for keyless links",
      /Local proxy URL/.test(settingsSource)
      && /Connect \(no key\)/.test(settingsSource)
      && /sendRemoteLocal\(/.test(settingsSource)
      && /item\.keyless/.test(settingsSource));
    check("the Mac guide exists and names the real path and port",
      /\/Volumes\/AI/.test(docsSource) && /8082/.test(docsSource) && /fcc-server/.test(docsSource));

    section("11. This suite never touched the real key file");
    check("the throwaway file was used", provider.PROVIDER_FILE === SCRATCH_FILE);
    check("the file holding the user's real key was not created or changed",
      JSON.stringify(realKeyBefore) === JSON.stringify(realKeySnapshot()));
  } finally {
    delete process.env.LUKE_FCC_BASE_URL;
    delete process.env.LUKE_REMOTE_PROVIDER_BASE_URL;
    try { fs.unlinkSync(SCRATCH_FILE); } catch {}
    await new Promise((resolve) => fcc.close(resolve));
    await new Promise((resolve) => cloud.close(resolve));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
