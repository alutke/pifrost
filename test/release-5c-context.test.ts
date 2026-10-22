import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "@oh-my-pi/pi-ai";
import { resolveImageTokenization, imageTokens } from "@oh-my-pi/pi-catalog/compat/image-tokenization";
import {
  installPifrostImageTokenPolicy, estimatePifrostImageTokens,
  resolvePifrostImageTokenization,
} from "../omp-context-policy.ts";
import {createModelAwareContextTokenizer,estimateOmpContextInputTokens} from "../context-estimator.ts";
import {fetchBifrostModels,BifrostModelInventoryIncompleteError} from "../index.ts";

function image(width:number,height:number){
  const bytes=Buffer.alloc(26);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes,0);
  bytes.writeUInt32BE(13,8);
  Buffer.from("IHDR").copy(bytes,12);
  bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);
  bytes[24]=8;bytes[25]=2;
  return {type:"image",data:bytes.toString("base64"),detail:"original"};
}
const flash={
  provider:"deepseek",id:"deepseek-v4.1-flash",api:"openai-completions",
  identity:{class:"deepseek",family:"flash",revision:"4.1"},
} as const;
const gpt={
  provider:"openai",id:"gpt-5.6-sol",api:"openai-responses",
  identity:{class:"openai",family:"gpt",revision:"5.6"},
} as const;

test("R5C-01 OMP 18.12.5 public rule applies to DeepSeek V4.1 and beats older generic wire pricing",()=>{
  installPifrostImageTokenPolicy(resolveImageTokenization,imageTokens);
  try {
    const rule=resolveImageTokenization(flash);
    assert.equal(rule?.regime,"deepseek-patch");
    assert.equal(rule?.verified,true);
    const specimen=image(1800,1200);
    const expected=imageTokens(rule!,{width:1800,height:1200},"original");
    assert.equal(estimatePifrostImageTokens(specimen,flash),expected);
    assert.ok(expected>=1&&expected<=1024,"deepseek billing has a 1024 visual-token ceiling");
    const oldWire=estimatePifrostImageTokens(specimen,{id:"unknown",api:"openai-completions"});
    assert.ok(oldWire>expected,"old OpenAI wire rule caused premature compaction");
    const gptRule=resolveImageTokenization(gpt);
    assert.ok(gptRule);
    assert.equal(estimatePifrostImageTokens(specimen,gpt),imageTokens(gptRule!,{width:1800,height:1200},"original"));
  } finally {installPifrostImageTokenPolicy(undefined,undefined)}
});

test("R5C-02 standalone fallback matches 18.12.5 DeepSeek formula when compiled host resolver unavailable",()=>{
  installPifrostImageTokenPolicy(undefined,undefined);
  const rule=resolveImageTokenization(flash);
  assert.ok(rule);
  const specimen=image(1800,1200);
  assert.equal(resolvePifrostImageTokenization(flash).regime,"deepseek-patch");
  assert.equal(estimatePifrostImageTokens(specimen,flash),imageTokens(rule!,{width:1800,height:1200},"original"));
  assert.ok(estimatePifrostImageTokens({type:"image",data:"invalid"},flash)<=1024);
  assert.equal(estimatePifrostImageTokens({type:"image",data:"invalid"},gpt),12000);
});

test("R5C-03 provider image policy changes contextual prewalk without compaction or role caps",()=>{
  installPifrostImageTokenPolicy(resolveImageTokenization,imageTokens);
  try {
    const context={systemPrompt:["you are an assistant"],messages:[{
      role:"user",timestamp:1,content:Array.from({length:25},()=>image(1800,1200)),
    }],tools:[]} as unknown as Context;
    const flashEstimate=estimateOmpContextInputTokens(context,createModelAwareContextTokenizer(flash));
    const oldEstimate=estimateOmpContextInputTokens(context,createModelAwareContextTokenizer({id:"unknown",api:"openai-completions"}));
    assert.ok(flashEstimate>0);
    assert.ok(flashEstimate<oldEstimate, "25-image history must not be overcounted with OpenAI default");
  } finally {installPifrostImageTokenPolicy(undefined,undefined)}
});

const config={url:"http://bifrost.invalid/v1",virtualKey:"test-vk"};
const model=(id:string)=>({id,model_kind:"chat",context_length:65536,max_output_tokens:4096});
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}})}
test("R5C-04 Bifrost discovery follows all opaque pages and preserves headers without changing model eligibility",async()=>{
  const urls:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);urls.push(url);
    const headers=new Headers(init?.headers);
    assert.equal(headers.get("x-bf-vk"),"test-vk");
    return urls.length===1
      ? reply({data:[model("custom/a")],next_page_token:"opaque/+=="})
      : reply({data:[model("custom/b")],next_page_token:""});
  };
  const inventory=await fetchBifrostModels(config,{fetch:fetcher});
  assert.deepEqual(inventory.map(x=>x.id),["custom/a","custom/b"]);
  assert.equal(urls.length,2);
  assert.match(urls[1]!,/page_token=opaque/u);
});

test("R5C-05 incomplete pagination never silently appears as a complete Bifrost route catalogue",async()=>{
  const scenarios=[
    {data:[model("custom/a")],has_more:true},
    {data:[model("custom/a")],next_page_token:"again"},
    {data:[model("custom/a")],key_statuses:[{status:"failed",provider:"custom"}]},
  ];
  for(const scenario of scenarios){
    const fetcher:typeof fetch=async()=>reply(scenario);
    await assert.rejects(fetchBifrostModels(config,{fetch:fetcher}),BifrostModelInventoryIncompleteError);
  }
  const fetcher:typeof fetch=async()=>reply({data:[model("custom/a")],next_page_token:"same"});
  await assert.rejects(fetchBifrostModels(config,{fetch:fetcher}),/repeated or invalid pagination cursor/u);
});
