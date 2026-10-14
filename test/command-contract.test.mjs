import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {COMMAND_SPEC, parseCliArgs, validateCommand, commandUsage, CommandUsageError} from "../command-contract.mjs";
import {healthExitCode, renderHealthOverview, wrapTerminalText} from "../terminal-presentation.mjs";

const commands=Object.keys(COMMAND_SPEC);
test("the entire CLI command registry has stable, accessible contextual help",()=>{
  assert.equal(commands.length,46,"Release 0.21 command surface must not silently drift");
  for(const name of commands){
    const help=commandUsage(name);
    assert.match(help,/^Usage: pifrost /u,name);
    assert.match(help,/Effect: /u,name);
    assert.match(help,/--help/u,name);
    assert.doesNotMatch(help,/\x1b\[|\r/u,name);
  }
});
test("option grammar rejects missing values, duplicate options, unknown options and invalid integers",()=>{
  assert.throws(()=>parseCliArgs(["repo","mcp","add","x","--tools"]),/requires a value/u);
  assert.throws(()=>parseCliArgs(["doctor","--verbose","--verbose"]),/Duplicate option/u);
  assert.throws(()=>parseCliArgs(["doctor","--verrbose"]),/Unknown option/u);
  assert.throws(()=>parseCliArgs(["routes","list","--limit","3bad"]),/non-negative integer/u);
  assert.throws(()=>parseCliArgs(["doctor","--verbose=true"]),/cannot accept a value/u);
  assert.deepEqual(parseCliArgs(["routes","list","--limit=12"]).flags,{limit:12});
  assert.deepEqual(parseCliArgs(["routes","explain","default","--tools"]).flags,{tools:true});
  assert.throws(()=>validateCommand("doctor",[],{tools:true}),/not valid/u);
  assert.throws(()=>validateCommand("routes list",["surplus"],{}),/Invalid arguments/u);
});
test("wildcard grants require explicit opt-in and tool scopes cannot broaden accidentally",()=>{
  assert.throws(()=>validateCommand("repo mcp add",["search"],{}),/--tools/u);
  assert.throws(()=>validateCommand("repo mcp add",["search"],{tools:"*"}),/Wildcard/u);
  assert.throws(()=>validateCommand("repo mcp add",["search"],{tools:"fetch,*"}),/wildcard/u);
  assert.throws(()=>validateCommand("repo mcp add",["search"],{tools:"fetch,,crawl"}),/empty tool/u);
  assert.throws(()=>validateCommand("repo mcp add",["search"],{tools:"fetch","allow-all-tools":true}),/OR/u);
  assert.equal(validateCommand("repo mcp add",["search"],{tools:"fetch,crawl"}).min,1);
  assert.equal(validateCommand("repo mcp add",["search"],{"allow-all-tools":true}).min,1);
  assert.throws(()=>validateCommand("repo init",[],{clients:"donsetch",tools:"*"}),/Wildcard/u);
});
test("common health contract distinguishes required failure, warning and strict unknown",()=>{
  const checks=[{label:"Inference",status:"ok",required:true},{label:"Logging",status:"unknown",required:false}];
  assert.equal(healthExitCode(checks),0);
  assert.equal(healthExitCode(checks,{strict:true}),2);
  assert.equal(healthExitCode([...checks,{label:"Gateway",status:"fail",required:true}]),2);
  assert.equal(healthExitCode([{label:"Optional",status:"fail",required:false}]),0);
  const text=renderHealthOverview([{label:"Gateway",status:"fail",id:"GATEWAY_UNAVAILABLE",required:true,
    detail:"Cannot connect",action:"pifrost global setup"}]);
  assert.match(text,/GATEWAY_UNAVAILABLE/u);
  assert.match(text,/pifrost global setup/u);
  assert.match(wrapTerminalText("one two three four five six seven",18),/\n/u);
});
test("CLI errors occur before any configuration or gateway side-effects",()=>{
  const temp=mkdtempSync(resolve(tmpdir(),"pifrost-ux-schema-"));
  const env={...process.env,HOME:temp,PIFROST_CONFIG_DIR:resolve(temp,"config"),BIFROST_URL:"",BIFROST_VIRTUAL_KEY:""};
  const invoke=(...args)=>spawnSync(process.execPath,["cli.mjs",...args],{
    cwd:resolve(import.meta.dirname,".."),env,encoding:"utf8",timeout:12000});
  try{
    const invalid=invoke("repo","mcp","add","any-client");
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/Explicitly choose --tools/u);
    const unknown=invoke("repo","skills","list","--delete-remote");
    assert.equal(unknown.status,1);
    assert.match(unknown.stderr,/not valid/u);
    const usage=invoke("repo","mcp","add","--help");
    assert.equal(usage.status,0,usage.stderr);
    assert.match(usage.stdout,/Changes gateway access/u);
    const noEcho=invoke("doctor","--json","--invalid","private-value");
    assert.equal(noEcho.status,1);
    assert.doesNotMatch(noEcho.stderr,/private-value/u);
    const json=invoke("models","doctor","--json");
    assert.ok([0,2].includes(json.status));
    const body=JSON.parse(json.stdout);
    assert.equal(body.schemaVersion,1);
    assert.equal(body.command,"models doctor");
    assert.equal(typeof body.output,"string");
  } finally{rmSync(temp,{recursive:true,force:true})}
});
