import assert from "node:assert/strict";
import test from "node:test";
import { bridgeBifrostUsageCostResponse, type BifrostCostCapture } from "../bifrost-cost-bridge.ts";
import { classifyInferenceFailure } from "../inference-failure.ts";
import { classifyGatewayHttpStatus } from "../gateway-reliability.ts";
import { evaluateAttemptTransition } from "../attempt-retry-policy.ts";
import { inspectInferenceRequest } from "../request-diagnostics.ts";
import { clampOutputTokenFields } from "../output-budget.ts";
import { recordBifrostCaptureTrace, formatPifrostRouteTraces, releasePifrostRouteTraces } from "../request-provenance.ts";
import { bridgePifrostPayload } from "../capability-bridge.ts";

test("R5B-01 HTTP 413 is always a terminal request, even with a misleading upstream code", async () => {
  const c: BifrostCostCapture = {};
  const response = await bridgeBifrostUsageCostResponse(new Response(
    JSON.stringify({ error: { code:"request_too_large",message:"Body exceeds configured limit",secret:"PRIVATE" }}),
    { status: 413, headers:{"content-type":"application/json","x-bifrost-request-id":"req-413"} },
  ), c);
  assert.equal(response.status,413);
  assert.equal(c.failureClass, "request");
  assert.equal(c.failureCode,"REQUEST_TOO_LARGE");
  assert.equal(classifyGatewayHttpStatus(413),"request");
  assert.equal(classifyInferenceFailure(413,{}).code,"REQUEST_TOO_LARGE");
  for (const kind of ["gateway-ingress","physical-compatibility"] as const) {
    assert.equal(evaluateAttemptTransition(kind,new Error("model does not support protocol"),{
      httpStatus:413,failureClass:"request",failureCode:"UPSTREAM_TRANSIENT",
    }).permitted,false);
  }
  assert.doesNotMatch(JSON.stringify(classifyInferenceFailure(413,{error:"PRIVATE"})),/PRIVATE/u);
});

test("R5B-02 Bifrost headers-mode metadata preserves physical identity, conversion and reports stripped output limit", async () => {
  const c:BifrostCostCapture={};
  const original={id:"chat-1",choices:[{message:{role:"assistant",content:"ok"}}],usage:{prompt_tokens:1,completion_tokens:3}};
  const bridged=await bridgeBifrostUsageCostResponse(new Response(JSON.stringify(original), {
    headers:{"content-type":"application/json","x-bifrost-routing-info-provider":"custom-openai",
      "x-bifrost-routing-info-model":"provider-model",
      "x-bifrost-routing-info-requested-model":"omp-default",
      "x-bifrost-routing-info-requested-provider":"bifrost",
      "x-bifrost-converted-request-type":"responses",
      "x-bifrost-dropped-compat-params":"temperature, max_completion_tokens, top_p",
      "x-bifrost-request-id":"req-44"},
  }),c);
  assert.deepEqual(await bridged.json(),original);
  assert.equal(c.requestId,"req-44");
  assert.equal(c.requestedModel,"omp-default");
  assert.equal(c.provider,"custom-openai");
  assert.equal(c.resolvedModel,"provider-model");
  assert.equal(c.convertedRequestType,"responses");
  assert.equal(c.droppedOutputLimit,true);
  const session="r5b-headers";
  recordBifrostCaptureTrace(session,{logicalModel:"omp-default",routeMode:"bifrost-native",protocol:"openai-completions",attempt:1,requestedPrimary:"omp-default",outcome:"done"},c);
  const shown=formatPifrostRouteTraces(session,{compact:false});
  assert.match(shown,/gateway-dropped-output-cap=yes egress-limit=unverified/u);
  assert.match(shown,/gateway-converted=responses/u);
  assert.doesNotMatch(shown,/temperature|top_p|PRIVATE/u);
  releasePifrostRouteTraces(session);
});

test("R5B-03 body-mode routing data and dropped-parameter evidence are read without rewriting OpenAI contents", async () => {
  const c:BifrostCostCapture={};
  const body={
    id:"resp-123",object:"response",status:"completed",
    output:[
      {type:"reasoning",id:"rs-1",encrypted_content:"opaque-signed-provider-payload"},
      {type:"function_call",call_id:"call-1",name:"delegate",arguments:'{"private":"do not touch"}'},
      {type:"function_call_output",call_id:"call-1",output:""},
      {type:"message",role:"assistant",content:[{type:"output_text",text:"ok"}]}
    ],
    usage:{input_tokens:15,output_tokens:20,cost:{total_cost:0.004}},
    extra_fields:{
      routing_info:{provider:"real-provider",model:"real-fallback",requested_model:"omp-task",primary_model:"primary",is_fallback:true},
      dropped_compat_plugin_params:["temperature","max_output_tokens"],
      converted_request_type:"chat_completion",
    }
  };
  const bridged=await bridgeBifrostUsageCostResponse(new Response(JSON.stringify(body),{
    headers:{"content-type":"application/json","x-bifrost-request-id":"req-body"},
  }),c);
  const data=await bridged.json() as typeof body & {usage:{cost:number}};
  assert.deepEqual(data.output,body.output);
  assert.equal(data.usage.cost,0.004);
  assert.equal(c.total,0.004);
  assert.equal(c.resolvedModel,"real-fallback");
  assert.equal(c.provider,"real-provider");
  assert.equal(c.isFallback,true);
  assert.equal(c.droppedOutputLimit,true);
  assert.equal(c.convertedRequestType,"chat_completion");
  assert.deepEqual(body.output[0],{type:"reasoning",id:"rs-1",encrypted_content:"opaque-signed-provider-payload"});
});

