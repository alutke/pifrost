import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayImageCountBudget, verifiedImageCountBudget, conservativeRouteImageCountBudget,
} from "../image-count-budget.ts";
import { buildPifrostCatalog, toProviderModel } from "../index.ts";

test("optional gateway count is an exact positive integer only",()=>{
  assert.equal(verifiedImageCountBudget(12),12);
  for(const bad of [undefined,null,0,-1,1.7,Number.NaN,Infinity,true,"20",10001])
    assert.equal(verifiedImageCountBudget(bad),undefined);
  assert.equal(gatewayImageCountBudget({}),undefined);
  assert.equal(gatewayImageCountBudget({image_count_budget:6}),6);
  assert.equal(gatewayImageCountBudget({per_request_limits:{images:4}}),4);
  assert.equal(gatewayImageCountBudget({image_count_budget:5,per_request_limits:{images:5}}),5);
  assert.equal(gatewayImageCountBudget({image_count_budget:6,per_request_limits:{images:9}}),undefined);
  assert.equal(gatewayImageCountBudget({image_count_budget:"5"}),undefined);
});
const image=(n,source="live")=>({input:["text","image"],imageCountBudget:n,capabilitySources:{imageCountBudget:source}});
test("conservative route count requires every eligible member to be verified",()=>{
  assert.equal(conservativeRouteImageCountBudget([image(8),image(3)]),3);
  assert.equal(conservativeRouteImageCountBudget([]),undefined);
  assert.equal(conservativeRouteImageCountBudget([image(8),image(undefined)]),undefined);
  assert.equal(conservativeRouteImageCountBudget([image(8),image(3,"fallback")]),undefined);
  assert.equal(conservativeRouteImageCountBudget([image(8),{...image(3),input:["text"]}]),undefined);
  assert.equal(conservativeRouteImageCountBudget([image(8),image(0)]),undefined);
});
function physical(id:string,count?:number,modality="image"){
  const b=toProviderModel({
    id,kind:"chat",context_length:128000,max_output_tokens:8192,
    architecture:{input_modalities:["text",modality]},image_count_budget:count,
  });
  assert.ok(b);
  return b;
}
test("native catalog carries explicit count, route min, and no invented fallback value",()=>{
  const a=physical("openai/model-a",10);
  const b=physical("openai/model-b",4);
  const c=physical("openai/model-c");
  const txt=physical("openai/model-txt",5,"text");
  assert.equal(a.imageCountBudget,10);
  assert.equal(txt.imageCountBudget,undefined);
  const aliases={
    aliases:{
      "omp-good":["openai/model-a","openai/model-b"],
      "omp-unknown":["openai/model-a","openai/model-c"],
      "omp-text":["openai/model-a","openai/model-txt"],
      "omp-unresolved":["openai/model-a","openai/does-not-exist"],
    },
  };
  const catalog=buildPifrostCatalog([a,b,c,txt],aliases);
  const good=catalog.models.find(m=>m.id==="omp-good");
  assert.equal(good?.imageCountBudget,4);
  assert.equal(good?.capabilitySources?.imageCountBudget,"live");
  assert.equal(catalog.models.find(m=>m.id==="omp-unknown")?.imageCountBudget,undefined);
  assert.equal(catalog.models.find(m=>m.id==="omp-text")?.imageCountBudget,undefined);
  assert.equal(catalog.models.find(m=>m.id==="omp-unresolved"),undefined);
  assert.equal(catalog.diagnostics.find(d=>d.id==="omp-good")?.imageCountBudget,4);
});
