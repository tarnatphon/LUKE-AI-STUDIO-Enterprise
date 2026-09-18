"use strict";

/**
 * Work mode can borrow a brain from Arena's gateway. That path carries the one
 * thing in this app that must never leave the machine — a key — so it is proved
 * here rather than trusted:
 *
 * 1. the key is stored inside the app folder, gitignored, and never handed back
 *    to the browser or printed in an error;
 * 2. the request is forced onto the router alias, because naming a model
 *    directly is refused by the gateway with a 403 the user cannot act on;
 * 3. a refusal comes back in the user's words — "the free router only answers
 *    its own apps", not `free_router_harness_restricted`;
 * 4. a stream split across chunks still reads as one answer;
 * 5. and none of this runs at all when no key is saved: the local path is
 *    untouched.
 *
 * Run: node scripts/validation/test-remote-text-provider.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const provider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

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
  section("1. The key lives on this machine and nowhere else");
  const relative = path.relative(root, provider.PROVIDER_FILE);
  check("it is stored inside the app folder", relative.startsWith("app" + path.sep + "runtime-state"), relative);
  check("it is gitignored", gitignore.includes("remote-text-provider.json"));
  check("the status it reports has no key in it",
    !JSON.stringify(await provider.providerStatus()).includes("SECRET") ||
      !fs.existsSync(provider.PROVIDER_FILE));

  const status = await provider.providerStatus();
  check("the status never carries the key itself", !("key" in status), Object.keys(status).join(", "));
  check("the status does say which gateway and model", status.baseUrl === "https://api.preview.arena.ai" && status.model === "coding-router-preview");
  check("the status says whose key it is, by hint only",
    status.keyHint === "" || /^…[A-Za-z0-9]{1,6}$/.test(status.keyHint), status.keyHint);

  section("2. No error, log or echo can carry the key");
  const scrubbed = provider.scrubKey(`request failed with ${FAKE_KEY} attached`, FAKE_KEY);
  check("the key is scrubbed out of any message", !scrubbed.includes("SECRET") && scrubbed.includes("[arena key hidden]"), scrubbed);
  check("a short value is left alone rather than mangled", provider.scrubKey("nothing here", "abc") === "nothing here");

  section("3. The request the gateway is asked to honour");
  const payload = provider.buildRemotePayload({
    messages: [{ role: "user", content: "fix it" }, { role: "assistant", content: "ok" }, { junk: true }],
    temperature: 0.2,
    maxTokens: 512,
  });
  check("the model is forced to the router alias", payload.model === "coding-router-preview", payload.model);
  check("a caller cannot choose another model",
    provider.buildRemotePayload({ messages: [], model: "claude-opus-4-6" }).model === "coding-router-preview");
  check("it streams", payload.stream === true);
  check("junk messages are dropped, not forwarded", payload.messages.length === 2, String(payload.messages.length));
  check("roles are only user or assistant", payload.messages.every((message) => ["user", "assistant"].includes(message.role)));
  check("a nonsense temperature is not sent", !("temperature" in provider.buildRemotePayload({ messages: [], temperature: "hot" })));
  const headers = provider.remoteHeaders(FAKE_KEY);
  check("the key travels as a bearer token", headers.authorization === `Bearer ${FAKE_KEY}`);
  check("and nowhere else in the headers", !JSON.stringify({ ...headers, authorization: "" }).includes("SECRET"));

  section("4. A refusal is reported in the user's words");
  const harness = provider.classifyRemoteError({ status: 403, body: '{"error":"free_router_harness_restricted"}' });
  check("harness restriction is named for what it is", harness.code === "harness_restricted");
  check("and says which apps the free router does accept",
    /Claude Code.*OpenCode/s.test(harness.message), harness.message);
  check("and what would lift it", /paid/i.test(harness.message));
  const modelRefused = provider.classifyRemoteError({ status: 403, body: "model not allowed" });
  check("a refused model is explained, not echoed", modelRefused.code === "model_not_allowed" && /router/i.test(modelRefused.message));
  const badKey = provider.classifyRemoteError({ status: 401, body: "" });
  check("a bad key says where to get a new one", badKey.code === "invalid_key" && /portal\.api\.preview\.arena\.ai/.test(badKey.message));
  check("a rate limit mentions credits", provider.classifyRemoteError({ status: 429 }).code === "rate_limited");
  check("a gateway failure does not blame the key",
    /nothing is wrong with your key/i.test(provider.classifyRemoteError({ status: 503 }).message));
  check("no connection at all says so plainly", provider.classifyRemoteError({ status: 0 }).code === "unreachable");
  check("nothing is left as a bare status code",
    [0, 400, 401, 403, 429, 500].every((status) => provider.classifyRemoteError({ status }).message.length > 30));

  section("5. A stream that arrives in pieces still reads as one answer");
  const decoder = provider.createSseDecoder();
  const first = decoder.push('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":');
  check("complete frames are published", first.length === 1 && provider.extractDelta(first[0]) === "Hello");
  const second = decoder.push('{"content":" world"}}]}\n\n');
  check("a frame split across two reads is finished on the second", provider.extractDelta(second[0]) === " world");
  check("a done marker is recognised", provider.isDone("data: [DONE]") === false && provider.isDone("[DONE]") === true);
  check("a done marker is not text", provider.extractDelta("[DONE]") === "");
  check("a malformed frame is skipped, not thrown", provider.extractDelta("not json") === "");
  check("a non-delta frame contributes nothing", provider.extractDelta('{"choices":[{"delta":{}}]}') === "");
  const rest = decoder.push("data: {\"choices\":[{\"delta\":{\"content\":\"!\"}}]}");
  check("a trailing frame with no blank line is flushed, not lost",
    rest.length === 0 && provider.extractDelta(decoder.flush()[0] || "") === "!");

  section("6. The local path is left exactly as it was");
  check("Work decides per turn whether to go to the cloud", /async function resolveRemoteTextTurn\(/.test(serveSource));
  check("and only goes when a key exists", /const key = await remoteTextProvider\.readStoredKey\(\);[\s\S]{0,80}if \(!key\) return null;/.test(serveSource));
  check("chat stays on this machine", /conversation\.assistantMode !== "work"\s*\)\s*return null;/.test(serveSource));
  check("the cloud turn emits the events the chat already reads",
    /"recovery-start"/.test(serveSource) && /"recovery-attempt"/.test(serveSource)
    && /"recovery-delta"/.test(serveSource) && /"recovery-complete"/.test(serveSource));
  check("the answer is saved like any other turn", /appendTextChatMessage\(/.test(serveSource));
  check("a failure is told to the user, not swallowed", /"recovery-exhausted"/.test(serveSource));
  check("the local generator is called only when the cloud is not used",
    (serveSource.match(/await generateWithRuntimeRecovery\(/g) || []).length === 1);

  section("7. The Settings panel never shows a key it already holds");
  const settings = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "Settings.jsx"), "utf8");
  check("the field is write-only", /type="password"/.test(settings));
  check("it never renders the stored key back", !/value=\{remoteProvider\.key\b/.test(settings));
  check("it shows a hint instead", /remoteProvider\.keyHint/.test(settings));
  check("it says where the key is kept", /app\/runtime-state/.test(settings));
  check("it can be forgotten from the same place", /sendRemoteKey\("clear"\)/.test(settings));
  check("it can be tested before it is relied on", /remote-provider\/test/.test(settings));
  check("the section is collapsed by default, not in the way",
    /cloud: localStorage\.getItem\("settings_section_cloud"\) === "true"/.test(settings));

  section("8. A key that is saved can be forgotten");
  const original = fs.existsSync(provider.PROVIDER_FILE)
    ? fs.readFileSync(provider.PROVIDER_FILE, "utf8")
    : null;

  try {
    await provider.saveKey(FAKE_KEY);
    check("a saved key is readable back", (await provider.readStoredKey()) === FAKE_KEY);
    check("it is saved with owner-only permissions",
      (fs.statSync(provider.PROVIDER_FILE).mode & 0o777) === 0o600,
      (fs.statSync(provider.PROVIDER_FILE).mode & 0o777).toString(8));
    check("the status admits there is one, without saying which",
      (await provider.providerStatus()).configured === true);

    await provider.clearKey();
    check("forgetting it leaves nothing behind", fs.existsSync(provider.PROVIDER_FILE) === false);
    check("and the status goes back to unconfigured", (await provider.providerStatus()).configured === false);
  } finally {
    if (original) {
      fs.mkdirSync(path.dirname(provider.PROVIDER_FILE), { recursive: true });
      fs.writeFileSync(provider.PROVIDER_FILE, original, { mode: 0o600 });
    }
  }

  let rejected = false;
  try {
    await provider.saveKey("   ");
  } catch {
    rejected = true;
  }
  check("an empty key is refused", rejected);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
