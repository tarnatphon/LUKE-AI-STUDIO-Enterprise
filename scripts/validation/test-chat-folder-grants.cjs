"use strict";

/**
 * Proves the chat folder picker can only ever reach the folder the user
 * approved — and that in normal chat it can only READ it.
 *
 * Run: node scripts/validation/test-chat-folder-grants.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const grantsPath = path.join(root, "scripts", "server", "work-folder-grants.cjs");
const servePath = path.join(root, "scripts", "server", "serve.cjs");
const composerPath = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");

const {
  assertWorkFolderGrant,
  assertNotChatScope,
  grantChatFolder,
  grantWorkFolder,
  revokeWorkFolderGrant,
  isChatScope,
  chatScopeId,
} = require(grantsPath);

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

function expectPermission(label, fn, expectedCode) {
  try {
    fn();
    check(label, false, "no error was thrown");
  } catch (error) {
    check(
      label,
      error.statusCode === 403 && (!expectedCode || error.code === expectedCode),
      `got status=${error.statusCode} code=${error.code}`
    );
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-chat-folder-"));
const approved = path.join(sandbox, "approved");
const secret = path.join(sandbox, "secret");
fs.mkdirSync(path.join(approved, "nested"), { recursive: true });
fs.mkdirSync(secret, { recursive: true });
fs.writeFileSync(path.join(approved, "notes.txt"), "hello from the approved folder");
fs.writeFileSync(path.join(approved, "nested", "deeper.txt"), "deeper");
fs.writeFileSync(path.join(secret, "passwords.txt"), "top secret");

section("1. Approving a folder grants exactly that folder");
const conversationId = "chat_1770000000000";
const granted = grantChatFolder({ conversationId, root: approved });
check("grant returns an id and a canonical root", Boolean(granted.grantId) && granted.root === fs.realpathSync(approved));
check("grant is scoped to the conversation", granted.projectId === `chat:${conversationId}`);
check("inside the approved folder is allowed", assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: approved, grantId: granted.grantId }) === fs.realpathSync(approved));
check(
  "a sub-folder passed as the root is refused (the grant is exact)",
  (() => {
    try {
      assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: path.join(approved, "nested"), grantId: granted.grantId });
      return false;
    } catch (error) {
      return error.statusCode === 403;
    }
  })()
);

section("2. Anything outside the approved folder is refused with 403");
expectPermission("a sibling folder is refused", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: secret, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("the parent folder is refused", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: sandbox, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("a traversal path (../secret) is refused", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: path.join(approved, "..", "secret"), grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("a path that only starts with the folder name is refused", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: `${approved}-evil`, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("no grant id is refused", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: approved }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("another conversation's id is refused", () =>
  assertWorkFolderGrant({ projectId: "chat:someone-else", root: approved, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
expectPermission("a Work project grant does not unlock a chat scope", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: approved, grantId: grantWorkFolder({ projectId: "project-1", root: approved }).grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");

// Symlink escape: a link inside the folder that points outside must not work.
const escapeLink = path.join(approved, "escape");
let symlinkCreated = false;
try {
  fs.symlinkSync(secret, escapeLink, "dir");
  symlinkCreated = true;
} catch {
  symlinkCreated = false;
}
if (symlinkCreated) {
  expectPermission("a symlink that points outside the folder is refused", () =>
    assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: escapeLink, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
} else {
  check("a symlink that points outside the folder is refused (skipped: no symlink support)", true);
}

section("3. Chat folders are read-only — the server refuses writes");
expectPermission("assertNotChatScope blocks a chat scope", () => assertNotChatScope(`chat:${conversationId}`), "CHAT_FOLDER_READ_ONLY");
let workScopeThrew = false;
try {
  assertNotChatScope("project-1");
} catch {
  workScopeThrew = true;
}
check("assertNotChatScope lets a Work project through", workScopeThrew === false);
check("the refusal message names Work Mode", (() => {
  try {
    assertNotChatScope("chat:x");
    return false;
  } catch (error) {
    return /Work Mode/i.test(error.message);
  }
})());
check("isChatScope recognises chat scopes only", isChatScope("chat:abc") === true && isChatScope("project-abc") === false && isChatScope("") === false);
check("chatScopeId prefixes and refuses empty ids", chatScopeId("c1") === "chat:c1" && (() => {
  try {
    chatScopeId("");
    return false;
  } catch {
    return true;
  }
})());

section("4. Revoking the folder takes the access away immediately");
revokeWorkFolderGrant({ projectId: `chat:${conversationId}`, grantId: granted.grantId });
expectPermission("the folder is unreadable after revoke", () =>
  assertWorkFolderGrant({ projectId: `chat:${conversationId}`, root: approved, grantId: granted.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");

section("5. Grants are session-only — nothing is written to disk");
const grantsSource = fs.readFileSync(grantsPath, "utf8");
check("the grant store keeps everything in memory", /new Map\(\)/.test(grantsSource));
check("the grant store never writes to disk", !/writeFile|appendFile|createWriteStream/.test(grantsSource));

section("6. Server wiring");
const serveSource = fs.readFileSync(servePath, "utf8");
for (const endpoint of ["/api/chat/folder/grant", "/api/chat/folder/revoke", "/api/chat/folder/tree", "/api/chat/folder/search", "/api/chat/folder/file"]) {
  check(`${endpoint} exists`, serveSource.includes(`req.url === "${endpoint}" && req.method === "POST"`));
}
const chatEndpointBlock = serveSource.slice(
  serveSource.indexOf('req.url === "/api/chat/folder/grant"'),
  serveSource.indexOf("// POST /api/work/search")
);
check("every chat folder endpoint checks the grant first", (chatEndpointBlock.match(/assertWorkFolderGrant/g) || []).length >= 3);
check("chat folder endpoints derive the scope on the server", /conversationId: body\.conversationId/.test(serveSource) && /`chat:\$\{/.test(serveSource));

for (const writeEndpoint of ["/api/work/file/write", "/api/work/command", "/api/work/terminal/session", "/api/work/terminal"]) {
  const start = serveSource.indexOf(`req.url === "${writeEndpoint}" && req.method === "POST"`);
  const window = serveSource.slice(start, start + 700);
  const blockIndex = window.indexOf("assertNotChatScope(body.projectId)");
  const grantIndex = window.indexOf("assertWorkFolderGrant(");
  check(`${writeEndpoint} refuses a chat-scoped grant`, blockIndex !== -1 && blockIndex < grantIndex);
}
check("the read-only endpoints keep working for chat (no blanket block)", (serveSource.match(/assertNotChatScope\(body\.projectId\)/g) || []).length === 4);

section("7. Composer wiring");
const composerSource = fs.readFileSync(composerPath, "utf8");
check("a folder button sits in the composer toolbar", /className=\{`chat-composer-folder-btn/.test(composerSource) && composerSource.indexOf("chat-composer-folder-btn") > composerSource.indexOf("chat-composer-attach-btn"));
check("the folder button uses the native picker", composerSource.includes('"/api/storage/choose-folder"'));
check("the picker does not grant by itself — an approval dialog follows", /setFolderApproval\(\{/.test(composerSource) && /chat-folder-approval-backdrop/.test(composerSource));
check("the dialog asks for approval by name", composerSource.includes("Approve for me"));
check("the dialog shows the absolute path", /chat-folder-approval-path/.test(composerSource) && /folderApproval\.root/.test(composerSource));
check("the dialog states the three guarantees", /only this folder/.test(composerSource) && /any other folder/.test(composerSource) && /read-only/.test(composerSource));
check("removing the chip revokes the grant", composerSource.includes('"/api/chat/folder/revoke"'));
check("the conversation id is the grant scope", /conversationId: chatScope/.test(composerSource));
check("a new chat starts a fresh scope and drops the approval", /chatScopeRef\.current = `chat_\$\{Date\.now\(\)\}`/.test(composerSource));
check("the model is told the folder is read-only", /approved for reading only/i.test(composerSource));

// ── Syntax check ──────────────────────────────────────────────────────────
section("8. Syntax");
try {
  execFileSync(process.execPath, ["--check", servePath], { stdio: "pipe" });
  check("serve.cjs parses", true);
} catch (error) {
  check("serve.cjs parses", false, String(error.stderr || error));
}
try {
  execFileSync(process.execPath, ["--check", grantsPath], { stdio: "pipe" });
  check("work-folder-grants.cjs parses", true);
} catch (error) {
  check("work-folder-grants.cjs parses", false, String(error.stderr || error));
}

// The read endpoints take the approved root plus a relative path, so the path
// itself has to be locked down too — not only the root.
const { listWorkDirectory, readWorkFile } = require(path.join(root, "scripts", "server", "work-file-manager.cjs"));

async function expectBlocked(label, promise) {
  try {
    await promise;
    check(label, false, "the call succeeded");
  } catch (error) {
    check(label, /traversal|outside|not permitted/i.test(error.message) || error.statusCode === 403, error.message);
  }
}

(async () => {
  section("9. Paths inside the folder are locked down as well");
  const read = await readWorkFile({ root: approved, filePath: "notes.txt" });
  check("a relative path inside the folder reads fine", String(read.content).includes("approved folder"));
  await expectBlocked("a relative path that escapes the folder is refused", readWorkFile({ root: approved, filePath: path.join("..", "secret", "passwords.txt") }));
  await expectBlocked("an absolute path outside the folder is refused", readWorkFile({ root: approved, filePath: path.join(secret, "passwords.txt") }));
  const listed = await listWorkDirectory({ root: approved, directoryPath: "" });
  check("the folder lists its own entries", listed.entries.some((entry) => entry.name === "notes.txt"));
  await expectBlocked("listing a directory outside the folder is refused", listWorkDirectory({ root: approved, directoryPath: path.join("..", "secret") }));

  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
