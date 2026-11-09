#!/usr/bin/env node
"use strict";

/**
 * "llama.cpp did not become ready within 3 minutes."
 *
 * A 9 GB Q4 model on an exFAT volume, loaded with --mmap: three minutes in, 1 GB
 * resident, 0.3% CPU, then the app gave up and fell back to CPU inference. The
 * same file with --no-mmap loaded in 33 s, and `dd` read that volume at
 * 219 MB/s — so the disk was fine and the mapping was not. Each relaunch
 * repeated the loop, because the mmap preference was reset to true at boot.
 *
 * This suite pins the rule: the filesystem of the model directory decides, the
 * override is explained out loud, and the user's own choice survives a restart.
 * It also pins the third bug from that night: POST /api/llm/arena/unload with no
 * body answered 200 {ok:true, unloaded:false}, which reads as "freed" while the
 * memory stayed held.
 *
 * Run: node scripts/validation/test-mmap-policy.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const policy = require(path.join(root, "scripts", "server", "mmap-policy.cjs"));
const poolModule = require(path.join(root, "scripts", "server", "text-model-pool.cjs"));
const serveSource = fs.readFileSync(path.join(root, "scripts", "server", "serve.cjs"), "utf8");
const poolSource = fs.readFileSync(path.join(root, "scripts", "server", "text-model-pool.cjs"), "utf8");

let checks = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks += 1;
  console.log(`  ✓ ${message}`);
}

const MAC_MOUNT = [
  "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
  "/dev/disk6s2 on /Volumes/AI (exfat, local, nodev, nosuid, noowners)",
  "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)",
].join("\n");

const LINUX_MOUNT = [
  "/dev/nvme0n1p1 on / type ext4 (rw,relatime)",
  "/dev/sda1 on /mnt/models type exfat (rw,relatime,fmask=0022)",
].join("\n");

function main() {
  console.log("=== mmap policy ===\n");

  // ── reading the mount table ───────────────────────────────────────────────
  const macEntries = policy.parseMountTable(MAC_MOUNT);
  assert(macEntries.length === 3, "macOS mount lines parse");
  assert(macEntries[1].mountPoint === "/Volumes/AI" && macEntries[1].type === "exfat", "with their mount point and type");

  const linuxEntries = policy.parseMountTable(LINUX_MOUNT);
  assert(
    linuxEntries.some((entry) => entry.mountPoint === "/mnt/models" && entry.type === "exfat"),
    "Linux lines parse too, where the type comes after the word 'type'",
  );

  // ── which filesystem a model lives on ────────────────────────────────────
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/Volumes/AI/app/llm-models/x.gguf") === "exfat",
    "a model inside the exFAT volume is recognised as exFAT",
  );
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/Volumes/AI/") === "exfat",
    "trailing slashes do not lose the match",
  );
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/Users/ekky/models/x.gguf") === "apfs",
    "the longest matching mount point wins, so / does not swallow everything",
  );
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/tmp/x.gguf") === "apfs",
    "a path outside every named volume still resolves, through the root mount",
  );
  assert(
    policy.filesystemTypeForPath("", "/tmp/x.gguf") === "",
    "an unreadable mount table is unknown rather than assumed unsafe",
  );

  // The real install: `mount` prints /Volumes/AI, the app builds paths from
  // /Volumes/ai, and macOS treats them as the same directory. A case-sensitive
  // prefix test fell through to the root volume, answered "apfs", and gave an
  // exFAT model its --mmap back.
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/Volumes/ai/app/llm-models/x.gguf") === "exfat",
    "the mount point's spelling does not decide which filesystem the model is on",
  );
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/Volumes/ai/") === "exfat",
    "including with a trailing slash",
  );
  assert(
    policy.filesystemTypeForPath(MAC_MOUNT, "/volumes/ai/app/llm-models/x.gguf") === "exfat",
    "and when every letter of the volume name differs in case",
  );
  assert(
    policy.filesystemTypeForPath(
      "/dev/nvme0n1p1 on / type ext4 (rw,relatime)\n/dev/sda1 on /mnt/models type exfat (rw,relatime)",
      "/mnt/models/x.gguf",
    ) === "exfat",
    "a deeper volume still beats the root mount it is nested under",
  );

  // The line the failing machine actually printed, fskit and all.
  const realLine = [
    "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
    "/dev/disk6s2 on /Volumes/AI (exfat, local, nodev, nosuid, noowners, noatime, fskit)",
    "//ekky@BoonNas/Mac%20Backup on /Volumes/.timemachine/BoonNas/X/Mac Backup (smbfs, nobrowse)",
  ].join("\n");
  assert(
    policy.filesystemTypeForPath(realLine, "/Volumes/ai/app/llm-models/gemma-4-12b-it-uncensored-Q3_K_M.gguf") === "exfat",
    "the reported machine's own mount line yields exfat for the path the app really uses",
  );
  assert(
    policy.decideMmap(true, policy.filesystemTypeForPath(realLine, "/Volumes/ai/app/llm-models/gemma-4-12b-it-uncensored-Q3_K_M.gguf")).mmap === false,
    "so that request is denied mmap, instead of silently falling back to the root volume",
  );

  // ── which filesystems block mmap ─────────────────────────────────────────
  for (const type of ["exfat", "msdos", "vfat", "ntfs", "smbfs", "fuse.ntfs", "fuse.exfat"]) {
    assert(policy.blocksMmap(type), `${type} blocks mmap`);
  }
  for (const type of ["apfs", "hfs", "ext4", "xfs", ""]) {
    assert(!policy.blocksMmap(type), `${type || "an unknown filesystem"} keeps mmap available`);
  }

  // ── the decision, and what it says out loud ──────────────────────────────
  const onExfat = policy.decideMmap(true, "exfat");
  assert(onExfat.mmap === false, "asking for mmap on exFAT does not get you mmap");
  assert(/exfat/.test(onExfat.reason), "the log line names the filesystem");
  assert(/--no-mmap/.test(onExfat.reason), "and the flag being used instead");
  assert(/APFS/.test(onExfat.reason), "and what would give mmap back");

  assert(policy.decideMmap(true, "apfs").mmap === true, "APFS keeps the request as asked");
  assert(policy.decideMmap(undefined, "apfs").mmap === true, "an unset preference defaults to mmap, as before");
  assert(policy.decideMmap(undefined, "exfat").mmap === false, "but the filesystem still overrules the default");
  const off = policy.decideMmap(false, "apfs");
  assert(off.mmap === false && off.reason === "", "a user who turned mmap off is not lectured about it");

  // ── the choice survives a restart ────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luke-prefs-"));
  try {
    assert(Object.keys(policy.readPrefs(dir)).length === 0, "a fresh install has no saved preference");
    policy.writePrefs(dir, { mmap: false });
    assert(policy.readPrefs(dir).mmap === false, "turning mmap off is remembered");
    policy.writePrefs(dir, { mlock: true });
    const merged = policy.readPrefs(dir);
    assert(merged.mmap === false && merged.mlock === true, "and a later write merges instead of forgetting");
    policy.writePrefs(dir, { nonsense: 1 });
    assert(policy.readPrefs(dir).mmap === false, "unknown keys are ignored rather than trusted");
    assert(policy.readPrefs(path.join(dir, "missing")).mmap === undefined, "a missing file reads as no preference");
    assert(
      policy.writePrefs(path.join(dir, "sub", "dir"), { mmap: true }).mmap === true,
      "the directory is created when it does not exist yet",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── the server actually uses it ──────────────────────────────────────────
  assert(
    /const mmapPolicy = require\("\.\/mmap-policy\.cjs"\)/.test(serveSource),
    "serve.cjs loads the policy module",
  );
  assert(
    /const mmapDecision = decideMmapForModel\(llmSettings\.mmap, loadPath\)/.test(serveSource),
    "the --mmap flag is decided from the model's own path",
  );
  assert(
    /console\.log\(`  \[llm\] \$\{mmapDecision\.reason\}`\)/.test(serveSource),
    "and the override is printed, so nobody has to guess why loading changed",
  );
  assert(
    /const saved = mmapPolicy\.readPrefs\(LLM_PREFS_DIR\)/.test(serveSource),
    "the saved preference is applied at boot",
  );
  assert(
    /mmapPolicy\.writePrefs\(LLM_PREFS_DIR, \{/.test(serveSource),
    "and an explicit choice is written back",
  );
  assert(
    /args\.push\("--no-mmap"\)/.test(serveSource),
    "the denied decision pushes --no-mmap, because llama.cpp defaults to mmap on",
  );
  assert(
    /llmSettings\.mmap = mmapDecision\.mmap/.test(serveSource),
    "and the response reports the flag that was launched, not the preference asked for",
  );

  // ── the Arena pool spawns its own llama-server ───────────────────────────
  // Two processes were seen alive at once, one with --mmap and one without: the
  // runtime had been fixed and the pool had not. The pool owned an
  // unconditional `if (settings.mmap !== false) args.push("--mmap")`.
  assert(
    !/if \(settings\.mmap !== false\) args\.push\("--mmap"\)/.test(poolSource),
    "the arena pool no longer pushes --mmap unconditionally",
  );
  const poolExfat = poolModule.buildMmapFlags(true, "/Volumes/ai/app/llm-models/gemma.gguf", {
    readMountTable: () => MAC_MOUNT,
  });
  assert(
    poolExfat.args.join(" ") === "--no-mmap" && poolExfat.mmap === false,
    "an arena model on the exFAT volume is started with --no-mmap",
  );
  assert(/exfat/.test(poolExfat.reason), "and the pool logs why");
  const poolLocal = poolModule.buildMmapFlags(true, "/Users/ekky/models/x.gguf", { readMountTable: () => MAC_MOUNT });
  assert(
    poolLocal.args.join(" ") === "--mmap" && poolLocal.mmap === true,
    "an arena model on the internal disk keeps --mmap",
  );
  const poolOff = poolModule.buildMmapFlags(false, "/Users/ekky/models/x.gguf", { readMountTable: () => MAC_MOUNT });
  assert(
    poolOff.args.join(" ") === "--no-mmap" && poolOff.reason === "",
    "and a user who turned mmap off is obeyed without a lecture",
  );
  assert(
    /buildMmapFlags\(settings\.mmap, modelPath/.test(poolSource),
    "the pool decides from the model file, not from a default",
  );


  // ── the saved choice reaches the pool too ───────────────────────────────
  // llm-prefs.json was honoured at boot by the single-model runtime and
  // ignored by the arena pool, so turning mmap off once did not hold for
  // Arena rounds on a filesystem where mmap was otherwise fine.
  const poolPolicy = { mmap: true, mlock: false };
  const defaults = poolModule.resolveRuntimeSettings({}, poolPolicy, {});
  assert(
    defaults.mmap === true && defaults.mlock === false,
    "without a saved choice the arena policy default stands",
  );
  const saved = poolModule.resolveRuntimeSettings({}, poolPolicy, { mmap: false });
  assert(saved.mmap === false, "a saved mmap:false is honoured by the pool");
  const explicit = poolModule.resolveRuntimeSettings({ mmap: true }, poolPolicy, { mmap: false });
  assert(explicit.mmap === true, "and an explicit per-model request still wins over it");
  assert(
    /getRuntimePreferences: \(\) => mmapPolicy\.readPrefs\(LLM_PREFS_DIR\)/.test(serveSource),
    "serve.cjs hands the saved preferences to the pool",
  );
  assert(
    /savedPreferences = this\.getRuntimePreferences\(\) \|\| \{\}/.test(poolSource),
    "and the pool asks for them before deciding",
  );
  // ── arena/unload no longer lies ──────────────────────────────────────────
  const unloadBlock = serveSource.slice(
    serveSource.indexOf('"/api/llm/arena/unload"'),
    serveSource.indexOf('"/api/llm/arena/generate-stream"'),
  );
  assert(
    /body\.all !== true && !body\.modelId/.test(unloadBlock) && /json\(res, 400/.test(unloadBlock),
    "a bare arena/unload POST answers 400 instead of ok with nothing unloaded",
  );
  assert(
    /arena\/unload needs/.test(unloadBlock),
    "and says what the caller has to send",
  );

  console.log(`\nPASS: ${checks} checks — the filesystem decides mmap, and it is said out loud.`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
