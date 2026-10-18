import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessOmpOrchestration, formatOmpOrchestration, ompVersionAtLeast,
  OMP_ORCHESTRATION_SETTING_IDS,
} from "../omp-orchestration-readiness.mjs";

const value = x => ({ status:"ok", value:x });
const modelRoles={default:"bifrost/omp-default",smol:"bifrost/omp-smol",
  advisor:"bifrost/omp-advisor",judge:"bifrost-judge/jev-latest"};
const baseSettings={
  "prewalk.enabled":value(false),
  "prewalk.auto":value("suggest"),
  "prewalk.autoTarget":value("@smol"),
  modelRoles:value(modelRoles),
  enabledModels:value(["bifrost/*","bifrost-judge/*","unrelated/*"]),
  "advisor.continueSeverity":value("concern"),
  "advisor.reviewMode":value("turn"),
};
const catalog={models:[{id:"omp-default"},{id:"omp-smol"}]};
const selectedJudge={selector:"bifrost-judge/jev-latest"};

test("version gates are exact and fail closed on unparseable host", () => {
  assert.equal(ompVersionAtLeast("18.11.2","18.11.3"),false);
  assert.equal(ompVersionAtLeast("18.11.3","18.11.3"),true);
  assert.equal(ompVersionAtLeast("v18.12.1","18.11.3"),true);
  assert.equal(ompVersionAtLeast("opaque-development-version","18.11.3"),undefined);
});

test("suggest readiness validates local target and native judge without inference", () => {
  const result=assessOmpOrchestration({settings:baseSettings,catalog,hostVersion:"18.12.1",selectedJudge});
  assert.equal(result.status,"locally-compatible");
  assert.equal(result.auto,"suggest");
  assert.equal(result.target,"bifrost/omp-smol");
  assert.deepEqual(result.checks.map(c=>c.status),["ok","ok","ok","ok","ok"]);
  assert.match(formatOmpOrchestration(result),/without switching/);
  assert.ok(result.notes.some(t=>t.includes("No settings")));
});

test("auto on is informational, does not change settings or turn on prewalk", () => {
  const original=JSON.stringify(baseSettings);
  const copy={...baseSettings,"prewalk.auto":value("on")};
  const result=assessOmpOrchestration({settings:copy,catalog,hostVersion:"18.12.1",selectedJudge});
  assert.equal(result.status,"locally-compatible");
  assert.match(result.checks[0].message,/0\.70/);
  assert.equal(JSON.stringify(baseSettings),original);
  assert.equal(copy["prewalk.enabled"].value,false);
});

test("independent unconditional prewalk and stale cache produce warnings",()=>{
  const r=assessOmpOrchestration({
    settings:{...baseSettings,"prewalk.enabled":value(true)},
    catalog,stale:true,hostVersion:"18.12.1",selectedJudge,
  });
  assert.equal(r.status,"attention");
  assert.equal(r.checks.find(c=>c.id==="unconditional-prewalk").status,"warn");
  assert.equal(r.checks.find(c=>c.id==="handoff-target").status,"warn");
  assert.match(formatOmpOrchestration(r),/pifrost models refresh --force/);
});

test("unavailable or ambiguous roles must not be silently marked ready",()=>{
  const noConfig=assessOmpOrchestration({hostVersion:"18.12.1"});
  assert.equal(noConfig.status,"unverified");
  assert.equal(noConfig.checks.find(c=>c.id==="auto-prewalk").status,"unknown");
  const external=assessOmpOrchestration({
    settings:{...baseSettings,modelRoles:value({...modelRoles,judge:"openai/gpt-6-luna-decisions"}),
      "prewalk.autoTarget":value("@missing")},catalog,hostVersion:"18.12.1",selectedJudge,
  });
  assert.equal(external.status,"unverified");
  assert.equal(external.checks.find(c=>c.id==="handoff-target").status,"unknown");
  assert.equal(external.checks.find(c=>c.id==="auto-prewalk").status,"unknown");
});

