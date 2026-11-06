"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const policy = require("../server/llm-load-policy.cjs");
const source = fs.readFileSync(path.join(__dirname,"../server/serve.cjs"),"utf8");
async function main() {
  const snapshot={releasedBy:"governor",releasedAt:1000};
  assert.equal(policy.delayGovernorRestore(snapshot,{level:"ok"},2000),true);
  assert.equal(policy.delayGovernorRestore(snapshot,{level:"critical"},60000),true);
  assert.equal(policy.delayGovernorRestore(snapshot,{level:"ok"},60000),false);
  assert.equal(policy.delayGovernorRestore({releasedBy:"arena"},{level:"critical"},60000),false);
  const begin = source.indexOf("async function releaseEngine(");
  const end = source.indexOf("\n/**",begin);
  let busy = true, kills = 0, queued;
  const config={model:"qwen.gguf",contextSize:2048,gpuLayers:0,cacheTypeK:"f16",cacheTypeV:"f16",flashAttn:false,batchSize:64,ubatchSize:64,enableThinking:false};
  const context = vm.createContext({llmLoadPolicy:policy,llmSettings:config,releasedMainModel:null,
    modelName:v=>v,governedEngines:()=>[{id:"text",resident:true,busy}],
    killLlm:async()=>{kills++;},runExclusiveLlmOperation:fn=>new Promise(resolve=>{queued=()=>Promise.resolve(fn()).then(resolve);}), Date});
  vm.runInContext(source.slice(begin,end),context);
  // A sweep planned earlier must recheck busy state *after* waiting for the lock.
  const release=context.releaseEngine("text",{reason:"pressure"});
  await queued(); assert.equal(await release,false); assert.equal(kills,0); assert.equal(context.releasedMainModel,null);
  busy=false;
  assert.equal(await context.releaseEngine("text",{reason:"pressure"},{insideLlmLock:true}),true);
  assert.equal(kills,1); assert.equal(context.releasedMainModel.cacheTypeV,"f16");
  assert.equal(context.releasedMainModel.batchSize,64); assert.equal(context.releasedMainModel.gpuLayers,0);
  const profilesStart=source.indexOf("function buildLlmLoadProfiles(");
  const profilesEnd=source.indexOf("\nasync function startLlm",profilesStart);
  vm.runInContext(source.slice(profilesStart,profilesEnd),vm.createContext({kimiK3:{isKimi:()=>false},llmLoadPolicy:policy}));
  const build=Function("kimiK3","llmLoadPolicy",source.slice(profilesStart,profilesEnd)+";return buildLlmLoadProfiles;")({isKimi:()=>false},policy);
  const recovered=build({model:"qwen.gguf",contextSize:8192,__recoveryProfile:"safe-cpu",__recoveryContext:2048},{key:"metal"});
  assert.equal(recovered.length,1); assert.equal(recovered[0].gpuLayers,0); assert.equal(recovered[0].contextSize,2048); assert.equal(recovered[0].batchSize,64);
  assert.ok(source.includes("Boolean(llmLoadProgress) || Boolean(llmProc && !llmReady)"));
  assert.ok(!source.includes('"-lv", "1"'),"normal backend load progress is no longer suppressed");
  assert.ok(source.includes("...llmLoadPolicy.restoreSettings(snapshot)"));
  assert.ok(source.includes('recoveryProfile: profile.name === "safe-cpu" ? "safe-cpu" : null'));
  assert.ok(source.includes('Math.max(32, Math.min(2048, effectiveBatchSize))'));
  console.log("PASS: governor load/lock race, full restore snapshot, persistent CPU recovery, real small batches and visible logs");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
