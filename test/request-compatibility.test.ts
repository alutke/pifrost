import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { confirmedProviderOutputCeiling, CONFIRMED_ENDPOINT_CONTRACTS } from "../endpoint-contracts.ts";
import { physicalPolicyIdentity, physicalRequestContractKey, pifrostDirectMaxTokens, normalizePifrostReasoningOptions } from "../request-compatibility.ts";
import { createPifrostMemberModelSpec } from "../multi-protocol-routing.ts";
import { planDynamicRouteAttempts, type DynamicRouteMemberProfile, type DynamicRouteProfile } from "../dynamic-routing.ts";

/** P1 coverage is intentionally provider-agnostic. Every provider-qualified
 * namespace receives a physical policy identity, including unknown gateways. */
const providers = [
  ["CommandCode GOAT", "commandcode"], ["command-code-goat", "commandcode"],
  ["opencode-go", "opencode-go"], ["OpenCode Go", "opencode-go"],
  ["OpenRouter", "openrouter"], ["DeepSeek", "deepseek"], ["Xiaomi MIMO", "xiaomi"],
  ["OpenAI", "openai"], ["OpenAI-Codex", "openai-codex"], ["Azure OpenAI", "azure-openai"],
  ["NVIDIA", "nvidia"], ["Anthropic", "anthropic"], ["Google", "google"],
  ["Groq", "groq"], ["Cerebras", "cerebras"], ["GitHub Copilot", "github-copilot"],
  ["Custom Provider", "custom-provider"],
] as const;
test("every qualified provider retains Bifrost wire identity but receives own OMP policy identity", () => {
  for (const [name, expected] of providers) {
    const full = name + "/vendor/model-v1:free";
    assert.deepEqual(physicalPolicyIdentity(full), { id: "vendor/model-v1:free", provider: expected, requestModelId: full });
  }
  assert.equal(physicalPolicyIdentity("model-without-provider"), undefined);
  assert.equal(physicalPolicyIdentity("provider/"), undefined);
});

test("evidence-based provider ceilings never leak across entitlements", () => {
  assert.ok(CONFIRMED_ENDPOINT_CONTRACTS.every(c => c.evidence.length > 20));
  assert.equal(confirmedProviderOutputCeiling("CommandCode GOAT/inclusionai/ling-3.1-flash:free"), 32768);
  for (const name of ["OpenRouter/inclusionai/ling-3.1-flash:free",
    "CommandCode GOAT/inclusionai/ling-3.1-flash",
    "CommandCode GOAT/inclusionai/ling-3.2-flash:free"]) {
    assert.equal(confirmedProviderOutputCeiling(name), undefined, name);
  }
});

function fakeModel(provider: string, overrides: Record<string, unknown> = {}): Model {
  return { id: "vendor/model-v1", provider, api: "openai-responses",
    identity: { class: "deepseek", family: "v4", revision: "1" },
    reasoning: true, thinking: { mode: "effort", efforts: ["low", "high"], effortMap: {low:"low",high:"high"} },
    compat: { requiresReasoningContentForAllAssistantTurns: true, reasoningContentField: "reasoning_content",
      supportsReasoningSummary: true, supportsToolChoice: true, ...overrides },
  } as unknown as Model;
}

test("physical wire key rejects all provider changes even for same model family", () => {
  const base = physicalRequestContractKey(fakeModel("commandcode"));
  for (const [, p] of providers) {
    if (p !== "commandcode") assert.notEqual(physicalRequestContractKey(fakeModel(p)), base, p);
  }
  assert.notEqual(physicalRequestContractKey(fakeModel("commandcode", { requiresReasoningContentForAllAssistantTurns:false })), base);
  assert.notEqual(physicalRequestContractKey(fakeModel("commandcode", { disableReasoningOnToolChoice:true })), base);
  assert.equal(physicalRequestContractKey(fakeModel("commandcode")), base);
});

