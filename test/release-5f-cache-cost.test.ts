import assert from "node:assert/strict";
import test from "node:test";
import { inspectResponsesCacheRequest, inspectGatewayUsageCounters, gatewayCostEvidence } from "../inference-cache-evidence.ts";
import { bridgeBifrostUsageCostResponse, type BifrostCostCapture } from "../bifrost-cost-bridge.ts";
import { formatPifrostRouteTraces, recordBifrostCaptureTrace, releasePifrostRouteTraces } from "../request-provenance.ts";

test("R5F-01 explicit 12-hour Responses lifetime stays intent, not forced policy or claimed acceptance", () => {
  const source = { model: "omp-default", prompt_cache_options: { mode: "explicit", ttl: "12h" },
    prompt_cache_key: "customer-secret-keep-private",
    input: [{ role: "user", content: [{ type: "input_text", text: "sensitive-data",
      prompt_cache_breakpoint: { mode: "explicit", ttl: "30m" } }] }] };
  const before = JSON.stringify(source);
  const result = inspectResponsesCacheRequest(source,"openai-responses");
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual({
    status:result.status, ttl:result.requestedTtl, twelveHourRequested:result.twelveHourRequested,
    breakpoints:result.breakpoints, overrides:result.explicitTtlOverrides, accepted:result.providerAccepted,
    cacheKey:result.cacheKeyPresent,
  },{status:"requested",ttl:"12h",twelveHourRequested:true,breakpoints:1,overrides:1,accepted:"unverified",cacheKey:true});
  assert.doesNotMatch(JSON.stringify(result),/customer-secret|sensitive-data/);
  assert.equal(inspectResponsesCacheRequest(source,"openai-completions").status,"unavailable");
  assert.equal(inspectResponsesCacheRequest({model:"x"},"openai-responses").status,"default");
});

test("R5F-02 unsupported cache TTL and breakpoints are diagnostics not silent rewrites",()=>{
  assert.equal(inspectResponsesCacheRequest({prompt_cache_options:{ttl:"24h"}},"openai-responses").status,"invalid");
  assert.equal(inspectResponsesCacheRequest({input:[{prompt_cache_breakpoint:{ttl:"12h"}}]},"openai-responses").twelveHourRequested,true);
  assert.equal(inspectResponsesCacheRequest({prompt_cache_options:{ttl:"12h"},input:Array.from({length:5},()=>({
    prompt_cache_breakpoint:{mode:"explicit"}
  }))},"openai-responses").status,"invalid");
});

test("R5F-03 cache counters report zeros as zeros but never fabricate missing fields",()=>{
  const counters = inspectGatewayUsageCounters({input_tokens:2100,output_tokens:19,
    input_tokens_details:{cached_tokens:0,cache_write_tokens:1500,
      cache_write_tokens_details:{ttl_30m_tokens:500,ttl_12h_tokens:1000}}});
  assert.equal(counters?.cacheReadTokens,0);
  assert.equal(counters?.cacheWrite12hTokens,1000);
  assert.equal(inspectGatewayUsageCounters({}),undefined);
  assert.equal(inspectGatewayUsageCounters({cache_creation_input_tokens:"500"}),undefined);
  assert.deepEqual(gatewayCostEvidence({}),{attribution:"unverified",amount:"unknown",accounting:"unknown"});
  assert.deepEqual(gatewayCostEvidence({provider:"moonshot",resolvedModel:"kimi",usageCounters:counters,total:0}),
    {attribution:"gateway-physical-model",amount:"gateway-reported",accounting:"reported-tokens"});
  assert.equal(gatewayCostEvidence({provider:"deepseek",total:0.005}).attribution,"unverified");
});

test("R5F-04 response headers/body preserve physical model and cache counters without cost inventions",async()=>{
  const capture:BifrostCostCapture={};
  const response = new Response(JSON.stringify({
    extra_fields:{routing_info:{provider:"moonshot",model:"kimi-k2.6"}},
    usage:{input_tokens:6000,output_tokens:32,input_tokens_details:{cached_tokens:2048,cache_write_tokens:2000,
      cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:2000}}}
  }),{status:200,headers:{"content-type":"application/json","x-bifrost-provider":"deepseek"}});
  const parsed=await bridgeBifrostUsageCostResponse(response,capture);
  assert.equal(parsed.status,200);
  assert.equal(capture.provider,"moonshot","final response body overrides early gateway header");
  assert.equal(capture.resolvedModel,"kimi-k2.6");
  assert.equal(capture.usageCounters?.cacheReadTokens,2048);
  assert.equal(capture.usageCounters?.cacheWrite12hTokens,2000);
  assert.equal(capture.total,undefined,"missing provider total stays unknown");
});

test("R5F-05 cache intent and physical cost evidence appear in trace without secrets",()=>{
  const sid="release-5f-cache-trace";
  recordBifrostCaptureTrace(sid,{
    logicalModel:"omp-default",routeMode:"bifrost-native",protocol:"openai-responses",
    attempt:1,requestedPrimary:"omp-default",outcome:"done",
  },{
    total:0.002,provider:"deepseek",resolvedModel:"deepseek-v4.1",
    cacheIntent:inspectResponsesCacheRequest({prompt_cache_options:{ttl:"12h"},prompt_cache_key:"secret"},"openai-responses"),
    usageCounters:inspectGatewayUsageCounters({input_tokens:1000,input_tokens_details:{cached_tokens:100,cache_write_tokens:500,
      cache_write_tokens_details:{ttl_12h_tokens:500}}}),
  });
  const compact=formatPifrostRouteTraces(sid,{compact:true});
  const verbose=formatPifrostRouteTraces(sid,{compact:false});
  assert.match(compact,/Cache: 12h requested; provider acceptance unverified/);
  assert.match(verbose,/cache-12h=requested/);
  assert.match(verbose,/cost-evidence=gateway-reported model-attribution=gateway-physical-model/);
  assert.match(verbose,/cache-write-12h-tokens=500/);
  assert.doesNotMatch(compact+verbose,/secret|cost-estimated|prompt=/);
  releasePifrostRouteTraces(sid);
});
