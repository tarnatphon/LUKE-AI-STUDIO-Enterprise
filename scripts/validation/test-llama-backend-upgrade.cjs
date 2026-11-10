"use strict";

/**
 * A backend that cannot be upgraded, and asset names that moved.
 *
 * Both were hit for real on one machine:
 *
 *   1. `setup-llama.sh` skipped the download whenever `llama-server` existed,
 *      so `LLAMA_RELEASE=b12242 ./scripts/setup/setup-llama.sh` did nothing —
 *      while docs/beta7 told users to "re-run setup-llama.sh" as the cure for an
 *      old backend. The remedy was a no-op.
 *   2. The asset names were built from the tag, but upstream renamed them:
 *      `-ubuntu-cuda-12.4-x64` became `cuda-12.8` / `cuda-13.5`, and
 *      `-ubuntu-rocm-x64` became `rocm-10.0`. Both are *optional* backends, so
 *      the 404 was swallowed and the machine quietly lost its GPU.
 *
 * The script is sourced in library mode (LLAMA_SETUP_LIB_ONLY=1) so these
 * decisions can be exercised without installing anything.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const setupScript = path.join(root, "scripts", "setup", "setup-llama.sh");
const setupSource = fs.readFileSync(setupScript, "utf8");

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sh(code, env = {}) {
  const result = spawnSync("bash", ["-c", code], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, LLAMA_SETUP_LIB_ONLY: "1", ...env },
  });
  return { status: result.status, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

/** Run one expression from the sourced script. */
function lib(expression, env = {}) {
  return sh(`source "${setupScript}"\n${expression}`, env);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-llama-"));

/** A directory holding a fake llama-server that reports `version`. */
function fakeBackend(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, "llama-server");
  fs.writeFileSync(binary, `#!/usr/bin/env bash\necho "version: ${version} (32120c10e)"\necho "built with AppleClang"\n`);
  fs.chmodSync(binary, 0o755);
  return dir;
}

// ── the names, and the names that moved ─────────────────────────────────────
const macArm = lib("asset_for macos-arm64");
check("the macOS asset name is still built from the tag", macArm.stdout === "llama-b9668-bin-macos-arm64.tar.gz", macArm.stdout);

const moved = lib("asset_pattern linux-cuda-x64");
check("the CUDA pattern allows the version to move", moved.stdout === "-bin-ubuntu-cuda-[0-9.]+-x64\\.tar\\.gz$", moved.stdout);
check("and so does ROCm", lib("asset_pattern linux-rocm-x64").stdout === "-bin-ubuntu-rocm-[0-9.]+-x64\\.tar\\.gz$");

const ranking = sh(`printf '%s\\n' \\
  llama-b12242-bin-ubuntu-cuda-12.8-x64.tar.gz \\
  llama-b12242-bin-ubuntu-cuda-13.5-x64.tar.gz | \\
  source "${setupScript}" >/dev/null 2>&1; \\
  printf '%s\\n' \\
  llama-b12242-bin-ubuntu-cuda-12.8-x64.tar.gz \\
  llama-b12242-bin-ubuntu-cuda-13.5-x64.tar.gz | bash -c 'source "'"${setupScript}"'"; pick_best_asset'`);
check("the newest CUDA build wins, not the first", ranking.stdout === "llama-b12242-bin-ubuntu-cuda-13.5-x64.tar.gz", ranking.stdout);

// No network, or a tag that does not exist: the constructed name is the answer.
const offline = lib("resolve_asset linux-cuda-x64", { LLAMA_RELEASE: "b000001" });
check("with nothing to ask, the built name is used", offline.stdout === "llama-b000001-bin-ubuntu-cuda-12.4-x64.tar.gz", offline.stdout);

// ── should this be installed at all? ────────────────────────────────────────
const absent = sh(`source "${setupScript}"; if should_install "${path.join(tmp, "missing")}" b9668; then echo INSTALL; else echo SKIP; fi`);
check("an empty folder means install", absent.stdout.endsWith("INSTALL"), absent.stdout);
check("and says why", absent.stdout.includes("nothing installed yet"), absent.stdout);

const same = lib(`dir="${fakeBackend(path.join(tmp, "same"), 9668)}"; if should_install "$dir" b9668; then echo INSTALL; else echo SKIP; fi`);
check("the same build is left alone", same.stdout.endsWith("SKIP"), same.stdout);
check("and the reason names both numbers", /b9668 is already the same as or newer than b9668/.test(same.stdout), same.stdout);

const newer = lib(`dir="${fakeBackend(path.join(tmp, "newer"), 12242)}"; if should_install "$dir" b9668; then echo INSTALL; else echo SKIP; fi`);
check("a newer build is not downgraded", newer.stdout.endsWith("SKIP"), newer.stdout);

