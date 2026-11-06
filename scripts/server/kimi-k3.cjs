"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const REPO = "unsloth/Kimi-K3-GGUF";
const QUANT = "UD-IQ1_S";
const FIRST = "Kimi-K3-UD-IQ1_S-00001-of-00015.gguf";
const MANIFEST = ".kimi-k3-install.json";
const pattern = /^Kimi-K3-UD-IQ1_S-(\d{5})-of-00015\.gguf$/;
const isKimi = name => /^Kimi-K3-/i.test(path.basename(String(name || "")));
function assess(specs = {}) {
  const ram = Math.max(0, Number(specs.ram_total_gb) || 0) * 1024 ** 3;
  const vram = Math.max(0, Number(specs.gpu_vram_gb) || 0) * 1024 ** 3;
  const unified = /apple|\bm[1-9]\b/i.test(`${specs.cpu_name || ""} ${specs.gpu_name || ""}`);
  const bytes = ram + (unified ? 0 : vram);
  const eligible = ram >= 610e9;
  return { eligible, unified, memoryGb: Math.round(bytes / 1e9), minimumGb: 610, downloadGb: 594,
    reason: `${unified ? "Unified memory (ไม่นับ VRAM ซ้ำ)" : "RAM + VRAM"}: ${Math.round(bytes / 1e9)} GB. Kimi K3 ${QUANT} ต้องการหน่วยความจำประมาณ 610 GB. การโหลด CPU-first ของ LUKE กำหนด RAM/unified memory อย่างน้อย 610 GB (ไม่ใช้ VRAM ทดแทน RAM). ดิสก์ประมาณ 594 GB บวกพื้นที่เผื่อ. ${eligible ? "ผ่านเกณฑ์ประมาณการ แต่ไม่รับประกัน OOM/ความเร็ว ควรปิดโมเดลอื่นก่อนโหลด" : "เครื่องนี้ไม่ผ่านเกณฑ์ แนะนำโมเดลขนาดเล็กใน Text AI แทน"}` };
}
function makeManifest(detail) {
  if (!/^[a-f0-9]{40}$/i.test(detail?.sha || "")) throw new Error("Kimi repository revision could not be pinned");
  const files = (detail.siblings || []).filter(f => String(f.rfilename).startsWith(`${QUANT}/`)).map(f => {
    const name = path.basename(f.rfilename);
    if (f.rfilename !== `${QUANT}/${name}` || !pattern.test(name)) return null;
    const size = Number(f.size ?? f.lfs?.size);
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Kimi shard size metadata is missing");
    return { name, size, url: `https://huggingface.co/${REPO}/resolve/${detail.sha}/${QUANT}/${name}` };
  }).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));
  if (files.length !== 15 || new Set(files.map(f => f.name)).size !== 15 || files.some((f,i) => Number(f.name.match(pattern)[1]) !== i + 1)) throw new Error("Kimi quant requires all 15 consecutive GGUF shards");
  return { repo: REPO, revision: detail.sha, quant: QUANT, files };
}
function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
    // Revalidate persisted data; never trust local URLs or path fragments.
    return makeManifest({ sha: m.revision, siblings: m.files.map(f => ({ rfilename: `${QUANT}/${f.name}`, size: f.size })) });
  } catch { return null; }
}
function completeFile(dir, f) {
  let fd;
  try {
    const file = path.join(dir, f.name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== f.size) return false;
    fd = fs.openSync(file, "r"); const magic = Buffer.alloc(4); fs.readSync(fd, magic, 0, 4, 0);
    return magic.toString() === "GGUF";
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function installed(dir) {
  const manifest = readManifest(dir);
  return Boolean(manifest && manifest.files.every(f => completeFile(dir, f)));
}
function bundleBytes(dir) { return readManifest(dir)?.files.reduce((n,f) => n + f.size, 0) || 0; }
// Probe with a harmless empty GGUF. Accept only an architecture-specific missing
// metadata error, never a version number or an arbitrary log mentioning Kimi.
function probeBackend(binary, run = spawnSync) {
  if (!binary || !fs.existsSync(binary)) return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "luke-kimi-probe-"));
  try {
    const str = value => { const b = Buffer.from(value); const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([len,b]); };
    const header = Buffer.alloc(24); header.write("GGUF"); header.writeUInt32LE(3,4); header.writeBigUInt64LE(1n,16);
    const type = Buffer.alloc(4); type.writeUInt32LE(8);
    const model = path.join(tmp, "probe.gguf");
    const data = Buffer.concat([header, str("general.architecture"), type, str("kimi-k3")]);
    fs.writeFileSync(model, Buffer.concat([data, Buffer.alloc((32 - data.length % 32) % 32)]));
    const result = run(binary, ["--model", model, "--n-gpu-layers", "0", "--no-warmup", "--ctx-size", "512"], { encoding: "utf8", timeout: 8000, env: { ...process.env, LD_LIBRARY_PATH: path.dirname(binary) + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""), DYLD_LIBRARY_PATH: path.dirname(binary) + (process.env.DYLD_LIBRARY_PATH ? `:${process.env.DYLD_LIBRARY_PATH}` : "") }, maxBuffer: 1024 * 1024 });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    return !/unknown model architecture|unsupported|unknown argument/i.test(text) && /key not found in model: kimi-k3\./i.test(text);
  } catch { return false; } finally { fs.rmSync(tmp, { recursive:true, force:true }); }
}
function createManager({ dir, getSpecs, getBackends, fetchDetail, startDownload, cancelDownload, getActiveCount, probe = probeBackend, statfs = fs.statfsSync }) {
  let state = { active: false, error: "", current: 0, total: 15 };
  let cancelled = false;
  let currentJob = null;
  const probes = new Map();
  function compatible() {
    return getBackends().filter(b => {
      let stamp; try { const st = fs.statSync(b.path); stamp = `${b.path}:${st.size}:${st.mtimeMs}`; } catch { return false; }
      if (!probes.has(stamp)) probes.set(stamp, probe(b.path));
      return probes.get(stamp);
    });
  }
  function status() {
    const hardware = assess(getSpecs());
    const backends = hardware.eligible ? compatible() : [];
    const ready = installed(dir);
    return { hardware, backendReady: backends.length > 0, backendReason: !hardware.eligible ? "ยังไม่ตรวจ backend เนื่องจากหน่วยความจำไม่พอ" : backends.length ? "พบ llama.cpp ที่รู้จัก kimi-k3 (text-only)" : "ไม่พบ llama.cpp ที่ยืนยันว่ารองรับ kimi-k3 — อัปเดต text backend ก่อนติดตั้ง", installed: ready, filename: FIRST, ...state };
  }
  async function install() {
    if (state.active) throw new Error("Kimi installation already running");
    if (!assess(getSpecs()).eligible) throw new Error(assess(getSpecs()).reason);
    if (!compatible().length) throw new Error("A verified kimi-k3 llama.cpp text backend is required");
    if (getActiveCount()) throw new Error("Wait for other model downloads to finish first");
    state = { active: true, error: "", current: 0, total: 15 }; cancelled = false;
    try {
      // Reuse the pinned revision on retry, so shards cannot mix revisions.
      const manifest = readManifest(dir) || makeManifest(await fetchDetail());
      fs.mkdirSync(dir, { recursive: true });
      const missing = manifest.files.filter(f => !completeFile(dir,f));
      const stat = statfs(dir);
      if (Number(stat.bavail) * Number(stat.bsize) < missing.reduce((n,f) => n + f.size,0) + 20e9) throw new Error("Insufficient disk space: missing Kimi shards plus 20 GB headroom required");
      fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null,2));
      // One shard at a time avoids starting fifteen giant downloads in parallel.
      void (async () => {
        try {
          for (const [i,f] of manifest.files.entries()) {
            if (cancelled) throw new Error("Kimi installation cancelled");
            state.current = i + 1;
            if (completeFile(dir,f)) continue;
            currentJob = startDownload(f.url, f.name, dir, "llm");
            while (currentJob.active) await new Promise(r => setTimeout(r,250));
            if (cancelled || currentJob.error) throw new Error(currentJob.error || "Kimi installation cancelled");
            if (!completeFile(dir,f)) { fs.unlinkSync(path.join(dir, f.name)); throw new Error(`Kimi shard verification failed: ${f.name}`); }
          }
        } catch (e) { state.error = e.message; }
        finally { state.active = false; currentJob = null; }
      })();
      return { ok: true, ...status() };
    } catch(e) { state.active = false; state.error = e.message; throw e; }
  }
  function cancel() { cancelled = true; if (currentJob?.active) cancelDownload(currentJob.filename); return { ok:true }; }
  function assertLoad(filename, binary) {
    if (!isKimi(filename)) return;
    if (filename !== FIRST) throw new Error("Load Kimi K3 using its first shard only");
    if (state.active || !installed(dir)) throw new Error("Install all 15 verified Kimi K3 shards before loading");
    if (!assess(getSpecs()).eligible) throw new Error(assess(getSpecs()).reason);
    if (binary && !compatible().some(b => b.path === binary)) throw new Error("Selected text backend does not support kimi-k3");
  }
  function remove() {
    if (state.active) throw new Error("Cancel Kimi installation before deleting its shards");
    const manifest = readManifest(dir);
    if (!manifest) throw new Error("Kimi install manifest is missing; cannot safely delete bundle");
    for (const f of manifest.files) {
      for (const suffix of ["", ".part"]) {
        try { fs.unlinkSync(path.join(dir, f.name + suffix)); } catch(e) { if (e.code !== "ENOENT") throw e; }
      }
    }
    fs.unlinkSync(path.join(dir, MANIFEST));
  }
  return { status, install, cancel, assertLoad, compatible, remove };
}
module.exports = { REPO, QUANT, FIRST, MANIFEST, isKimi, assess, makeManifest, readManifest, completeFile, installed, bundleBytes, probeBackend, createManager };
