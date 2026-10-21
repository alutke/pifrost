import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { dynamicRouteContract, opaqueRouteContract, gatewaySelectionRelativeToPrimary, compatibilityExecutionError, assertLiveCompatibilityAttestation } from "../route-compatibility.ts";
import { planDynamicRouteAttempts, canUseNativeBifrostRoute, type DynamicRouteProfile } from "../dynamic-routing.ts";
import type { AliasDiagnostic } from "../index.ts";
import { classifyInferenceFailure } from "../inference-failure.ts";
import { isGatewayProtocolRejection } from "../multi-protocol-routing.ts";

const sha="a".repeat(64);
const now=Date.now();
const member=(reference:string,protocol:"openai-completions"|"openai-responses"="openai-completions")=>({
  reference,resolvedModelId:reference,contextWindow:1000000,maxTokens:200000,
  input:["text" as const],reasoning:true,supportsTools:true,protocols:[protocol],
  compat:{supportsToolChoice:true},
});
const profile=(...members:ReturnType<typeof member>[]):DynamicRouteProfile=>({
  id:"omp-default",mode:"context-aware",source:"bifrost-simple-rule",
  staticContextWindow:1000000,advertisedContextWindow:1000000,maxTokens:200000,
  synchronizedAt:new Date(now).toISOString(),policyFingerprint:sha,members,bands:[],
});
const body={model:"omp-default",messages:[{role:"user",content:"hello"}],max_tokens:150000};
const plan=(p:DynamicRouteProfile, keys?:Map<string,string>)=>planDynamicRouteAttempts(p,body,
  {estimatedInputTokens:100,compatibilityByMember:keys});