const older = lib(`dir="${fakeBackend(path.join(tmp, "older"), 9668)}"; if should_install "$dir" b12242; then echo INSTALL; else echo SKIP; fi`);
check("an older build is upgraded — the bug that made the documented fix a no-op", older.stdout.endsWith("INSTALL"), older.stdout);
check("and the reason is the version gap", /b9668 is older than b12242/.test(older.stdout), older.stdout);

const forced = lib(`dir="${fakeBackend(path.join(tmp, "forced"), 12242)}"; if should_install "$dir" b9668; then echo INSTALL; else echo SKIP; fi`, { LLAMA_FORCE: "1" });
check("LLAMA_FORCE=1 reinstalls anyway", forced.stdout.endsWith("INSTALL"), forced.stdout);

const unreadable = fakeBackend(path.join(tmp, "unreadable"), "not-a-number");
const unknown = lib(`dir="${unreadable}"; if should_install "$dir" v0.9.0; then echo INSTALL; else echo SKIP; fi`);
check("an uncomparable version keeps what is installed", unknown.stdout.endsWith("SKIP"), unknown.stdout);
check("and says it could not compare", /cannot be compared/.test(unknown.stdout), unknown.stdout);

check("a build number is read out of the tag", lib("release_number b12242").stdout === "12242");
check("a semantic tag is not mistaken for one", lib("release_number v0.9.0").stdout === "");

// ── the install itself: staging, backup, and no half-installed folder ──────
const installScript = (dest, { failFetch = false } = {}) => `
set -uo pipefail
source "${setupScript}"
dest="${dest}"
if [[ "${failFetch}" == "true" ]]; then
  fetch_and_extract() { echo "   XX   simulated download failure" >&2; return 1; }
else
  fetch_and_extract() {
    local asset="$1" target="$2"
    mkdir -p "$target"
    printf '#!/usr/bin/env bash\\necho "version: 12242 (deadbeef)"\\n' > "$target/llama-server"
    chmod +x "$target/llama-server"
    echo "   >>   (stub) $asset"
  }
fi
if ensure_backend macos-arm64 "$dest"; then echo "RESULT installed"; else echo "RESULT failed"; fi
echo "VERSION $(installed_release "$dest")"
[[ -d "$dest.bak" ]] && echo "BACKUP yes" || echo "BACKUP no"
[[ -e "$dest.new" ]] && echo "STAGING left behind" || echo "STAGING clean"
`;

const upgradeDest = fakeBackend(path.join(tmp, "upgrade"), 9668);
const upgrade = sh(installScript(upgradeDest), { LLAMA_RELEASE: "b12242" });
check("an old build is replaced", upgrade.stdout.includes("RESULT installed"), upgrade.stdout);
check("the new build is the one in place", upgrade.stdout.includes("VERSION 12242"), upgrade.stdout);
check("the previous build is kept next to it", upgrade.stdout.includes("BACKUP yes"), upgrade.stdout);
check("no staging folder is left", upgrade.stdout.includes("STAGING clean"), upgrade.stdout);
check("the backup still holds the old build",
  sh(`grep -q "version: 9668" "${upgradeDest}.bak/llama-server" && echo OLD`).stdout === "OLD");
check("the run says what it now runs", /now runs b12242/.test(upgrade.stdout), upgrade.stdout);

const keepDest = fakeBackend(path.join(tmp, "keep"), 9668);
const failed = sh(installScript(keepDest, { failFetch: true }), { LLAMA_RELEASE: "b12242" });
check("a failed download is reported", failed.stdout.includes("RESULT failed"), failed.stdout);
check("the working build is untouched", failed.stdout.includes("VERSION 9668"), failed.stdout);
check("no half-installed folder takes its place", failed.stdout.includes("STAGING clean"), failed.stdout);
check("and the message says the backend was left alone", /left untouched/.test(failed.stderr), failed.stderr);

// ── the shape of the script ─────────────────────────────────────────────────
check("the skip is no longer decided by existence alone",
  !/if \[\[ -x "\$dest\/llama-server" \]\]; then\s*\n\s*echo "   OK   llama\.cpp backend already ready/.test(setupSource));
check("the decision goes through installed_release", /installed="\$\(installed_release "\$dir"\)"/.test(setupSource));
check("nothing is extracted straight into the live folder", /staging="\$dest\.new"/.test(setupSource) && /mv "\$staging" "\$dest"/.test(setupSource));
check("the release's own asset list is consulted", /releases\/tags\/\$RELEASE/.test(setupSource) && /grep -E -e "\$pattern"/.test(setupSource));
check("the cudart side-archive is excluded", /\| grep '\^llama-'/.test(setupSource));
check("library mode keeps the platform section out of a sourced script", /LLAMA_SETUP_LIB_ONLY/.test(setupSource));
check("the pinned release is still the one catalog says", /\$\{LLAMA_RELEASE:-b9668\}/.test(setupSource));

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} of ${passed + failures.length} checks — ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`PASS: ${passed} checks — an old backend can be replaced, safely, and a renamed asset is still found.`);
