import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { requireManagement, requireRuntime } from "../cli-preconditions.mjs";
import { ompAgentDir } from "../cli-lib.mjs";
import { nativeProviderBlock, nativeModelsPath, writeNativeModels } from "../native-models.mjs";

test("Bifrost management requires gateway+management auth, NOT inference credentials",()=>{
  const state={config:{bifrost:{url:"http://bifrost.local:8180/v1",managementAuthMode:"basic"}},
    secrets:{managementAdminUsername:"admin",managementAdminPassword:"pass"}};
  const env={};
  const admin=requireManagement(state,env);
  assert.equal(admin.url,"http://bifrost.local:8180/v1");
  assert.equal(admin.virtualKey,undefined);
  assert.equal(admin.managementKey.mode,"basic");
  assert.throws(()=>requireRuntime(state,env),/inference/u);
});

test("OMP profile resolution respects OMP_PROFILE, PI_PROFILE, PI_CONFIG_DIR and explicit agent directory",()=>{
  const root=join(tmpdir(),"omp-config-tests");
  assert.equal(ompAgentDir({PI_CONFIG_DIR:root,OMP_PROFILE:"work",PI_CODING_AGENT_DIR:"/ignore"}),
    join(root,"profiles","work","agent"));
  assert.equal(ompAgentDir({PI_CONFIG_DIR:root,PI_PROFILE:"personal"}),
    join(root,"profiles","personal","agent"));
  assert.equal(ompAgentDir({PI_CONFIG_DIR:root,OMP_PROFILE:"",PI_PROFILE:"personal"}),
    join(root,"agent"));
  assert.equal(ompAgentDir({PI_CONFIG_DIR:root,PI_CODING_AGENT_DIR:"/explicit/agent"}),
    "/explicit/agent");
  assert.throws(()=>ompAgentDir({OMP_PROFILE:"../unsafe"}),/Unsafe OMP profile/u);
});

test("native model auth separates VK header and optional Bearer explicitly",()=>{
  const vk=nativeProviderBlock("http://localhost:8180/v1","openai-completions","vk");
  assert.match(vk,/auth: none/u);
  assert.match(vk,/x-bf-vk: "!pifrost secret inference-vk"/u);
  assert.doesNotMatch(vk,/apiKey:|Authorization:|authHeader: true/u);
  const both=nativeProviderBlock("http://localhost:8180/v1","openai-responses","bearer+vk");
  assert.match(both,/apiKey: "!pifrost secret inference-bearer"/u);
  assert.match(both,/x-bf-vk:/u);
  const onlyBearer=nativeProviderBlock("http://localhost:8180/v1","openai-completions","bearer");
  assert.match(onlyBearer,/apiKey:/u);
  assert.doesNotMatch(onlyBearer,/x-bf-vk:/u);
});

test("environment-only inference secrets are delivered by CLI without persisting config",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-auth-"));
  try{
    const env={...process.env,PIFROST_CONFIG_DIR:root,
      BIFROST_API_KEY:"env-bearer-secret",BIFROST_VIRTUAL_KEY:"env-vk-secret",
      BIFROST_URL:"https://gateway.local/v1"};
    const run=(cmd)=>spawnSync(process.execPath,[resolve(import.meta.dirname,"../cli.mjs"),"secret",cmd],{encoding:"utf8",env});
    const bearer=run("inference-bearer"),vk=run("inference-vk");
    assert.equal(bearer.status,0,bearer.stderr);
    assert.equal(vk.status,0,vk.stderr);
    assert.equal(bearer.stdout,"env-bearer-secret");
    assert.equal(vk.stdout,"env-vk-secret");
    assert.equal(existsSync(join(root,"secrets.json")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("native YAML modifies only active profile path",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-profiles-"));
  try{
    const env={PI_CONFIG_DIR:root,OMP_PROFILE:"work",PI_CODING_AGENT_DIR:join(root,"wrong")};
    const out=writeNativeModels("openai-completions","http://127.0.0.1:8180/v1",env);
    assert.match(out.path,/profiles\/work\/agent\/models.yml$/u);
    assert.match(readFileSync(out.path,"utf8"),/PIFROST-NATIVE-MODELS-START/u);
    assert.equal(existsSync(join(root,"wrong","models.yml")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
