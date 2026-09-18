"use strict";

/**
 * Work can borrow a brain from the cloud, and every free cloud tier is finite.
 * Several simply stopped being free this year — Cerebras, GitHub Models,
 * SambaNova — so this is not one provider: it is a chain, tried in order, with
 * the local model as the last link. That chain carries the one thing in this
 * app that must never leave the machine — the keys — so it is proved here
 * rather than trusted:
 *
 * 1. keys are stored inside the app folder, gitignored, scrubbed out of every
 *    error, and never handed back to the browser;
 * 2. the chain is tried in order, and a rate limit or a paywall moves to the
 *    next link instead of failing the turn;
 * 3. when the whole chain is spent, this machine takes the turn;
 * 4. a refusal is reported in the user's words — "the free router only answers
 *    its own apps", not `free_router_harness_restricted`;
 * 5. a stream split across chunks still reads as one answer;
 * 6. and none of this runs when no key is saved: the local path is untouched.
 *
 * Run: node scripts/validation/test-remote-text-provider.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const provider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const settings = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "Settings.jsx"), "utf8");

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

const FAKE_KEY = "sk-arena-SECRET-abcdef123456";

async function main() {
  section("1. The keys live on this machine and nowhere else");
  const relative = path.relative(root, provider.PROVIDER_FILE);
  check("they are stored inside the app folder", relative.startsWith("app" + path.sep + "runtime-state"), relative);
  check("that file is gitignored", gitignore.includes("remote-text-provider.json"));

  const status = await provider.providerStatus();
  check("the status never carries a key itself", !JSON.stringify(status).includes("SECRET"));
  check("it says which providers exist", status.providers.length === 4, String(status.providers.length));
  check("and for each one whether a key is saved", status.providers.every((item) => typeof item.configured === "boolean"));
  check("a hint is shown, never the key",
    status.providers.every((item) => item.keyHint === "" || /^…[A-Za-z0-9]{1,6}$/.test(item.keyHint)));
  check("it names the gateway each provider uses",
    status.providers.every((item) => /^https:\/\//.test(provider.PROVIDERS[item.id].baseUrl)));

  section("2. No error, log or echo can carry a key");
  const scrubbed = provider.scrubKey(`request failed with ${FAKE_KEY} attached`, FAKE_KEY);
  check("a key is scrubbed out of any message", !scrubbed.includes("SECRET") && /hidden/.test(scrubbed), scrubbed);
  check("a short value is left alone rather than mangled", provider.scrubKey("nothing here", "abc") === "nothing here");

  section("3. The request a provider is asked to honour");
  const payload = provider.buildRemotePayload({
    providerId: "nvidia",
    model: "some/model",
    messages: [{ role: "user", content: "fix it" }, { role: "assistant", content: "ok" }, { junk: true }],
    temperature: 0.2,
    maxTokens: 512,
  });
  check("the model is the one chosen for that provider", payload.model === "some/model", payload.model);
  check("it falls back to the provider's default", provider.buildRemotePayload({ providerId: "groq" }).model === provider.PROVIDERS.groq.model);
  check("a router account has its model forced",
    provider.buildRemotePayload({ providerId: "arena", model: "claude-opus-4-6" }).model === "coding-router-preview");
  check("it streams", payload.stream === true);
  check("junk messages are dropped, not forwarded", payload.messages.length === 2, String(payload.messages.length));
  check("roles are only user or assistant", payload.messages.every((message) => ["user", "assistant"].includes(message.role)));
  check("a nonsense temperature is not sent", !("temperature" in provider.buildRemotePayload({ providerId: "nvidia", temperature: "hot" })));
  const headers = provider.remoteHeaders(FAKE_KEY);
  check("the key travels as a bearer token", headers.authorization === `Bearer ${FAKE_KEY}`);
  check("and nowhere else in the headers", !JSON.stringify({ ...headers, authorization: "" }).includes("SECRET"));
  check("each provider has its own endpoint",
    provider.remoteEndpoint("nvidia") !== provider.remoteEndpoint("groq")
    && provider.remoteEndpoint("zai").includes("z.ai"));

  section("4. A refusal is reported in the user's words");
  const harness = provider.classifyRemoteError({ status: 403, body: '{"error":"free_router_harness_restricted"}' });
  check("harness restriction is named for what it is", harness.code === "harness_restricted");
  check("and says which apps the free router does accept", /Claude Code.*OpenCode/s.test(harness.message), harness.message);
  check("and what would lift it", /paid/i.test(harness.message));
  const paywall = provider.classifyRemoteError({ status: 402, providerId: "cerebras-like" });
  check("a provider that started charging says so", paywall.code === "now_paid" && /charg/i.test(paywall.message));
  const gone = provider.classifyRemoteError({ status: 404, providerId: "groq" });
  check("a model that no longer exists says where to get a current name", gone.code === "unknown_model" && /console\.groq\.com/.test(gone.message));
  const badKey = provider.classifyRemoteError({ status: 401, providerId: "nvidia" });
  check("a bad key says where to get a new one", badKey.code === "invalid_key" && /build\.nvidia\.com/.test(badKey.message));
  check("a rate limit names the provider", provider.classifyRemoteError({ status: 429, providerId: "zai" }).message.includes("Z.ai"));
  check("a gateway failure does not blame the key",
    /nothing is wrong with your key/i.test(provider.classifyRemoteError({ status: 503 }).message));
  check("no connection at all says so plainly", provider.classifyRemoteError({ status: 0 }).code === "unreachable");
  check("nothing is left as a bare status code",
    [0, 400, 401, 402, 403, 404, 429, 500].every((status) => provider.classifyRemoteError({ status }).message.length > 30));

  section("5. The chain keeps going when one link is spent");
  check("a rate limit moves to the next provider", provider.isRetryable("rate_limited") === true);
  check("so does a provider that started charging", provider.isRetryable("now_paid") === true);
  check("so does a model that disappeared", provider.isRetryable("unknown_model") === true);
  check("so does one that went down", provider.isRetryable("upstream_error") === true);
  check("so does one that refuses this kind of app", provider.isRetryable("harness_restricted") === true);
  check("a refused key does not: three identical answers help nobody",
    provider.isRetryable("invalid_key") === false && provider.isRetryable("model_not_allowed") === false);
  check("the order starts with the provider that has no daily quota",
    provider.DEFAULT_ORDER[0] === "nvidia", provider.DEFAULT_ORDER.join(" -> "));
  check("and tries all three before giving up", provider.DEFAULT_ORDER.length === 3);

  section("6. A stream that arrives in pieces still reads as one answer");
  const decoder = provider.createSseDecoder();
  const first = decoder.push('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":');
  check("complete frames are published", first.length === 1 && provider.extractDelta(first[0]) === "Hello");
  const second = decoder.push('{"content":" world"}}]}\n\n');
  check("a frame split across two reads is finished on the second", provider.extractDelta(second[0]) === " world");
  check("a done marker is recognised", provider.isDone("data: [DONE]") === false && provider.isDone("[DONE]") === true);
  check("a done marker is not text", provider.extractDelta("[DONE]") === "");
  check("a malformed frame is skipped, not thrown", provider.extractDelta("not json") === "");
  check("a non-delta frame contributes nothing", provider.extractDelta('{"choices":[{"delta":{}}]}') === "");
  const rest = decoder.push('data: {"choices":[{"delta":{"content":"!"}}]}');
  check("a trailing frame with no blank line is flushed, not lost",
    rest.length === 0 && provider.extractDelta(decoder.flush()[0] || "") === "!");

  section("7. The local path is left exactly as it was");
  check("Work decides per turn whether to go to the cloud", /async function resolveRemoteTextTurn\(/.test(serveSource));
  check("and only goes when at least one key exists",
    /config\.order\.some\(\(providerId\) => config\.keys\[providerId\]\)\)/.test(serveSource));
  check("chat stays on this machine", /conversation\.assistantMode !== "work"\s*\)\s*return null;/.test(serveSource));
  check("when the chain is spent, this machine takes the turn",
    /config\.useLocalFallback[\s\S]{0,1500}requestTextRuntime\([\s\S]{0,200}"\/v1\/chat\/completions"/.test(serveSource));
  check("the local answer is saved like any other turn", /appendTextChatMessage\(/.test(serveSource));
  check("the cloud turn emits the events the chat already reads",
    /"recovery-start"/.test(serveSource) && /"recovery-attempt"/.test(serveSource)
    && /"recovery-delta"/.test(serveSource) && /"recovery-complete"/.test(serveSource));
  check("a failure names every link that failed, not just the last",
    /failures\.map\(\(failure\) => `\$\{failure\.modelId\}: \$\{failure\.error\}`\)/.test(serveSource));
  check("the local generator is called only when the cloud is not used",
    (serveSource.match(/await generateWithRuntimeRecovery\(/g) || []).length === 1);

  section("8. The Settings panel never shows a key it already holds");
  check("the field is write-only", /type="password"/.test(settings));
  check("it never renders a stored key back", !/value=\{remoteProvider\.key\b/.test(settings));
  check("it shows a hint instead", /keyHint/.test(settings));
  check("it says where the keys are kept", /app\/runtime-state/.test(settings));
  check("it can forget a key from the same place", /sendRemoteKey\(/.test(settings));
  check("it can test a provider before relying on it", /remote-provider\/test/.test(settings));

  section("9. A key that is saved can be forgotten, and an old file still reads");
  const original = fs.existsSync(provider.PROVIDER_FILE)
    ? fs.readFileSync(provider.PROVIDER_FILE, "utf8")
    : null;

  try {
    await provider.saveKey("nvidia", FAKE_KEY);
    check("a saved key is readable back", (await provider.readStoredKey("nvidia")) === FAKE_KEY);
    check("it is saved with owner-only permissions",
      (fs.statSync(provider.PROVIDER_FILE).mode & 0o777) === 0o600,
      (fs.statSync(provider.PROVIDER_FILE).mode & 0o777).toString(8));
    check("the status admits there is one, without saying which",
      (await provider.providerStatus()).providers.find((item) => item.id === "nvidia").configured === true);
    check("the chain now includes that provider",
      (await provider.providerStatus()).chain.includes("nvidia"));

    await provider.clearKey("nvidia");
    check("forgetting it leaves the other links alone", (await provider.readStoredKey("nvidia")) === null);
    check("and the chain goes back to what is left",
      !(await provider.providerStatus()).chain.includes("nvidia"));

    // A file written by the version that only knew Arena must still be read.
    await provider.writeConfig({ key: FAKE_KEY, savedAt: new Date().toISOString() });
    check("a key file from the single-provider version still reads",
      (await provider.readStoredKey("arena")) === FAKE_KEY);

    await provider.writeConfig({ keys: {}, order: [...provider.DEFAULT_ORDER], models: {}, useLocalFallback: true });
    check("cleared is cleared", (await provider.providerStatus()).chain.length === 0);
    check("and the local model is still the last link by default",
      (await provider.providerStatus()).localFallback === true);
  } finally {
    if (original) {
      fs.mkdirSync(path.dirname(provider.PROVIDER_FILE), { recursive: true });
      fs.writeFileSync(provider.PROVIDER_FILE, original, { mode: 0o600 });
    } else {
      await provider.writeConfig({ keys: {}, order: [...provider.DEFAULT_ORDER], models: {}, useLocalFallback: true });
    }
  }

  let rejected = false;
  try {
    await provider.saveKey("nvidia", "   ");
  } catch {
    rejected = true;
  }
  check("an empty key is refused", rejected);

  let unknownProvider = false;
  try {
    await provider.saveKey("made-up", FAKE_KEY);
  } catch {
    unknownProvider = true;
  }
  check("a key cannot be saved to a provider that does not exist", unknownProvider);

  let lockedModel = false;
  try {
    await provider.setModel("arena", "something-else");
  } catch {
    lockedModel = true;
  }
  check("a router's model cannot be overridden", lockedModel);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
