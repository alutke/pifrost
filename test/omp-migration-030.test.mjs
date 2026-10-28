import test from "node:test";
import assert from "node:assert/strict";
import { planLegacyOmpCleanup } from "../omp-legacy-migration.mjs";

test("legacy Pifrost roles are removed without changing custom roles", () => {
  const plan = planLegacyOmpCleanup({
    modelRoles:{default:"bifrost/omp-default",smol:"bifrost/omp-smol",
      judge:"typesafe/jev-latest",plan:"custom/my-plan"},
    enabledModels:["bifrost/*","openai-codex/*"],
    modelProviderOrder:["bifrost","openai-codex"],
  });
  assert.equal(plan.removedRoles,2);
  assert.deepEqual(plan.changes.find(x=>x.key==="modelRoles").after,
    {judge:"typesafe/jev-latest",plan:"custom/my-plan"});
  assert.deepEqual(plan.changes.find(x=>x.key==="enabledModels").after,["openai-codex/*"]);
  assert.deepEqual(plan.changes.find(x=>x.key==="modelProviderOrder").after,["openai-codex"]);
});
test("migration resets lone historical Pifrost defaults", () => {
 const plan=planLegacyOmpCleanup({
  modelRoles:{default:"bifrost/omp-default"},
  enabledModels:["bifrost/*"],modelProviderOrder:["bifrost"],
 });
 assert.deepEqual(plan.changes.map(x=>[x.key,x.method]),
   [["modelRoles","reset"],["enabledModels","reset"],["modelProviderOrder","reset"]]);
});
test("migration does not infer ownership from a user's Bifrost selections", () => {
 const input={modelRoles:{default:"bifrost/my-model"},
   enabledModels:["bifrost/*"],modelProviderOrder:["bifrost"]};
 const plan=planLegacyOmpCleanup(input);
 assert.equal(plan.removedRoles,0);
 assert.deepEqual(plan.changes,[]);
 assert.deepEqual(input.modelRoles,{default:"bifrost/my-model"});
});
test("migration refuses missing/incompatible OMP values", () => {
 assert.throws(()=>planLegacyOmpCleanup({modelRoles:null,enabledModels:[],modelProviderOrder:[]}),/cannot safely read/u);
});
