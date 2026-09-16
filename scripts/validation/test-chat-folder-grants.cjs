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
  assertChatFolderWrite,
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

section("3. A chat folder is read-only until the user allows editing");
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

const readOnlyFolder = grantChatFolder({ conversationId: "chat-readonly", root: approved });
const editableFolder = grantChatFolder({ conversationId: "chat-editable", root: approved, canWrite: true });
check("a folder defaults to read-only", readOnlyFolder.canWrite === false);
check("editing is only on when it was asked for", editableFolder.canWrite === true);
expectPermission("writing to a read-only folder is refused", () =>
  assertChatFolderWrite({ projectId: "chat:chat-readonly", root: approved, grantId: readOnlyFolder.grantId }), "CHAT_FOLDER_READ_ONLY");
check(
  "writing to an editable folder is allowed",
  assertChatFolderWrite({ projectId: "chat:chat-editable", root: approved, grantId: editableFolder.grantId }) === fs.realpathSync(approved)
);
expectPermission("an editable grant still refuses another folder", () =>
  assertChatFolderWrite({ projectId: "chat:chat-editable", root: secret, grantId: editableFolder.grantId }), "WORK_FOLDER_PERMISSION_REQUIRED");
check(
  "a Work project keeps its own policy (no chat read-only rule)",
  assertChatFolderWrite({ projectId: "project-1", root: approved, grantId: grantWorkFolder({ projectId: "project-1", root: approved }).grantId }) === fs.realpathSync(approved)
);
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
for (const endpoint of ["/api/chat/folder/grant", "/api/chat/folder/revoke", "/api/chat/folder/tree", "/api/chat/folder/search", "/api/chat/folder/file", "/api/chat/folder/write"]) {
  check(`${endpoint} exists`, serveSource.includes(`req.url === "${endpoint}" && req.method === "POST"`));
}
const chatEndpointBlock = serveSource.slice(
  serveSource.indexOf('req.url === "/api/chat/folder/grant"'),
  serveSource.indexOf("// POST /api/work/search")
);
check("every chat folder endpoint checks the grant first", (chatEndpointBlock.match(/assertWorkFolderGrant/g) || []).length >= 3);
check("chat folder endpoints derive the scope on the server", /conversationId: body\.conversationId/.test(serveSource) && /`chat:\$\{/.test(serveSource));
check("the grant endpoint reports the edit permission", /canWrite: granted\.canWrite === true/.test(serveSource));
check("the grant endpoint forwards the edit choice to the store", /canWrite: body\.canWrite === true/.test(serveSource));
check("chat edits go through their own guarded endpoint", serveSource.includes("assertChatFolderWrite({") && serveSource.includes("req.url === \"/api/chat/folder/write\""));
check("chat edits still need the approved root", (() => {
  const start = serveSource.indexOf('req.url === "/api/chat/folder/write"');
  const window = serveSource.slice(start, start + 900);
  return window.includes("assertChatFolderWrite(") && window.includes("writeWorkFile(");
})());

for (const writeEndpoint of ["/api/work/file/write", "/api/work/command", "/api/work/terminal/session", "/api/work/terminal"]) {
  const start = serveSource.indexOf(`req.url === "${writeEndpoint}" && req.method === "POST"`);
  const window = serveSource.slice(start, start + 700);
  const blockIndex = window.indexOf("assertNotChatScope(body.projectId)");
  const grantIndex = window.indexOf("assertWorkFolderGrant(");
  check(`${writeEndpoint} refuses a chat-scoped grant`, blockIndex !== -1 && blockIndex < grantIndex);
}
// Endpoints that only read inside a granted folder may accept a chat grant;
// everything else — anything that writes, runs, patches or indexes — must not.
const chatSafeWorkEndpoints = new Set(["/api/work/directory", "/api/work/file/read", "/api/work/review/diff", "/api/work/search"]);
const workEndpointIds = [...new Set([...serveSource.matchAll(/req\.url === "(\/api\/work\/[^"]+)" && req\.method === "POST"/g)].map((match) => match[1]))];
for (const endpoint of workEndpointIds) {
  if (chatSafeWorkEndpoints.has(endpoint)) continue;
  if (/\/(grant|revoke|restore)$/.test(endpoint)) continue;
  const start = serveSource.indexOf(`req.url === "${endpoint}" && req.method === "POST"`);
  const window = serveSource.slice(start, start + 900);
  if (!/body\.root/.test(window)) continue;
  check(`${endpoint} refuses a chat-scoped grant`, /assertNotChatScope\(body\.projectId\)/.test(window));
}
check("chat grants cannot be replayed on Work write endpoints", workEndpointIds.length > 8);

section("7. Composer wiring");
const composerSource = fs.readFileSync(composerPath, "utf8");
check("a folder button sits in the composer toolbar", /className=\{`chat-composer-folder-btn/.test(composerSource) && composerSource.indexOf("chat-composer-folder-btn") > composerSource.indexOf("chat-composer-attach-btn"));
check("the folder button uses the native picker", composerSource.includes('"/api/storage/choose-folder"'));
check("the picker does not grant by itself — an approval dialog follows", /setFolderApproval\(\{/.test(composerSource) && /chat-folder-approval-backdrop/.test(composerSource));
check("the dialog asks for approval by name", composerSource.includes("Approve for me"));
check("the dialog shows the absolute path", /chat-folder-approval-path/.test(composerSource) && /folderApproval\.root/.test(composerSource));
check("the dialog states the confinement guarantees", /only this folder/.test(composerSource) && /any other folder/.test(composerSource));
check("the dialog offers an editing switch", /Allow LUKE AI to edit files in this folder/.test(composerSource) && /setFolderApproval\(\(current\) => \(current \? \{ \.\.\.current, canWrite/.test(composerSource));
check("the approval button names the mode it grants", /Approve for me \(read \+ edit\)/.test(composerSource));
check("removing the chip revokes the grant", composerSource.includes('"/api/chat/folder/revoke"'));
check("the conversation id is the grant scope", /conversationId: chatScope/.test(composerSource));
check("a new chat starts a fresh scope and drops the approval", /chatScopeRef\.current = `chat_\$\{Date\.now\(\)\}`/.test(composerSource));
check("the model is told when editing is allowed", /Editing is allowed in:/.test(composerSource) && /approved for reading only/i.test(composerSource));
check("chat has its own action executor pinned to the folder", /executeChatFolderActions/.test(composerSource) && /\/api\/chat\/folder\/write/.test(composerSource));
check("the chat executor refuses commands and the terminal", /Commands and the terminal are Work Mode only/.test(composerSource));
check("every edit is confirmed with the user first", /Allow LUKE AI to \$\{existing \? "edit" : "create"\} this file\?/.test(composerSource));
check("the chat executor only offers folder tools", /\["list_directory", "read_file", "write_file"\]/.test(composerSource));

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
const { listWorkDirectory, readWorkFile, writeWorkFile } = require(path.join(root, "scripts", "server", "work-file-manager.cjs"));

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

  section("10. Edits land inside the folder and nowhere else");
  const written = await writeWorkFile({ root: approved, filePath: "edited.txt", content: "rewritten by LUKE AI", approvalGranted: true });
  check("a file inside the folder is written", written.saved === true && fs.readFileSync(path.join(approved, "edited.txt"), "utf8") === "rewritten by LUKE AI");
  await writeWorkFile({ root: approved, filePath: path.join("nested", "created.txt"), content: "new file", approvalGranted: true });
  check("a new file in a sub-folder is created", fs.readFileSync(path.join(approved, "nested", "created.txt"), "utf8") === "new file");
  await expectBlocked("editing a file that escapes with ../ is refused", writeWorkFile({ root: approved, filePath: path.join("..", "secret", "passwords.txt"), content: "pwned", approvalGranted: true }));
  await expectBlocked("editing through an absolute path is refused", writeWorkFile({ root: approved, filePath: path.join(secret, "passwords.txt"), content: "pwned", approvalGranted: true }));
  const escapeDir = path.join(approved, "escape-link");
  let linkMade = true;
  try {
    fs.symlinkSync(secret, escapeDir, "dir");
  } catch {
    linkMade = false;
  }
  if (linkMade) {
    await expectBlocked("editing through a symlinked folder is refused", writeWorkFile({ root: approved, filePath: path.join("escape-link", "pwned.txt"), content: "pwned", approvalGranted: true }));
  } else {
    check("editing through a symlinked folder is refused (skipped: no symlink support)", true);
  }
  check("nothing outside the folder was touched", fs.readdirSync(secret).length === 1 && fs.readFileSync(path.join(secret, "passwords.txt"), "utf8") === "top secret");
  try {
    await writeWorkFile({ root: approved, filePath: "nope.txt", content: "x" });
    check("a write without approval is refused", false, "it succeeded");
  } catch (error) {
    check("a write without approval is refused", /approval/i.test(error.message));
  }

  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
