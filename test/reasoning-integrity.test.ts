import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {auditReasoningReplay,enforceReasoningReplay,reasoningReplayRequirementFromCompat,ReasoningReplayIntegrityError,
type ReasoningReplayContract} from "../reasoning-integrity.ts";
const responses = (requirement: ReasoningReplayContract["requirement"]): ReasoningReplayContract =>
 ({requirement,protocol:"openai-responses",source:"physical-omp-policy"});
const chat = (requirement: ReasoningReplayContract["requirement"]): ReasoningReplayContract =>
 ({requirement,protocol:"openai-completions",source:"physical-omp-policy"});
test("D-01: original 555-entry OMP request has no native reasoning, rejects before Bifrost when contract is verified strict",()=>{
  const input:Record<string,unknown>[]=[];
  for(let n=0;n<35;n++)input.push({role:"user",content:[]});
  for(let n=0;n<100;n++)input.push({type:"message",role:"assistant",content:[{type:"output_text",text:"<thinking>visible text</thinking>"}]});
  for(let n=0;n<210;n++){input.push({type:"function_call",name:"mock_tool",call_id:"n"+n,arguments:"{}"});input.push({type:"function_call_output",call_id:"n"+n,output:""});}
  assert.equal(input.length,555);
  const payload={model:"omp-default",input,reasoning:{effort:"high"},max_output_tokens:712434};
  const audit=auditReasoningReplay(payload,responses("all-assistant-runs"),true);
  assert.equal(audit.missingRequiredRuns,100);
  assert.equal(audit.nativeReasoningItems,0);
  assert.equal(audit.reason,"incompatible-history");
  assert.throws(()=>enforceReasoningReplay(payload,responses("all-assistant-runs"),true),ReasoningReplayIntegrityError);
  assert.doesNotMatch(JSON.stringify(audit),/visible text|thinking>|call_id|mock_tool/u);
});
test("D-02: native signed/encrypted reasoning items are preserved by reference",()=>{
  const item={type:"reasoning",id:"opaque-provider-id",encrypted_content:"SECRET",content:[{type:"reasoning_text",text:"REAL THINKING"}]};
  const body={input:[{role:"user",content:"private"},item,{type:"message",role:"assistant",content:[{type:"output_text",text:"answer"}]}],reasoning:{effort:"high"}};
  assert.equal(enforceReasoningReplay(body,responses("all-assistant-runs"),true).reason,"verified");
  assert.strictEqual(body.input[1],item);
  assert.doesNotMatch(JSON.stringify(auditReasoningReplay(body,responses("all-assistant-runs"),true)),/SECRET|REAL THINKING|private/u);
});
test("D-03: multiple tool-result boundaries require a valid item per actual assistant run",()=>{
  const body={input:[{role:"user",content:"x"},{type:"reasoning",content:[{type:"reasoning_text",text:"synthetic OMP replay"}]},
    {type:"function_call",call_id:"1"},{type:"function_call_output",call_id:"1",output:"a"},
    {type:"function_call",call_id:"2"},{type:"function_call_output",call_id:"2",output:"b"}]};
  const result=auditReasoningReplay(body,responses("tool-call-runs"),true);
  assert.equal(result.runsRequiringReasoning,2);
  assert.equal(result.missingRequiredRuns,1);
});
test("D-04: no strict policy inferred from unknown route or disabled reasoning",()=>{
  const payload={input:[{type:"message",role:"assistant",content:[{type:"output_text",text:"answer"}]}]};
  assert.equal(enforceReasoningReplay(payload,responses("unknown"),true).reason,"contract-unknown");
  assert.equal(enforceReasoningReplay(payload,responses("all-assistant-runs"),false).reason,"not-applicable");
  assert.equal(enforceReasoningReplay(payload,responses("not-required"),true).reason,"not-required");
});
test("D-05: Chat guards require OMP's native replay field, not visible <thinking> text",()=>{
  const body={messages:[{role:"user",content:"hi"},{role:"assistant",content:"<thinking>not valid replay</thinking>",tool_calls:[{id:"1"}]}]};
  assert.equal(auditReasoningReplay(body,chat("tool-call-runs"),true).missingRequiredRuns,1);
  assert.throws(()=>enforceReasoningReplay(body,chat("tool-call-runs"),true),ReasoningReplayIntegrityError);
  body.messages[1]!.reasoning_content=""; // OMP's documented empty-field Chat fallback is accepted for serialization
  assert.equal(enforceReasoningReplay(body,chat("tool-call-runs"),true).reason,"verified");
});
test("D-06: preservation and idempotence across all legitimate reasoning forms",()=>{
  const items=[{role:"user",content:"x"},{type:"reasoning",summary:[],encrypted_content:"opaque"},
    {type:"message",role:"assistant",content:[{type:"output_text",text:"answer"}]},
    {type:"function_call",call_id:"z"},{type:"function_call_output",call_id:"z",output:"ok"}];
  const body={input:items};
  const a=enforceReasoningReplay(body,responses("all-assistant-runs"),true);
  assert.equal(a.missingRequiredRuns,0);
  assert.strictEqual(body.input,items);
  assert.deepEqual(auditReasoningReplay(body,responses("all-assistant-runs"),true),a);
});
test("D-07: unverified model constraints may not be converted into mandatory strict rules",()=>{
  assert.equal(reasoningReplayRequirementFromCompat(undefined),"unknown");
  assert.equal(reasoningReplayRequirementFromCompat({requiresReasoningContentForToolCalls:true}),"tool-call-runs");
  assert.equal(reasoningReplayRequirementFromCompat({requiresReasoningContentForAllAssistantTurns:true}),"all-assistant-runs");
  assert.equal(reasoningReplayRequirementFromCompat({requiresReasoningContentForAllAssistantTurns:false,requiresReasoningContentForToolCalls:false}),"not-required");
});