function member(reference: string, protocol: "openai-completions"|"openai-responses"="openai-responses"): DynamicRouteMemberProfile {
  return { reference, resolvedModelId:reference, contextWindow:262144, maxTokens:32768,
    input:["text"], reasoning:true, supportsTools:true, protocols:[protocol],
    compat:{ supportsToolChoice:true, supportsReasoningWithTools:true } };
}
function route(...members:DynamicRouteMemberProfile[]): DynamicRouteProfile {
  return {id:"omp-default",mode:"context-aware",source:"bifrost-simple-rule",
    staticContextWindow:262144,advertisedContextWindow:262144,maxTokens:32768,
    members,bands:[{maxRequiredTokens:262144,members:members.map(m=>m.reference)}] };
}
const body = {model:"omp-default",messages:[{role:"user",content:"hello"}],max_completion_tokens:4096};
const estimate = { estimatedInputTokens:64, outputCapExplicit:false };

test("compatible provider members remain Bifrost-managed in one attempt", () => {
  const first=member("deepseek/a"), second=member("deepseek/b");
  const plan=planDynamicRouteAttempts(route(first,second),body,{
    ...estimate,compatibilityByMember:new Map([[first.reference,"same-wire"],[second.reference,"same-wire"]])});
  assert.equal(plan.attempts.length,1);
  assert.deepEqual(plan.attempts[0]?.fallbacks,["deepseek/b"]);
  assert.equal(plan.compatibilityBreaks,undefined);
});
test("incompatible same-protocol providers retry separately and keep Bifrost route order", () => {
  const members=[member("opencode-go/muse"),member("commandcode/deepseek"),member("openrouter/deepseek")];
  const plan=planDynamicRouteAttempts(route(...members),body,{...estimate,
    compatibilityByMember:new Map(members.map((m,i)=>[m.reference,"wire-"+i]))});
  assert.deepEqual(plan.attempts.map(a=>a.primary), members.map(m=>m.reference));
  assert.ok(plan.attempts.every(a=>a.fallbacks.length===0));
  assert.equal(plan.compatibilityBreaks?.length,2);
});
test("unknown physical policy fails closed rather than joining a foreign request", () => {
  const a=member("provider/a"),b=member("provider/b");
  const plan=planDynamicRouteAttempts(route(a,b),body,{...estimate,compatibilityByMember:new Map([[a.reference,"known"]])});
  assert.equal(plan.attempts.length,2);
});
test("protocol boundaries remain ordered with same-protocol compatible fallback",()=>{
  const a=member("provider/a"),b=member("provider/b","openai-completions"),c=member("provider/c","openai-completions");
  const plan=planDynamicRouteAttempts(route(a,b,c),body,{...estimate,
    compatibilityByMember:new Map([[a.reference,"x"],[b.reference,"y"],[c.reference,"y"]])});
  assert.deepEqual(plan.attempts.map(a=>[a.protocol,a.primary,a.fallbacks]),[
    ["openai-responses","provider/a",[]],["openai-completions","provider/b",["provider/c"]]]);
});

test("physical member spec does not inherit logical alias's incompatible request dialect",()=>{
  const logical={id:"omp-default",provider:"bifrost",api:"openai-completions",
    baseUrl:"http://bifrost/v1", cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
    compatConfig:{supportsDeveloperRole:true,reasoningContentField:"logical-only", extraBody:{unsafe:"logical"}}} as unknown as Model;
  const m=member("CommandCode GOAT/deepseek/deepseek-v4.1-flash");
  const spec=createPifrostMemberModelSpec(logical,m,"openai-completions",["deepseek/fallback"]);
  assert.equal(spec.provider,"commandcode");
  assert.equal(spec.requestModelId,m.reference);
  assert.equal((spec.compat as Record<string,unknown>)?.reasoningContentField,undefined);
  assert.equal((spec.compat as Record<string,unknown>)?.supportsDeveloperRole,false);
  assert.deepEqual((spec.compat as Record<string,unknown>)?.extraBody,{fallbacks:["deepseek/fallback"]});
});

test("reasoning off stays off across all provider routes, and fractional caps round down",()=>{
  const mandatory={reasoning:true,thinking:{requiresEffort:true,efforts:["low","high"]}} as unknown as Model;
  for (const [p] of providers) {
    assert.equal(normalizePifrostReasoningOptions(mandatory,{disableReasoning:true})?.reasoning,undefined,p);
    assert.equal(normalizePifrostReasoningOptions(mandatory,{forceReasoningOff:true})?.reasoning,undefined,p);
  }
  assert.equal(pifrostDirectMaxTokens(32768.8,32768),32768);
  assert.equal(pifrostDirectMaxTokens(65536,32768),32768);
  assert.equal(pifrostDirectMaxTokens(-2,32768),32768);
});
