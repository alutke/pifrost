import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerPifrost, { runPifrostSlash } from "../omp-commands.js";
import { commandPaths, commandStatus, enableCommands, disableCommands } from "../omp-commands-install.mjs";

function harness(approval=true,selected) {
  const calls=[], notifications=[], prompts=[];
  const ctx={cwd:"/tmp/test-project",hasUI:true,ui:{
    notify:(msg,type)=>notifications.push({msg,type}),
    confirm:async (title,desc)=>{prompts.push({title,desc});return approval;},
    select:async (_title,options)=>{prompts.push({options});return selected;},
  }};
  const run=async (argv,cwd)=>{calls.push({argv,cwd});return {code:0,stdout:"OK",stderr:"",killed:false};};
  return {ctx,calls,notifications,prompts,run};
}
test("palette is opt-in command only: no tools, hooks, provider interceptors",()=>{
  const registrations=[];
  registerPifrost({
    registerCommand:(name,def)=>registrations.push({name,def}),
    on:()=>assert.fail("No event hooks"),
    registerTool:()=>assert.fail("No tools"),
    registerProvider:()=>assert.fail("No providers"),
  });
  assert.deepEqual(registrations.map(x=>x.name),["pifrost"]);
  assert.ok(registrations[0].def.description.includes("opt-in"));
  assert.ok(registrations[0].def.getArgumentCompletions("mod").length>=2);
});
test("read-only slash calls map to the current CLI",async()=>{
  const h=harness();
  await runPifrostSlash("status",h.ctx,h.run);
  await runPifrostSlash("models list",h.ctx,h.run);
  await runPifrostSlash("mcp",h.ctx,h.run);
  await runPifrostSlash("skills",h.ctx,h.run);
  await runPifrostSlash("commands",h.ctx,h.run);
  assert.deepEqual(h.calls.map(x=>x.argv),[
    ["doctor"],["models","list"],["repo","mcp","list"],
    ["repo","skills","list"],["omp","commands","status"],
  ]);
  assert.equal(h.prompts.length,0);
});
test("menu opens without sending any agent messages",async()=>{
  const h=harness(true,"Models");
  await runPifrostSlash("",h.ctx,h.run);
  assert.deepEqual(h.calls.map(x=>x.argv),[["models","status"]]);
  assert.deepEqual(h.prompts[0].options,["Status","Models","MCPs","Skills","Migration","Help"]);
});
test("mutations require an explicit interactive confirmation",async()=>{
  const denied=harness(false);
  await runPifrostSlash("models enable responses",denied.ctx,denied.run);
  await runPifrostSlash("skills add \"Data Analysis\"",denied.ctx,denied.run);
  assert.equal(denied.calls.length,0);
  assert.equal(denied.prompts.length,2);
  const accepted=harness(true);
  await runPifrostSlash("models enable responses",accepted.ctx,accepted.run);
  await runPifrostSlash("mcp add railway list-projects,get-logs",accepted.ctx,accepted.run);
  await runPifrostSlash("vmcp add 'Infrastructure Tools'",accepted.ctx,accepted.run);
  await runPifrostSlash("skills sync 'Data Analysis'",accepted.ctx,accepted.run);
  assert.deepEqual(accepted.calls.map(x=>x.argv),[
    ["models","enable","--api","responses"],
    ["repo","mcp","add","railway","--tools","list-projects,get-logs"],
    ["repo","vmcp","add","Infrastructure Tools"],
    ["repo","skills","sync","Data Analysis"],
  ]);
});
test("no arbitrary CLI commands or loose MCP grants through slash",async()=>{
  const h=harness();
  await runPifrostSlash("mcp add railway",h.ctx,h.run);
  await runPifrostSlash("routes sync",h.ctx,h.run);
  await runPifrostSlash("secret inference",h.ctx,h.run);
  await runPifrostSlash("skills add \"unclosed",h.ctx,h.run);
  assert.equal(h.calls.length,0);
  assert.ok(h.notifications.every(x=>x.type==="warning"));
  const headless=harness();
  headless.ctx.hasUI=false;
  await runPifrostSlash("models disable",headless.ctx,headless.run);
  assert.equal(headless.calls.length,0);
});
test("slash output is bounded and failures report truthfully",async()=>{
  const h=harness();
  await runPifrostSlash("models list",h.ctx,async()=>({code:0,stdout:"m".repeat(10000),stderr:""}));
  assert.match(h.notifications[0].msg,/truncated/);
  await runPifrostSlash("status",h.ctx,async()=>({code:2,stderr:"Not authenticated",stdout:""}));
  assert.equal(h.notifications[1].type,"error");
  await runPifrostSlash("status",h.ctx,async()=>({code:-1,killed:true}));
  assert.match(h.notifications[2].msg,/timed out/u);
});
test("CLI palette install/upgrade/remove respects ownership and local edits",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-pal-"));
  const env={PI_CODING_AGENT_DIR:root};
  try {
    const paths=commandPaths(env);
    assert.equal(commandStatus(env).status,"disabled");
    const first=enableCommands(env);
    assert.ok(first.changed);
    assert.equal(commandStatus(env).status,"enabled");
    assert.equal(enableCommands(env).changed,false);
    assert.match(readFileSync(paths.file,"utf8"),/PIFROST-COMMAND-PALETTE-V1/u);
    writeFileSync(paths.file,readFileSync(paths.file,"utf8")+"\n// local edit");
    assert.equal(commandStatus(env).status,"unmanaged");
    assert.throws(()=>disableCommands(env),/unmanaged\/modified/u);
    assert.throws(()=>enableCommands(env),/unowned, changed/u);
  } finally{rmSync(root,{recursive:true,force:true});}
});
test("managed palette can be safely disabled with backup",()=>{
  const root=mkdtempSync(join(tmpdir(),"pifrost-pal-off-"));
  const env={PI_CODING_AGENT_DIR:root};
  try{
    enableCommands(env);
    const disabled=disableCommands(env);
    assert.ok(disabled.changed);
    assert.ok(existsSync(disabled.backup));
    assert.equal(commandStatus(env).status,"disabled");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("gateway errors are not reflected into persistent OMP UI output",async()=>{
  const h=harness();
  const secret="Bearer unusually-sensitive-value";
  await runPifrostSlash("status",h.ctx,async()=>({code:2,stdout:"",stderr:"Error: "+secret}));
  assert.equal(h.notifications.at(-1).type,"error");
  assert.doesNotMatch(h.notifications.at(-1).msg,/unusually-sensitive-value/u);
});
test("OMP command palette redacts VKs, authorization headers and URL tokens",async()=>{
  const h=harness();
  await runPifrostSlash("models list",h.ctx,async()=>({code:0,stderr:"",
    stdout:"Authorization: Bearer super-secret\nx-bf-vk: vk-testing-long-and-secret\nhttps://api.local/v1?token=sensitive"}));
  const message=h.notifications.at(-1).msg;
  assert.doesNotMatch(message,/super-secret|vk-testing-long-and-secret|token=sensitive/u);
});
