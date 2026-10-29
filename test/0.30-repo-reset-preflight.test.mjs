import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {preflightLocalRepoReset} from "../repo-reset-preflight.mjs";

test("preflight refuses unowned MCP entry before irreversible gateway deletion",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-preflight-"));
 try{
  mkdirSync(join(root,".omp"),{recursive:true});
  writeFileSync(join(root,".omp/mcp.json"),JSON.stringify({
    mcpServers:{bifrost:{headers:{"x-bf-vk":"!pifrost secret repo-mcp --id other"}}}}));
  assert.throws(()=>preflightLocalRepoReset({root,id:"this"},{}),/not owned/u);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("preflight permits owned MCP without modifying it",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-preflight-safe-"));
 try{
  mkdirSync(join(root,".omp"),{recursive:true});
  const body=JSON.stringify({mcpServers:{bifrost:{
    headers:{"x-bf-vk":"!pifrost secret repo-mcp --id this"}}}});
  writeFileSync(join(root,".omp/mcp.json"),body);
  assert.doesNotThrow(()=>preflightLocalRepoReset({root,id:"this"},{}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("preflight refuses malformed MCP JSON and unowned Skill folders",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-preflight-invalid-"));
 try{
  mkdirSync(join(root,".omp"),{recursive:true});
  writeFileSync(join(root,".omp/mcp.json"),"{not json");
  assert.throws(()=>preflightLocalRepoReset({root,id:"this"},{}),/invalid JSON/u);
  rmSync(join(root,".omp/mcp.json"));
  mkdirSync(join(root,".agents/skills/unknown"),{recursive:true});
  assert.throws(()=>preflightLocalRepoReset({root,id:"this"},{bifrostSkills:[{name:"unknown"}]}),/ownership marker/u);
 }finally{rmSync(root,{recursive:true,force:true});}
});
