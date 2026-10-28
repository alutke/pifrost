import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  commandCatalog,commandUsage,validateCliInvocation,cliUsageError,flagRequiresValue,
} from "../cli-command-schema.mjs";
import {
  healthOutcome,reportHealth,listFilter,safeUiText,
} from "../cli-health.mjs";

const commands=[
"init","global setup","global status","global mcp-policy","global observability","global configure-omp",
"omp readiness","omp context","omp context apply","omp workarounds","judge status","judge providers","judge activate","judge probe","routes list","routes diff","routes verify","routes attest","routes sync","routes reconcile",
"routes diagnose","routes effective","routes explain","migrate status","migrate apply","migrate rollback",
"models list","models status","models enable","models disable","models refresh","models doctor","models kinds",
"repo init","repo status","repo research status","repo research bind","repo research unbind",
"repo research prefer","repo research probe","repo rotate-key","repo reset","repo mcp list",
"repo mcp add","repo mcp remove","repo mcp instructions","repo vmcp list","repo vmcp add",
"repo vmcp remove","repo skills list","repo skills suggestions","repo skills bind","repo skills unbind",
"repo skills dismiss","repo skills undismiss","repo skills add","repo skills remove","repo skills sync",
"secret repo-mcp","secret inference","secret inference-vk","doctor",
];
test("all 62 CLI command contracts are present, documented and readable",()=>{
  assert.deepEqual([...commandCatalog.keys()],commands);
  for(const [name,def] of commandCatalog){
    const h=commandUsage(name);
    assert.match(h,/^Usage: pifrost /u);
    assert.match(h,/Operation: /u);
    assert.match(h,/Detailed help: pifrost help --all/u);
    assert.doesNotMatch(h,/\x1b\[|Bearer|sk-secret/u);
    assert.ok(["read-only","local-change","gateway-change","billed","machine-secret"].includes(def.operation));
    assert.throws(()=>validateCliInvocation(name,Array(def.max+1).fill("arg"),{}),/Expected .* argument/u);
    assert.throws(()=>validateCliInvocation(name,Array(def.min).fill("arg"),{unrecognised:true}),/not valid/u);
  }
});
test("grant allow-lists must be explicit and never silently expand",()=>{
  assert.throws(()=>validateCliInvocation("repo mcp add",["DonSeTch"],{}),/Specify allowed tools explicitly/u);
  assert.throws(()=>validateCliInvocation("repo init",[],{clients:"DonSeTch"}),/explicit --tools/u);
  assert.equal(validateCliInvocation("repo mcp add",["DonSeTch"],{tools:"web_search"}).operation,"gateway-change");
  assert.equal(validateCliInvocation("repo mcp add",["DonSeTch"],{tools:"*"}).operation,"gateway-change");
  assert.equal(flagRequiresValue("tools","routes explain"),false);
  assert.equal(flagRequiresValue("tools","repo mcp add"),true);
});
test("health results distinguish required failure, warning and strict unknown",()=>{
  assert.equal(healthOutcome([{required:true,status:"fail"}]).exitCode,2);
  assert.equal(healthOutcome([{required:false,status:"warn"}]).exitCode,0);
  assert.equal(healthOutcome([{required:false,status:"unknown"}],true).exitCode,2);
  const original=console.log;let serialized="";
  try {
    console.log=value=>{serialized+=String(value);};
    reportHealth({command:"doctor",json:true,checks:[
      {id:"gateway",label:"Gateway",status:"fail",required:true,detail:"Bearer confidential-secret"},
      {id:"provider",label:"Optional provider",status:"unknown",required:false,detail:"not checked"},
    ]});
  } finally {console.log=original;}
  const doc=JSON.parse(serialized);
  assert.equal(doc.schemaVersion,1);
  assert.equal(doc.result,"FAILED");
  assert.equal(doc.checks[0].required,true);
  assert.doesNotMatch(serialized,/Bearer confidential-secret/u);
});
test("filters, pagination and redaction are consistent",()=>{
  const items=[{name:"Asearch"},{name:"Compute"},{name:"Bsearch"}];
  assert.deepEqual(listFilter(items,{filter:"search",limit:"1"}).items,[items[0]]);
  assert.equal(listFilter(items,{filter:"search",limit:"1"}).omitted,1);
  assert.match(safeUiText("Authorization Bearer secret-key"),/\[redacted\]/u);
});
test("CLI invalid arguments are rejected before any gateway access or writes",()=>{
  const home=mkdtempSync(resolve(tmpdir(),"pifrost-ux-contract-"));
  const env={...process.env,HOME:home,PIFROST_CONFIG_DIR:resolve(home,"config"),BIFROST_URL:"",BIFROST_VIRTUAL_KEY:""};
  const run=(...args)=>spawnSync(process.execPath,["cli.mjs",...args],{
    cwd:resolve(import.meta.dirname,".."),env,encoding:"utf8",timeout:10000,
  });
  try{
    for(const [args,message] of [
      [["repo","mcp","add","DonSeTch"],"Specify allowed tools explicitly"],
      [["repo","mcp","add","DonSeTch","--tools"],"requires a value"],
      [["repo","mcp","add","DonSeTch","--tools","--force"],"requires a value"],
      [["repo","init","--clients","DonSeTch"],"explicit --tools"],
      [["doctor","--unrecognised"],"Unknown option"],
      [["routes","explain","default","--output-tokens","bad"],"positive integer"],
      [["repo","reset","extra"],"Expected 0 argument"],
    ]){
      const r=run(...args);
      assert.equal(r.status,1,r.stdout+r.stderr);
      assert.match(r.stderr,new RegExp(message,"iu"),args.join(" "));
      assert.doesNotMatch(r.stderr,/sk-[a-z0-9]{8,}/iu);
    }
    const help=run("repo","mcp","add","--help");
    assert.equal(help.status,0,help.stderr);
    assert.match(help.stdout,/Operation: Changes gateway permissions or credentials/u);
    assert.match(help.stdout,/--tools <value>/u);
    const shortcut=run("routes","explain","default","--tools","--help");
    assert.equal(shortcut.status,0,shortcut.stderr);
    assert.match(shortcut.stdout,/--tools(?:\s|$)/u);
  } finally {rmSync(home,{recursive:true,force:true});}
});

test("every registered command has contextual CLI help without connecting to Bifrost",()=>{
  const root=mkdtempSync(resolve(tmpdir(),"pifrost-help-matrix-"));
  const env={...process.env,HOME:root,PIFROST_CONFIG_DIR:resolve(root,"config"),
    BIFROST_URL:"",BIFROST_VIRTUAL_KEY:""};
  try{
    for(const name of commands){
      const result=spawnSync(process.execPath,["cli.mjs",...name.split(" "),"--help"],{
        cwd:resolve(import.meta.dirname,".."),env,encoding:"utf8",timeout:10000,
      });
      assert.equal(result.status,0,name+": "+result.stderr);
      assert.match(result.stdout,/^Usage: pifrost /u,name);
      assert.match(result.stdout,/^Operation: /mu,name);
      assert.doesNotMatch(result.stdout,/\x1b\[|sk-secret/u,name);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("non-configured JSON status failure still emits parseable, redacted machine output",()=>{
  const root=mkdtempSync(resolve(tmpdir(),"pifrost-json-"));
  try{
    const r=spawnSync(process.execPath,["cli.mjs","repo","status","--json"],{
      cwd:resolve(import.meta.dirname,".."),
      env:{...process.env,HOME:root,PIFROST_CONFIG_DIR:resolve(root,"config"),BIFROST_URL:"",
        BIFROST_API_KEY:"",BIFROST_VIRTUAL_KEY:""},
      encoding:"utf8",timeout:12000,
    });
    const parsed=JSON.parse(r.stdout);
    assert.equal(r.status,2);
    assert.equal(parsed.schemaVersion,1);
    assert.equal(parsed.result,"FAILED");
    assert.equal(parsed.checks[0].id,"command-error");
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("first-time setup preview performs no writes",()=>{
  const home=mkdtempSync(resolve(tmpdir(),"pifrost-setup-preview-"));
  try{
    const r=spawnSync(process.execPath,["cli.mjs","init","--dry-run"],{
      cwd:resolve(import.meta.dirname,".."),
      env:{...process.env,HOME:home,PIFROST_CONFIG_DIR:resolve(home,"config"),
        PI_CODING_AGENT_DIR:resolve(home,"agent")},
      encoding:"utf8",timeout:10000,
    });
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/Read-only preview/u);
    assert.match(r.stdout,/no changes made/u);
  }finally{rmSync(home,{recursive:true,force:true});}
});