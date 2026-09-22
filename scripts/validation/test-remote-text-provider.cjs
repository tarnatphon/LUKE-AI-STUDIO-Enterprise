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

const os = require("node:os");

const root = path.resolve(__dirname, "..", "..");

// The keys belong to the user, not to a test run. Backing the real file up in
// memory and restoring it in a `finally` is one interrupted run — a killed
// process, a stopped mac.sh — away from leaving the saved key destroyed. So
// this suite points the module at a throwaway file before it is even loaded.
const SCRATCH_FILE = path.join(os.tmpdir(), `luke-provider-test-${process.pid}.json`);
const REAL_KEY_FILE = path.join(root, "app", "runtime-state", "text-chat", "remote-text-provider.json");

const realKeyBefore = fs.existsSync(REAL_KEY_FILE)
  ? { mtime: fs.statSync(REAL_KEY_FILE).mtimeMs, content: fs.readFileSync(REAL_KEY_FILE, "utf8") }
  : null;

process.env.LUKE_REMOTE_PROVIDER_FILE = SCRATCH_FILE;

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
  const moduleSource = fs.readFileSync(
    path.join(root, "scripts", "server", "remote-text-provider.cjs"),
    "utf8",
  );
  check("by default the keys are stored inside the app folder",
    /"app",\s*"runtime-state",\s*"text-chat",\s*"remote-text-provider\.json"/.test(moduleSource));
  check("that file is gitignored", gitignore.includes("remote-text-provider.json"));
  check("a test run is pointed somewhere throwaway instead", provider.PROVIDER_FILE === SCRATCH_FILE,
    provider.PROVIDER_FILE);

  const status = await provider.providerStatus();
  check("the status never carries a key itself", !JSON.stringify(status).includes("SECRET"));
  check("it says which providers exist",
    status.providers.length === Object.keys(provider.PROVIDERS).length,
    String(status.providers.length));
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
  check("roles survive as themselves, not flattened",
    payload.messages.every((message) => ["user", "assistant"].includes(message.role)));

  // The contract lives in a system message. Demote it to a user turn and the
  // model never reads it — which is how Work ends up writing tool names out as
  // prose, the failure this whole app is built to contain.
  const withSystem = provider.buildRemotePayload({
    providerId: "nvidia",
    messages: [
      { role: "system", content: "the contract" },
      { role: "user", content: "fix it" },
      { role: "tool", content: "some tool output" },
    ],
  });
  check("the system prompt reaches the provider as a system message",
    withSystem.messages[0].role === "system" && withSystem.messages[0].content === "the contract",
    JSON.stringify(withSystem.messages[0]));
  check("and is not demoted to a user turn",
    !withSystem.messages.some((message) => message.role === "user" && message.content === "the contract"));
  check("a tool transcript is not forwarded as though it were speech",
    !withSystem.messages.some((message) => message.content === "some tool output"));
  check("the conversation itself still follows",
    withSystem.messages.length === 2 && withSystem.messages[1].role === "user");
  check("a nonsense temperature is not sent", !("temperature" in provider.buildRemotePayload({ providerId: "nvidia", temperature: "hot" })));
  const headers = provider.remoteHeaders(FAKE_KEY);
  check("the key travels as a bearer token", headers.authorization === `Bearer ${FAKE_KEY}`);
  check("and nowhere else in the headers", !JSON.stringify({ ...headers, authorization: "" }).includes("SECRET"));
  // Checked against the provider's own /v1/models, which answers without a key
  // (2026-09-22): kimi-k2.5 is not in it, kimi-k3 is. A default that does not
  // exist costs a 404 and a wasted link on every turn.
  const VERIFIED_NVIDIA = ["moonshotai/kimi-k3", "moonshotai/kimi-k2.6", "nvidia/nemotron-3-super-120b-a12b", "z-ai/glm-5.3"];
  check("the default NVIDIA model is one the provider was seen to serve",
    VERIFIED_NVIDIA.includes(provider.PROVIDERS.nvidia.model), provider.PROVIDERS.nvidia.model);

  // Groq, from console.groq.com/docs/models (2026-09-22), and Z.ai from its own
  // pricing page — where GLM-4.7-Flash is the row that reads Free across input,
  // cached input and output.
  check("the default Groq model is one its catalogue lists",
    ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"].includes(provider.PROVIDERS.groq.model),
    provider.PROVIDERS.groq.model);
  check("the default Z.ai model is one of the ones priced at zero",
    ["glm-4.7-flash", "glm-4.5-flash"].includes(provider.PROVIDERS.zai.model),
    provider.PROVIDERS.zai.model);

  // OpenRouter, from openrouter.ai/api/v1/models?max_price=0&supported_
  // parameters=tools (2026-09-22): pricing "0" for prompt and completion, tools
  // supported, no expiration date.
  check("the default OpenRouter model was listed at zero with tool support",
    [
      "poolside/laguna-s-2.1:free",
      "qwen/qwen3.8-27b:free",
      "thinkingmachines/inkling:free",
      "nvidia/nemotron-3.5-lightning:free",
    ].includes(provider.PROVIDERS.openrouter.model),
    provider.PROVIDERS.openrouter.model);
  check("and so is every alternate standing behind it",
    (provider.PROVIDERS.openrouter.fallbackModels || []).length > 0
    && provider.PROVIDERS.openrouter.fallbackModels.every((model) => model.endsWith(":free")),
    JSON.stringify(provider.PROVIDERS.openrouter.fallbackModels));
  check("the alternates are the next best free ones, in order",
    JSON.stringify(provider.PROVIDERS.openrouter.fallbackModels)
      === JSON.stringify(["qwen/qwen3.8-27b:free", "thinkingmachines/inkling:free"]),
    JSON.stringify(provider.PROVIDERS.openrouter.fallbackModels));
  check("a model that expires in days is not in the chain or behind it",
    ![provider.PROVIDERS.openrouter.model, ...provider.PROVIDERS.openrouter.fallbackModels]
      .some((model) => model.startsWith("nex-agi/")),
    JSON.stringify([provider.PROVIDERS.openrouter.model, ...provider.PROVIDERS.openrouter.fallbackModels]));
  check("and the panel does not call a billed model free",
    /bills per token/.test(provider.PROVIDERS.groq.note)
    && !/\bfree\b/i.test(provider.PROVIDERS.groq.note),
    provider.PROVIDERS.groq.note);
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

  // The user asked for free, and free means nothing is billed per token. A
  // rate limit is a free tier; a price per million tokens is not.
  const NOT_FREE = ["groq", "arena"];
  check("nothing in the chain bills per token",
    !provider.DEFAULT_ORDER.some((providerId) => NOT_FREE.includes(providerId)),
    provider.DEFAULT_ORDER.join(" -> "));
  check("a provider that charges is still offered, just not turned on",
    NOT_FREE.every((providerId) => provider.PROVIDERS[providerId])
    && NOT_FREE.every((providerId) => !provider.DEFAULT_ORDER.includes(providerId)));
  check("and its note says so before anyone connects it",
    /Not in the chain by default/.test(provider.PROVIDERS.groq.note),
    provider.PROVIDERS.groq.note);
  check("OpenRouter's free model carries the suffix that makes it zero",
    provider.PROVIDERS.openrouter.model.endsWith(":free"),
    provider.PROVIDERS.openrouter.model);
  check("its note names the real catch — a request count, not a bill",
    /request count/.test(provider.PROVIDERS.openrouter.note)
    && /50 a day/.test(provider.PROVIDERS.openrouter.note),
    provider.PROVIDERS.openrouter.note);

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
  const routeFn = serveSource.slice(
    serveSource.indexOf("async function routeWorkTurnToCloud("),
    serveSource.indexOf("  if (req.url === \"/api/llm/chat\""),
  );
  check("there is one cloud path, and it is the one on /api/llm/chat", routeFn.length > 800);
  check("only a Work turn is offered to the cloud",
    /body\.assistantMode === "work" &&/.test(serveSource));
  check("chat is not mentioned in that condition",
    !/body\.assistantMode === "chat"/.test(serveSource));
  check("when the chain is spent and nothing was written, the local model takes the turn",
    /if \(!started && config\.useLocalFallback !== false\) return false;/.test(routeFn));
  check("and the Settings toggle to refuse that fallback is honoured",
    /config\.useLocalFallback !== false/.test(routeFn));
  check("tokens go out in the frames the local runtime already streams",
    /choices: \[\{ delta: \{ content: text \} \}\]/.test(routeFn));
  check("the stream is closed the way the reader expects",
    /res\.write\("data: \[DONE\]\\n\\n"\)/.test(routeFn));
  check("no unreachable second implementation is left behind",
    !/generateWithRemoteProvider/.test(serveSource)
    && !/resolveRemoteTextTurn/.test(serveSource));
  check("and the recovery generator is called from exactly one place",
    (serveSource.match(/await generateWithRuntimeRecovery\(/g) || []).length === 1);

  section("8. The cloud path sits on the endpoint the app actually calls");
  const apiSource = fs.readFileSync(
    path.join(root, "app", "frontend", "src", "services", "api.js"),
    "utf8",
  );
  const chatSource = fs.readFileSync(
    path.join(root, "app", "frontend", "src", "components", "TextChat.jsx"),
    "utf8",
  );
  check("the mode travels with the chat request",
    /assistantMode: options\.assistantMode === "work" \? "work" : "chat"/.test(apiSource));
  check("and the chat window supplies it", /const streamOptions = \{\s*assistantMode,/.test(chatSource));
  check("the server routes Work at /api/llm/chat",
    /body\.assistantMode === "work" &&\s*\(await routeWorkTurnToCloud\(req, res, body\)\)/.test(serveSource));
  check("which is the endpoint the chat window calls",
    /fetchWithTimeoutAndRetry\("\/api\/llm\/chat"/.test(apiSource));

  section("9. The live route commits nothing until it has something to say");
  check("the headers are written only once a first token exists",
    /const head = \(\) => \{\s*if \(started\) return;/.test(routeFn)
    && routeFn.indexOf("if (started) return;") < routeFn.indexOf("res.writeHead(200"));
  check("a client that walks away cancels the request upstream",
    /req\.on\("close", \(\) => \{/.test(routeFn) && /controller\.abort\(\)/.test(routeFn));
  check("nothing is buffered that could be lost, each delta goes straight out",
    /onDelta: send/.test(routeFn));
  check("a failure after bytes are out is told to the user, not swallowed",
    /The cloud providers could not finish this turn/.test(routeFn));
  check("and it names every provider that refused",
    /result\.failures \|\| \[\]/.test(routeFn)
    && /failure\.label\}: \$\{failure\.message\}/.test(routeFn));
  check("an empty provider list never reaches the network",
    /if \(!config\.order\.some\(\(providerId\) => config\.keys\[providerId\]\)\) return false;/.test(routeFn));

  section("10. The Settings panel never shows a key it already holds");
  check("the field is write-only", /type="password"/.test(settings));
  check("it never renders a stored key back", !/value=\{remoteProvider\.key\b/.test(settings));
  check("it shows a hint instead", /keyHint/.test(settings));
  check("it says where the keys are kept", /app\/runtime-state/.test(settings));
  check("it can forget a key from the same place", /sendRemoteKey\(/.test(settings));
  check("it can test a provider before relying on it", /remote-provider\/test/.test(settings));

  section("11. A key that is saved can be forgotten, and an old file still reads");
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
    fs.rmSync(SCRATCH_FILE, { force: true });
  }

  // The point of the scratch file: a suite that saves, clears and rewrites keys
  // must leave the one holding the user's real key exactly as it found it.
  const realKeyAfter = fs.existsSync(REAL_KEY_FILE)
    ? { mtime: fs.statSync(REAL_KEY_FILE).mtimeMs, content: fs.readFileSync(REAL_KEY_FILE, "utf8") }
    : null;
  check("the run never touched the file holding the user's real key",
    JSON.stringify(realKeyBefore) === JSON.stringify(realKeyAfter));

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
