"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cpuIsolationArgs, safeProfile, waitForReady } = require("../server/llm-load-policy.cjs");
async function main() {
  const help = "--device --no-kv-offload --no-op-offload";
  assert.deepEqual(cpuIsolationArgs({platform:"darwin",gpuLayers:0,help}), ["--device","none","--no-kv-offload","--no-op-offload"]);
  assert.deepEqual(cpuIsolationArgs({platform:"darwin",gpuLayers:-1,help:""}), []);
  assert.deepEqual(cpuIsolationArgs({platform:"linux",gpuLayers:0,help:""}), []);
  assert.throws(()=>cpuIsolationArgs({platform:"darwin",gpuLayers:0,help:"--device"}), /newer llama.cpp/);
  assert.equal(safeProfile(2048).cacheTypeV,"f16");
  assert.equal(safeProfile(2048).flashAttn,false);
  let time=0, ready=false, checks=0;
  const common = {now:()=>time,sleep:async ms=>{time+=ms;},isAlive:()=>true,markReady:()=>{ready=true;}};
  await waitForReady({...common,timeoutMs:600000,checkReady:async()=>{time+=1000; return ++checks===150;}});
  assert.ok(ready); assert.ok(time>180000,"CPU can become ready after old three-minute cutoff");
  time=0; ready=false;
  await assert.rejects(waitForReady({...common,timeoutMs:600000,deadline:2000,checkReady:async()=>false,getTail:()=>"load_tensors: 42%"}), /2 seconds.*Last backend output:\nload_tensors: 42%/);
  assert.equal(time,2000); assert.equal(ready,false);
  await assert.rejects(waitForReady({...common,timeoutMs:600000,isAlive:()=>false,checkReady:async()=>{throw Error("must not poll");},getError:()=>"Metal crashed"}), /Metal crashed/);
  const serve=fs.readFileSync(path.join(__dirname,"../server/serve.cjs"),"utf8");
  assert.ok(serve.includes('"--alias", filename'),"readiness model ID is deterministic");
  assert.ok(serve.includes('llmSettings.flashAttn ? "on" : "off"'),"disabled flash attention is explicit, not backend auto");
  assert.ok(serve.includes('llmLoadPolicy.safeProfile(safeContext)'));
  console.log("PASS: CPU isolation, F16 fallback, explicit flash/alias, wall-clock readiness, exit and diagnostic preservation");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