test("C-01 all affinity-reachable members share one Chat contract; Bifrost native route remains enabled",()=>{
  const a=member("openai/a"),b=member("openai/b"),p=profile(a,b);
  const q=plan(p,new Map([[a.reference,"same-encoder"],[b.reference,"same-encoder"]]));
  assert.equal(q.encoderContractsComplete,true);
  assert.equal(canUseNativeBifrostRoute(p,q),true);
  const e=dynamicRouteContract(p,q);
  assert.equal(e.mode,"bifrost-native");
  assert.equal(e.verification,"verified-local-snapshot");
  assert.equal(e.possibleMembers,2);
  assert.equal(e.unknownMembers,0);
  assert.equal(compatibilityExecutionError(p,q),undefined);
});
test("C-02 known heterogeneous physical encoders use bounded compatibility exceptions",()=>{
  const a=member("opencode-go/deepseek-v4"),b=member("commandcode/deepseek-v4"),p=profile(a,b);
  const q=plan(p,new Map([[a.reference,"policy-a"],[b.reference,"policy-b"]]));
  assert.equal(canUseNativeBifrostRoute(p,q),false);
  assert.deepEqual(q.attempts.map(x=>x.primary),[a.reference,b.reference]);
  assert.equal(dynamicRouteContract(p,q).mode,"pifrost-compatibility");
  assert.equal(compatibilityExecutionError(p,q),undefined);
});
test("C-03 incomplete physical encoder knowledge never becomes native passthrough or local compatibility permission",()=>{
  const a=member("provider/a"),b=member("provider/b"),p=profile(a,b);
  const q=plan(p,new Map([[a.reference,"known"]]));
  assert.equal(q.encoderContractsComplete,false);
  assert.equal(canUseNativeBifrostRoute(p,q),false);
  assert.match(compatibilityExecutionError(p,q)??"",/unresolved physical encoder/u);
  const one=profile(a),unknown=plan(one);
  assert.equal(canUseNativeBifrostRoute(one,unknown),false,"single unknown encoder must not be called native-safe");
});
test("C-04 missing fingerprint or stale policy rejects local physical dispatch, not gateway passthrough",()=>{
  const a=member("provider/a"),b=member("provider/b"),p=profile(a,b);
  const q=plan(p,new Map([[a.reference,"x"],[b.reference,"y"]]));
  assert.match(compatibilityExecutionError({...p,policyFingerprint:undefined},q)??"",/policy fingerprint/u);
  assert.match(compatibilityExecutionError({...p,synchronizedAt:"2000-01-01T00:00:00Z"},q)??"",/last synchronized/u);
  const native=plan(profile(a),new Map([[a.reference,"x"]]));
  assert.equal(compatibilityExecutionError({...profile(a),policyFingerprint:undefined},native),undefined,"no locally lowered route");
});
test("C-05 opaque CEL, key-pinned and conditional route members remain gateway-owned",()=>{
  const diagnostic={id:"omp-default",name:"default",chain:["provider/a","provider/b"],resolved:[],unresolved:[],
    image:false,reasoning:true,reasoningEfforts:[],tools:true,
    routingPins:[{source:"target",keyId:"SECRET_DO_NOT_PRINT"}],
    members:[{reference:"provider/a",status:"resolved",protocols:["openai-responses"]},
      {reference:"provider/b",status:"resolved",protocols:["openai-completions"]}],
  } as AliasDiagnostic;
  const e=opaqueRouteContract("omp-default",diagnostic);
  assert.equal(e.mode,"bifrost-direct");
  assert.equal(e.mixedProtocols,true);
  assert.equal(e.possibleMembers,2);
  assert.equal(e.encodersComplete,false);
  assert.doesNotMatch(JSON.stringify(e),/SECRET_DO_NOT_PRINT/u);
});
test("C-06 gateway served model can differ from primary; cause is always unknown",()=>{
  const c=opaqueRouteContract("omp-default",{
    id:"omp-default",name:"default",chain:["OpenCode Go/deepseek/deepseek-v4.1-flash"],resolved:[],unresolved:[],
    image:false,reasoning:true,reasoningEfforts:[],tools:true,
  });
  assert.equal(gatewaySelectionRelativeToPrimary(c,"opencode-go","deepseek/deepseek-v4.1-flash"),"matches-cached-primary");
  assert.equal(gatewaySelectionRelativeToPrimary(c,"commandcode","deepseek/deepseek-v4.1-flash"),"differs-from-cached-primary");
  assert.equal(gatewaySelectionRelativeToPrimary(c,undefined,"deepseek/deepseek-v4.1-flash"),"unverified");
  assert.equal(c.gatewaySelectionCause,"unknown");
});
test("C-07 virtual-key model denial remains an authorization failure; no protocol retry or bypass",()=>{
  const error={type:"model_blocked",message:"Model example-model is not allowed for virtual key example-key"};
  assert.equal(classifyInferenceFailure(403,{error}).code,"MODEL_NOT_PERMITTED");
  assert.equal(isGatewayProtocolRejection(new Error(error.message)),false);
});

test("R1-06 physical compatibility dispatch needs fresh matching live fingerprint and complete ordered membership",()=>{
  const p=profile(member("provider/a"),member("provider/b"));
  const at=Date.parse("2026-10-21T12:00:00Z");
  const valid={schemaVersion:1,status:"verified",alias:p.id,policyFingerprint:p.policyFingerprint,
    memberDigest:createHash("sha256").update(JSON.stringify(p.members.map(m=>m.reference))).digest("hex"),
    verifiedAt:new Date(at).toISOString()};
  assert.doesNotThrow(()=>assertLiveCompatibilityAttestation(p,valid,at+2000));
  for (const changed of [
    {...valid,policyFingerprint:"b".repeat(64)},
    {...valid,memberDigest:"b".repeat(64)},
    {...valid,alias:"omp-advisor"},
    {...valid,verifiedAt:new Date(at-16000).toISOString()},
    {...valid,status:"unverified"},
  ]) assert.throws(()=>assertLiveCompatibilityAttestation(p,changed,at),/physical dispatch blocked/u);
});
