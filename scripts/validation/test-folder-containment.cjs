#!/usr/bin/env node
"use strict";

/**
 * The single guarantee that matters most:
 *
 *   The AI can do NOTHING outside the folder the user approved.
 *
 * This validation boots the real application server and attacks every endpoint
 * the model can reach with paths that try to leave the granted folder — other
 * folders, ".." walks, absolute paths, symlinks, revoked grants and another
 * conversation's grant. Every one of them has to be refused, and the secret
 * canary outside the folder must never appear in any response.
 *
 * Run: node scripts/validation/test-folder-containment.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

const CANARY = "TOP-SECRET-CANARY-DO-NOT-LEAK";

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error || !port ? reject(error || new Error("no port")) : resolve(port)));
    });
  });
}

async function main() {
  console.log("Approved-folder containment validation (end to end)");

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-containment-"));
  const approved = path.join(sandbox, "approved");
  const secret = path.join(sandbox, "secret");
  fs.mkdirSync(path.join(approved, "nested"), { recursive: true });
  fs.mkdirSync(secret, { recursive: true });
  const canonicalApproved = fs.realpathSync(approved);
  const canonicalSecret = fs.realpathSync(secret);
  fs.writeFileSync(path.join(approved, "notes.txt"), "hello from the approved folder");
  fs.writeFileSync(path.join(approved, "nested", "deeper.txt"), "deeper");
  fs.writeFileSync(path.join(secret, "passwords.txt"), CANARY);
  fs.writeFileSync(path.join(sandbox, "outside.txt"), CANARY);
  let symlinkMade = true;
  try {
    fs.symlinkSync(secret, path.join(approved, "escape-link"), "dir");
    fs.symlinkSync(path.join(secret, "passwords.txt"), path.join(approved, "escape-file.txt"), "file");
  } catch {
    symlinkMade = false;
  }

  const port = await getFreePort();
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
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}
      return { status: response.status, data, text };
    };

    const conversation = "chat_containment_test";
    const otherConversation = "chat_someone_else";

    // ── Approve the folder, exactly like the UI does ──────────────────────
    section("1. The folder can be approved and used");
    const editable = await call("/api/chat/folder/grant", { conversationId: conversation, root: approved, canWrite: true });
    check("the folder is granted", editable.status === 200 && Boolean(editable.data?.grantId), `status ${editable.status}`);
    const grantId = editable.data?.grantId;
    check("editing was granted because it was asked for", editable.data?.canWrite === true);
    const root_ = editable.data?.root;
    check("the grant is pinned to the canonical path", root_ === canonicalApproved, `${root_}`);

    const insideRead = await call("/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: "notes.txt" });
    check("a file inside the folder is readable", insideRead.status === 200 && String(insideRead.data?.file?.content || "").includes("approved folder"));
    const insideWrite = await call("/api/chat/folder/write", { conversationId: conversation, root: approved, grantId, path: "edited.txt", content: "rewritten" });
    check("a file inside the folder is writable", insideWrite.status === 200);
    const insideTree = await call("/api/chat/folder/tree", { conversationId: conversation, root: approved, grantId, path: "" });
    check("the folder lists its own files", insideTree.status === 200);

    // ── Trying to reach another folder ────────────────────────────────────
    section("2. Another folder cannot be reached, not even by naming it");
    const attacks = [
      ["tree", "/api/chat/folder/tree", { conversationId: conversation, root: secret, grantId, path: "" }],
      ["file", "/api/chat/folder/file", { conversationId: conversation, root: secret, grantId, path: "passwords.txt" }],
      ["write", "/api/chat/folder/write", { conversationId: conversation, root: secret, grantId, path: "pwned.txt", content: "pwned" }],
      ["search", "/api/chat/folder/search", { conversationId: conversation, root: secret, grantId, query: "secret" }],
      ["parent folder", "/api/chat/folder/tree", { conversationId: conversation, root: sandbox, grantId, path: "" }],
      ["sibling with the same prefix", "/api/chat/folder/tree", { conversationId: conversation, root: `${approved}-evil`, grantId, path: "" }],
      ["traversal in the path", "/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: "../secret/passwords.txt" }],
      ["traversal when writing", "/api/chat/folder/write", { conversationId: conversation, root: approved, grantId, path: "../secret/pwned.txt", content: "pwned" }],
      ["absolute path", "/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: path.join(secret, "passwords.txt") }],
      ["absolute path when writing", "/api/chat/folder/write", { conversationId: conversation, root: approved, grantId, path: path.join(secret, "pwned.txt"), content: "pwned" }],
      ["home shortcut", "/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: "~/.ssh/id_rsa" }],
      ["deep traversal", "/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: "nested/../../secret/passwords.txt" }],
    ];
    for (const [label, endpoint, payload] of attacks) {
      const response = await call(endpoint, payload);
      check(`${label} is refused`, response.status >= 400, `status ${response.status}`);
      check(`${label} leaks nothing`, !String(response.text).includes(CANARY));
    }

    // ── Symlinks out of the folder ────────────────────────────────────────
    section("3. A link inside the folder cannot be used as a tunnel");
    if (symlinkMade) {
      const linkedRead = await call("/api/chat/folder/file", { conversationId: conversation, root: approved, grantId, path: "escape-file.txt" });
      check("reading a linked file is refused", linkedRead.status >= 400, `status ${linkedRead.status}`);
      check("the linked file leaks nothing", !String(linkedRead.text).includes(CANARY));
      const linkedTree = await call("/api/chat/folder/tree", { conversationId: conversation, root: approved, grantId, path: "escape-link" });
      check("listing a linked directory is refused", linkedTree.status >= 400, `status ${linkedTree.status}`);
      const linkedWrite = await call("/api/chat/folder/write", { conversationId: conversation, root: approved, grantId, path: "escape-link/pwned.txt", content: "pwned" });
      check("writing through a linked directory is refused", linkedWrite.status >= 400, `status ${linkedWrite.status}`);
    } else {
      check("symlink tunnels are refused (skipped: no symlink support)", true);
    }

    // ── Grants are per conversation and can be withdrawn ──────────────────
    section("4. The grant only works for the conversation that approved it");
    const otherGrant = await call("/api/chat/folder/grant", { conversationId: otherConversation, root: approved, canWrite: true });
    const otherGrantId = otherGrant.data?.grantId;
    const crossConversation = await call("/api/chat/folder/file", { conversationId: conversation, root: approved, grantId: otherGrantId, path: "notes.txt" });
    check("another conversation's grant is refused here", crossConversation.status >= 400, `status ${crossConversation.status}`);
    const noGrant = await call("/api/chat/folder/file", { conversationId: conversation, root: approved, path: "notes.txt" });
    check("no grant id means no access", noGrant.status >= 400, `status ${noGrant.status}`);
    const revoked = await call("/api/chat/folder/revoke", { conversationId: otherConversation, grantId: otherGrantId });
    check("the grant can be revoked", revoked.status === 200);
    const afterRevoke = await call("/api/chat/folder/file", { conversationId: otherConversation, root: approved, grantId: otherGrantId, path: notesPath() });
    check("a revoked grant stops working immediately", afterRevoke.status >= 400, `status ${afterRevoke.status}`);

    // ── Editing has to be opted in ────────────────────────────────────────
    section("5. Writing needs the user's opt-in, reading does not");
    const readOnlyGrant = await call("/api/chat/folder/grant", { conversationId: "chat_readonly", root: approved, canWrite: false });
    check("a folder defaults to read-only", readOnlyGrant.data?.canWrite === false);
    const readOnlyRead = await call("/api/chat/folder/file", { conversationId: "chat_readonly", root: approved, grantId: readOnlyGrant.data?.grantId, path: "notes.txt" });
    check("a read-only folder can still be read", readOnlyRead.status === 200);
    const readOnlyWrite = await call("/api/chat/folder/write", { conversationId: "chat_readonly", root: approved, grantId: readOnlyGrant.data?.grantId, path: "pwned.txt", content: "pwned" });
    check("a read-only folder cannot be written to", readOnlyWrite.status === 403, `status ${readOnlyWrite.status}`);

    // ── A chat grant cannot be replayed on the Work endpoints ─────────────
    section("6. A chat grant buys nothing on the Work endpoints");
    for (const [label, endpoint, payload] of [
      ["write", "/api/work/file/write", { projectId: `chat:${conversation}`, root: approved, grantId, path: "notes.txt", content: "pwned", approvalGranted: true }],
      ["terminal", "/api/work/terminal", { projectId: `chat:${conversation}`, root: approved, grantId, command: "cat notes.txt" }],
      ["terminal session", "/api/work/terminal/session", { projectId: `chat:${conversation}`, root: approved, grantId }],
      ["command palette", "/api/work/command", { projectId: `chat:${conversation}`, root: approved, grantId, commandId: "git-status" }],
      ["a different folder", "/api/work/directory", { projectId: `chat:${conversation}`, root: secret, grantId, path: "" }],
      ["reading another folder", "/api/work/file/read", { projectId: `chat:${conversation}`, root: secret, grantId, path: "passwords.txt" }],
      ["searching another folder", "/api/work/search", { projectId: `chat:${conversation}`, query: "secret", sources: [{ root: secret, grantId }] }],
    ]) {
      const response = await call(endpoint, payload);
      check(`Work ${label} refuses it`, response.status >= 400, `status ${response.status}`);
      check(`Work ${label} leaks nothing`, !String(response.text).includes(CANARY));
    }

    // ── The Work tools themselves, with a real project grant ──────────────
    section("7. Work tools are confined to their own granted folder");
    const {
      listWorkDirectory,
      readWorkFile,
      writeWorkFile,
    } = require(path.join(root, "scripts", "server", "work-file-manager.cjs"));
    const { runTypedWorkCommand, runReadOnlyWorkCommand, runWorkFileDiff } = require(path.join(root, "scripts", "server", "work-action-runner.cjs"));
    const { searchProjectFiles } = require(path.join(root, "scripts", "server", "work-project-search.cjs"));
    const { assertWorkFolderGrant, grantWorkFolder, revokeWorkFolderGrant } = require(path.join(root, "scripts", "server", "work-folder-grants.cjs"));

    const projectGrant = grantWorkFolder({ projectId: "project-containment", root: approved });
    const scope = { projectId: "project-containment", root: approved, grantId: projectGrant.grantId };

    async function refuses(label, action) {
      try {
        const result = await action();
        check(label, false, `it succeeded: ${JSON.stringify(result).slice(0, 120)}`);
      } catch (error) {
        check(label, Boolean(error && (error.statusCode >= 400 || error.status >= 400)), `status ${error?.statusCode}`);
      }
    }

    await refuses("the terminal refuses ../", () => runTypedWorkCommand({ root: approved, command: "cat ../secret/passwords.txt" }));
    await refuses("the terminal refuses an absolute path", () => runTypedWorkCommand({ root: approved, command: `cat ${path.join(secret, "passwords.txt")}` }));
    await refuses("the terminal refuses a shell pipe", () => runTypedWorkCommand({ root: approved, command: "cat notes.txt | sh" }));
    await refuses("the terminal refuses unknown commands", () => runTypedWorkCommand({ root: approved, command: "curl http://evil.example" }));
    if (symlinkMade) {
      await refuses("the terminal refuses a symlinked file", () => runTypedWorkCommand({ root: approved, command: "cat escape-file.txt" }));
    }
    await refuses("the diff refuses ../", () => runWorkFileDiff({ root: approved, filePath: "../secret/passwords.txt" }));
    await refuses("the diff refuses a symlinked file", () => runWorkFileDiff({ root: approved, filePath: "escape-file.txt" }));
    await refuses("the palette refuses an unknown id", () => runReadOnlyWorkCommand({ root: approved, commandId: "rm -rf /" }));
    // The HTTP handlers always call assertWorkFolderGrant before touching a
    // file, so the pair is exercised together — that is the real contract.
    const viaWorkEndpoint = (rootValue, fn) => {
      assertWorkFolderGrant({ projectId: "project-containment", root: rootValue, grantId: projectGrant.grantId });
      return fn();
    };
    await refuses("reading another folder is refused", () => viaWorkEndpoint(secret, () => readWorkFile({ root: secret, filePath: "passwords.txt" })));
    await refuses("writing without approval is refused", () => viaWorkEndpoint(approved, () => writeWorkFile({ root: approved, filePath: "notes.txt", content: "x" })));
    await refuses("writing through ../ is refused", () => viaWorkEndpoint(approved, () => writeWorkFile({ root: approved, filePath: "../outside.txt", content: "pwned", approvalGranted: true })));
    if (symlinkMade) {
      await refuses("writing through a symlinked folder is refused", () => viaWorkEndpoint(approved, () => writeWorkFile({ root: approved, filePath: "escape-link/pwned.txt", content: "pwned", approvalGranted: true })));
    }
    await refuses("listing another folder is refused", () => viaWorkEndpoint(secret, () => listWorkDirectory({ root: secret, directoryPath: "" })));
    await refuses("the grant refuses another root", () => {
      assertWorkFolderGrant({ projectId: "project-containment", root: secret, grantId: projectGrant.grantId });
    });
    await refuses("the grant refuses another project", () => {
      assertWorkFolderGrant({ projectId: "project-other", root: approved, grantId: projectGrant.grantId });
    });
    revokeWorkFolderGrant({ projectId: "project-containment", grantId: projectGrant.grantId });
    await refuses("a revoked project grant stops working", () => {
      assertWorkFolderGrant({ projectId: "project-containment", root: approved, grantId: projectGrant.grantId });
    });

    const search = await searchProjectFiles({ root: approved, query: "approved folder", limit: 5 });
    check("the index only walks the granted folder", !JSON.stringify(search).includes(CANARY));

    // ── Nothing outside was touched ───────────────────────────────────────
    section("8. The machine outside the folder is untouched");
    check("nothing was written into the secret folder", fs.readdirSync(secret).filter((name) => name !== "passwords.txt").length === 0, fs.readdirSync(secret).join(", "));
    check("the secret file still has its original content", fs.readFileSync(path.join(secret, "passwords.txt"), "utf8") === CANARY);
    const createdInside = fs.existsSync(path.join(approved, "edited.txt"));
    check("the file the AI was allowed to write is there", createdInside);
    if (createdInside) fs.rmSync(path.join(approved, "edited.txt"), { force: true });

    // ── The model's own tool surface ──────────────────────────────────────
    section("9. The model can only name endpoints that are guarded");
    const composer = fs.readFileSync(path.join(root, "app", "frontend", "src", "components", "TextChat.jsx"), "utf8");
    const server = fs.readFileSync(serverFile, "utf8");
    const allowed = [
      "/api/work/directory", "/api/work/file/read", "/api/work/file/write", "/api/work/terminal",
      "/api/work/terminal/session", "/api/work/review/diff", "/api/work/search",
      "/api/chat/folder/tree", "/api/chat/folder/file", "/api/chat/folder/write",
      "/api/chat/folder/search", "/api/chat/folder/grant", "/api/chat/folder/revoke",
    ];
    const usedEndpoints = [...composer.matchAll(/fetch\("(\/api\/[^"]+)"/g)].map((match) => match[1]);
    const toolEndpoints = [...new Set(usedEndpoints.filter((endpoint) => endpoint.startsWith("/api/work/") || endpoint.startsWith("/api/chat/")))];
    const unexpected = toolEndpoints.filter((endpoint) => !allowed.includes(endpoint));
    check("no unguarded file endpoint is reachable from the composer", unexpected.length === 0, unexpected.join(", "));
    // grant/revoke only manage the grant itself; everything else must assert it.
    for (const endpoint of allowed.filter((item) => !item.endsWith("/grant") && !item.endsWith("/revoke"))) {
      const start = server.indexOf(`req.url === "${endpoint}"`);
      const window = start === -1 ? "" : server.slice(start, start + 800);
      check(`${endpoint} asserts the folder grant before doing anything`, /assertWorkFolderGrant|assertChatFolderWrite/.test(window));
    }
    check("the chat executor never sends a shell command", !/executeChatFolderActions[\s\S]{0,4000}terminal/.test(composer) || /Commands and the terminal are Work Mode only/.test(composer));
    check("every chat edit asks the user first", /window\.confirm\([\s\S]{0,200}Allow LUKE AI to/.test(composer));
  } finally {
    child.kill("SIGTERM");
    await delay(300);
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

function notesPath() {
  return "notes.txt";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
