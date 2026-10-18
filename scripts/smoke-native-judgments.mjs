#!/usr/bin/env node
/**
 * Opt-in, potentially BILLABLE gateway conformance. Never used by CI without
 * user-provided credentials and explicit PIFROST_LIVE_JUDGMENTS=1.
 */
import { probeNativeJudge, inspectNativeJudgeModels } from "../judge-control.mjs";
const env=process.env;
if(env.PIFROST_LIVE_JUDGMENTS!=="1"){
  console.error("Refusing billable judgment tests; set PIFROST_LIVE_JUDGMENTS=1 explicitly");
  process.exitCode=2;
}else if(!env.BIFROST_URL||!env.BIFROST_VIRTUAL_KEY){
  console.error("BIFROST_URL and BIFROST_VIRTUAL_KEY are required; no request sent.");
  process.exitCode=2;
}else{
  const config={url:env.BIFROST_URL,virtualKey:env.BIFROST_VIRTUAL_KEY};
  const models=(env.PIFROST_LIVE_JUDGE_MODELS||"jev-1.14.0,openai/gpt-6-luna").split(",").map(x=>x.trim()).filter(Boolean);
  let failures=0;
  for(const selection of models){
    const profile={...env,PIFROST_NATIVE_JUDGE_MODEL:selection,PIFROST_NATIVE_JUDGE_IMAGES:"1"};
    for(const image of [false,true]){
      const label=selection+" "+(image?"image":"text");
      try{
        const listed=await inspectNativeJudgeModels(config,profile);
        if(listed.status!=="available")throw Error("model not present in native listing");
        const result=await probeNativeJudge(config,profile,{image});
        if(result.answered!==(image?4:3))throw Error("incomplete typed answers");
        if(!result.hasUsage)throw Error("provider usage missing");
        console.log("PASS "+label+" "+result.kind+" "+result.answered+" typed answers");
      }catch(error){
        failures++;
        // Never print arbitrary upstream errors: they can contain credentials,
        // provider response bodies or the submitted test state.
        console.error("FAIL "+label+" (inspect gateway logs securely)");
      }
    }
  }
  if(failures)process.exitCode=1;
}
