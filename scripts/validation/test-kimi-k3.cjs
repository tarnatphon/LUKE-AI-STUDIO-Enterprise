"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const kimi = require("../server/kimi-k3.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-kimi-test-"));
const binary = path.join(root, "llama-server"); fs.writeFileSync(binary, "fixture");
const detail = { sha: "a".repeat(40), siblings: Array.from({length:15}, (_,i) => ({ rfilename: `UD-IQ1_S/Kimi-K3-UD-IQ1_S-${String(i+1).padStart(5,"0")}-of-00015.gguf`, size:4 })) };
async function main() {
  assert.equal(kimi.assess({}).eligible, false);
  assert.equal(kimi.assess({ ram_total_gb:64, gpu_vram_gb:600 }).eligible, false, "CPU-first cannot use VRAM as RAM");
  assert.equal(kimi.assess({ ram_total_gb:512, gpu_vram_gb:512, cpu_name:"Apple M4" }).eligible, false, "unified memory is not double counted");
  assert.equal(kimi.assess({ ram_total_gb:1024, cpu_name:"Apple M4" }).eligible, true);
  assert.equal(kimi.makeManifest(detail).files.length, 15);
  assert.throws(() => kimi.makeManifest({...detail, sha:"main"}), /revision/);
  assert.throws(() => kimi.makeManifest({...detail, siblings:detail.siblings.slice(1)}), /all 15/);
  assert.throws(() => kimi.makeManifest({...detail, siblings:[...detail.siblings.slice(0,14),detail.siblings[0]]}), /all 15/);
  assert.equal(kimi.probeBackend(binary, (_bin,args) => {
    assert.equal(fs.readFileSync(args[1]).toString("ascii",0,4), "GGUF");
    return { stderr:"error loading model: key not found in model: kimi-k3.context_length" };
  }), true);
  assert.equal(kimi.probeBackend(binary, () => ({stderr:"unknown model architecture: kimi-k3"})), false);
  assert.equal(kimi.probeBackend(binary, () => ({stderr:"kimi-k3 supported soon"})), false);
  let calls = 0; let compatible = true; let specs = { ram_total_gb:16 };
  const dir = path.join(root, "models");
  const manager = kimi.createManager({dir, getSpecs:()=>specs, getBackends:()=>[{path:binary}], probe:()=>compatible,
    fetchDetail:async()=>detail, getActiveCount:()=>0, cancelDownload:()=>{}, statfs:()=>({bavail:1e15,bsize:1}),
    startDownload:(url,name,target)=>{ calls++; assert.match(url,/resolve\/a{40}\/UD-IQ1_S\//); fs.writeFileSync(path.join(target,name),"GGUF"); return {active:false}; }
  });
  await assert.rejects(manager.install(), /RAM/); assert.equal(calls,0);
  specs = { ram_total_gb:1024 };
  await manager.install();
  assert.equal(calls,15); assert.equal(manager.status().installed,true);
  manager.assertLoad(kimi.FIRST,binary);
  assert.throws(()=>manager.assertLoad("Kimi-K3-UD-IQ1_S-00002-of-00015.gguf",binary),/first shard/);
  await manager.install(); assert.equal(calls,15,"completed shards are skipped on retry");
  fs.writeFileSync(path.join(dir,kimi.FIRST),"BAD!");
  assert.equal(manager.status().installed,false);
  assert.throws(()=>manager.assertLoad(kimi.FIRST,binary),/all 15/);
  await manager.install(); assert.equal(calls,16); assert.equal(manager.status().installed,true);
  manager.remove(); assert.equal(manager.status().installed,false);
  assert.ok(!fs.existsSync(path.join(dir,kimi.MANIFEST)));
  const noBackend = kimi.createManager({dir,getSpecs:()=>specs,getBackends:()=>[{path:binary}],probe:()=>false,getActiveCount:()=>0});
  await assert.rejects(noBackend.install(), /verified/);
  const noDisk = kimi.createManager({dir,getSpecs:()=>specs,getBackends:()=>[{path:binary}],probe:()=>true,getActiveCount:()=>0,fetchDetail:async()=>detail,statfs:()=>({bavail:1,bsize:1})});
  await assert.rejects(noDisk.install(), /disk space/);
  assert.equal(calls,16);
  const cancelDir = path.join(root, "cancel-models");
  const pending = { active:true, filename:kimi.FIRST };
  const cancelManager = kimi.createManager({dir:cancelDir,getSpecs:()=>specs,getBackends:()=>[{path:binary}],probe:()=>true,getActiveCount:()=>0,fetchDetail:async()=>detail,statfs:()=>({bavail:1e15,bsize:1}),startDownload:()=>pending,cancelDownload:()=>{pending.active=false; pending.error="cancelled";}});
  await cancelManager.install(); assert.equal(cancelManager.status().active,true);
  cancelManager.cancel(); await new Promise(r=>setTimeout(r,300));
  assert.equal(cancelManager.status().active,false); assert.match(cancelManager.status().error,/cancelled/);
  assert.equal(cancelManager.status().installed,false);
  console.log("PASS: Kimi hardware, manifest, backend probe, 15-shard install/retry, load guards and bundle deletion");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
