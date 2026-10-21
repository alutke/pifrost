import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeRouteState } from "../runtime-route-state.ts";
import type { BifrostProviderModel, AliasDiagnostic } from "../index.ts";

function model(id:string):BifrostProviderModel {
  return { id, name:id, reasoning:false, input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
    contextWindow:200000,maxTokens:65536,supportsTools:true,compat:{
      supportsDeveloperRole:false,supportsReasoningEffort:false,supportsUsageInStreaming:true,
    } };
}
const diag=(id:string,reference:string):AliasDiagnostic=>({
  id,name:id,chain:[reference],resolved:[],unresolved:[],
  contextWindow:200000,maxTokens:65536,image:false,reasoning:false,reasoningEfforts:[],tools:true,
} as AliasDiagnostic);
test("R3-01 independent OMP extension stores have no shared runtime routing state",()=>{
  const left=createRuntimeRouteState(),right=createRuntimeRouteState();
  assert.equal(left.capture().generation,0);
  assert.equal(right.capture().generation,0);
  left.publish([model("provider/one")],[diag("omp-default","provider/one")]);
  assert.equal(left.capture().generation,1);
  assert.equal(left.capture().aliasDiagnostics.get("omp-default")?.chain[0],"provider/one");
  assert.equal(right.capture().generation,0);
  assert.equal(right.capture().aliasDiagnostics.has("omp-default"),false);
});
test("R3-02 concurrent in-flight request retains exact original route generation",()=>{
  const store=createRuntimeRouteState();
  store.publish([model("provider/one")],[diag("omp-default","provider/one")]);
  const existingRequest=store.capture();
  store.publish([model("provider/two")],[diag("omp-default","provider/two")]);
  const nextRequest=store.capture();
  assert.notStrictEqual(existingRequest,nextRequest);
  assert.equal(existingRequest.generation,1);
  assert.equal(nextRequest.generation,2);
  assert.equal(existingRequest.aliasDiagnostics.get("omp-default")?.chain[0],"provider/one");
  assert.equal(nextRequest.aliasDiagnostics.get("omp-default")?.chain[0],"provider/two");
});
test("R3-03 invalid catalogue publication is atomic and cannot erase previously working route state",()=>{
  const store=createRuntimeRouteState();
  store.publish([model("provider/one")],[diag("omp-default","provider/one")]);
  const previous=store.capture();
  const broken={...diag("omp-default","provider/two"),chain:null} as unknown as AliasDiagnostic;
  assert.throws(()=>store.publish([model("provider/two")],[broken]));
  assert.strictEqual(store.capture(),previous);
  assert.equal(previous.generation,1);
});
