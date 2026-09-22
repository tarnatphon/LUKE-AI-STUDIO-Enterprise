"use strict";

/**
 * The chain, driven over a real socket.
 *
 * Its companion suite reads this module's source and asserts what the code
 * says. That is worth having, but it is not the same as watching the code work:
 * a stream assembled from chunks split in awkward places, a rate limit that
 * moves the turn to the next provider, a refused key that stops the chain
 * instead of repeating the same failure three times.
 *
 * So this stands up a stand-in gateway on a local port, points the module at it
 * with LUKE_REMOTE_PROVIDER_BASE_URL, and makes real requests. The gateway
 * decides how to behave from the model name it is sent, which is also how it
 * can prove which provider the chain reached.
 *
 * Run: node scripts/validation/test-remote-provider-chain.cjs
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

const SCRATCH_FILE = path.join(os.tmpdir(), `luke-chain-test-${process.pid}.json`);
const REAL_KEY_FILE = path.join(root, "app", "runtime-state", "text-chat", "remote-text-provider.json");

process.env.LUKE_REMOTE_PROVIDER_FILE = SCRATCH_FILE;

const provider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));

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

const KEYS = {
  nvidia: "nvapi-SECRET-nvidia-key-0001",
  zai: "zai-SECRET-zai-key-0002",
  groq: "gsk-SECRET-groq-key-0003",
};

/** Which model belongs to which provider, so a request can be recognised. */
const MODEL_OWNER = {};
for (const [id, entry] of Object.entries(provider.PROVIDERS)) {
  MODEL_OWNER[entry.model] = id;
}

