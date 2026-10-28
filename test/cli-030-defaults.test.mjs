import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pkg from "../package.json" with { type: "json" };

const cli=resolve(import.meta.dirname,"../cli.mjs");
const run=(args,env)=>spawnSync(process.execPath,[cli,...args],{
  encoding:"utf8", env:{...process.env,...env},
});
test("0.30 package has no automatic OMP runtime extension",()=>{
  assert.equal(pkg.omp?.extensions,undefined);
  assert.equal(pkg.bin?.pifrost,"./cli.mjs");
});
test("fresh init dry-run does not install Pifrost plugin or modify OMP",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-030-cli-"));
  try{
    const env={PIFROST_CONFIG_DIR:join(root,"config"),
      PI_CODING_AGENT_DIR:join(root,"omp"),BIFROST_URL:"",BIFROST_VIRTUAL_KEY:"",
      BIFROST_API_KEY:""};
    const result=run(["init","--dry-run"],env);
    assert.equal(result.status,0,result.stderr+"\n"+result.stdout);
    assert.match(result.stdout,/leave all OMP model roles/u);
    assert.doesNotMatch(result.stdout,/Installing\/updating Pifrost OMP extension/u);
    assert.equal(existsSync(join(root,"config")),false);
    assert.equal(existsSync(join(root,"omp")),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("models disable preview never writes OMP config",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-030-disable-"));
 try{
  const r=run(["models","disable","--dry-run"],{PI_CODING_AGENT_DIR:root});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/Would remove only the marked Pifrost/u);
  assert.equal(existsSync(join(root,"models.yml")),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