test("R5B-04 SSE lifecycle, tool call identity, empty results and fallback provenance survive byte-split frames", async () => {
  const c:BifrostCostCapture={};
  const frames=[
    {type:"response.created",response:{id:"r1",status:"in_progress",output:[]}},
    {type:"response.output_item.added",item:{id:"f1",type:"function_call",call_id:"call-88",name:"search",arguments:""}},
    {type:"response.function_call_arguments.delta",item_id:"f1",delta:'{"q":1}'},
    {type:"response.output_item.done",item:{id:"f1",type:"function_call",call_id:"call-88",name:"search",arguments:'{"q":1}'}},
    {type:"response.completed",response:{id:"r1",status:"completed",output:[],extra_fields:{
      routing_info:{provider:"fallback-provider",model:"fallback-physical",is_fallback:true},
      dropped_compat_plugin_params:[]}}},
  ];
  const raw=frames.map(item=>"event: "+item.type+"\ndata: "+JSON.stringify(item)+"\n\n").join("")+"data: [DONE]\n\n";
  const buf=new TextEncoder().encode(raw);
  let i=0;
  const body=new ReadableStream<Uint8Array>({pull(ctrl){if(i>=buf.length){ctrl.close();return}ctrl.enqueue(buf.slice(i,i+13));i+=13}});
  const result=await bridgeBifrostUsageCostResponse(new Response(body,{headers:{
    "content-type":"text/event-stream","x-bifrost-provider":"primary-provider",
    "x-bifrost-resolved-model":"primary-physical",
  }}),c);
  const decoded=await result.text();
  assert.equal(decoded,raw,"the gateway bridge must not edit any SSE event, call or reasoning payload");
  assert.equal(c.provider,"fallback-provider","final stream extra_fields updates early headers");
  assert.equal(c.resolvedModel,"fallback-physical");
  assert.equal(c.isFallback,true);
});

test("R5B-05 xhigh effort and multi-field output limit remain represented on final wire; no inferred extra ceilings",()=>{
  const body={model:"omp-default",messages:[
    {role:"system",content:"test"},
    {role:"assistant",tool_calls:[{id:"call-1",type:"function",function:{name:"search",arguments:'{"private":true}'}}],reasoning_content:"signed-native"},
    {role:"tool",tool_call_id:"call-1",content:""},
  ],instructions:"Leave system instructions intact",reasoning_effort:"xhigh",
  parallel_tool_calls:false,max_tokens:4096,max_completion_tokens:10240};
  const capped=clampOutputTokenFields(body,{effectiveTokens:8192});
  assert.equal(capped.max_tokens,4096);
  assert.equal(capped.max_completion_tokens,8192);
  assert.equal(capped.reasoning_effort,"xhigh");
  assert.equal(capped.instructions,body.instructions);
  assert.deepEqual(capped.messages,body.messages);
  const info=inspectInferenceRequest(capped);
  assert.equal(info?.reasoningEffort,"xhigh");
  assert.equal(info?.toolCalls,1);
  assert.equal(info?.toolResults,1);
  assert.equal(info?.orphanToolResults,0);
});

test("R5B-06 deferred tool and between-tools bridge retains identifiers and preserves unrelated wire data",()=>{
  const body={model:"opaque",input:[{type:"reasoning",encrypted_content:"SIGNED"},{type:"function_call_output",call_id:"call-1",output:""}],
    tools:[{type:"function",name:"search",parameters:{type:"object"}},{type:"function",name:"read",defer_loading:true}],
    reasoning:{effort:"xhigh"},max_output_tokens:4096};
  const result=bridgePifrostPayload(body,{deferredTools:new Set(["read"]),enableToolSearch:true}) as {input:unknown;reasoning:{effort:string};tools:{type:string;defer_loading?:boolean}[]};
  assert.deepEqual(result.input,body.input);
  assert.equal(result.reasoning.effort,"xhigh");
  assert.equal(result.tools.filter(x=>x.type==="tool_search").length,1);
  assert.equal(result.tools[1].defer_loading,true);
  assert.equal(body.tools.length,2);
});