test("a hidden native judge or missing logical alias is visibly not ready",()=>{
  const hidden=assessOmpOrchestration({
    settings:{...baseSettings,enabledModels:value(["bifrost/*"])},
    catalog,hostVersion:"18.12.1",selectedJudge,
  });
  assert.equal(hidden.checks.find(c=>c.id==="auto-prewalk").status,"ok");
  assert.equal(hidden.checks.find(c=>c.id==="handoff-target").status,"ok");
  const missing=assessOmpOrchestration({
    settings:baseSettings,catalog:{models:[]},hostVersion:"18.12.1",selectedJudge,
  });
  assert.equal(missing.checks.find(c=>c.id==="handoff-target").status,"warn");
});

test("seance is a version/readiness check, not session access",()=>{
  const old=assessOmpOrchestration({
    settings:baseSettings,catalog,hostVersion:"18.10.4",selectedJudge,
  });
  assert.equal(old.checks.find(c=>c.id==="seance").status,"warn");
  const unsupported=assessOmpOrchestration({
    settings:baseSettings,catalog,hostVersion:undefined,selectedJudge,
  });
  assert.equal(unsupported.checks.find(c=>c.id==="seance").status,"unknown");
  const native=readFileSync(new URL("../native.ts",import.meta.url),"utf8");
  assert.match(native,/if \(ctx\.agent\.kind !== "main"\) return;/);
  assert.match(native,/refreshProvider\(PROVIDER_ID, "online"\)/);
  assert.deepEqual(OMP_ORCHESTRATION_SETTING_IDS.includes("modelRoles"),true);
});

test("advisor severity is read-only, exposes resumption and cost impacts",()=>{
  const blocker=assessOmpOrchestration({
    settings:{...baseSettings,"advisor.continueSeverity":value("blocker")},
    catalog,hostVersion:"18.12.1",selectedJudge,
  });
  assert.match(blocker.checks.find(c=>c.id==="advisor").message,/Only blockers/);
  assert.match(blocker.checks.find(c=>c.id==="advisor").message,/Bifrost cost/);
  const unknown=assessOmpOrchestration({
    settings:{...baseSettings,"advisor.continueSeverity":{status:"error"}},
    catalog,hostVersion:"18.12.1",selectedJudge,
  });
  assert.equal(unknown.checks.find(c=>c.id==="advisor").status,"unknown");
  assert.doesNotMatch(JSON.stringify(unknown),/Bearer|sk-bf-/);
});

test("readiness CLI is registered read-only and JSON/verbose are exclusive",async()=>{
  const {commandCatalog,validateCliInvocation}=await import("../cli-command-schema.mjs");
  assert.equal(commandCatalog.get("omp readiness")?.operation,"read-only");
  assert.ok(commandCatalog.get("omp readiness")?.options.includes("json"));
  assert.throws(()=>validateCliInvocation("omp readiness",[],{json:true,verbose:true}),/separate/);
});

test("complex OMP chat scope is unverified rather than falsely denied",()=>{
 const scoped=assessOmpOrchestration({
   settings:{...baseSettings,enabledModels:value(["{bifrost,openai}/*"])},
   catalog,hostVersion:"18.12.1",selectedJudge,
 });
 assert.equal(scoped.checks.find(c=>c.id==="auto-prewalk").status,"ok");
 assert.equal(scoped.checks.find(c=>c.id==="handoff-target").status,"unknown");
 assert.equal(scoped.status,"unverified");
});
test("native judgment selector remains eligible independent of chat scope",()=>{
 const scoped=assessOmpOrchestration({
   settings:{...baseSettings,enabledModels:value(["bifrost/omp-*"])},
   catalog,hostVersion:"18.12.1",selectedJudge,
 });
 assert.equal(scoped.checks.find(c=>c.id==="auto-prewalk").status,"ok");
 assert.equal(scoped.status,"locally-compatible");
});
