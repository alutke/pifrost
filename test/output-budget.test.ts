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

test("R4-01 physical primary retains its 131K output despite weak 8K fallback",()=>{
  const members=[
    {reference:"provider/primary",maxTokens:131072,source:"live"},
    {reference:"provider/fallback",maxTokens:8192,source:"live"},
  ];
  const primary=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:131072,
    advertisedTokens:131072,members,memberPolicy:"primary",environment:{}});
  assert.equal(primary.effectiveTokens,131072);
  assert.equal(primary.memberCount,2);
  assert.equal(primary.verifiedMemberCount,2);
  assert.ok(!primary.constraints.some(item=>item.tokens===8192));
  // The second physical target has its own limit, if it is dispatched separately.
  const fallback=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:131072,
    members:[members[1]!],memberPolicy:"primary",environment:{}});
  assert.equal(fallback.effectiveTokens,8192);
  assert.equal(fallback.limitingSource,"live-member");
});
test("R4-02 opaque logical Bifrost route treats member capacities as diagnostic only",()=>{
  const budget=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:131072,
    advertisedTokens:131072,members:[
      {reference:"provider/first",maxTokens:131072,source:"live"},
      {reference:"provider/fallback",maxTokens:8192,source:"live"},
    ],memberPolicy:"diagnostic",environment:{}});
  assert.equal(budget.effectiveTokens,131072);
  assert.equal(budget.memberCount,2);
  assert.equal(budget.verifiedMemberCount,2);
  assert.ok(!budget.constraints.some(c=>["catalog-member","live-member","confirmed-endpoint"].includes(c.source)));
});
test("R4-03 exact confirmed physical primary cap still applies and operator cap is never bypassed",()=>{
  const chain=[
    {reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"bifrost-datasheet"},
    {reference:"provider/limited-fallback",maxTokens:8192,source:"live"},
  ];
  const full=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:712434,
    members:chain,memberPolicy:"primary",environment:{}});
  assert.equal(full.effectiveTokens,393216);
  assert.equal(full.limitingSource,"confirmed-endpoint");
  const overridden=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:712434,
    members:chain,memberPolicy:"primary",environment:{PIFROST_OUTPUT_CAP_DEFAULT:"16384"}});
  assert.equal(overridden.effectiveTokens,16384);
  assert.equal(overridden.limitingSource,"operational-cap");
});
test("R4-04 confirmed fallback limit may be known but must not be copied to primary",()=>{
  const chain=[
    {reference:"OpenCode Go/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"live"},
    {reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"live"},
  ];
  const result=resolveOutputBudget({logicalModel:"omp-default",requestedTokens:712434,
    members:chain,memberPolicy:"primary",environment:{}});
  assert.equal(result.effectiveTokens,712434);
  assert.equal(result.memberCount,2);
  assert.ok(!result.constraints.some(c=>c.tokens===393216));
});

test("P0: opaque Bifrost route enforces verified endpoint ceilings across affinity and fallbacks", () => {
  const members = [
    {reference:"OpenCode Go/deepseek-v4.1-flash",maxTokens:670395,source:"live"},
    {reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:670395,source:"bifrost-datasheet"},
    {reference:"deepseek/deepseek-v4-flash",maxTokens:670395,source:"fallback"},
  ];
  const decision=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:670395,advertisedTokens:670395,
    members,memberPolicy:"gateway",environment:{},
  });
  assert.equal(decision.effectiveTokens,393216);
  assert.equal(decision.limitingSource,"confirmed-endpoint");
  assert.equal(decision.verifiedMemberCount,2);
  assert.deepEqual(clampOutputTokenFields({model:"omp-default",max_output_tokens:670395},decision),
    {model:"omp-default",max_output_tokens:393216});
});

test("P0: gateway mode ignores speculative low fallbacks and leaves unrelated models capable", () => {
  const decision=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:131072,advertisedTokens:131072,
    members:[
      {reference:"provider/primary",maxTokens:131072,source:"live"},
      {reference:"provider/fallback",maxTokens:8192,source:"bifrost-datasheet"},
    ],memberPolicy:"gateway",environment:{},
  });
  assert.equal(decision.effectiveTokens,131072);
  assert.ok(!decision.constraints.some(c=>c.source==="live-member"||c.source==="catalog-member"));
});

test("P0: operator caps and explicit overrides never bypass the gateway's confirmed maximum", () => {
  const decision=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:670395,explicit:true,
    members:[{reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:670395,source:"live"}],
    memberPolicy:"gateway",environment:{PIFROST_OUTPUT_CAP_DEFAULT:"999999"},
  });
  assert.equal(decision.effectiveTokens,393216);
  assert.equal(decision.reduced,true);
  assert.equal(decision.explicit,true);
});
