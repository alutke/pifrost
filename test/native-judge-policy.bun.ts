import assert from "node:assert/strict";
import test from "node:test";
import { getBundledModels } from "@oh-my-pi/pi-catalog";
import { resolveJudgmentImageInput } from "@oh-my-pi/pi-catalog/compat/judgment-images";
import { nativeJudgeGateway } from "../judge-bridge.mjs";
const config={url:"http://127.0.0.1:8180/v1",virtualKey:"sk-bf-test-policy"};
test("OMP upstream Jev model bounds remain known for supported experimental image models",()=>{
 const stock=getBundledModels("typesafe").find(m=>m.id==="jev-latest");
 assert.ok(stock);
 const limits=resolveJudgmentImageInput(stock);
 assert.ok(limits);
 assert.equal(limits.minSide,280);
 assert.equal(limits.maxSide,1568);
 assert.ok(limits.mimeTypes?.includes("image/png"));
 assert.ok(limits.mimeTypes?.includes("image/jpeg"));
});
test("Pifrost only advertises explicitly whitelisted Jev versions with image opt-in",()=>{
 for(const model of ["jev-latest","jev-preview","jev-1.13.0","jev-1.14.0"]){
   const judge=nativeJudgeGateway(config,{PIFROST_NATIVE_JUDGE_MODEL:model,PIFROST_NATIVE_JUDGE_IMAGES:"1"});
   assert.equal(judge?.imageEnabled,true);
 }
 assert.throws(()=>nativeJudgeGateway(config,{
   PIFROST_NATIVE_JUDGE_MODEL:"jev-future",PIFROST_NATIVE_JUDGE_IMAGES:"1",
 }),/verified Jev version/);
 assert.equal(nativeJudgeGateway(config,{PIFROST_NATIVE_JUDGE_MODEL:"jev-1.14.0"})?.imageEnabled,false);
});
