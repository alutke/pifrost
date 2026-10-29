import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli=resolve(import.meta.dirname,"../cli.mjs");
test("migration CLI preserves custom config and supports guarded rollback",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-migrate-cli-"));
  try{
    const bin=join(root,"bin"),ompDir=join(root,"omp");
    mkdirSync(bin,{recursive:true});mkdirSync(ompDir,{recursive:true});
    const config=join(ompDir,"config.yml");
    const original={modelRoles:{default:"bifrost/omp-default",advisor:"user/my-advisor",judge:"decision/jev"},
      enabledModels:["bifrost/*","openai-codex/*"],
      modelProviderOrder:["bifrost","openai-codex"],"user.unrelated":true};
    writeFileSync(config,JSON.stringify(original,null,2));
    const fake=join(bin,"omp");
    writeFileSync(fake,[
      "#!/usr/bin/env node",
      'const fs=require("node:fs");',
      'const p=process.env.PI_CODING_AGENT_DIR+"/config.yml";',
      "const a=process.argv.slice(2);",
      'if(a[0]==="--version"){process.stdout.write("18.12.5\\n");process.exit(0);}',
      'if(a[0]==="plugin"&&a[1]==="list"){process.stdout.write(JSON.stringify({npm:[{name:"pifrost",enabled:true}],marketplace:[]}));process.exit(0);}',
      'if(a[0]==="plugin"&&a[1]==="disable"&&a[2]==="pifrost"){fs.writeFileSync(process.env.PI_CODING_AGENT_DIR+"/plugin-disabled","yes");process.exit(0);}',
      'if(a[0]!=="config"){process.exit(2);}',
      'if(a[1]==="path"){process.stdout.write(process.env.PI_CODING_AGENT_DIR+"\\n");process.exit(0);}',
      'const obj=JSON.parse(fs.readFileSync(p,"utf8"));',
      "const key=a[2];",
      'if(a[1]==="get"){process.stdout.write(JSON.stringify({key,value:obj[key]})+"\\n");process.exit(0);}',
      'if(a[1]==="set"){obj[key]=JSON.parse(a[3]);fs.writeFileSync(p,JSON.stringify(obj,null,2));process.exit(0);}',
      'if(a[1]==="reset"){delete obj[key];fs.writeFileSync(p,JSON.stringify(obj,null,2));process.exit(0);}',
      "process.exit(2);",
    ].join("\n")+"\n");
    chmodSync(fake,0o755);
    const env={...process.env,PATH:bin+":"+process.env.PATH,
      PI_CODING_AGENT_DIR:ompDir,PIFROST_CONFIG_DIR:join(root,"pifrost")};
    const cmd=(args)=>spawnSync(process.execPath,[cli,...args],{env,encoding:"utf8"});
    const dry=cmd(["migrate","disable-extension","--dry-run"]);
    assert.equal(dry.status,0,dry.stderr);
    assert.match(dry.stdout,/Would disable only OMP npm plugin/u);
    const disabled=cmd(["migrate","disable-extension"]);
    assert.equal(disabled.status,0,disabled.stderr);
    assert.equal(readFileSync(join(ompDir,"plugin-disabled"),"utf8"),"yes");
    const status=cmd(["migrate","status"]);
    assert.equal(status.status,0,status.stderr);
    assert.match(status.stdout,/Historical Pifrost roles found: 1/u);
    assert.deepEqual(JSON.parse(readFileSync(config,"utf8")),original);
    const applied=cmd(["migrate","apply"]);
    assert.equal(applied.status,0,applied.stderr+"\n"+applied.stdout);
    const changed=JSON.parse(readFileSync(config,"utf8"));
    assert.deepEqual(changed.modelRoles,{advisor:"user/my-advisor",judge:"decision/jev"});
    assert.deepEqual(changed.enabledModels,["bifrost/*","openai-codex/*"]);
    assert.equal(changed["user.unrelated"],true);
    const rollback=cmd(["migrate","rollback"]);
    assert.equal(rollback.status,0,rollback.stderr+"\n"+rollback.stdout);
    assert.deepEqual(JSON.parse(readFileSync(config,"utf8")),original);
  }finally{rmSync(root,{recursive:true,force:true});}
});
