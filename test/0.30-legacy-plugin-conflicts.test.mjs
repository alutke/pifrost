import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {legacyPifrostConflicts} from "../legacy-plugin-conflicts.mjs";

test("fails closed when plugin inventory is incomplete",()=>{
 assert.throws(()=>legacyPifrostConflicts({npm:[]}),/Incomplete OMP plugin inventory/u);
});
test("detects npm and marketplace legacy Pifrost runtimes but ignores unrelated plugins",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-collision-"));
 try{
  const found=legacyPifrostConflicts({
    npm:[{name:"pifrost",enabled:true},{name:"unrelated",enabled:true}],
    marketplace:[{id:"someone/pifrost",scope:"project",entries:[]},
      {id:"other-tool",entries:[]}],
  },{PI_CODING_AGENT_DIR:root},root);
  assert.deepEqual(found.map(x=>x.type),["npm","marketplace"]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("detects project and user extensions and active settings, excluding owned command-only palette",()=>{
 const root=mkdtempSync(join(tmpdir(),"pifrost-ext-"));
 const user=join(root,"agent"),project=join(root,"project");
 try{
  mkdirSync(join(user,"extensions"),{recursive:true});
  mkdirSync(join(project,".omp/extensions"),{recursive:true});
  mkdirSync(join(project,".omp"),{recursive:true});
  writeFileSync(join(user,"extensions","pifrost-commands.js"),"// palette");
  writeFileSync(join(project,".omp/extensions","legacy-pifrost.js"),"// legacy");
  writeFileSync(join(user,"settings.json"),JSON.stringify({extensions:["./legacy-pifrost.js"]}));
  const found=legacyPifrostConflicts({npm:[],marketplace:[]},{PI_CODING_AGENT_DIR:user},project);
  assert.deepEqual(found.map(x=>x.type).sort(),["extension","settings"]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
