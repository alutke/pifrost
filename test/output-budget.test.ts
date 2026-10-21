import assert from "node:assert/strict";
import test from "node:test";
import { clampOutputTokenFields, operationalOutputCap, resolveOutputBudget, OutputBudgetCapacityError } from "../output-budget.ts";

test("Release B: reproduces captured 712434 overshoot across native fallback candidates", () => {
  const budget=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:712434,advertisedTokens:1_048_576,explicit:true,
    members:[
      {reference:"OpenCode Go/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"bifrost-datasheet"},
      {reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"bifrost-datasheet"},
      {reference:"deepseek/deepseek-v4-flash",maxTokens:500000,source:"live"},
    ],environment:{},
  });
  assert.equal(budget.effectiveTokens,393216);
  assert.equal(budget.reduced,true);
  assert.equal(budget.explicit,true);
  assert.ok(budget.constraints.some(c=>c.source==="confirmed-endpoint" && c.tokens===393216));
  assert.deepEqual(clampOutputTokenFields({model:"omp-default",max_output_tokens:712434,tools:[{a:"private"}]},budget),
    {model:"omp-default",max_output_tokens:393216,tools:[{a:"private"}]});
  assert.equal(budget.verifiedMemberCount,2);
});
test("Release B: confirmed cap is exact-entitlement scoped; works without role cap", () => {
  const model="CommandCode GOAT/deepseek/deepseek-v4.1-flash";
  const d=resolveOutputBudget({logicalModel:model,requestedTokens:712434,advertisedTokens:712434,environment:{}});
  assert.equal(d.effectiveTokens,393216);
  assert.equal(d.limitingSource,"confirmed-endpoint");
  const unrelated=resolveOutputBudget({logicalModel:"OpenRouter/deepseek/deepseek-v4.1-flash",requestedTokens:712434,environment:{}});
  assert.equal(unrelated.effectiveTokens,712434);
});
test("Release B: weakest route member wins and physical headroom is respected", () => {
  const d=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:262144,
    contextWindow:700000,estimatedInputTokens:200000,
    members:[{reference:"provider/a",maxTokens:196608,source:"live"},
      {reference:"provider/b",maxTokens:131072,source:"live"}],
    environment:{PIFROST_OUTPUT_CAP_DEFAULT:"0"}});
  assert.equal(d.effectiveTokens,131072);
  assert.equal(d.memberCount,2);
  assert.throws(()=>resolveOutputBudget({logicalModel:"omp-task",requestedTokens:32768,
    members:[{reference:"provider/a",maxTokens:65536,source:"live",contextWindow:100000,estimatedInputTokens:100000}],
    environment:{PIFROST_OUTPUT_CAP_TASK:"0"}}),/no output headroom/u);
});
test("Release B: no artificial role defaults, and operator caps are opt-in only", () => {
  for(const role of ["default","task","advisor","plan","smol","tiny","commit","designer"])
    assert.equal(operationalOutputCap("omp-"+role,{}),undefined);
  assert.equal(operationalOutputCap("vendor/physical",{}),undefined);
  assert.equal(operationalOutputCap("omp-default",{PIFROST_OUTPUT_CAP_DEFAULT:"65536"}),65536);
  assert.equal(operationalOutputCap("omp-task",{PIFROST_OUTPUT_CAP_TOKENS:"32768",PIFROST_OUTPUT_CAP_TASK:"8192"}),8192);
  assert.equal(operationalOutputCap("omp-default",{PIFROST_OUTPUT_CAP_DEFAULT:"0"}),undefined);
  assert.throws(()=>operationalOutputCap("omp-default",{PIFROST_OUTPUT_CAP_DEFAULT:"bad"}),OutputBudgetCapacityError);
});
test("Release B: explicit overrides are visible, never erased by serializer", () => {
  const result=resolveOutputBudget({logicalModel:"omp-advisor",requestedTokens:65536,explicit:true,
    advertisedTokens:131072,environment:{PIFROST_OUTPUT_CAP_ADVISOR:"16384"}});
  assert.equal(result.effectiveTokens,16384);
  assert.equal(result.reduced,true);
  const original={max_output_tokens:10000,max_completion_tokens:45000,max_tokens:65536,arbitrary:{secret:"retain"}};
  const copy=clampOutputTokenFields(original,result);
  assert.deepEqual(copy,{max_output_tokens:10000,max_completion_tokens:16384,max_tokens:16384,arbitrary:{secret:"retain"}});
  assert.equal(original.max_tokens,65536);
});
test("Release B: absent caps are not invented; invalid/empty budgets fail clearly",()=>{
  assert.deepEqual(clampOutputTokenFields({model:"opaque"}, {effectiveTokens:32768}),{model:"opaque"});
  assert.throws(()=>resolveOutputBudget({logicalModel:"unknown/physical",environment:{}}),/No safe output limit/u);
  assert.throws(()=>resolveOutputBudget({logicalModel:"omp-default",requestedTokens:-10,environment:{}}),/Invalid requested/u);
});

test("Release B: only explicit, exact supplied context accounting constrains output",()=>{
  const result=resolveOutputBudget({
    logicalModel:"physical/model",requestedTokens:65536,advertisedTokens:131072,
    contextWindow:100000,estimatedInputTokens:80000,environment:{},
  });
  assert.equal(result.effectiveTokens,20000);
  assert.equal(result.limitingSource,"context-headroom");
});

test("Release B: high-capability OMP roles are not arbitrarily downgraded",()=>{
  const d=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:712434,advertisedTokens:712434,
    members:[{reference:"provider/unknown",maxTokens:712434,source:"fallback"}], environment:{}
  });
  assert.equal(d.effectiveTokens,712434);
  assert.equal(d.unknownMemberCount,1);
  assert.equal(d.reduced,false);
  assert.ok(!d.constraints.some(c=>c.source==="operational-cap"));
  assert.ok(!d.constraints.some(c=>c.source==="catalog-member"));
});
test("Release B: role override never raises confirmed physical limit",()=>{
  const d=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:712434,advertisedTokens:712434,
    members:[{reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"bifrost-datasheet"}],
    environment:{PIFROST_OUTPUT_CAP_DEFAULT:"9999999"},
  });
  assert.equal(d.effectiveTokens,393216);
  assert.equal(d.limitingSource,"confirmed-endpoint");
});
