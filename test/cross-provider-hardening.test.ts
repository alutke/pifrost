import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { physicalPolicyIdentity } from "../request-compatibility.ts";
import { normalizedPhysicalProvider, confirmedProviderOutputCeiling } from "../endpoint-contracts.ts";
import { resolveOutputBudget, clampOutputTokenFields } from "../output-budget.ts";
import { createPifrostMemberModelSpec, isVerifiedGatewayProtocolRejection } from "../multi-protocol-routing.ts";
import { auditReasoningReplay, unanimousStrictReasoningRequirement } from "../reasoning-integrity.ts";
import { normalizeResponsesReplay, normalizeCompletionsReplay } from "../reasoning-replay.ts";
import { inspectInferenceRequest } from "../request-diagnostics.ts";

const providers = [
  { name:"OpenCode Go", id:"opencode-go", model:"deepseek/deepseek-v4.1-flash" },
  { name:"CommandCode GOAT", id:"commandcode", model:"deepseek/deepseek-v4.1-flash" },
  { name:"DeepSeek", id:"deepseek", model:"deepseek-v4-flash" },
  { name:"Xiaomi MiMo", id:"xiaomi", model:"mimo-v2.6-pro" },
  { name:"OpenRouter", id:"openrouter", model:"moonshot/kimi-k3" },
  { name:"OpenAI Codex", id:"openai-codex", model:"gpt-6" },
  { name:"Azure OpenAI", id:"azure-openai", model:"gpt-6" },
  { name:"GitHub Copilot", id:"github-copilot", model:"claude-sonnet" },
  { name:"OpenCode Zen", id:"opencode-zen", model:"model-a" },
] as const;
function logical(): Model {
  return {
    id:"omp-default",provider:"bifrost",name:"OMP Default",
    api:"openai-completions",baseUrl:"http://127.0.0.1:8180/v1",
    contextWindow:1_000_000,maxTokens:712_434,reasoning:true,
    input:["text"],supportsTools:true,
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
    headers:{"x-bf-vk":"sk-test-only", "X-Test-Header":"unchanged"},
    compatConfig:{supportsReasoningEffort:true},
  } as unknown as Model;
}
function member(reference:string) {
  return {
    reference,resolvedModelId:reference,contextWindow:1_000_000,maxTokens:712_434,
    input:["text" as const],reasoning:true,supportsTools:true,
    protocols:["openai-completions" as const,"openai-responses" as const],
    compat:{supportsToolChoice:true},
  };
}
test("F-01: all bundled/provider entitlement identities remain qualified and retain Bifrost request names",()=>{
  const original = logical();
  for(const row of providers){
    const physical = row.name+"/"+row.model;
    const identity=physicalPolicyIdentity(physical);
    assert.equal(identity?.provider,row.id,physical);
    assert.equal(identity?.id,row.model,physical);
    assert.equal(identity?.requestModelId,physical,physical);
    assert.equal(normalizedPhysicalProvider(row.name),row.id);
    for(const api of ["openai-completions","openai-responses"] as const){
      const spec=createPifrostMemberModelSpec(original,member(physical),api);
      assert.equal(spec.provider,row.id,api+" "+physical);
      assert.equal(spec.id,row.model);
      assert.equal(spec.requestModelId,physical);
      assert.equal(spec.api,api);
      assert.equal(spec.headers?.["x-bf-vk"],"sk-test-only");
      assert.equal((spec.compat as Record<string,unknown>).supportsDeveloperRole,false);
      assert.equal((spec.compat as Record<string,unknown>).supportsToolChoice,true);
    }
  }
  assert.equal(original.id,"omp-default");
  assert.equal(original.provider,"bifrost");
  assert.equal(original.headers?.["X-Test-Header"],"unchanged");
});
test("F-02: provider ceilings are entitlement-specific, not transferred across DeepSeek hosts",()=>{
  assert.equal(confirmedProviderOutputCeiling("CommandCode GOAT/deepseek/deepseek-v4.1-flash"),393216);
  for(const name of ["OpenCode Go","DeepSeek","OpenRouter","Xiaomi MiMo"]){
    assert.equal(confirmedProviderOutputCeiling(name+"/deepseek/deepseek-v4.1-flash"),undefined,name);
  }
  const a=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:712434,advertisedTokens:712434,
    members:[{reference:"CommandCode GOAT/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"live"}],
    environment:{},
  });
  assert.equal(a.effectiveTokens,393216);
  assert.equal(a.limitingSource,"confirmed-endpoint");
  const b=resolveOutputBudget({
    logicalModel:"omp-default",requestedTokens:712434,advertisedTokens:712434,
    members:[{reference:"OpenCode Go/deepseek/deepseek-v4.1-flash",maxTokens:712434,source:"live"}],
    environment:{},
  });
  assert.equal(b.effectiveTokens,712434);
  assert.equal(b.reduced,false);
  const original={model:"omp-default",max_output_tokens:712434,max_tokens:712434,
    messages:[{role:"user",content:"private fixture"}]};
  const capped=clampOutputTokenFields(original,a);
  assert.equal(capped.max_output_tokens,393216);
  assert.equal(capped.max_tokens,393216);
  assert.equal(capped.messages,original.messages,"only the envelope is copied");
  assert.equal(original.max_tokens,712434,"caller request is never mutated");
});
test("F-03: protocol probe requires actual HTTP 400/422 and specific rejection",()=>{
 const protocol=new Error("Model does not support this protocol.");
 for(const status of [400,422]){
   assert.equal(isVerifiedGatewayProtocolRejection(protocol,{httpStatus:status,failureClass:"request"}),true);
 }
 for(const status of [0,200,401,402,403,404,408,409,429,500,502,503,504]){
   assert.equal(isVerifiedGatewayProtocolRejection(protocol,{httpStatus:status}),false,status.toString());
 }
 for(const code of ["REASONING_REPLAY_INVALID","OUTPUT_LIMIT_EXCEEDED","MODEL_NOT_PERMITTED","ROUTE_CONTRACT_UNKNOWN","UPSTREAM_TRANSIENT"]){
   assert.equal(isVerifiedGatewayProtocolRejection(protocol,{httpStatus:400,failureCode:code}),false,code);
 }
 assert.equal(isVerifiedGatewayProtocolRejection(protocol,{httpStatus:400,outputStarted:true}),false);
 assert.equal(isVerifiedGatewayProtocolRejection(protocol,{httpStatus:400,failureClass:"authorization"}),false);
 assert.equal(isVerifiedGatewayProtocolRejection(new Error("upstream timeout"),{httpStatus:400}),false);
 assert.equal(isVerifiedGatewayProtocolRejection(protocol,undefined),false);
});
test("F-04: unknown, mixed or tolerant physical reasoning policies are not upgraded to strict",()=>{
 const strict="all-assistant-runs" as const,other="tool-call-runs" as const;
 assert.equal(unanimousStrictReasoningRequirement([strict,strict],true),strict);
 assert.equal(unanimousStrictReasoningRequirement([other,other],true),other);
 for(const list of [[strict,other],[strict,"unknown"],[strict,"not-required"]] as const)
   assert.equal(unanimousStrictReasoningRequirement(list,true),"unknown");
 assert.equal(unanimousStrictReasoningRequirement([strict,strict],false),"unknown");
});
test("F-05: Responses retains opaque native reasoning, tool pairing, images and IDs across provider names",()=>{
 const signature={type:"reasoning",id:"sig-id",encrypted_content:"opaque-SECRET",summary:[]};
 const call={type:"function_call",name:"lookup",call_id:"call-1",arguments:"{\"private\":true}"};
 const output={type:"function_call_output",call_id:"call-1",output:"redacted private data"};
 for(const row of providers){
   const body={model:row.name+"/"+row.model,input:[
      {role:"user",content:[{type:"input_image",image_url:"data:image/png;base64,PRIVATE"}]},
      signature,call,output,{type:"message",role:"assistant",content:[{type:"output_text",text:"result"}]},
   ]};
   const original=JSON.stringify(body);
   const cleaned=normalizeResponsesReplay(body);
   assert.strictEqual(cleaned.payload,body,"valid replay must not be rewritten: "+row.name);
   assert.equal(JSON.stringify(body),original);
   const inspected=inspectInferenceRequest(body)!;
   assert.equal(inspected.toolCalls,1);
   assert.equal(inspected.toolResults,1);
   assert.equal(inspected.orphanToolResults,0);
   assert.equal(inspected.nativeReasoningItems,1);
   const audit=auditReasoningReplay(body,{protocol:"openai-responses",requirement:"all-assistant-runs",source:"physical-omp-policy"},true);
   // The output is separated by the tool-result boundary; per-run validation is conservative.
   assert.equal(audit.reason,"incompatible-history");
   assert.doesNotMatch(JSON.stringify({inspected,audit}),/PRIVATE|SECRET|redacted private data|call-1/);
 }
});
test("F-06: Chat preserves provider reasoning fields and tool results without synthetic substitution",()=>{
 const original={messages:[
    {role:"user",content:"test"},
    {role:"assistant",reasoning_content:"opaque-unmodified",tool_calls:[
     {id:"tool-a",type:"function",function:{name:"apply_patch",arguments:"{\"path\":\"secret\"}"}},
    ],content:null},
    {role:"tool",tool_call_id:"tool-a",content:"already applied"},
 ]};
 const cloned=normalizeCompletionsReplay(original);
 assert.strictEqual(cloned.payload,original);
 const inspected=inspectInferenceRequest(original)!;
 assert.equal(inspected.chatReasoningMessages,1);
 assert.equal(inspected.toolCalls,1);
 assert.equal(inspected.toolResults,1);
 assert.equal(inspected.orphanToolResults,0);
 assert.equal(auditReasoningReplay(original,{protocol:"openai-completions",requirement:"tool-call-runs",source:"physical-omp-policy"},true).reason,"verified");
 assert.doesNotMatch(JSON.stringify(inspected),/already applied|secret|opaque-unmodified/);
});