function sseChunk(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

async function main() {
  // ── the stand-in gateway ────────────────────────────────────────────────

  /** Behaviour per model: { status, body, chunks, delayMs, echoAuth } */
  const behaviour = {};
  const seen = [];
  let modelsMode = "answer";

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.endsWith("/models")) {
      if (modelsMode === "refuse") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid key" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "moonshotai/kimi-k3" }, { id: "z-ai/glm-5.3" }, "plain-string-model"],
        }),
      );
      return;
    }

    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", async () => {
      let payload = {};

      try {
        payload = JSON.parse(raw || "{}");
      } catch {}

      const owner = MODEL_OWNER[payload.model] || "unknown";

      seen.push({ owner, model: payload.model, payload, authorization: req.headers.authorization });

      const rule = behaviour[payload.model] || { chunks: ["ok"] };

      if (rule.status && rule.status >= 400) {
        res.writeHead(rule.status, { "content-type": "application/json" });
        res.end(
          rule.echoAuth
            ? JSON.stringify({ error: `refused, saw ${req.headers.authorization}` })
            : JSON.stringify({ error: rule.error || "refused" }),
        );
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const chunks = rule.chunks || ["ok"];

      for (let index = 0; index < chunks.length; index += 1) {
        // The first chunk is written at once so a cancellation test has
        // something to have received; the rest are held back so there is
        // still a stream to cancel.
        if (rule.delayMs && index > 0) {
          await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
        }

        res.write(sseChunk(chunks[index]));
      }

      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const port = server.address().port;

  process.env.LUKE_REMOTE_PROVIDER_BASE_URL = `http://127.0.0.1:${port}/v1`;

  // Keys for the chain to walk, in the throwaway file.
  for (const [id, key] of Object.entries(KEYS)) {
    await provider.saveKey(id, key);
  }

  const NVIDIA = provider.PROVIDERS.nvidia.model;
  const ZAI = provider.PROVIDERS.zai.model;
  const GROQ = provider.PROVIDERS.groq.model;

  const reset = (rules) => {
    seen.length = 0;

    for (const key of Object.keys(behaviour)) delete behaviour[key];

    Object.assign(behaviour, rules);
  };

  const MESSAGES = [
    { role: "system", content: "the contract" },
    { role: "user", content: "fix the failing test" },
  ];

  try {
    section("1. A provider that answers is the one the chain lands on");
    reset({ [NVIDIA]: { chunks: ["The ", "test ", "passes now."] } });

    const first = await provider.streamRemoteChain({ messages: MESSAGES });

    check("it reached the first provider", seen.length === 1 && seen[0].owner === "nvidia", JSON.stringify(seen.map((s) => s.owner)));
    check("the chunks came back as one answer", first.content === "The test passes now.", first.content);
    check("no failure was recorded", first.failures.length === 0);
    check("it names the provider that answered", first.providerId === "nvidia" && first.model === NVIDIA);

    section("2. The settings the user turned actually arrive");
    const request = seen[0];
    check("the system message arrived as a system message",
      request.payload.messages[0].role === "system" && request.payload.messages[0].content === "the contract");
    check("it asked to stream", request.payload.stream === true);
    check("the model was the one configured for that provider", request.payload.model === NVIDIA);
    check("the key travelled as a bearer token", request.authorization === `Bearer ${KEYS.nvidia}`);

    const withSettings = await provider.streamRemoteChain({
      messages: MESSAGES,
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 1024,
    });
    const settingsRequest = seen[seen.length - 1];
    check("temperature reaches the provider", settingsRequest.payload.temperature === 0.3);
    check("top_p reaches the provider", settingsRequest.payload.top_p === 0.9);
    check("the output cap reaches the provider", settingsRequest.payload.max_tokens === 1024);
    check("and the turn still answers", withSettings.content.length > 0);

    section("3. A rate limit moves the turn to the next provider");
    reset({
      [NVIDIA]: { status: 429, error: "rate_limited" },
      [ZAI]: { chunks: ["answered ", "by the second link"] },
    });

    const second = await provider.streamRemoteChain({ messages: MESSAGES });

    check("two providers were tried", seen.length === 2, String(seen.length));
    check("the second one answered", second.providerId === "zai" && second.content === "answered by the second link", second.content);
    check("the first failure was recorded, not swallowed",
      second.failures.length === 1 && second.failures[0].providerId === "nvidia" && second.failures[0].code === "rate_limited",
      JSON.stringify(second.failures));
    check("the third was never bothered", !seen.some((entry) => entry.owner === "groq"));

    section("4. A provider that started charging is passed over");
    reset({
      [NVIDIA]: { status: 402, error: "payment required" },
      [ZAI]: { chunks: ["second link again"] },
    });

    const third = await provider.streamRemoteChain({ messages: MESSAGES });
    check("a paywall moves on", third.providerId === "zai" && third.failures[0].code === "now_paid",
      JSON.stringify(third.failures));
    check("and the message says the free tier is gone", /charg/i.test(third.failures[0].message), third.failures[0].message);

    section("5. A refused key stops the chain instead of repeating itself");
    reset({
      [NVIDIA]: { status: 401, error: "invalid key" },
      [ZAI]: { chunks: ["should not be reached"] },
    });

    const fourth = await provider.streamRemoteChain({ messages: MESSAGES });
    check("only one provider was tried", seen.length === 1 && seen[0].owner === "nvidia", JSON.stringify(seen.map((s) => s.owner)));
    check("the chain reported itself spent", fourth.exhausted === true);
    check("the failure names the provider whose key is wrong",
      fourth.failures.length === 1 && fourth.failures[0].code === "invalid_key");
    check("and its message points at where to get a new one", /build\.nvidia\.com/.test(fourth.failures[0].message));

    section("6. When every link is spent, the chain says so rather than failing quietly");
    reset({
      [NVIDIA]: { status: 429, error: "slow down" },
      [ZAI]: { status: 429, error: "slow down" },
      [GROQ]: { status: 429, error: "slow down" },
    });

    const fifth = await provider.streamRemoteChain({ messages: MESSAGES });
    check("all three were tried", seen.length === 3, String(seen.length));
    check("nothing was produced", fifth.content === "" && fifth.providerId === null);
    check("every link is named in the failures", fifth.failures.length === 3, String(fifth.failures.length));
    check("and the caller is told the chain is spent", fifth.exhausted === true);

    section("7. No error can carry the key, even when the gateway echoes it back");
    reset({ [NVIDIA]: { status: 403, error: "nope", echoAuth: true } });

    let leaked = "";

    try {
      await provider.streamRemoteChat({ providerId: "nvidia", key: KEYS.nvidia, messages: MESSAGES });
    } catch (error) {
      leaked = `${error.message} ${error.stack || ""}`;
    }

    check("the gateway did see the key", seen[0].authorization === `Bearer ${KEYS.nvidia}`);
    check("and the error that came back does not contain it", !leaked.includes("SECRET"), leaked.slice(0, 160));
    check("the failure is still explained", leaked.includes("Arena") || leaked.includes("refused") || leaked.length > 10);

    section("8. A cancelled turn stops reading the stream");
    reset({ [NVIDIA]: { chunks: ["one", "two", "three", "four"], delayMs: 40 } });

    const controller = new AbortController();
    const collected = [];

    setTimeout(() => controller.abort(), 60);

    let cancelled = "";

    try {
      await provider.streamRemoteChat({
        providerId: "nvidia",
        key: KEYS.nvidia,
        messages: MESSAGES,
        signal: controller.signal,
        onDelta: (delta) => collected.push(delta),
      });
    } catch (error) {
      cancelled = error.message;
    }

    check("the cancellation was reported", /cancel/i.test(cancelled), cancelled);
    check("it received the first chunk before cancelling", collected[0] === "one", JSON.stringify(collected));
    check("and stopped before the stream ended", collected.length < 4, String(collected.length));

    section("9. A stream split across reads is still one answer");
    const decoder = provider.createSseDecoder();
    const torn = sseChunk("first part");
    const half = Math.floor(torn.length / 2);
    const assembled = [...decoder.push(torn.slice(0, half)), ...decoder.push(torn.slice(half))];
    check("a frame torn in half is finished on the second read",
      assembled.length === 1 && provider.extractDelta(assembled[0]) === "first part");

    section("10. The stream is bytes, and Thai does not fit in one");
    const thaiFrame = Buffer.from(
      sseChunk("แก้ไขให้แล้ว"),
      "utf8",
    );
    // Cut inside the first syllable, where a chunk boundary would really land.
    const cut = thaiFrame.indexOf(0xe0) + 1;
    const byteDecoder = provider.createSseDecoder();
    const firstHalf = byteDecoder.push(thaiFrame.subarray(0, cut));
    const secondHalf = byteDecoder.push(thaiFrame.subarray(cut));
    const thaiFrames = [...firstHalf, ...secondHalf];

    check("a frame arriving as bytes is read as text", thaiFrames.length === 1, String(thaiFrames.length));
    check("a syllable split across two reads survives",
      provider.extractDelta(thaiFrames[0] || "") === "แก้ไขให้แล้ว",
      provider.extractDelta(thaiFrames[0] || ""));

    const asciiDecoder = provider.createSseDecoder();
    const asciiBytes = Buffer.from(sseChunk("plain"), "utf8");
    check("plain bytes are not read as comma separated numbers",
      provider.extractDelta(asciiDecoder.push(asciiBytes)[0] || "") === "plain",
      String(asciiDecoder.push(asciiBytes)[0]));

    section("11. The model list is read off the provider, not remembered");
    const listed = await provider.listRemoteModels("nvidia");
    check("the provider's own catalogue comes back", listed.ok === true && listed.models.length === 3,
      JSON.stringify(listed));
    check("it is sorted and complete",
      listed.models.join(",") === ["moonshotai/kimi-k3", "plain-string-model", "z-ai/glm-5.3"].sort().join(","),
      listed.models.join(","));
    check("and the count is reported in words", /3 models/.test(listed.message), listed.message);

    modelsMode = "refuse";
    const refusedList = await provider.listRemoteModels("nvidia");
    check("a provider that refuses says so instead of returning nothing",
      refusedList.ok === false && refusedList.code === "invalid_key" && refusedList.models.length === 0,
      JSON.stringify(refusedList).slice(0, 140));
    modelsMode = "answer";

    section("12. The user's real key file was never part of any of this");
    const realAfter = fs.existsSync(REAL_KEY_FILE)
      ? fs.readFileSync(REAL_KEY_FILE, "utf8")
      : null;
    check("the file holding a real key was not created or written", realAfter === null, String(realAfter));
    check("and the chain ran from the throwaway file", provider.PROVIDER_FILE === SCRATCH_FILE);
  } finally {
    server.close();
    fs.rmSync(SCRATCH_FILE, { force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
