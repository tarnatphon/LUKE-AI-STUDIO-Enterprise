"use strict";

/**
 * The chat archive, proved rather than promised.
 *
 * The promise: a finished turn is written to disk once and never rewritten, a
 * turn that is still being generated or was cancelled never reaches it, and
 * reading it back costs only the slices that matched — not the transcript.
 *
 * - the archive lives inside the app folder, on the external disk
 * - a conversation id cannot wander out of it
 * - appending two exchanges leaves the first one byte-identical
 * - searching returns small slices with their turn numbers, never the file
 * - a message that points backwards is recognised without asking the model
 *
 * Run: node scripts/validation/test-chat-history-archive.cjs
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const archive = require(path.join(root, "scripts", "server", "chat-history-archive.cjs"));

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function refuses(label, fn, matcher = /./) {
  let error = null;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  check(label, Boolean(error) && matcher.test(error instanceof Error ? error.message : String(error)), error ? String(error.message).slice(0, 120) : "it did not refuse");
}

async function main() {
  const conversationId = `test-history-${process.pid}`;

  // ── 1. It stays where the app lives ──────────────────────────────────────
  section("1. The archive lives inside the app folder");
  check("it is under app/runtime-state", archive.HISTORY_DIR.startsWith(path.join(root, "app", "runtime-state")));
  check("it is not in the git working set", (() => {
    try {
      const { execFileSync } = require("node:child_process");
      execFileSync("git", ["check-ignore", "-q", path.join("app", "runtime-state", "text-chat", "history", "x.md")], { cwd: root, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })(), "add the history folder to .gitignore");
  for (const badId of ["../escape", "a/b", "/etc/passwd", "", "id with spaces", "id;rm"]) {
    await refuses(`id refused: ${JSON.stringify(badId)}`, () => archive.appendExchange({ conversationId: badId, userText: "x" }));
  }

  // ── 2. Appending is append-only ──────────────────────────────────────────
  section("2. A finished turn is written once and never rewritten");
  const empty = await archive.appendExchange({ conversationId, userText: "  ", assistantText: "" });
  check("an empty exchange is not archived", empty.archived === false, JSON.stringify(empty));

  const first = await archive.appendExchange({
    conversationId,
    userText: "ช่วยสรุปโปรเจกต์นี้ให้หน่อย",
    assistantText: "โปรเจกต์นี้คือ LUKE AI STUDIO — รหัสลับคือมะม่วง",
    model: "Qwen3.5-9B",
  });
  check("the first exchange is archived", first.archived === true && first.turn === 1);

  const files = await fsp.readdir(archive.HISTORY_DIR);
  const file = path.join(archive.HISTORY_DIR, files.find((name) => name.startsWith(conversationId)));
  const afterFirst = await fsp.readFile(file, "utf8");
  check("the question is in the file", afterFirst.includes("ช่วยสรุปโปรเจกต์นี้ให้หน่อย"));
  check("the answer is in the file, under its own heading", afterFirst.includes("### LUKE") && afterFirst.includes("มะม่วง"));
  check("the turn is anchored", /^## Turn 1 · /m.test(afterFirst));

  await archive.appendExchange({
    conversationId,
    userText: "แล้วรายงานฉบับล่าสุดล่ะ",
    assistantText: "รายงานอยู่ใน reports/quarterly.md — ตัวเลขคือ 42",
  });
  const afterSecond = await fsp.readFile(file, "utf8");
  check("the first exchange is untouched", afterSecond.startsWith(afterFirst));
  check("the second turn is numbered", /^## Turn 2 · /m.test(afterSecond));

  // Five turns at once must not tangle: every heading appears exactly once.
  await Promise.all(
    [3, 4, 5, 6, 7].map((n) =>
      archive.appendExchange({ conversationId, userText: `คำถามที่ ${n}`, assistantText: `คำตอบที่ ${n}` }),
    ),
  );
  const afterMany = await fsp.readFile(file, "utf8");
  const numbers = (afterMany.match(/^## Turn (\d+) ·/gm) || []).map((line) => Number(line.replace(/\D+/g, "")));
  check("every concurrent turn was written", numbers.length === 7, JSON.stringify(numbers));
  check("no turn number was used twice", new Set(numbers).size === numbers.length, JSON.stringify(numbers));
  check("no turn was written twice or lost in a rewrite", numbers.slice().sort((a, b) => a - b).join(",") === "1,2,3,4,5,6,7");

  // ── 3. Reading back costs only what matched ──────────────────────────────
  section("3. Reading back costs only the slices that matched");
  const found = await archive.searchHistory({ conversationId, query: "มะม่วง" });
  check("the needle is found", found.slices.length >= 1, JSON.stringify(found).slice(0, 200));
  check("the turn it came from is named", found.slices[0] && found.slices[0].turn === 1, JSON.stringify(found.slices[0] || {}));
  check("the slice carries the text", String(found.slices[0] && found.slices[0].snippet).includes("มะม่วง"));
  check("the whole archive is never returned", JSON.stringify(found.slices).length < afterMany.length / 2, `${JSON.stringify(found.slices).length} vs ${afterMany.length}`);
  check("the archive knows how many turns it holds", found.turns === 7, String(found.turns));

  const capped = await archive.searchHistory({ conversationId, query: "คำถาม", maxSlices: 2 });
  check("as many slices as asked for, no more", capped.slices.length <= 2, String(capped.slices.length));
  const nothing = await archive.searchHistory({ conversationId, query: "zzzz-nothing-like-this" });
  check("a question with no match returns nothing at all", nothing.slices.length === 0);
  await refuses("searching without a question is refused", () => archive.searchHistory({ conversationId, query: "  " }));

  const otherConversation = await archive.searchHistory({ conversationId: "never-existed", query: "มะม่วง" });
  check("a conversation with no archive reads as empty", otherConversation.slices.length === 0);

  // ── 4. Recognising a message that points backwards ───────────────────────
  section("4. A message that points backwards is recognised without asking the model");
  for (const phrase of ["อันก่อนหน้าเป็นยังไง", "เมื่อกี้เราคุยเรื่องอะไร", "ที่เคยบอกไว้ล่ะ", "what did you say earlier", "as we discussed, update it", "@history มะม่วง"]) {
    const verdict = archive.pastReference(phrase);
    check(`recognised: ${phrase}`, verdict.isReference === true, JSON.stringify(verdict));
  }
  for (const phrase of ["เขียนฟังก์ชันเรียงลำดับให้หน่อย", "what is 2 + 2", "ช่วยแปลประโยคนี้"]) {
    const verdict = archive.pastReference(phrase);
    check(`left alone: ${phrase}`, verdict.isReference === false, JSON.stringify(verdict));
  }
  check("an explicit request is marked as one", archive.pastReference("@history มะม่วง").explicit === true);

  const status = await archive.status(conversationId);
  check("the status counts the turns", status.turns === 7, JSON.stringify(status));
  check("the status stays inside the app folder", !status.dir.startsWith(".."));

  // ── 5. The endpoints answer ──────────────────────────────────────────────
  section("5. The endpoints answer");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) ready = true;
      } catch {}
      if (!ready) await delay(150);
    }
    if (!ready) throw new Error(`Application server did not become ready.\n${log}`);

    const call = async (endpoint, payload) => {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {}
      return { status: response.status, data };
    };

    const appended = await call("/api/chat/history/append", {
      conversationId: `${conversationId}-api`,
      userText: "เก็บไว้ในประวัติด้วย",
      assistantText: "บันทึกแล้ว — รหัสคือส้มตำ",
    });
    check("appending through the endpoint works", appended.status === 200 && appended.data.result.archived === true, JSON.stringify(appended.data).slice(0, 160));

    const searched = await call("/api/chat/history/search", { conversationId: `${conversationId}-api`, query: "ส้มตำ" });
    check("searching through the endpoint works", searched.status === 200 && searched.data.result.slices.length === 1, JSON.stringify(searched.data).slice(0, 160));

    const referenced = await call("/api/chat/history/reference", { conversationId: `${conversationId}-api`, message: "อันก่อนหน้าบอกว่าอะไร" });
    check("a backwards-looking question is answered with the archive", referenced.status === 200 && referenced.data.result.isReference === true && referenced.data.result.slices.length >= 1, JSON.stringify(referenced.data).slice(0, 160));

    const plain = await call("/api/chat/history/reference", { conversationId: `${conversationId}-api`, message: "เขียนฟังก์ชันบวกเลข" });
    check("an ordinary question reads nothing from disk", plain.status === 200 && plain.data.result.slices.length === 0, JSON.stringify(plain.data).slice(0, 160));

    const bad = await call("/api/chat/history/search", { conversationId: "../escape", query: "x" });
    check("a wandering conversation id is refused", bad.status === 400, JSON.stringify(bad.data).slice(0, 160));

    const state = await call("/api/chat/history/status", { conversationId: `${conversationId}-api` });
    check("the status endpoint answers", state.status === 200 && state.data.result.turns === 1, JSON.stringify(state.data).slice(0, 160));
  } finally {
    child.kill("SIGTERM");
  }

  // clean up this run's archive
  await fsp.rm(path.join(archive.HISTORY_DIR, `${conversationId}.md`), { force: true });
  await fsp.rm(path.join(archive.HISTORY_DIR, `${conversationId}-api.md`), { force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
