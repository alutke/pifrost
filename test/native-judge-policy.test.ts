import assert from "node:assert/strict";
import test from "node:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { getBundledModels } from "@oh-my-pi/pi-catalog";
import { resolveJudgmentImageInput } from "@oh-my-pi/pi-catalog/compat/judgment-images";
function wrapped(provider:string,id:string,api:"typesafe"|"openai-decisions"){
 const source=provider==="typesafe"?"jev-latest":"gpt-6-luna-decisions";
 const seed=getBundledModels(provider).find(model=>model.id===source);
 assert.ok(seed,"bundled judge catalog seed missing");
 return buildModel({...seed,provider:"bifrost-judge",providerType:provider,id,
  name:"Pifrost wrapped judge",api,input:["text","image"],kind:"judge"});
}
test("Bifrost Jev model preserves upstream policy identity and experimental image bounds",()=>{
 const model=wrapped("typesafe","jev-1.14.0","typesafe");
 assert.equal(model.provider,"bifrost-judge");
 assert.equal(model.providerType,"typesafe");
 const limits=resolveJudgmentImageInput(model);
 assert.ok(limits,"TypeSafe image bounds must resolve under providerType override");
 assert.equal(limits.minSide,280);
 assert.equal(limits.maxSide,1568);
 assert.ok(limits.mimeTypes?.includes("image/png"));
 assert.ok(limits.mimeTypes?.includes("image/jpeg"));
});
test("OpenAI Decisions wrapped judge keeps native API and physical policy identity",()=>{
 const model=wrapped("openai","gpt-6-luna-decisions","openai-decisions");
 assert.equal(model.provider,"bifrost-judge");
 assert.equal(model.providerType,"openai");
 assert.equal(model.api,"openai-decisions");
});
