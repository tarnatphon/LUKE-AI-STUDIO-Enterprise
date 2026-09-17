"use strict";

/**
 * Work says what is wrong instead of showing an empty panel.
 *
 * Every Work panel needs one thing before any of them can do anything: a
 * folder the user granted for this session. When that is missing the panels
 * were simply blank, which reads as "Work is broken". The readiness check
 * answers the question the user is actually asking — why is nothing
 * happening — and this suite proves it tells the truth in all four cases.
 *
 * Run: node scripts/validation/test-work-readiness.cjs
 */

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverFile = path.join(root, "scripts", "server", "serve.cjs");

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

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "luke-work-readiness-"));
  const missing = path.join(sandbox, "never-created");

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

    console.log("\n1. A project with no folder knows that is the problem");
    const none = await call("/api/work/readiness", { projectId: "p1", sourceFolders: [], folderGrants: {} });
    check("it answers", none.status === 200 && none.data.ok === true);
    check("it says what to do about it", /no source folder/i.test(String(none.data.result?.hint)), String(none.data.result?.hint));
    check("no tool is offered", none.data.result.tools.terminal === false);

    console.log("\n2. A folder that exists but was never granted this session");
    const ungranted = await call("/api/work/readiness", { projectId: "p1", sourceFolders: [sandbox], folderGrants: {} });
    check("the folder is reported", ungranted.data.result.folders[0].exists === true);
    check("the missing grant is counted", ungranted.data.result.missingGrantCount === 1);
    check("it says granting is the fix", /grant/i.test(String(ungranted.data.result.hint)), String(ungranted.data.result.hint));

    console.log("\n3. A folder that is gone from the disk");
    const gone = await call("/api/work/readiness", { projectId: "p1", sourceFolders: [missing], folderGrants: {} });
    check("it is reported as missing", gone.data.result.folders[0].exists === false);
    check("the count reflects it", gone.data.result.missingFolderCount === 1);
    check("it says to re-attach the folder", /re-attach|could not be opened/i.test(String(gone.data.result.hint)), String(gone.data.result.hint));

    console.log("\n4. Once it is granted, everything is ready and it says nothing");
    const restored = await call("/api/work/folder/restore", { projectId: "p1", roots: [sandbox] });
    const grantId = restored.data?.grants?.[sandbox];
    const ready_ = await call("/api/work/readiness", { projectId: "p1", sourceFolders: [sandbox], folderGrants: { [sandbox]: grantId } });
    check("the folder counts as ready", ready_.data.result.readyCount === 1);
    check("there is nothing left to complain about", ready_.data.result.hint === null, String(ready_.data.result.hint));
    check("the tools are offered", ready_.data.result.tools.terminal === true && ready_.data.result.tools.checks === true);
    check("an active folder is chosen", ready_.data.result.activeRoot === fs.realpathSync(sandbox), String(ready_.data.result.activeRoot));

    console.log("\n5. It never hands out a grant id");
    check("the answer carries no secrets", !/grantId|base64/i.test(JSON.stringify(ready_.data.result.folders)), JSON.stringify(ready_.data.result.folders).slice(0, 160));
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
