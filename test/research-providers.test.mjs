import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMcpClientShape } from "../mcp-client-shape.mjs";
import {
  RESEARCH_PROFILES, normalizeResearchPreference, researchProviderDiagnostics,
  eligibleResearchCodeModeClients, probeResearchCodeMode,
} from "../research-providers.mjs";
import { classifyResearchResult } from "../research-results.mjs";

function client(name="donsetch", options={}) {
  return normalizeMcpClientShape({
    config: {client_id:name+"-id",name,is_code_mode_client:options.code??false,tools_to_execute:options.execute??["*"],tools_to_auto_execute:options.auto??[]},
    tools:options.tools??Object.values(RESEARCH_PROFILES.donsetch.tools),
    state:"connected",
  });
}
function policy(name="donsetch",tools=["*"]) { return {effective:[{client:name,tools,sources:["direct"]}],virtualMcps:[]}; }
const direct = (name,tools) => tools.map(t=>({name:"mcp__bifrost_"+name+"_"+t}));
test("DonSeTch detected by stable profile, not hardcoded Hound contract count",()=>{
  const c=client(),p=researchProviderDiagnostics(policy(),[c],{liveTools:direct("donsetch",c.tools)});
  assert.equal(p.preferred,"donsetch");
  assert.equal(p.providers[0].status,"research-ready");
  assert.equal(p.providers[0].screenshotCallable,true);
  assert.equal(p.providers[0].deepResearchReady,true);
  assert.equal(p.providers[0].statefulHandles,true);
});
test("separate client execute deny overrides repo wildcard and gateway discoverability",()=>{
  const c=client("donsetch",{execute:["web_fetch","web_crawl","web_screenshot"]});
  const p=researchProviderDiagnostics(policy(),[c],{liveTools:direct("donsetch",c.tools)});
  assert.equal(p.providers[0].capabilities.search.visible,true);
  assert.equal(p.providers[0].capabilities.search.executable,false);
  assert.equal(p.providers[0].searchReady,false);
  assert.equal(p.ready,false);
  assert.equal(p.providers[0].status,"partial");
});
test("missing gateway evidence cannot claim operational readiness",()=>{
  const c=client();const result=researchProviderDiagnostics(policy(),[c]);
  assert.equal(result.providers[0].status,"configured-unverified");
  assert.equal(result.providers[0].searchReady,false);
});
test("a search-only generic MCP is useful, never falsely full research-ready",()=>{
  const c=client("alternative",{tools:["search_web","delete_all"]});
  const result=researchProviderDiagnostics(policy("alternative"),[c],{
    research:{preferred:"alt",providers:[{id:"alt",clientId:"alternative-id",profile:"generic",tools:{search:"search_web"}}]},
    liveTools:direct("alternative",["search_web","delete_all"]),
  });
  assert.equal(result.preferred,"alt");
  assert.equal(result.providers[0].status,"partial");
  assert.equal(result.providers[0].searchReady,true);
  assert.equal(result.providers[0].webResearchReady,false);
});
test("similar-looking tool names never discover generic providers automatically",()=>{
  const c=client("anonymous",{tools:["web_search","web_fetch"]});
  assert.equal(researchProviderDiagnostics(policy("anonymous"),[c],{liveTools:direct("anonymous",c.tools)}).providers.length,0);
});
test("ambiguous unprefixed gateway names cannot prove identity for two clients",()=>{
  const a=client("donsetch"),b=client("alternative",{tools:["web_search"]});
  const p=researchProviderDiagnostics(policy("donsetch"),[a,b],{liveTools:[{name:"mcp__bifrost_web_search"}]});
  assert.equal(p.providers[0].capabilities.search.visible,false);
});
test("provider bindings are validated and matched by ID after a rename",()=>{
  const c=client("renamed",{tools:Object.values(RESEARCH_PROFILES.donsetch.tools)});
  const research={preferred:"ds",providers:[{id:"ds",clientId:"renamed-id",mcpClient:"old",profile:"donsetch"}]};
  assert.equal(researchProviderDiagnostics(policy("renamed"),[c],{research,liveTools:direct("renamed",c.tools)}).providers[0].status,"research-ready");
  assert.throws(()=>normalizeResearchPreference({preferred:"missing",providers:research.providers}),/Preferred/u);
  assert.throws(()=>normalizeResearchPreference({providers:[{id:"generic",mcpClient:"x"}]}),/requires explicit/u);
  assert.throws(()=>normalizeResearchPreference({providers:[{id:"bad",mcpClient:"x",tools:{search:"safe",fetch:"safe"}}]}),/distinct/u);
});
test("Code Mode stub probing reads metadata only and confirms real functions, not comments",async()=>{
  const c=client("donsetch",{code:true}),calls=[];
  const probe=await probeResearchCodeMode(async(name,args)=>{
    calls.push({name,args});
    if(name==="listToolFiles")return {content:[{type:"text",text:"servers/\n  donsetch.pyi\n  other.pyi"}]};
    if(name==="readToolFile")return {content:[{type:"text",text:"# def unsafe() comment\nasync def web_search(query: str) -> dict:\n  pass\ndef web_fetch(url: str) -> dict:\n  pass"}]};
    throw Error("execution forbidden");
  },[c]);
  assert.deepEqual(calls.map(x=>x.name),["listToolFiles","readToolFile"]);
  assert.deepEqual(probe["donsetch-id"].tools,["web_search","web_fetch"]);
  const live= ["listToolFiles","readToolFile","getToolDocs","executeToolCode"].map(t=>({name:"mcp__bifrost_"+t}));
  const result=researchProviderDiagnostics(policy(),[c],{liveTools:live,codeModeProbes:probe});
  assert.equal(result.providers[0].status,"research-ready");
  assert.equal(result.providers[0].screenshotCallable,false);
  assert.equal(result.providers[0].mode,"code");
  const spoof=live.map(x=>({name:"mcp__other_"+x.name.split("_").at(-1)}));
  assert.equal(researchProviderDiagnostics(policy(),[c],{liveTools:spoof,codeModeProbes:probe}).providers[0].searchReady,false);
  assert.deepEqual(eligibleResearchCodeModeClients(policy(),[c]),[c]);
});
test("Code Mode metadata never claims screenshot visual readiness",()=>{
  const c=client("donsetch",{code:true}),live=["listToolFiles","readToolFile","executeToolCode"].map(t=>({name:"mcp__bifrost_"+t}));
  const p=researchProviderDiagnostics(policy(),[c],{liveTools:live,codeModeProbes:{"donsetch-id":{ok:true,tools:c.tools}}});
  assert.equal(p.providers[0].visualWebStatus,"conditional-code-mode");
});
test("DonSeTch success and failure envelopes support folded and structured responses",()=>{
  const failed=classifyResearchResult({isError:false,content:[{type:"text",text:'[meta] {"ok":false,"code":"wall.captcha","next_action":"try other source"}\n\nBlocked'}]},"donsetch");
  assert.deepEqual([failed.ok,failed.code,failed.nextAction,failed.source],[false,"wall.captcha","try other source","folded-meta"]);
  const successful=classifyResearchResult({structuredContent:{ok:true,url:"https://example.org/",next_offset:100},content:[{type:"text",text:"Article"}]},"donsetch");
  assert.equal(successful.ok,true);assert.equal(successful.continuation,100);
  assert.equal(classifyResearchResult({isError:true,content:[]}).ok,false);
  assert.equal(classifyResearchResult({isError:false,content:[{type:"text",text:"Unclassified"}]},"donsetch").ok,undefined);
});
