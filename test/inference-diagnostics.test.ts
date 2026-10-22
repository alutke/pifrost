import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyInferenceFailure, inferenceFailureAdvice } from "../inference-failure.ts";
import { inspectInferenceRequest } from "../request-diagnostics.ts";
import { bridgeBifrostUsageCostResponse, type BifrostCostCapture } from "../bifrost-cost-bridge.ts";
import { formatPifrostRouteTraces, recordBifrostCaptureTrace, releasePifrostRouteTraces } from "../request-provenance.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/release-a-incident.json", import.meta.url), "utf8")) as {
  request: { historyItems: number; assistantMessages: number; userMessages: number; toolCalls: number; toolResults: number; maxOutputTokens: number };
  incidents: Array<Record<string, unknown>>;
};
function syntheticRequest() {
  const input: Array<Record<string, unknown>> = [];
  // Each item is a shape-only stand-in. Never embed the uploaded conversation.
  for (let i = 0; i < fixture.request.userMessages; i++) input.push({ role:"user",content:[] });
  for (let i = 0; i < fixture.request.assistantMessages; i++) input.push({ type:"message",role:"assistant",content:[] });
  for (let i = 0; i < fixture.request.toolCalls; i++) {
    input.push({type:"function_call",call_id:`call_${i}`,name:"test_tool",arguments:"{}"});
    input.push({type:"function_call_output",call_id:`call_${i}`,output:""});
  }
  return {model:"omp-default",input,max_output_tokens:fixture.request.maxOutputTokens,
    reasoning:{effort:"high",summary:"auto"},tools:[{type:"function",name:"test_tool"}]};
}
test("A-01: reproduces 555-entry Responses shape without storing private history", () => {
  const body=syntheticRequest();
  const shape=inspectInferenceRequest(body);
  assert.ok(shape);
  assert.equal(shape.historyItems,555);
  assert.equal(shape.assistantMessages,100);
  assert.equal(shape.nativeReasoningItems,0);
  assert.equal(shape.toolCalls,210);
  assert.equal(shape.toolResults,210);
  assert.equal(shape.orphanToolResults,0);
  assert.equal(shape.requestedOutputTokens,712434);
  assert.equal(shape.reasoningEffort,"high");
  assert.equal(shape.protocol,"openai-responses");
  const json=JSON.stringify(shape);
  assert.doesNotMatch(json,/call_\d+|test_tool|prompt|thinking_text|api.?key/iu);
});
test("A-02/A-03/A-04: original failure patterns classify deterministically", () => {
  for(const item of fixture.incidents.filter(x=>x.kind==="failure")) {
    assert.equal(classifyInferenceFailure(Number(item.status),item.error).code,item.code);
  }
  assert.match(inferenceFailureAdvice("REASONING_REPLAY_INVALID"),/reasoning replay/u);
  assert.equal(classifyInferenceFailure(400,{message:"synthetic unrelated bad request"}).code,"OTHER_REQUEST");
  assert.equal(classifyInferenceFailure(503,{message:"connection timeout"}).code,"UPSTREAM_TRANSIENT");
  assert.equal(classifyInferenceFailure(403,{message:"generic forbidden"}).code,"UNKNOWN");
});
test("A-05/A-06: different affinity selection and three failed attempts remain separate evidence", () => {
  const affinity=fixture.incidents.find(x=>x.case==="A-05")!;
  assert.notEqual(affinity.configuredPrimary,affinity.affinitySelected);
  const exhaust=fixture.incidents.find(x=>x.case==="A-06")!;
  assert.deepEqual(exhaust.attemptCodes,["REASONING_REPLAY_INVALID","OUTPUT_LIMIT_EXCEEDED","MODEL_NOT_PERMITTED"]);
  // Classification is observational only: it does not choose providers or retries.
});
test("response diagnosis examines error metadata but never records response content or secrets", async () => {
  const marker="SECRET_PROMPT_CONTENT_NOT_FOR_DIAGNOSTICS";
  const capture:BifrostCostCapture={};
  const body={error:{type:"invalid_request_error",
    message:`The reasoning_content in the thinking mode must be passed back to the API. ${marker}`}};
  const bridged=await bridgeBifrostUsageCostResponse(new Response(JSON.stringify(body),
    {status:400,headers:{"content-type":"application/json","x-bifrost-request-id":"safe-id"}}),capture);
  assert.equal(bridged.status,400);
  assert.deepEqual(await bridged.json(),body);
  assert.equal(capture.failureCode,"REASONING_REPLAY_INVALID");
  assert.equal(capture.requestId,"safe-id");
  assert.doesNotMatch(JSON.stringify(capture),new RegExp(marker));
});
test("Chat tool results and native reasoning counted without inspecting content",()=>{
  const shape=inspectInferenceRequest({messages:[
    {role:"assistant",reasoning_content:"hidden",tool_calls:[{id:"call-1",function:{arguments:"SECRET"}}]},
    {role:"tool",tool_call_id:"call-1",content:"PRIVATE"},
    {role:"tool",tool_call_id:"unpaired",content:"PRIVATE"},
  ],max_completion_tokens:8192,reasoning_effort:"high"});
  assert.deepEqual({protocol:shape?.protocol,tools:shape?.toolCalls,results:shape?.toolResults,
    orphans:shape?.orphanToolResults,thinking:shape?.chatReasoningMessages},
    {protocol:"openai-completions",tools:1,results:2,orphans:1,thinking:1});
  assert.doesNotMatch(JSON.stringify(shape),/SECRET|PRIVATE|call-1|unpaired/u);
});
test("new diagnostics surface in compact and verbose traces without raw error text",()=>{
  const sid="release-a-incident-shape";
  const request=inspectInferenceRequest(syntheticRequest());
  recordBifrostCaptureTrace(sid,{
    logicalModel:"omp-default",routeMode:"bifrost-direct",protocol:"openai-responses",
    attempt:1,requestedPrimary:"omp-default",outcome:"error"
  },{httpStatus:400,failureClass:"request",failureCode:"REASONING_REPLAY_INVALID",
    requestDiagnostics:request,requestId:"safe-req"});
  const compact=formatPifrostRouteTraces(sid,{compact:true});
  const verbose=formatPifrostRouteTraces(sid,{compact:false});
  assert.match(compact,/reasoning-replay-invalid|REASONING_REPLAY_INVALID/u);
  assert.match(verbose,/failure-code=REASONING_REPLAY_INVALID/u);
  assert.match(verbose,/history-items=555/u);
  assert.match(verbose,/reasoning-items=0/u);
  assert.match(verbose,/output-requested=712434/u);
  assert.doesNotMatch(compact,/safe-req/u);
  releasePifrostRouteTraces(sid);
});

test("P0: provider range validation errors classify as output-limit faults",()=> {
  for (const payload of [
    {error:{code:"server_error",message:"Upstream request failed: [invalid_request_error] max_tokens must be between 1 and 393216"}},
    {error:{type:"invalid_request_error",message:JSON.stringify({type:"invalid_request_error",message:"max_tokens: 670395 exceeds maximum 393216 trace_id: REDACTED"})}},
    {error:{message:"max_output_tokens must be between 1 and 393216"}},
    {error:{message:"max_completion_tokens out of range: maximum 393216"}},
  ]) {
    const decision=classifyInferenceFailure(400,payload);
    assert.equal(decision.code,"OUTPUT_LIMIT_EXCEEDED");
    assert.doesNotMatch(JSON.stringify(decision),/REDACTED|670395/u);
  }
});
