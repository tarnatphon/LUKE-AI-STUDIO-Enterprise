"use strict";

/**
 * Online surfaces and the no-pay invariant, without leaving this machine.
 *
 * Every state file is pointed at a throwaway directory before a single module
 * is loaded, and every outbound call is either a local stand-in socket or an
 * injected transport. That is the point: the suite proves the policy, the
 * ledger and the consent gates, not that a free provider happens to be up.
 * External media generation was removed entirely, so its former tests now
 * assert that the module, the routes and the switches no longer exist.
 *
 * Run: node scripts/validation/test-online-surfaces.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "luke-online-surfaces-"));

process.env.LUKE_ONLINE_SURFACES_FILE = path.join(scratch, "surfaces.json");
process.env.LUKE_EGRESS_LEDGER_FILE = path.join(scratch, "ledger.jsonl");
process.env.LUKE_LAN_PAIRING_FILE = path.join(scratch, "lan.json");
process.env.LUKE_CHANNEL_RELAY_FILE = path.join(scratch, "channels.json");
process.env.LUKE_REMOTE_PROVIDER_FILE = path.join(scratch, "providers.json");

const aiCatalog = require(path.join(root, "scripts", "server", "ai-provider-catalog.cjs"));
const egressLedger = require(path.join(root, "scripts", "server", "egress-ledger.cjs"));
const lanPairing = require(path.join(root, "scripts", "server", "lan-pairing.cjs"));
const onlineSurfaces = require(path.join(root, "scripts", "server", "online-surfaces.cjs"));
const mcpServer = require(path.join(root, "scripts", "server", "mcp-server.cjs"));
const channelRelay = require(path.join(root, "scripts", "server", "channel-relay.cjs"));
const contentParts = require(path.join(root, "scripts", "server", "content-parts.cjs"));
const remoteProvider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));

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

function readSource(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

async function main() {
  const serveSource = readSource(path.join("scripts", "server", "serve.cjs"));

  // ── 1. The catalogue contains free, card-free providers only ──────────────
  section("1. One catalogue, with every billable option removed");
  const catalog = aiCatalog.readCatalog();
  check("the catalogue loads", catalog.providers.length >= 8, String(catalog.providers.length));
  check("it carries a verification date", /^\d{4}-\d{2}-\d{2}$/.test(catalog.verifiedAt), catalog.verifiedAt);
  check("every entry is free, not paid, and needs no card",
    catalog.providers.every((entry) => entry.free === true && entry.paid === false && entry.requiresCard === false));
  check("only recurring free tiers and local providers remain",
    catalog.providers.every((entry) => ["free-tier", "local"].includes(entry.kind)));
  check("every entry names its modalities and a source",
    catalog.providers.every((entry) => Array.isArray(entry.modalities) && typeof entry.sourceUrl === "string"));
  const REMOVED = [
    "groq", "arena", "openai", "anthropic", "xai", "azure", "aws", "gcp", "oci",
    "amd", "cerebras", "sambanova", "github_models", "huggingface", "together",
    "fireworks", "coreweave", "cohere",
  ];
  check("nothing that costs money or needs a card is registered",
    REMOVED.every((id) => !catalog.providers.some((entry) => entry.id === id)));
  check("no transport provider is paid",
    Object.values(remoteProvider.PROVIDERS).every((entry) => entry.free === true && entry.paid === false));
  check("Groq and the Arena router are deleted from the transport registry",
    !remoteProvider.PROVIDERS.groq && !remoteProvider.PROVIDERS.arena);
  check("a provider missing from the catalogue fails closed",
    aiCatalog.transportPolicy("no-such-provider").free === false
    && aiCatalog.transportPolicy("no-such-provider").paid === true);
  check("Gemini is the multimodal free link",
    aiCatalog.entryFor("gemini").free === true
    && aiCatalog.entryFor("gemini").modalities.includes("video"));
  check("the local GGUF is marked uncensored and free",
    aiCatalog.entryFor("local_gguf").uncensored === true
    && aiCatalog.entryFor("local_gguf").free === true);

  // ── 2. The switchboard ───────────────────────────────────────────────────
  section("2. Policy defaults and the four hard stops");
  const defaults = onlineSurfaces.getConfig();
  check("online-first Chat is on by default", defaults.cloudForChat === true);
  check("no-pay is an invariant, not a switch",
    !("freeOnly" in defaults) && onlineSurfaces.NO_PAY === true);
  check("the local-only / channel surfaces are off by default",
    defaults.uncensoredMode === false && defaults.airGapMode === false
    && defaults.channelsEnabled === false);
  check("no online-media switch is registered at all",
    !("onlineMediaEnabled" in defaults));
  check("a Work turn is allowed", onlineSurfaces.cloudDecision("work").allowed === true);
  check("a Chat turn is allowed too", onlineSurfaces.cloudDecision("chat").allowed === true);
  check("an unmarked turn is treated as chat", onlineSurfaces.cloudDecision(undefined).mode === "chat");

  const switched = onlineSurfaces.setConfig({ cloudForChat: false, rateLimitRetry: 9 });
  check("a switch can be turned off", switched.config.cloudForChat === false);
  check("the retry count is capped", switched.config.rateLimitRetry === 3);
  check("chat is refused when online-first is off",
    onlineSurfaces.cloudDecision("chat").allowed === false);
  check("Work still is not refused by that switch",
    onlineSurfaces.cloudDecision("work").allowed === true);
  onlineSurfaces.setConfig({ cloudForChat: true, airGapMode: true });
  check("air-gap mode blocks Work as well as Chat",
    onlineSurfaces.cloudDecision("work").allowed === false
    && onlineSurfaces.cloudDecision("chat").allowed === false);
  onlineSurfaces.setConfig({ airGapMode: false, uncensoredMode: true });
  check("the no-filter lane blocks every cloud turn",
    /No-filter lane/.test(onlineSurfaces.cloudDecision("work").reason));
  onlineSurfaces.setConfig({ uncensoredMode: false, rateLimitRetry: 0 });
  let badPatch = false;
  try { onlineSurfaces.setConfig({ cloudForChat: "yes" }); } catch { badPatch = true; }
  check("a non-boolean switch is refused", badPatch);
  const ignored = onlineSurfaces.setConfig({ freeOnly: false });
  check("a hand-written freeOnly:false is ignored — there is no paid path to enable",
    !("freeOnly" in ignored.config) && ignored.changed.length === 0);
  check("the config file is owner-only",
    (fs.statSync(onlineSurfaces.configFile()).mode & 0o777) === 0o600);

  // ── 3. Egress Ledger ─────────────────────────────────────────────────────
  section("3. The Egress Ledger is proof, not a promise");
  egressLedger.clear();
  check("it starts empty", egressLedger.list().length === 0);
  egressLedger.record({
    surface: "cloud-chain",
    provider: "nvidia",
    url: "https://integrate.api.nvidia.com/v1/chat/completions?key=SECRET-SHOULD-NOT-BE-STORED",
    method: "POST",
    bytes: 1234,
    decision: "allowed",
    reason: "free cloud turn",
  });
  egressLedger.record({
    surface: "cloud-chain",
    provider: "__unregistered_paid_probe",
    url: "https://paid.example/v1/chat/completions",
    decision: "blocked",
    reason: "no-pay invariant",
    paid: true,
  });
  const rows = egressLedger.list();
  check("both departures are recorded", rows.length === 2, String(rows.length));
  check("only the host is kept, never a query or a secret",
    rows[0].host === "https://integrate.api.nvidia.com"
    && !JSON.stringify(rows).includes("SECRET-SHOULD-NOT-BE-STORED"));
  check("the refused billable link is counted as blocked, not allowed",
    egressLedger.stats().blocked === 1 && egressLedger.stats().allowed === 1);
  check("no paid endpoint was actually called", egressLedger.stats().paidCalls === 0);
  check("credentials in a URL are stripped",
    egressLedger.safeHost("https://user:pw@example.com/v1").includes("credentials removed"));
  const report = egressLedger.report();
  check("the attestation names LUKE and its own scope",
    /LUKE AI STUDIO/.test(report.attestation) && /out of scope/i.test(report.attestation));
  check("the attestation has a digest", /^[a-f0-9]{64}$/.test(report.digest));
  check("the badge follows the ledger, not a wish",
    ["free-cloud", "online-ready"].includes(onlineSurfaces.badge().id), onlineSurfaces.badge().id);
  onlineSurfaces.setConfig({ airGapMode: true });
  check("air-gap mode makes the badge say so", onlineSurfaces.badge().id === "air-gap");
  onlineSurfaces.setConfig({ airGapMode: false });
  check("clearing starts a new evidence window", egressLedger.clear() && egressLedger.list().length === 0);

  // ── 4. Content parts ─────────────────────────────────────────────────────
  section("4. Attached images are translated, not silently dropped");
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const attachment = [
    { type: "text", text: "What is in this picture?" },
    { type: "image_url", image_url: { url: tinyPng } },
  ];
  const openAi = contentParts.normalizeContentParts(attachment, "openai-chat", {
    allowedModalities: ["text", "image"],
  });
  const anthropic = contentParts.normalizeContentParts(attachment, "anthropic-messages", {
    allowedModalities: ["text", "image"],
  });
  const gemini = contentParts.normalizeContentParts(attachment, "gemini-generate", {
    allowedModalities: ["text", "image"],
  });
  check("OpenAI keeps the text and the image_url",
    Array.isArray(openAi) && openAi[0].text === "What is in this picture?" && openAi[1].type === "image_url");
  check("Anthropic gets a base64 image source",
    Array.isArray(anthropic) && anthropic[1].type === "image" && anthropic[1].source.type === "base64");
  check("Gemini gets inline_data",
    Array.isArray(gemini) && Boolean(gemini[1].inline_data));
  check("a text-only provider gets a placeholder, not a lost turn",
    contentParts.normalizeContentParts(attachment, "openai-chat", { allowedModalities: ["text"] })
      .some((part) => String(part.text || "").includes("Attached image omitted")));
  const remoteImage = contentParts.normalizeContentParts(
    [{ type: "image_url", image_url: { url: "http://127.0.0.1:1420/private.png" } }],
    "openai-chat",
    { allowedModalities: ["text", "image"] },
  );
  check("a remote URL is never handed to a provider",
    !JSON.stringify(remoteImage).includes("127.0.0.1")
    && JSON.stringify(remoteImage).includes("Attached image omitted"));
  check("textOf reads both shapes",
    contentParts.textOf("hello") === "hello"
    && contentParts.textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }]) === "a\nb");
  const payload = remoteProvider.buildRemotePayload({
    providerId: "gemini",
    messages: [{ role: "user", content: attachment }],
  });
  check("the real Gemini payload carries the image part",
    Array.isArray(payload.messages[0].content)
    && payload.messages[0].content.some((part) => part.type === "image_url"));
  const textOnlyPayload = remoteProvider.buildRemotePayload({
    providerId: "nvidia",
    messages: [{ role: "user", content: attachment }],
  });
  check("the real NVIDIA payload degrades to text with a note",
    JSON.stringify(textOnlyPayload).includes("Attached image omitted"));

  // ── 5. LAN pairing ───────────────────────────────────────────────────────
  section("5. 0.0.0.0 without a door is a hole; pairing closes it");
  const loopback = { socket: { remoteAddress: "127.0.0.1" }, method: "GET", headers: {}, url: "/api/llm/chat" };
  const lan = { socket: { remoteAddress: "192.168.1.42" }, method: "POST", headers: {}, url: "/api/llm/chat" };
  check("this computer is always trusted", lanPairing.authorize(loopback, "/api/llm/chat").allowed === true);
  check("an unpaired device is refused by default",
    lanPairing.authorize(lan, "/api/llm/chat").allowed === false);
  check("static assets still load for the pairing screen",
    lanPairing.authorize({ ...lan, url: "/index.html" }, "/index.html").allowed === true);
  check("the handshake endpoints are reachable",
    lanPairing.authorize(lan, "/api/lan/status").allowed === true);
  const paired = lanPairing.pair();
  check("pairing returns a token once", /^[a-f0-9]{48}$/.test(paired.token), paired.token);
  check("status never returns that token", !JSON.stringify(lanPairing.status()).includes(paired.token));
  check("a wrong token is refused",
    lanPairing.authorize({ ...lan, headers: { "x-luke-pair": "wrong" } }, "/api/llm/chat").allowed === false);
  check("the right token is accepted",
    lanPairing.authorize({ ...lan, headers: { "x-luke-pair": paired.token } }, "/api/llm/chat").allowed === true);
  check("the pairing file is owner-only",
    (fs.statSync(lanPairing.pairingFile()).mode & 0o777) === 0o600);
  lanPairing.revoke();
  check("revoking closes the door again", lanPairing.authorize(lan, "/api/llm/chat").allowed === false);

  // ── 6. MCP ───────────────────────────────────────────────────────────────
  section("6. MCP is a third door, and it is read-only about secrets");
  const context = {
    status: () => onlineSurfaces.status(),
    catalog: () => aiCatalog.summary(),
    egressReport: () => egressLedger.report(),
    chat: async ({ message }) => ({ content: `echo: ${message}`, provider: "test" }),
  };
  const init = await mcpServer.handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, context);
  check("initialize answers with a protocol version", init.result.protocolVersion === mcpServer.PROTOCOL_VERSION);
  const tools = await mcpServer.handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, context);
  check("four tools are advertised", tools.result.tools.length === 4);
  check("no file, terminal or key tool is exposed",
    tools.result.tools.every((tool) => !/file|terminal|key|delete|write/i.test(tool.name)));
  const called = await mcpServer.handleRpc({
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "luke_chat", arguments: { message: "hello" } },
  }, context);
  check("a chat tool call returns text", /echo: hello/.test(called.result.content[0].text));
  const empty = await mcpServer.handleRpc({
    jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "luke_chat", arguments: {} },
  }, context);
  check("an empty chat call is refused", empty.error.code === -32602);
  const invalid = await mcpServer.handleRpc({ id: 5, method: "tools/list" }, context);
  check("a non-JSON-RPC request is refused", invalid.error.code === -32600);

  // ── 7. Channel relay ─────────────────────────────────────────────────────
  section("7. Channels are off until configured, and tokens never come back");
  check("channels start disabled", channelRelay.status().enabled === false);
  check("a disabled relay refuses an outbound send",
    await channelRelay.send("telegram", { text: "hi" }).then(() => false).catch((e) => e.statusCode === 403));
  const channelStatus = channelRelay.configure({
    enabled: true,
    platform: "telegram",
    token: "BOT-SECRET-12345",
    webhookSecret: "HOOK-SECRET-999",
  });
  check("the platform shows configured", channelStatus.platforms[0].configured === true);
  check("and the token is never returned", !JSON.stringify(channelStatus).includes("BOT-SECRET-12345"));
  check("the channel file is owner-only",
    (fs.statSync(channelRelay.configFile()).mode & 0o777) === 0o600);
  check("a webhook with the wrong secret is refused",
    channelRelay.verifyWebhook("telegram", { message: { text: "hi" } }, { "x-telegram-bot-api-secret-token": "nope" }).ok === false);
  check("a webhook with the right secret is accepted",
    channelRelay.verifyWebhook("telegram", { message: { text: "hi" } }, { "x-telegram-bot-api-secret-token": "HOOK-SECRET-999" }).ok === true);
  const outbound = [];
  const dry = await channelRelay.send("telegram", { text: "dry", chatId: "42", dryRun: true }, {
    transport: async () => { throw new Error("dry run must not call the transport"); },
    recordEgress: (entry) => outbound.push(entry),
  });
  check("a dry run never calls the network", dry.dryRun === true && outbound[0].decision === "blocked");
  const live = await channelRelay.send("telegram", { text: "live", chatId: "42" }, {
    transport: async (url, init) => ({ status: 200, body: JSON.stringify({ url, body: init.body }) }),
    recordEgress: (entry) => outbound.push(entry),
  });
  check("an explicit live send uses the injected transport", live.upstream.status === 200);
  check("and the ledger entry does not contain the bot token",
    !JSON.stringify(outbound[outbound.length - 1]).includes("BOT-SECRET-12345"));
  check("an unknown channel is refused",
    await channelRelay.send("carrier-pigeon", { text: "hi" }).then(() => false).catch((e) => e.statusCode === 400));

  // ── 8. No external media generation surface at all ──────────────────────
  section("8. External media generation is deleted, not disabled");
  const mediaModule = path.join(root, "scripts", "server", "online-media.cjs");
  check("the online-media module is gone from the repository", !fs.existsSync(mediaModule));
  check("serve.cjs no longer requires it",
    !/require\("\.\/online-media\.cjs"\)/.test(serveSource));
  check("the server declares no /api/online-media route",
    !serveSource.includes("/api/online-media/"));
  const onlineSurfacesSource = readSource(path.join("scripts", "server", "online-surfaces.cjs"));
  check("no onlineMediaEnabled switch survives in the policy",
    !/onlineMediaEnabled/.test(onlineSurfacesSource));
  const panelSource = readSource(path.join("app", "frontend", "src", "components", "OnlineSurfacesPanel.jsx"));
  check("the panel never calls an online-media endpoint",
    !panelSource.includes("/api/online-media/"));
  check("the panel explains that media is produced locally",
    /Media stays on this machine/i.test(panelSource));
  check("no media trial, allowance or card-confirmation path survives in the server",
    !/kling_free|fal_trial|veo_gcp_trial|stability_trial|cardConfirmed|budgetConfirmed|freeAllowance/.test(serveSource));
  check("Settings shows the seven remaining switches",
    /count=\{7\}/.test(readSource(path.join("app", "frontend", "src", "components", "Settings.jsx"))));

  // ── 9. PWA and zero static egress ────────────────────────────────────────
  section("9. Installable shell with no external font call");
  const manifest = JSON.parse(readSource(path.join("app", "frontend", "public", "manifest.webmanifest")));
  check("the manifest names the app and two PNG icons",
    manifest.name === "LUKE AI STUDIO" && manifest.icons.length === 2
    && manifest.icons.every((icon) => icon.type === "image/png"));
  check("both icon files exist",
    fs.existsSync(path.join(root, "app", "frontend", "public", "luke-icon-192.png"))
    && fs.existsSync(path.join(root, "app", "frontend", "public", "luke-icon-512.png")));
  const sw = readSource(path.join("app", "frontend", "public", "sw.js"));
  check("the worker never caches /api or /v1 answers",
    /startsWith\("\/api\/"\)/.test(sw) && /startsWith\("\/v1\/"\)/.test(sw));
  const html = readSource(path.join("app", "frontend", "index.html"));
  check("index.html declares the manifest", /rel="manifest"/.test(html));
  check("and no longer phones a font CDN", !/fonts\.googleapis\.com/.test(html));
  const main = readSource(path.join("app", "frontend", "src", "main.jsx"));
  check("the worker is registered only in a built bundle",
    /import\.meta\.env\.PROD/.test(main) && /serviceWorker\.register/.test(main));

  // ── 10. Wiring in the live server ────────────────────────────────────────
  section("10. Every surface is actually wired into serve.cjs");
  const endpoints = [
    "/api/online-surfaces/status", "/api/online-surfaces/config", "/api/online-surfaces/catalog",
    "/api/egress/ledger", "/api/egress/report", "/api/egress/clear",
    "/api/lan/status", "/api/lan/pair", "/api/lan/revoke", "/api/mcp",
    "/api/channels/status", "/api/channels/config", "/api/channels/webhook",
    "/api/channels/send", "/api/channels/test",
    "/v1/chat/completions",
  ];
  for (const endpoint of endpoints) {
    check(`route declared: ${endpoint}`, serveSource.includes(endpoint));
  }
  check("no deleted online-media endpoint can be re-declared silently",
    !serveSource.includes("/api/online-media/"));
  check("the LAN guard runs before the routes",
    serveSource.indexOf("lanPairing.authorize") < serveSource.indexOf("/api/online-surfaces/status"));
  check("the external gateway is declared before the /v1/ proxy",
    serveSource.indexOf('req.url === "/v1/chat/completions"')
    < serveSource.indexOf("return proxyImageBackendRequest(req, res)"));
  check("the chat gate reads the online-surface decision",
    /onlineSurfaces\.cloudDecision\(body\.assistantMode\)/.test(serveSource));
  check("the chain receives the policy and the ledger hook",
    /policy,\s*onEgress: \(entry\) => egressLedger\.record\(entry\)/.test(serveSource));
  check("the external gateway advertises the no-pay invariant, not a switch",
    /noPay: onlineSurfaces\.NO_PAY/.test(serveSource));
  check("no freeOnly switch survives in the live server",
    !/freeOnly/.test(serveSource));

  // ── 11. README tells the truth ───────────────────────────────────────────
  section("11. Positioning is honest");
  const readme = readSource("README.md");
  check("offline is a default, not a false absolute",
    /Offline by default · Online on your terms/.test(readme));
  check("the no-filter lane is documented", /No-filter local lane/.test(readme));
  check("the online-surfaces doc is linked", /online-surfaces-and-differentiation\.md/.test(readme));
  check("the README says no paid provider is registered",
    /No paid provider is registered at all/.test(readme));
  check("the new doc exists", fs.existsSync(path.join(root, "docs", "beta7", "online-surfaces-and-differentiation.md")));

  // ── 12. No-pay over a real socket ────────────────────────────────────────
  // Groq/Arena no longer exist, so a paid-shaped provider is injected ONLY for
  // this test. It proves the invariant still holds if a stale config file, a
  // hand edit, or a future mistake ever puts a billable link back in `order`.
  section("12. Even a stale paid key can never reach the network");
  const seenKeys = [];
  const gateway = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seenKeys.push(String(req.headers.authorization || ""));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "free answer" } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  process.env.LUKE_REMOTE_PROVIDER_BASE_URL = `http://127.0.0.1:${gateway.address().port}/v1`;

  remoteProvider.PROVIDERS.__paid_probe = {
    id: "__paid_probe",
    label: "Paid probe (test only)",
    baseUrl: "https://paid.example/v1",
    model: "paid/model",
    docs: "none",
    note: "test only",
    free: false,
    paid: true,
    modalities: ["text"],
  };

  fs.writeFileSync(process.env.LUKE_REMOTE_PROVIDER_FILE, `${JSON.stringify({
    keys: { nvidia: "nvapi-TEST-KEY-00000001", __paid_probe: "paid-TEST-KEY-00000002" },
    enabled: {}, bases: {}, models: {}, order: ["__paid_probe", "nvidia"], useLocalFallback: true,
  }, null, 2)}\n`);

  const freeEgress = [];
  const freeResult = await remoteProvider.streamRemoteChain({
    messages: [{ role: "user", content: "hello" }],
    cooldownMs: 0,
    onEgress: (entry) => freeEgress.push(entry),
  });
  check("the chain still answers", freeResult.content === "free answer", freeResult.content);
  check("the injected paid link was never called",
    !seenKeys.some((key) => key.includes("paid-TEST-KEY")), seenKeys.join(" | "));
  check("only the free key left this machine",
    seenKeys.length === 1 && seenKeys[0].includes("nvapi-TEST-KEY"), seenKeys.join(" | "));
  check("the refusal is in the ledger hook",
    freeEgress.some((entry) => entry.decision === "blocked" && /no-pay invariant/.test(entry.reason)));

  seenKeys.length = 0;
  const noSwitchEgress = [];
  await remoteProvider.streamRemoteChain({
    messages: [{ role: "user", content: "hello" }],
    policy: { freeOnly: false },
    cooldownMs: 0,
    onEgress: (entry) => noSwitchEgress.push(entry),
  });
  check("passing freeOnly:false changes nothing — no paid path exists",
    !seenKeys.some((key) => key.includes("paid-TEST-KEY")), seenKeys.join(" | "));
  check("and the refusal is still marked paid in the ledger hook",
    noSwitchEgress.some((entry) => entry.paid === true && entry.decision === "blocked"));

  delete remoteProvider.PROVIDERS.__paid_probe;
  gateway.close();
  delete process.env.LUKE_REMOTE_PROVIDER_BASE_URL;
}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
