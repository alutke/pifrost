import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createBifrostCostBridgeFetch, type BifrostCostCapture } from "../bifrost-cost-bridge.ts";
import { deriveAliasesFromRules } from "../routing-core.ts";
import { canUseNativeBifrostRoute, planDynamicRouteAttempts, compatibilityRouteSnapshotError, type DynamicRouteProfile } from "../dynamic-routing.ts";
import { routePolicyFingerprint } from "../route-policy-fingerprint.mjs";

/** Real loopback HTTP requests against a Bifrost-shaped mock, not a claim of
 * live Bifrost or live provider availability. The gateway owns match counters. */
test("mock gateway sees logical alias and owns a native route match and provenance", async () => {
  const rules=[{name:"omp-default",enabled:true,scope:"global",cel_expression:"model == 'omp-default'",
    targets:[{provider:"provider",model:"first",weight:1}],fallbacks:["other/second"]}];
  const derived=deriveAliasesFromRules(rules);
  assert.equal(derived.aliases["omp-default"]?.dynamicRouting?.mode,"context-aware");
  const models=[
    {reference:"provider/first",resolvedModelId:"first",contextWindow:128000,maxTokens:16000,input:["text"] as const,
    reasoning:true,supportsTools:true,protocols:["openai-completions"] as const,compat:{supportsToolChoice:true}},
    {reference:"other/second",resolvedModelId:"second",contextWindow:128000,maxTokens:16000,input:["text"] as const,
    reasoning:true,supportsTools:true,protocols:["openai-completions"] as const,compat:{supportsToolChoice:true}},
  ];
  const profile={ id:"omp-default",mode:"context-aware",source:"bifrost-simple-rule",
    members:models,staticContextWindow:128000,advertisedContextWindow:128000,maxTokens:16000,
    bands:[],synchronizedAt:new Date().toISOString(),policyFingerprint:routePolicyFingerprint(rules) } as unknown as DynamicRouteProfile;
  const planned=planDynamicRouteAttempts(profile,{model:"omp-default",messages:[{role:"user",content:"test"}],max_tokens:1000},
    {estimatedInputTokens:100,compatibilityByMember:new Map(models.map(x=>[x.reference,"same-wire"]))});
  assert.equal(canUseNativeBifrostRoute(profile,planned),true);
  assert.equal(compatibilityRouteSnapshotError(profile),undefined);
  let matchCount=0;
  const server=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(body.model==="omp-default") matchCount++;
    assert.deepEqual(body.fallbacks,undefined,"native request cannot ship Pifrost's copied fallback chain");
    assert.equal(body.model,"omp-default");
    assert.equal(req.headers["x-bf-vk"],"sk-bf-fixture");
    res.writeHead(200,{"content-type":"application/json",
      "x-bifrost-routing-info-requested-model":"omp-default",
      "x-bifrost-routing-info-provider":"provider",
      "x-bifrost-routing-info-model":"first",
      "x-bifrost-request-id":"req-verified"});
    res.end(JSON.stringify({model:"first",usage:{cost:{total_cost:0.004}},choices:[]}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const addr=server.address();
    if(!addr||typeof addr==="string") throw new Error("mock server not bound");
    const capture:BifrostCostCapture={};
    const client=createBifrostCostBridgeFetch(globalThis.fetch,capture);
    const response=await client(`http://127.0.0.1:${addr.port}/v1/chat/completions`,{
      method:"POST",headers:{"content-type":"application/json","x-bf-vk":"sk-bf-fixture"},
      body:JSON.stringify({model:profile.id,messages:[{role:"user",content:"test"}]})
    });
    assert.equal(response.status,200);
    assert.equal(matchCount,1);
    assert.equal(capture.requestedModel,"omp-default");
    assert.equal(capture.resolvedModel,"first");
    assert.equal(capture.total,0.004);
    assert.equal(capture.requestId,"req-verified");
    assert.match(routePolicyFingerprint(rules),/^[0-9a-f]{64}$/u);
  } finally {await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});
