"use strict";

/**
 * Proves the "grant access to this folder again" round trip is gone without
 * giving the AI (or the network) any folder the user did not choose.
 *
 * The bug: Work projects live in the browser, the permission that lets the
 * server read their folders lives in the server's memory. After a restart the
 * browser replayed a grant id the new process had never seen, so every Work
 * command failed with "This Work folder needs permission. Open Edit project…".
 *
 * Run: node scripts/validation/test-work-grant-restore.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");
const appFile = path.join(root, "app", "frontend", "src", "App.jsx");
const dockFile = path.join(root, "app", "frontend", "src", "components", "WorkTerminalDock.jsx");
const chatFile = path.join(root, "app", "frontend", "src", "components", "TextChat.jsx");
const libFile = path.join(root, "app", "frontend", "src", "lib", "work-grants.mjs");

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function bootServer(port) {
  const child = spawn(process.execPath, [serverFile], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LUKE_AI_HOST: "127.0.0.1", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  let ready = false;
  for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}.\n${log}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.status === 200) ready = true;
    } catch {}
    if (!ready) await delay(150);
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`Application server did not become ready.\n${log}`);
  }
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
}

async function main() {
  console.log("Work folder grant restore validation (end to end)");

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-grant-restore-"));
  const approved = path.join(sandbox, "approved");
  const secret = path.join(sandbox, "secret");
  const gone = path.join(sandbox, "deleted-since-last-time");
  fs.mkdirSync(path.join(approved, "nested"), { recursive: true });
  fs.mkdirSync(secret, { recursive: true });
  fs.writeFileSync(path.join(approved, "notes.txt"), "hello from the approved folder");
  fs.writeFileSync(path.join(approved, "nested", "deeper.txt"), "deeper");
  fs.writeFileSync(path.join(secret, "passwords.txt"), "top secret");

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const call = async (endpoint, payload) => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {}
    return { status: response.status, data };
  };

  const project = "work_project_restore";
  const otherProject = "work_project_someone_else";

  // ── Session 1: the folder is approved and used ──────────────────────────
  section("1. An approved folder works while the app is running");
  let child = await bootServer(port);
  const first = await call("/api/work/folder/restore", { projectId: project, roots: [approved] });
  const firstGrantId = first.data?.grants?.[approved];
  check("the folder is granted", first.status === 200 && Boolean(firstGrantId), `status ${first.status}`);
  const beforeRestart = await call("/api/work/directory", { projectId: project, root: approved, grantId: firstGrantId, path: "" });
  check("the folder can be listed with the fresh grant", beforeRestart.status === 200, `status ${beforeRestart.status}`);

  // ── Restart: this is the bug the user hit ───────────────────────────────
  await stopServer(child);
  child = await bootServer(port);
  section("2. After a restart the old grant is gone (the reported bug)");
  const stale = await call("/api/work/directory", { projectId: project, root: approved, grantId: firstGrantId, path: "" });
  check("the saved grant id no longer works", stale.status === 403, `status ${stale.status}`);
  check(
    "it is refused with the permission message",
    String(stale.data?.error || "").includes("needs permission"),
    String(stale.data?.error || "")
  );

  // ── The fix ─────────────────────────────────────────────────────────────
  section("3. The app restores the folders the project already saved");
  const restored = await call("/api/work/folder/restore", { projectId: project, roots: [approved] });
  check("restore answers ok", restored.status === 200 && restored.data?.ok === true, `status ${restored.status}`);
  const restoredGrantId = restored.data?.grants?.[approved];
  check("a usable grant comes back for the saved folder", Boolean(restoredGrantId));
  check("the restored grant is a new one, not the dead one", restoredGrantId && restoredGrantId !== firstGrantId);
  const listed = await call("/api/work/directory", { projectId: project, root: approved, grantId: restoredGrantId, path: "" });
  check("the folder works again without opening Edit project", listed.status === 200, `status ${listed.status}`);
  const read = await call("/api/work/file/read", { projectId: project, root: approved, grantId: restoredGrantId, path: "notes.txt" });
  check("a file inside it reads again", read.status === 200 && String(read.data?.file?.content || "").includes("approved folder"));

  section("4. Restoring grants nothing new");
  const missingFolder = await call("/api/work/folder/restore", { projectId: project, roots: [gone] });
  check("a folder that no longer exists is refused", missingFolder.data?.failed?.length === 1 && !missingFolder.data?.grants?.[gone], JSON.stringify(missingFolder.data?.failed || []));
  const noProject = await call("/api/work/folder/restore", { roots: [approved] });
  check("restore without a project is refused", noProject.status === 400, `status ${noProject.status}`);
  const otherUse = await call("/api/work/directory", { projectId: otherProject, root: approved, grantId: restoredGrantId, path: "" });
  check("the restored grant does not work for another project", otherUse.status === 403, `status ${otherUse.status}`);
  const outsideUse = await call("/api/work/directory", { projectId: project, root: secret, grantId: restoredGrantId, path: "" });
  check("the restored grant does not open a folder that was not saved", outsideUse.status === 403, `status ${outsideUse.status}`);
  const escaped = await call("/api/work/file/read", {
    projectId: project,
    root: approved,
    grantId: restoredGrantId,
    path: "../secret/passwords.txt",
  });
  check("a path escaping the folder is still refused", escaped.status !== 200, `status ${escaped.status}`);
  check("the secret never appears in any reply", !String(escaped.data?.file?.content || "").includes("top secret"));

  const server = fs.readFileSync(serverFile, "utf8");
  check("a brand new folder still needs the native picker", /purpose === "work-project-source"/.test(server) && /grantWorkFolder\(\{ projectId: body\.projectId, root: result\.selectedPath \}/.test(server));
  check("restore only answers this computer", /Folder access can only be restored from this computer/.test(server));

  await stopServer(child);

  // ── The wiring, without booting the UI ──────────────────────────────────
  section("5. The app restores on its own, and offers a button if it ever fails");
  const app = fs.readFileSync(appFile, "utf8");
  const dock = fs.readFileSync(dockFile, "utf8");
  const chat = fs.readFileSync(chatFile, "utf8");
  const lib = fs.readFileSync(libFile, "utf8");

  check("a shared helper knows which folders lost their grant", /export function missingGrants/.test(lib));
  check("the helper calls the restore endpoint", /\/api\/work\/folder\/restore/.test(lib));
  check("the helper only sends folders the project already has", /sourceFolders/.test(lib) && /folderGrants/.test(lib));
  check("App restores the grants after a launch", /restoreProjectGrants\(project\)/.test(app));
  check("it runs once per launch, not on every render", /projectGrantsRestoredRef\.current = true/.test(app));
  check("the restored id is written back into the project", /withRestoredGrants\(project, patch\.grants\)/.test(app));
  check("TextChat hands the project list to the terminal", /setProjects=\{setProjects\}/.test(chat));
  check("the terminal notices a permission refusal", /setNeedsGrant\(\/permission\/i\.test\(message\)\)/.test(dock));
  check("the terminal offers to grant access again", /grantAccess/.test(dock) && /Grant access to this folder again/.test(dock));
  check("the terminal also restores through the same helper", /restoreProjectGrants\(project\)/.test(dock));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
