import assert from "node:assert/strict";
import test from "node:test";
import { proposeAdaptiveContextSettings, formatAdaptiveContextPlan } from "../adaptive-context-settings.mjs";
import { adaptiveContextMode, planAdaptiveContextMaintenance } from "../adaptive-context-policy.mjs";

const value = value => ({ status:"ok", value });
const base = {
 "compaction.enabled":value(true),
 "compaction.midTurnEnabled":value(true),
 "compaction.autoContinue":value(true),
 "compaction.modelThresholdsEnabled":value(true),
 "compaction.modelThresholds":value({ "other/strong": "90%" }),
};

test("30B: 615K/1M is over adaptive idle budget; 128K windows use fractional limit", () => {
  const p = planAdaptiveContextMaintenance(614978,1000000);
  assert.equal(p.shouldCompact,true);
  assert.equal(p.threshold,120000);
  assert.equal(planAdaptiveContextMaintenance(50000,128000).reason,"below-target");
  assert.equal(planAdaptiveContextMaintenance(85000,128000).threshold,83200);
  assert.equal(planAdaptiveContextMaintenance(85000,128000).reason,"adaptive-budget");
  assert.equal(planAdaptiveContextMaintenance(526832,1000000).reason,"adaptive-budget");
  assert.equal(planAdaptiveContextMaintenance(85000,128000,{window:128000,afterTokens:84000}).reason,"cooldown");
  assert.equal(planAdaptiveContextMaintenance(118000,128000,{window:128000,afterTokens:84000}).reason,"adaptive-budget");
  assert.equal(planAdaptiveContextMaintenance(100000,100000).reason,"unverified-or-overflow");
});
test("30B: context mode is default-on but unknown explicit settings are fail-safe", () => {
  assert.equal(adaptiveContextMode({}),"adaptive");
  assert.equal(adaptiveContextMode({PIFROST_CONTEXT_MODE:"native"}),"native");
  assert.equal(adaptiveContextMode({PIFROST_CONTEXT_MODE:"off"}),"off");
  assert.equal(adaptiveContextMode({PIFROST_CONTEXT_MODE:"typo"}),"native");
});
test("30B: threshold provisioning is additive and uses safe percentage when window unverified", () => {
  const b=JSON.stringify(base);
  const r=proposeAdaptiveContextSettings(base);
  assert.equal(r.status,"proposed");
  assert.equal(r.merged["other/strong"],"90%");
  assert.equal(r.merged["bifrost/omp-default"],"65%");
  assert.equal(r.merged["bifrost/omp-advisor"],"65%");
  assert.equal(JSON.stringify(base),b);
  assert.match(formatAdaptiveContextPlan(r),/native context policy/);
});
test("30B: known high-window aliases receive fixed thresholds for main and advisor", () => {
  const r=proposeAdaptiveContextSettings(base,[
    {id:"omp-default",contextWindow:1000000},
    {id:"omp-advisor",contextWindow:526832},
    {id:"omp-plan",contextWindow:128000},
  ]);
  assert.equal(r.merged["bifrost/omp-default"],"f120000");
  assert.equal(r.merged["bifrost/omp-advisor"],"f64000");
  assert.equal(r.merged["bifrost/omp-plan"],"65%");
});
test("30B: preserve exact and wildcard user threshold rules and disabled compaction", () => {
  const custom={...base,
    "compaction.modelThresholds":value({"bifrost/omp-*":"92%","bifrost/omp-default":"f500000","other/strong":"90%"})};
  const r=proposeAdaptiveContextSettings(custom,[{id:"omp-default",contextWindow:1000000}]);
  assert.equal(r.status,"unchanged");
  assert.equal(r.merged["bifrost/omp-default"],"f500000");
  assert.equal(r.changes.length,0);
  for(const key of ["compaction.enabled","compaction.midTurnEnabled","compaction.autoContinue","compaction.modelThresholdsEnabled"]){
    const disabled={...base,[key]:value(false)};
    const plan=proposeAdaptiveContextSettings(disabled);
    assert.equal(plan.changes.length,0,key);
  }
  assert.equal(proposeAdaptiveContextSettings(base,[],"native").status,"disabled");
  assert.equal(proposeAdaptiveContextSettings({...base,"compaction.modelThresholds":{status:"error"}}).status,"unavailable");
});
test("30B: no ungrounded proof of compaction for giant advisor requests with shared parent history",()=>{
 const r=proposeAdaptiveContextSettings(base,[{id:"omp-advisor",contextWindow:1000000}]);
 assert.equal(r.merged["bifrost/omp-advisor"],"f64000");
 assert.equal(r.changes.find(x=>x.selector==="bifrost/omp-advisor").evidence,"catalogue-window-hint");
});

test("30B: pinned OMP CLI accepts the f-token and percentage model thresholds", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const dir = mkdtempSync(resolve(tmpdir(),"pifrost-30b-omp-"));
  const exe = resolve(import.meta.dirname,"../node_modules/.bin/omp");
  const env = {...process.env,HOME:dir};
  try {
    const payload = JSON.stringify({"bifrost/omp-default":"f120000","bifrost/omp-advisor":"f64000","bifrost/omp-plan":"65%"});
    const set = spawnSync(exe,["config","set","compaction.modelThresholds",payload],{env,encoding:"utf8",timeout:15000});
    assert.equal(set.status,0,set.stdout+" "+set.stderr);
    const get = spawnSync(exe,["config","get","compaction.modelThresholds","--json"],{env,encoding:"utf8",timeout:15000});
    assert.equal(get.status,0,get.stdout+" "+get.stderr);
    assert.match(get.stdout,/f120000/);
    assert.match(get.stdout,/f64000/);
    assert.match(get.stdout,/65%/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
