import assert from "node:assert/strict";
import test from "node:test";
import { nativeJudgeGateway } from "../judge-bridge.mjs";
import { nativeJudgeCapabilityEvidence, resolvePinnedOmpJudgeCapabilities, decisionProviderInventory } from "../judge-certification.mjs";

const config={url:"http://localhost:8180/v1",virtualKey:"sk-bf-fixture"};

test("R5F-06 Jev 1.14 box questions are eligible with image opt-in, but never live-certified",()=>{
 const judge=nativeJudgeGateway(config,{PIFROST_NATIVE_JUDGE_MODEL:"jev-1.14.0",PIFROST_NATIVE_JUDGE_IMAGES:"1"});
 const report=nativeJudgeCapabilityEvidence(judge,{mimeTypes:["image/png","image/jpeg","application/secret"],minSide:280,maxSide:1568});
 assert.equal(report.boxQuestions,"eligible-not-live-verified");
 assert.equal(report.imageBounds,"resolved-from-omp");
 assert.deepEqual(report.bounds,{minSide:280,maxSide:1568,mimeTypes:["image/png","image/jpeg"]});
 assert.equal(report.execution,"not-tested");
 assert.doesNotMatch(JSON.stringify(report),/sk-bf-fixture/);
 const uncertain=nativeJudgeCapabilityEvidence({...judge,model:"jev-latest"},{minSide:280});
 assert.equal(uncertain.boxQuestions,"unverified-version","version alias is not a verified 1.14.0 entitlement");
 assert.equal(nativeJudgeCapabilityEvidence({...judge,api:"openai-decisions"}).boxQuestions,"unavailable");
 assert.equal(nativeJudgeCapabilityEvidence({...judge,imageEnabled:false}).imageBounds,"unavailable");
});

test("R5F-07 pinned OMP native image API supplies authoritative bounds (mocked export; no new scaling policy)",async()=>{
 const judge=nativeJudgeGateway(config,{PIFROST_NATIVE_JUDGE_MODEL:"jev-1.14.0",PIFROST_NATIVE_JUDGE_IMAGES:"1"});
 let calls=0;
 const result=await resolvePinnedOmpJudgeCapabilities(judge,{catalog:{getBundledModels:()=>[{
   id:"jev-1.14.0",api:"typesafe",input:["text","image"]}]},api:{
   nativeJudgmentImageBounds(model){calls++;assert.equal(model.api,"typesafe");return {minSide:280,maxSide:1568,maxCount:4}},
   nativeJudgmentSupportsBoxes(model){assert.equal(model.id,"jev-1.14.0");return true;}
 }});
 assert.equal(calls,1);
 assert.equal(result.ompBoxWire,"forwarded-by-wire");
 assert.deepEqual(result.bounds,{minSide:280,maxSide:1568,maxCount:4});
 const unavailable=await resolvePinnedOmpJudgeCapabilities(judge,{catalog:{getBundledModels:()=>[]},api:{}});
 assert.equal(unavailable.imageBounds,"unverified");
});

test("R5F-08 Azure/Databricks listing does not imply Decisions capability or create outbound requests",()=>{
 const input={data:[
  {id:"azure/microsoft-decision-1",kind:"judgment",key:"private-secret"},
  {id:"databricks/ai_decide"},
  {id:"azure/not-decision-chat"},
  {id:"openai/gpt-6-luna"},
  {id:"databricks/../../unsafe"}
 ]};
 const report=decisionProviderInventory(input);
 assert.equal(report.providers[0].status,"listed-not-decision-verified");
 assert.equal(report.providers[0].verifiedExecution,false);
 assert.equal(report.providers[1].status,"listed-not-decision-verified");
 assert.equal(report.decisionEndpoint,"unverified");
 assert.doesNotMatch(JSON.stringify(report),/private-secret|unsafe/);
 const absent=decisionProviderInventory({data:[]});
 assert.ok(absent.providers.every(p=>p.status==="not-listed"));
 assert.throws(()=>decisionProviderInventory({data:{}}),/no data array/);
});
