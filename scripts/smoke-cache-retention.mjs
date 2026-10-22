#!/usr/bin/env node
/**
 * Explicitly BILLABLE two-request canary. Never called by CI.
 * Provider-side prompt caching is distinct from Bifrost response caching.
 */
import { requestJson } from "../http-client.mjs";
import { inspectGatewayUsageCounters, gatewayCostEvidence } from "../inference-cache-evidence.ts";

const env=process.env;
if(env.PIFROST_LIVE_CACHE!=="1") {
  console.error("No inference sent. Set PIFROST_LIVE_CACHE=1 to approve two potentially billed Responses requests.");
  process.exitCode=2;
} else if (!env.BIFROST_URL || !env.BIFROST_VIRTUAL_KEY || !env.PIFROST_CACHE_MODEL) {
  console.error("Set BIFROST_URL, BIFROST_VIRTUAL_KEY and PIFROST_CACHE_MODEL explicitly; no inference sent.");
  process.exitCode=2;
} else {
  const base=env.BIFROST_URL.replace(/\/+$/u,"");
  if(!/^https?:\/\/[^/]+\/v1$/u.test(base) || !/^[-a-z0-9_./:@]{1,128}$/iu.test(env.PIFROST_CACHE_MODEL)) {
    console.error("Invalid gateway URL/model selector; no inference sent.");
    process.exitCode=2;
  } else {
    const fixture="Pifrost disposable cache fixture. "+
      Array.from({length:240},(_,i)=>"Reference segment "+i+" contains static non-personal words. ").join("");
    const request={
      model:env.PIFROST_CACHE_MODEL, input:[
        {role:"developer",content:[{type:"input_text",text:fixture}]},
        {role:"user",content:[{type:"input_text",text:"Return the word ready."}]},
      ],
      max_output_tokens:24,
      prompt_cache_options:{mode:"implicit",ttl:"12h"},
    };
    const headers={"x-bf-vk":env.BIFROST_VIRTUAL_KEY};
    if(env.BIFROST_API_KEY)headers.Authorization="Bearer "+env.BIFROST_API_KEY;
    try{
      const results=[];
      for(let i=0;i<2;i++){
        // Exactly two explicit POSTs with the same static prefix. Never retry
        // transport failures: a request may have been accepted/billed already.
        const body=await requestJson(base+"/responses",{
          method:"POST",headers,body:request,timeoutMs:45000,maxResponseBytes:512000,
        });
        const counters=inspectGatewayUsageCounters(body?.usage);
        const info=body?.extra_fields?.routing_info;
        const evidence=gatewayCostEvidence({
          total:body?.usage?.cost?.total_cost,provider:info?.provider,resolvedModel:info?.model,
          usageCounters:counters,
        });
        results.push({response:i+1,cachedReadTokens:counters?.cacheReadTokens??"unreported",
          cacheWrite12hTokens:counters?.cacheWrite12hTokens??"unreported",
          providerAttribution:evidence.attribution,costStatus:evidence.amount,
        });
      }
      for(const result of results)console.log(JSON.stringify(result));
      const accepted=results.length===2;
      if(!accepted)process.exitCode=1;
      else console.log("Two Responses calls completed; provider egress, 12h retention and billing remain unverified unless gateway/provider evidence confirms them. No global cache setting changed.");
    }catch{
      console.error("Cache conformance request was unsuccessful/ambiguous; inspect redacted Bifrost logs securely. No retry attempted.");
      process.exitCode=1;
    }
  }
}
